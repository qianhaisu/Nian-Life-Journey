#!/usr/bin/env node
// Consolidates duplicate-organization_fingerprint DailyTrace rows so the fingerprint can become a
// database-enforced unique key.
//
// DRY RUN BY DEFAULT. `--apply` is required to write, and even then the script refuses to run if
// anything about the data has moved since it was audited.
//
// ---------------------------------------------------------------------------------------------
// Why these rows exist, and why consolidating them is not a judgement call
//
// persistDailyTrace() does SELECT-then-INSERT. Under READ COMMITTED the second worker cannot see
// the first's uncommitted row, so two workers organizing the SAME evidence both miss and both
// insert. That is the whole cause: every group is same-fingerprint, same-day, same-profile, seconds
// apart, all rule-derived.
//
// Had the race not happened, the second call would have found the first row and taken the merge
// branch, which is literally:
//
//     entries:   [...new Set([...existing.entries,   ...incoming.entries])]
//     sourceIds: [...new Set([...existing.sourceIds, ...incoming.sourceIds])]
//
// This script applies that same merge to the rows that exist. It is not a new consolidation
// semantic invented for a migration — it is the repository's own, replayed. Nothing is dropped.
//
// The divergence inside seven of the groups has a separate, already-fixed cause: the same-day merge
// removed in 573f4cc appended later batches to whichever row it happened to find, which is why one
// row in those groups carries sources its own organizerRun never saw (run.sourceCount < the row's).
// Union restores the state a single row would have held.
//
// Display impact: none, in the direction that matters. memory-chapters.ts already concatenates the
// entries of EVERY trace on a day into one TraceDay, so the family already sees the union — twice
// over for any line both rows held. Consolidation removes that doubling and changes nothing else.
// All 34 rows are rule-derived with no ledger row, so isTracePublishable() is false for every one:
// none is on the site today, and none becomes visible as a result of this.
//
// ---------------------------------------------------------------------------------------------
// Deterministic rules
//
//   survivor      earliest created_at; ties broken by id ascending. That is the row a non-racing
//                 run would have kept.
//   entries       union in survivor-first order, de-duplicated (the repository's merge).
//   sourceIds     union in survivor-first order, de-duplicated (the repository's merge).
//   organizerRun  the run whose organizationFingerprint EQUALS the row's fingerprint, if any —
//                 otherwise the earliest processedAt. This repairs provenance rather than
//                 propagating the day-merge's foreign run. It cannot change publication state:
//                 requiresQualityReview() reads organizerType, which is "rule" on every candidate.
//   occurredAt / scopes / visibility / profileId
//                 asserted EQUAL across the group and carried through unchanged. If any group ever
//                 disagreed the script would abort rather than pick.
//
//   node --import tsx -r dotenv/config scripts/organizer-trace-fingerprint-remediate.mjs \
//     [--apply] --before=<path>.json dotenv_config_path=.env.local
import { writeFileSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const APPLY = args.includes("--apply");
const BEFORE = argOf("before", null);
if (APPLY && !BEFORE) { console.error("--apply requires --before=<path> so the pre-state is captured."); process.exit(1); }

const url = process.env.DATABASE_URL;
if (!url) { console.error("no DATABASE_URL"); process.exit(1); }
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const before = {
  traces: (await c.query("select count(*)::int n from daily_traces")).rows[0].n,
  distinct: (await c.query("select count(distinct organization_fingerprint)::int n from daily_traces")).rows[0].n,
  lifeEvents: (await c.query("select count(*)::int n from life_events")).rows[0].n,
  reviews: (await c.query("select count(*)::int n from content_quality_reviews")).rows[0].n,
  organizerRuns: (await c.query("select count(*)::int n from organizer_runs")).rows[0].n,
  rawSources: (await c.query("select count(*)::int n from raw_sources")).rows[0].n,
};
console.log("BEFORE:", JSON.stringify(before));

const { rows: groups } = await c.query(`
  select organization_fingerprint fp from daily_traces
  where organization_fingerprint is not null group by 1 having count(*) > 1 order by 1
`);
console.log(`duplicate fingerprint groups: ${groups.length}`);

const plan = [];
const abort = [];
for (const { fp } of groups) {
  const { rows } = await c.query(`
    select id, profile_id, occurred_at, entries, source_ids, scopes, visibility, organizer_run,
           organization_fingerprint, created_at, updated_at
    from daily_traces where organization_fingerprint = $1 order by created_at asc, id asc
  `, [fp]);

  // Nothing in the schema points at a daily_traces row (verified: zero foreign keys reference it,
  // and source_memory_links targets life_events only), so the only external binding that could be
  // lost is a ledger row. Refuse outright if one exists rather than trying to repoint it.
  const { rows: reviews } = await c.query("select id, target_id, decision from content_quality_reviews where target_id = any($1)", [rows.map((r) => r.id)]);
  if (reviews.length) { abort.push(`${fp}: ${reviews.length} quality-review row(s) attached — refusing to consolidate a reviewed artifact`); continue; }

  const disagree = (field, get) => new Set(rows.map((r) => JSON.stringify(get(r)))).size > 1 ? field : null;
  const conflicts = [
    disagree("profile_id", (r) => r.profile_id),
    disagree("occurred_at", (r) => String(r.occurred_at)),
    disagree("visibility", (r) => r.visibility),
    disagree("scopes", (r) => [...(r.scopes ?? [])].sort()),
  ].filter(Boolean);
  if (conflicts.length) { abort.push(`${fp}: rows disagree on ${conflicts.join(", ")} — refusing to pick a winner`); continue; }

  const survivor = rows[0];
  const losers = rows.slice(1);
  const entries = [...new Set(rows.flatMap((r) => r.entries ?? []))];
  const sourceIds = [...new Set(rows.flatMap((r) => r.source_ids ?? []))];
  const matching = rows.filter((r) => r.organizer_run?.organizationFingerprint === fp);
  const runPool = matching.length ? matching : rows;
  const organizerRun = [...runPool].sort((a, b) => String(a.organizer_run?.processedAt ?? "").localeCompare(String(b.organizer_run?.processedAt ?? "")))[0].organizer_run;

  // Losslessness, asserted rather than assumed: every entry and every source id present anywhere in
  // the group must be present in the survivor afterwards.
  for (const r of rows) {
    for (const e of r.entries ?? []) if (!entries.includes(e)) abort.push(`${fp}: entry would be lost`);
    for (const s of r.source_ids ?? []) if (!sourceIds.includes(s)) abort.push(`${fp}: source id would be lost`);
  }

  plan.push({
    fingerprint: fp,
    survivorId: survivor.id,
    deleteIds: losers.map((r) => r.id),
    before: rows.map((r) => ({ id: r.id, entries: r.entries, sourceIds: r.source_ids, organizerRun: r.organizer_run, createdAt: String(r.created_at), updatedAt: String(r.updated_at), occurredAt: String(r.occurred_at), scopes: r.scopes, visibility: r.visibility, profileId: r.profile_id })),
    after: { entries, sourceIds, organizerRun },
    entryDelta: entries.length - (survivor.entries ?? []).length,
    sourceDelta: sourceIds.length - (survivor.source_ids ?? []).length,
    runRepaired: survivor.organizer_run?.organizationFingerprint !== organizerRun?.organizationFingerprint,
  });
}

if (abort.length) {
  console.error("\nREFUSING TO PROCEED:");
  for (const a of abort) console.error("  -", a);
  await c.end();
  process.exit(2);
}

console.log(`\nplan: ${plan.length} groups, ${plan.reduce((a, p) => a + p.deleteIds.length, 0)} rows to delete\n`);
for (const p of plan) {
  console.log(`${p.fingerprint.slice(0, 12)}  keep ${p.survivorId}  delete ${p.deleteIds.join(",")}  entries +${p.entryDelta}  sources +${p.sourceDelta}  runRepaired=${p.runRepaired}`);
}

if (BEFORE) { writeFileSync(BEFORE, JSON.stringify({ capturedAt: new Date().toISOString(), before, plan }, null, 2)); console.log(`\nbefore-state + full plan (FAMILY TEXT — keep outside the repo) -> ${BEFORE}`); }

if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with --apply to execute."); await c.end(); process.exit(0); }

// ---------------------------------------------------------------- apply, one transaction
console.log("\nAPPLYING…");
await c.query("begin");
try {
  let updated = 0, deleted = 0;
  for (const p of plan) {
    const res = await c.query(
      `update daily_traces set entries = $1::jsonb, source_ids = $2::jsonb, organizer_run = $3::jsonb, updated_at = now()
       where id = $4`,
      [JSON.stringify(p.after.entries), JSON.stringify(p.after.sourceIds), JSON.stringify(p.after.organizerRun), p.survivorId],
    );
    updated += res.rowCount;
    const del = await c.query("delete from daily_traces where id = any($1)", [p.deleteIds]);
    deleted += del.rowCount;
  }
  console.log(`updated ${updated} survivors, deleted ${deleted} duplicates`);

  const { rows: left } = await c.query(`
    select count(*)::int n from (
      select organization_fingerprint from daily_traces where organization_fingerprint is not null
      group by 1 having count(*) > 1) x
  `);
  if (left[0].n !== 0) throw new Error(`still ${left[0].n} duplicate groups after consolidation — rolling back`);

  const after = (await c.query("select count(*)::int n from daily_traces")).rows[0].n;
  if (after !== before.traces - deleted) throw new Error(`row count ${after} != expected ${before.traces - deleted} — rolling back`);

  await c.query("commit");
  console.log(`\nCOMMITTED. daily_traces ${before.traces} -> ${after}, duplicate groups 0`);
} catch (error) {
  await c.query("rollback");
  console.error("\nROLLED BACK:", error?.message ?? error);
  await c.end();
  process.exit(3);
}

const afterState = {
  traces: (await c.query("select count(*)::int n from daily_traces")).rows[0].n,
  distinct: (await c.query("select count(distinct organization_fingerprint)::int n from daily_traces")).rows[0].n,
  lifeEvents: (await c.query("select count(*)::int n from life_events")).rows[0].n,
  reviews: (await c.query("select count(*)::int n from content_quality_reviews")).rows[0].n,
  organizerRuns: (await c.query("select count(*)::int n from organizer_runs")).rows[0].n,
  rawSources: (await c.query("select count(*)::int n from raw_sources")).rows[0].n,
};
console.log("AFTER: ", JSON.stringify(afterState));
for (const key of ["lifeEvents", "reviews", "organizerRuns", "rawSources"]) {
  if (afterState[key] !== before[key]) console.error(`UNEXPECTED: ${key} changed ${before[key]} -> ${afterState[key]}`);
}
await c.end();
