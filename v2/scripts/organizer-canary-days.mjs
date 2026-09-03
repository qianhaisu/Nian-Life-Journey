// Read-only helper for the canary plan: which fresh-pool days already hold DailyTrace rows, what
// ledger decisions those rows carry, and whether any fresh day is genuinely trace-free.
//   node --import tsx -r dotenv/config scripts/organizer-canary-days.mjs --manifest=<fresh shadow json> dotenv_config_path=.env.local
import { readFileSync } from "node:fs";
import pg from "pg";

const args = process.argv.slice(2);
const manifestPath = args.find((a) => a.startsWith("--manifest="))?.slice(11);
if (!manifestPath) { console.error("--manifest=<fresh shadow json>"); process.exit(1); }
const PROFILE_ID = "profile-zhangnian";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")).manifest.windows;

const client = new pg.Client({ connectionString: process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const traces = (await client.query(`select t.id, to_char(t.occurred_at,'YYYY-MM-DD') as day, jsonb_array_length(t.entries) as entries, t.organizer_run->>'organizerType' as organizer_type, r.decision
  from daily_traces t left join content_quality_reviews r on r.target_kind='daily_trace' and r.target_id=t.id where t.profile_id=$1 order by t.occurred_at`, [PROFILE_ID])).rows;
const byDay = new Map();
for (const t of traces) { if (!byDay.has(t.day)) byDay.set(t.day, []); byDay.get(t.day).push(t); }

const ledger = (await client.query(`select target_kind, decision, count(*)::int as n from content_quality_reviews where profile_id=$1 group by 1,2 order by 1,2`, [PROFILE_ID])).rows;
console.log("ledger:", ledger.map((r) => `${r.target_kind}/${r.decision}=${r.n}`).join("  "));
console.log(`daily_traces: ${traces.length} rows over ${byDay.size} days; days with >1 row: ${[...byDay.values()].filter((v) => v.length > 1).length}`);

const days = [...new Set(manifest.map((w) => w.lifeDate))].sort();
for (const day of days) {
  const rows = byDay.get(day) ?? [];
  const wins = manifest.filter((w) => w.lifeDate === day).map((w) => `${w.fingerprint.slice(0, 8)}:${w.action}/${w.promotable}`);
  console.log(`${day}  traces=${rows.length} ${rows.map((t) => `${t.id.slice(0, 14)}(${t.organizer_type ?? "?"},${t.entries}e,${t.decision ?? "no-row"})`).join(" ")}  windows: ${wins.join(" ")}`);
}
await client.end();
