#!/usr/bin/env node
// One-time historical backfill: organize unorganized WeChat RawSources using the rule-based
// organizer with a shared store. Loading the store once avoids O(N × getStore) cost — the reason
// this must NOT go through organizer-worker.mjs (which calls getStore() per job).
//
// Usage:
//   node --import tsx scripts/backfill-wechat-organizer.mjs
//   node --import tsx scripts/backfill-wechat-organizer.mjs --month=2025-09
//   node --import tsx scripts/backfill-wechat-organizer.mjs --limit=200
//   node --import tsx scripts/backfill-wechat-organizer.mjs --dry-run
import path from "node:path";
import { openSync, closeSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
// dotenv MUST run before any repository module is dynamically imported — repository.ts creates its
// singleton at module-load time and reads process.env then.
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

// Dynamic imports so env is fully set before repository.ts runs createRepository()
const { getOrganizerStore } = await import("../lib/db/repository.ts");
const { RuleBasedMemoryOrganizer } = await import("../lib/organizer/rule-based.ts");
const { preGroupSources } = await import("../lib/organizer/pre-group.ts");
const { CANONICAL_PROFILE_ID } = await import("../lib/db/config.ts");
// getOrganizerStore's rawSources select omits `status`, so we query uploaded IDs separately via pg
const { Client } = await import("pg");
const { readFileSync } = await import("node:fs");

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const monthArg = args.find((a) => a.startsWith("--month="));
const dryRun = args.includes("--dry-run");
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : Infinity;
const targetMonth = monthArg ? monthArg.slice("--month=".length) : undefined;

if (dryRun) console.log("DRY-RUN mode: no data will be written.");
if (targetMonth) console.log(`Month filter: ${targetMonth}`);
if (limit < Infinity) console.log(`Limit: first ${limit} groups`);

// Exclusive lock file — prevents two concurrent backfill runs from racing and creating
// duplicate LifeEvents. The TOCTOU race in persistOrganization is fixed at the DB level,
// but this guards the shared store (loaded once) from being processed twice in parallel.
const LOCK_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "backfill-wechat-organizer.lock");
let lockFd;
try {
  lockFd = openSync(LOCK_FILE, "wx"); // exclusive create — fails if file exists
} catch {
  console.error(`\nAnother backfill instance is already running (lock file: ${LOCK_FILE}).\nIf no instance is running, delete the lock file and retry.`);
  process.exit(1);
}
const releaseLock = () => { try { closeSync(lockFd); unlinkSync(LOCK_FILE); } catch { /**/ } };
process.on("exit", releaseLock);
process.on("SIGINT", () => { releaseLock(); process.exit(130); });
process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

// Step 1: query the set of uploaded wechat source IDs from DB directly
// (getOrganizerStore's rawSources select omits the `status` column)
function parseEnv(envPath) {
  try {
    const raw = readFileSync(envPath, "utf8");
    const env = {};
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      env[key] = val;
    }
    return env;
  } catch { return {}; }
}
const envLocal = parseEnv(path.resolve(process.cwd(), ".env.local"));
const dbUrl = envLocal.DATABASE_URL_UNPOOLED || envLocal.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!dbUrl) { console.error("DATABASE_URL not found"); process.exit(1); }

const pgClient = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await pgClient.connect();
let uploadedRows;
if (targetMonth) {
  uploadedRows = await pgClient.query(
    // captured_at is timestamptz: it MUST be converted into Shanghai before the month is read,
    // otherwise a message sent between Shanghai 00:00 and 07:59 on the 1st is filed in the previous
    // month (Postgres renders a timestamptz through the session TimeZone, which is GMT here).
    `SELECT id FROM raw_sources WHERE source_type='wechat' AND status='uploaded' AND to_char(captured_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM')=$1`,
    [targetMonth]
  );
} else {
  uploadedRows = await pgClient.query(
    `SELECT id FROM raw_sources WHERE source_type='wechat' AND status='uploaded'`
  );
}
await pgClient.end();
const uploadedIds = new Set(uploadedRows.rows.map((r) => r.id));
console.log(`\nUnorganized WeChat sources (from DB): ${uploadedIds.size}`);

console.log("\nLoading organizer store (may take ~80s with current data volume)...");
const t0 = Date.now();
const store = await getOrganizerStore(CANONICAL_PROFILE_ID);
const loadMs = Date.now() - t0;
console.log(`Store loaded in ${(loadMs / 1000).toFixed(1)}s: ${store.rawSources.length} rawSources, ${store.events.length} events`);

// Filter to unorganized WeChat sources only using the ID set from DB
let unorganized = store.rawSources.filter((s) =>
  s.sourceType === "wechat" && uploadedIds.has(s.id) && !s.deletedAt
);

console.log(`\nUnorganized WeChat sources: ${unorganized.length}`);
if (unorganized.length === 0) { console.log("Nothing to organize."); process.exit(0); }

// By-month breakdown
const byMonth = {};
for (const s of unorganized) {
  const m = s.capturedAt.slice(0, 7);
  byMonth[m] = (byMonth[m] ?? 0) + 1;
}
console.log("By month:", JSON.stringify(byMonth));

// Pre-group using the standard algorithm (3-hour window, same-day, compatible family)
const groups = preGroupSources(unorganized);
const groupsToProcess = limit < Infinity ? groups.slice(0, limit) : groups;
console.log(`\nPre-grouped into ${groups.length} groups, processing ${groupsToProcess.length}`);

const organizer = new RuleBasedMemoryOrganizer();
const counts = { daily_trace: 0, create_memory: 0, attach_existing: 0, store_only: 0, care_episode: 0, skipped_prior: 0, failed: 0 };
const t1 = Date.now();

for (let i = 0; i < groupsToProcess.length; i++) {
  const group = groupsToProcess[i];
  const sourceIds = group.map((s) => s.id);
  try {
    const result = await organizer.organize(sourceIds, { store, dryRun });
    if (result.action === "daily_trace") counts.daily_trace++;
    else if (result.action === "create_memory" || result.action === "attach_existing") {
      counts[result.action]++;
    } else if (result.action === "store_only") counts.store_only++;
    else if (result.action === "care_episode") counts.care_episode++;
    else counts.skipped_prior++;
  } catch (err) {
    counts.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  Group ${i + 1} failed: ${msg.slice(0, 120)}`);
  }
  if ((i + 1) % 100 === 0 || i + 1 === groupsToProcess.length) {
    const elapsedSec = ((Date.now() - t1) / 1000).toFixed(0);
    const rate = ((i + 1) / ((Date.now() - t1) / 1000)).toFixed(1);
    console.log(`  [${i + 1}/${groupsToProcess.length}] elapsed=${elapsedSec}s rate=${rate}/s counts=${JSON.stringify(counts)}`);
  }
}

const totalSec = ((Date.now() - t1) / 1000).toFixed(1);
console.log(`\n=== Backfill done: ${groupsToProcess.length} groups in ${totalSec}s ===`);
console.log("Action breakdown:", JSON.stringify(counts, null, 2));
if (dryRun) console.log("\n(DRY-RUN: nothing written to DB)");
