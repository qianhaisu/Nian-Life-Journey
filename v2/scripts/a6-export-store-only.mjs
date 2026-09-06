#!/usr/bin/env node
// READ-ONLY. Dumps 2025 store_only life_events (title/story text + month) to a JSON file
// outside the repo so a human/AI reader can classify them for the A-6 trace-layer marker.
// Does not touch life_events, content_quality_reviews, or any other table.
//
//   node --import tsx -r dotenv/config scripts/a6-export-store-only.mjs --out=<path outside repo>.json \
//     dotenv_config_path=.env.local
import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
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

// Latest review per (target_id) by reviewed_at — a life_event can have more than one review row
// (e.g. this script's own marker rows land here later); take the most recent *grading* decision.
const { rows } = await client.query(`
  select e.id, e.title, e.story, e.occurred_at,
         to_char(e.occurred_at, 'YYYY-MM') as month,
         r.decision, r.reason_codes, r.reviewed_at
  from life_events e
  join lateral (
    select decision, reason_codes, reviewed_at
    from content_quality_reviews
    where target_kind = 'life_event' and target_id = e.id and provider != 'cowork-a6'
    order by reviewed_at desc
    limit 1
  ) r on true
  where e.profile_id = $1
    and e.occurred_at >= '2025-01-01' and e.occurred_at < '2026-01-01'
    and r.decision = 'store_only'
  order by e.occurred_at, e.id
`, [PROFILE_ID]);

await client.end();

const byMonth = {};
for (const row of rows) {
  (byMonth[row.month] ??= []).push({
    id: row.id,
    title: row.title,
    story: row.story,
    occurred_at: row.occurred_at,
  });
}

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: rows.length, byMonth }, null, 2), "utf8");
console.log(`store_only 2025 life_events: ${rows.length}`);
for (const m of Object.keys(byMonth).sort()) console.log(`  ${m}: ${byMonth[m].length}`);
console.log(`written to ${OUT}`);
