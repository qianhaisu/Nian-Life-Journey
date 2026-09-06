#!/usr/bin/env node
// READ-ONLY. A-8: statistics + a random sample of 2026 approved life_events that have exactly one
// linked raw_source (the pattern A-7 found responsible for 100% of its fabrication hits in 2025).
// Does not touch any table.
//
//   node --import tsx -r dotenv/config scripts/a8-single-source-audit-2026.mjs --out=<path outside repo>.json \
//     [--sample=25] [--seed=a8] dotenv_config_path=.env.local
import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const SAMPLE_SIZE = Number(argOf("sample", "25"));
const SEED = argOf("seed", "a8");
const PROFILE_ID = "profile-zhangnian";
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
if (!OUT) { console.error("--out required"); process.exit(1); }
if (resolve(OUT) === REPO_ROOT || resolve(OUT).startsWith(REPO_ROOT + sep)) {
  console.error("--out must point outside the repository (the JSON carries real family text)."); process.exit(1);
}

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: events } = await client.query(`
  select e.id, e.title, e.story, e.occurred_at, jsonb_array_length(e.source_ids::jsonb) as n_sources,
         to_char(e.occurred_at, 'YYYY-MM') as month
  from life_events e
  join lateral (
    select decision
    from content_quality_reviews
    where target_kind = 'life_event' and target_id = e.id and provider != 'cowork-a6'
    order by reviewed_at desc
    limit 1
  ) r on true
  where e.profile_id = $1
    and e.occurred_at >= '2026-01-01' and e.occurred_at < '2027-01-01'
    and r.decision = 'approved'
  order by e.occurred_at, e.id
`, [PROFILE_ID]);

const total = events.length;
const singleSource = events.filter((e) => Number(e.n_sources) === 1);
const byMonthAll = {};
const byMonthSingle = {};
for (const e of events) byMonthAll[e.month] = (byMonthAll[e.month] ?? 0) + 1;
for (const e of singleSource) byMonthSingle[e.month] = (byMonthSingle[e.month] ?? 0) + 1;

// Deterministic pseudo-random sample so a re-run with the same seed reproduces the same sample
// (useful if Cowork wants to verify the exact same 25 independently).
const scored = singleSource.map((e) => ({
  e,
  key: createHash("sha256").update(`${SEED}:${e.id}`).digest("hex"),
}));
scored.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const sampleIds = scored.slice(0, SAMPLE_SIZE).map((s) => s.e.id);

const { rows: links } = await client.query(`
  select l.life_event_id, l.raw_source_id, l.role, s.captured_at, s.text, s.source_type, s.source_label
  from source_memory_links l join raw_sources s on s.id = l.raw_source_id
  where l.life_event_id = any($1::text[])
  order by s.captured_at
`, [sampleIds]);

await client.end();

const linksByEvent = new Map();
for (const l of links) {
  if (!linksByEvent.has(l.life_event_id)) linksByEvent.set(l.life_event_id, []);
  linksByEvent.get(l.life_event_id).push({ role: l.role, capturedAt: l.captured_at, text: l.text, sourceLabel: l.source_label });
}

const sample = singleSource
  .filter((e) => sampleIds.includes(e.id))
  .map((e) => ({ id: e.id, title: e.title, story: e.story, occurredAt: e.occurred_at, month: e.month, evidence: linksByEvent.get(e.id) ?? [] }));

const fullSingleSourceList = singleSource.map((e) => ({ id: e.id, title: e.title, month: e.month, occurredAt: e.occurred_at }));

writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalApproved2026: total,
  singleSourceCount: singleSource.length,
  singleSourcePercent: Math.round((singleSource.length / total) * 1000) / 10,
  byMonthAllApproved: byMonthAll,
  byMonthSingleSource: byMonthSingle,
  sampleSize: sample.length,
  sample,
  fullSingleSourceList,
}, null, 2), "utf8");

console.log(`2026 approved life_events: ${total}`);
console.log(`single-source: ${singleSource.length} (${Math.round((singleSource.length / total) * 1000) / 10}%)`);
console.log(`sample drawn: ${sample.length}`);
console.log(`written to ${OUT}`);
