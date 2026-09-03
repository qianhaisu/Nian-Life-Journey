#!/usr/bin/env node
// READ-ONLY against production: exports the full Store to .data/nian-life.json so the local dev
// server can render REAL production data through the JSON backend at interactive speed. Uses plain
// pg (the drizzle pool stalls from this network) with the SAME publication gate the site applies
// (isEventPublishable / isTracePublishable over the quality ledger, exactly like
// postgres-repository.assembleStore). The previous local JSON store is backed up first.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { indexReviews, isEventPublishable, isTracePublishable, normalizeQualityDecision } from "../lib/organizer/quality-review.ts";

if (!process.env.DATABASE_URL) { console.error("Need DATABASE_URL (run with dotenv over v2/.env.local)."); process.exit(1); }
// Timestamps must stay strings exactly as drizzle mode:"string" returns them.
for (const oid of [1082, 1114, 1184]) pg.types.setTypeParser(oid, (value) => value);

// Long single-connection bulk reads over this network get cut ("Connection terminated
// unexpectedly"), so: unpooled endpoint, ONE query at a time, keyset pagination, and a fresh
// connection + retry when the wire drops. Still strictly read-only.
const CONN = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const PAGE = 1000;
// raw_sources rows carry chat text + metadata and are much heavier on the wire.
const PAGE_BY_TABLE = { raw_sources: 200 };
let client;
async function connect() {
  if (client) try { client.end().catch(() => {}); } catch { /* gone already */ }
  // query_timeout matters: this network sometimes black-holes a transfer without an error, and
  // only a timeout turns that hang into something the retry path can act on.
  client = new pg.Client({ connectionString: CONN, ssl: { rejectUnauthorized: false }, query_timeout: 90000, statement_timeout: 85000, connectionTimeoutMillis: 20000 });
  await client.connect();
}
await connect();

const camel = (key) => key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const mapRow = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value === null ? undefined : value]));
async function query(sql, params = [], attempt = 1) {
  try { return await client.query(sql, params); }
  catch (error) {
    if (attempt >= 6) throw error;
    console.log(`  retry ${attempt} after: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    await connect();
    return query(sql, params, attempt + 1);
  }
}
// Per-table cache so a dropped run resumes instead of refetching everything. Local scratch only.
const cacheDir = path.join(process.cwd(), ".data", "tmp", "p1a2-export");
mkdirSync(cacheDir, { recursive: true });
async function all(table) {
  const cacheFile = path.join(cacheDir, `${table}.json`);
  if (existsSync(cacheFile)) {
    const rows = JSON.parse(readFileSync(cacheFile, "utf8"));
    console.log(`  ${table}: ${rows.length} rows (cached)`);
    return rows;
  }
  const started = Date.now();
  const pageSize = PAGE_BY_TABLE[table] ?? PAGE;
  const rows = [];
  let after = "";
  for (;;) {
    const { rows: page } = await query(`select * from ${table} where id > $1 order by id limit ${pageSize}`, [after]);
    rows.push(...page.map(mapRow));
    console.log(`    ${table} +${page.length} (total ${rows.length})`);
    if (page.length < pageSize) break;
    after = page[page.length - 1].id;
  }
  writeFileSync(cacheFile, JSON.stringify(rows), "utf8");
  console.log(`  ${table}: ${rows.length} rows in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return rows;
}

console.log("Exporting production store (read-only)…");
const profiles = (await query(`select * from profiles where id = 'profile-zhangnian'`)).rows.map(mapRow);
const contributors = await all("contributors");
const media = await all("media");
const mediaAssets = await all("media_assets");
const mediaLocations = await all("media_locations");
const connectorStates = await all("connector_states");
const rawSources = await all("raw_sources");
const events = await all("life_events");
const dailyTraces = await all("daily_traces");
const growthRecords = await all("growth_records");
const careRecords = await all("care_records");
const careEpisodes = await all("care_episodes");
const monthlyFocusGoals = await all("monthly_focus_goals");
const organizerRuns = await all("organizer_runs");
const organizerJobs = await all("organizer_jobs");
const linkRows = (await query(`select * from source_memory_links`)).rows;
const links = linkRows.map(mapRow);
const reviewRows = await all("content_quality_reviews");
const snapshotRows = (await query(`select * from monthly_snapshot where profile_id='profile-zhangnian' order by month desc limit 1`)).rows.map(mapRow);
await client.end();

if (!profiles[0]) { console.error("No canonical profile row."); process.exit(1); }
const qualityReviews = reviewRows.map((row) => ({ ...row, decision: normalizeQualityDecision(row.decision) }));
const reviews = indexReviews(qualityReviews);
const store = {
  profile: profiles[0],
  contributors,
  media,
  mediaAssets,
  mediaLocations,
  connectorStates,
  rawSources,
  events: events.filter((event) => isEventPublishable(event, reviews)),
  dailyTraces: dailyTraces.filter((trace) => isTracePublishable(trace, reviews)),
  growthRecords, careRecords, careEpisodes, monthlyFocusGoals, organizerRuns, organizerJobs,
  chatImportTasks: [],
  links,
  qualityReviews,
  monthlySnapshot: snapshotRows[0] ?? null,
};
console.log(`events(publishable)=${store.events.length} traces(publishable)=${store.dailyTraces.length} media=${store.media.length} rawSources=${store.rawSources.length} reviews=${store.qualityReviews.length} locations=${store.mediaLocations.length}`);

const dataDir = path.join(process.cwd(), ".data");
const storeFile = path.join(dataDir, "nian-life.json");
mkdirSync(dataDir, { recursive: true });
if (existsSync(storeFile)) {
  const backup = path.join(dataDir, `nian-life.json.bak-p1a2-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  copyFileSync(storeFile, backup);
  console.log(`backed up previous local store → ${backup}`);
}
writeFileSync(storeFile, JSON.stringify(store, null, 1), "utf8");
console.log(`wrote ${storeFile}`);
process.exit(0);
