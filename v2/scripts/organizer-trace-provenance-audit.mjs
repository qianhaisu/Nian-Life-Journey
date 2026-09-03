#!/usr/bin/env node
// READ-ONLY audit of DailyTrace identity and provenance in production.
//
// Answers the questions Canary #1 left open: how many trace rows exist, how many days they cover,
// who produced them, which of them carry a quality-ledger row, and — the one that decides whether
// the day-merge in persistDailyTrace() is a live hazard — what would happen to each existing row's
// publication state if an AI-derived trace merged into it.
//
// SELECT only. It never writes daily_traces, life_events, content_quality_reviews or raw_sources.
//
//   node --import tsx -r dotenv/config scripts/organizer-trace-provenance-audit.mjs \
//     --out=<path>.json dotenv_config_path=.env.local
import { writeFileSync } from "node:fs";
import pg from "pg";
import { indexReviews, isTracePublishable, requiresQualityReview } from "../lib/organizer/quality-review.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const PROFILE_ID = argOf("profile", "profile-zhangnian");

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const one = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);

// ---- 1. Headline counts, independently recomputed --------------------------------------------
const counts = {
  lifeEvents: await one("select count(*)::int n from life_events where profile_id = $1", [PROFILE_ID]),
  dailyTraces: await one("select count(*)::int n from daily_traces where profile_id = $1", [PROFILE_ID]),
  organizerRuns: await one("select count(*)::int n from organizer_runs where profile_id = $1", [PROFILE_ID]),
  qualityReviews: await one("select count(*)::int n from content_quality_reviews where profile_id = $1", [PROFILE_ID]),
  rawSources: await one("select count(*)::int n from raw_sources where profile_id = $1", [PROFILE_ID]),
  media: await one("select count(*)::int n from media where profile_id = $1", [PROFILE_ID]),
  sourceMemoryLinks: await one("select count(*)::int n from source_memory_links"),
  canaryRuns: await one("select count(*)::int n from organizer_runs where id like 'organizer-run-canary-%'"),
};

// ---- 2. Trace rows with provenance ------------------------------------------------------------
// `occurred_at` is a timestamp column; the pg driver hands back a JS Date, and the app's own day
// key is `occurredAt.slice(0, 10)` over the ISO string. Ask Postgres for that exact string so the
// audit groups days the way persistDailyTrace() does, rather than by a locale-formatted Date.
const { rows: traceRows } = await client.query(
  `select id, to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SS') as occurred_at_iso, occurred_at,
          entries, source_ids, visibility, organizer_run, organization_fingerprint,
          created_at, updated_at
     from daily_traces where profile_id = $1 order by occurred_at`,
  [PROFILE_ID],
);
const { rows: reviewRows } = await client.query(
  `select id, profile_id, target_kind, target_id, decision, reason_codes, provider, prompt_version,
          policy_version, reviewed_at
     from content_quality_reviews where profile_id = $1`,
  [PROFILE_ID],
);
const reviews = indexReviews(reviewRows.map((r) => ({ ...r, targetKind: r.target_kind, targetId: r.target_id })));

const traces = traceRows.map((r) => ({
  id: r.id,
  day: r.occurred_at_iso.slice(0, 10),
  occurredAt: r.occurred_at_iso,
  entries: r.entries ?? [],
  sourceIds: r.source_ids ?? [],
  visibility: r.visibility,
  organizerRun: r.organizer_run,
  organizationFingerprint: r.organization_fingerprint,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
}));

const byDay = new Map();
for (const t of traces) byDay.set(t.day, [...(byDay.get(t.day) ?? []), t]);

const provenance = { rule: 0, ai: 0, none: 0, otherType: 0 };
const fingerprint = { present: 0, missing: 0, distinct: new Set() };
const ledger = { withRow: 0, withoutRow: 0, byDecision: {} };
const publication = { publishable: 0, hidden: 0 };
// The hazard: a trace that is hidden today only because requiresQualityReview() sees rule
// provenance. Merging an AI run into it flips organizerRun.organizerType to "ai", the ledger has no
// row, and isTracePublishable() then returns true — the legacy row publishes itself.
const hazard = { flipsToPublishedOnMerge: [], inheritsApproval: [], safe: 0 };

for (const t of traces) {
  const type = t.organizerRun?.organizerType;
  if (type === "rule") provenance.rule += 1;
  else if (type === "ai") provenance.ai += 1;
  else if (!type) provenance.none += 1;
  else provenance.otherType += 1;

  if (t.organizationFingerprint) { fingerprint.present += 1; fingerprint.distinct.add(t.organizationFingerprint); }
  else fingerprint.missing += 1;

  const decision = reviews.get(`daily_trace:${t.id}`);
  if (decision !== undefined) {
    ledger.withRow += 1;
    ledger.byDecision[decision] = (ledger.byDecision[decision] ?? 0) + 1;
  } else ledger.withoutRow += 1;

  const publishableNow = isTracePublishable(t, reviews);
  if (publishableNow) publication.publishable += 1; else publication.hidden += 1;

  // Simulate the merge exactly as postgres-repository.persistDailyTrace() would apply it: the
  // incoming AI run replaces organizerRun; the row id, and therefore its ledger binding, is kept.
  const merged = { ...t, organizerRun: { ...(t.organizerRun ?? {}), organizerType: "ai" } };
  const publishableAfter = isTracePublishable(merged, reviews);
  if (!publishableNow && publishableAfter) {
    hazard.flipsToPublishedOnMerge.push({ id: t.id, day: t.day, entries: t.entries.length, sources: t.sourceIds.length, requiresReviewNow: requiresQualityReview(t) });
  } else if (decision === "approved") {
    hazard.inheritsApproval.push({ id: t.id, day: t.day, entries: t.entries.length, sources: t.sourceIds.length });
  } else hazard.safe += 1;
}

const daysWithMultipleRows = [...byDay.entries()].filter(([, rows]) => rows.length > 1);

// persistDailyTrace() looks a trace up by fingerprint first, so two rows sharing one fingerprint
// should be impossible through that path. Any collision is evidence of a second write path (the
// JSON→Postgres migration, a seed, or a race) and matters because it means fingerprint alone is
// not currently a key.
const byFingerprintKey = new Map();
for (const t of traces) {
  if (!t.organizationFingerprint) continue;
  byFingerprintKey.set(t.organizationFingerprint, [...(byFingerprintKey.get(t.organizationFingerprint) ?? []), t]);
}
const fingerprintCollisions = [...byFingerprintKey.entries()]
  .filter(([, rows]) => rows.length > 1)
  .map(([fp, rows]) => ({
    fingerprint: `${fp.slice(0, 12)}…`,
    rows: rows.length,
    sameDay: new Set(rows.map((r) => r.day)).size === 1,
    days: [...new Set(rows.map((r) => r.day))],
    ids: rows.map((r) => r.id),
    createdAt: rows.map((r) => r.createdAt),
    entryCounts: rows.map((r) => r.entries.length),
    sourceCounts: rows.map((r) => r.sourceIds.length),
    identicalEntries: new Set(rows.map((r) => JSON.stringify(r.entries))).size === 1,
  }));

// ---- 3. Which days the evidence pipeline would land on ----------------------------------------
const { rows: dayCoverage } = await client.query(
  `select count(distinct (captured_at at time zone 'Asia/Shanghai')::date)::int n
     from raw_sources where profile_id = $1`,
  [PROFILE_ID],
);

const report = {
  generatedAt: new Date().toISOString(),
  profileId: PROFILE_ID,
  counts,
  traces: {
    total: traces.length,
    distinctDays: byDay.size,
    daysWithMultipleRows: daysWithMultipleRows.length,
    multiRowDays: daysWithMultipleRows.map(([day, rows]) => ({ day, rows: rows.length, ids: rows.map((r) => r.id) })),
    provenance,
    fingerprint: { present: fingerprint.present, missing: fingerprint.missing, distinct: fingerprint.distinct.size },
    fingerprintCollisions: { groups: fingerprintCollisions.length, detail: fingerprintCollisions },
    ledger,
    publication,
    hazard: {
      flipsToPublishedOnMerge: hazard.flipsToPublishedOnMerge.length,
      inheritsApproval: hazard.inheritsApproval.length,
      safe: hazard.safe,
      flipSample: hazard.flipsToPublishedOnMerge.slice(0, 10),
      approvalSample: hazard.inheritsApproval.slice(0, 10),
    },
    earliestDay: traces[0]?.day ?? null,
    latestDay: traces[traces.length - 1]?.day ?? null,
  },
  rawSourceDistinctDays: dayCoverage[0].n,
};

console.log(JSON.stringify(report, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify({ ...report, traceRows: traces }, null, 2)); console.log(`\nFull rows (entries carry family text) → ${OUT}`); }
await client.end();
