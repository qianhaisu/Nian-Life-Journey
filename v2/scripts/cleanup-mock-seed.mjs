#!/usr/bin/env node
// Deterministic production cleanup for the JSON seed accidentally migrated before the
// real Quark photo initialization. It deliberately classifies only by (a) IDs present
// in the immutable seed file and (b) manifest checksum -> MediaAsset references.
//
// Usage:
//   node scripts/cleanup-mock-seed.mjs --dry-run
//   node scripts/cleanup-mock-seed.mjs --commit
// A commit writes a timestamped JSON backup outside this repository before the DB transaction.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const repoRoot = path.resolve(root, "..");
loadDotenv({ path: path.join(root, ".env.local"), quiet: true });

const commit = process.argv.includes("--commit");
const dryRun = process.argv.includes("--dry-run") || !commit;
const seedPath = path.join(root, ".data", "nian-life.json");
const manifestPath = path.join(repoRoot, ".github", "skills", "quarkclouddrive", "workbuddy", "storage", "quark-photo-prep-20260831", "artifacts", "task-items.jsonl");
const backupDir = process.env.NIANLIFE_MOCK_BACKUP_DIR || path.resolve(repoRoot, "..", "nianlife-backups");
const PROFILE_ID = "profile-zhangnian";
const WALK_EVENT_ID = "event-walk";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

function ids(rows = []) { return new Set(rows.map((row) => row.id).filter(Boolean)); }
function values(set) { return [...set]; }
function sameIds(actual, expected) {
  const a = [...actual].sort(); const e = [...expected].sort();
  return a.length === e.length && a.every((id, index) => id === e[index]);
}
function countByTable(snapshot) {
  return Object.fromEntries(Object.entries(snapshot).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : rows ? 1 : 0]));
}
function safeTimestamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function dateOf(value) { return new Date(value).toISOString().slice(0, 10); }

const seed = JSON.parse(await readFile(seedPath, "utf8"));
const manifest = (await readFile(manifestPath, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const manifestChecksums = new Set(manifest.filter((item) => item.kind === "photo" && item.download_status === "success" && item.checksum_duplicate === false && item.date_label === "in_window" && item.capture_time?.reliable === true).map((item) => `sha256:${item.sha256}`));

const seedIds = {
  contributors: ids(seed.contributors), rawSources: ids(seed.rawSources), mediaAssets: ids(seed.mediaAssets), mediaLocations: ids(seed.mediaLocations), media: ids(seed.media), events: ids(seed.events), dailyTraces: ids(seed.dailyTraces), growthRecords: ids(seed.growthRecords), careRecords: ids(seed.careRecords), careEpisodes: ids(seed.careEpisodes), monthlyFocusGoals: ids(seed.monthlyFocusGoals), connectorStates: ids(seed.connectorStates), organizerRuns: ids(seed.organizerRuns), organizerJobs: ids(seed.organizerJobs),
};

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const db = { query: (text, params = []) => pool.query(text, params) };
  const [assets, sources, media, locations, links, events, traces, runs, jobs, contributors] = await Promise.all([
    db.query("select * from media_assets where checksum = any($1)", [values(manifestChecksums)]),
    db.query("select * from raw_sources"), db.query("select * from media"), db.query("select * from media_locations"), db.query("select * from source_memory_links"), db.query("select * from life_events"), db.query("select * from daily_traces"), db.query("select * from organizer_runs"), db.query("select * from organizer_jobs"), db.query("select * from contributors"),
  ]);
  const realAssets = assets.rows;
  const realAssetIds = new Set(realAssets.map((row) => row.id));
  const realSourceIds = new Set(realAssets.map((row) => row.raw_source_id).filter(Boolean));
  const realMedia = media.rows.filter((row) => realAssetIds.has(row.media_asset_id));
  const realMediaIds = new Set(realMedia.map((row) => row.id));
  const walkRealMedia = realMedia.filter((row) => row.life_event_id === WALK_EVENT_ID);
  const walkRealSourceIds = new Set(walkRealMedia.map((row) => row.raw_source_id).filter(Boolean));
  const walkRealLinks = links.rows.filter((row) => row.life_event_id === WALK_EVENT_ID && realSourceIds.has(row.raw_source_id));
  const date17Sources = sources.rows.filter((row) => realSourceIds.has(row.id) && dateOf(row.captured_at) === "2026-08-17");
  const date17Ids = new Set(date17Sources.map((row) => row.id));

  // These guards implement the user-authorized scope: if this is not the known 107/12 state,
  // nothing is deleted because provenance is no longer certain enough.
  if (realAssets.length !== 107 || new Set(realAssets.map((row) => row.checksum)).size !== 107) throw new Error(`Expected exactly 107 existing manifest-proven real assets; found ${realAssets.length}`);
  const initialWalkState = walkRealMedia.length === 12 && sameIds(walkRealSourceIds, date17Ids);
  const detachedByThisCleanup = walkRealMedia.length === 0 && walkRealLinks.length === 0;
  if ((!initialWalkState && !detachedByThisCleanup) || date17Ids.size !== 12) throw new Error(`Expected the known 12-link state or this cleanup's detached state for ${WALK_EVENT_ID}; found media=${walkRealMedia.length}, sources=${date17Ids.size}, links=${walkRealLinks.length}`);
  if (!events.rows.some((row) => row.id === WALK_EVENT_ID) && !detachedByThisCleanup) throw new Error(`${WALK_EVENT_ID} is absent outside this cleanup's known detached state`);

  // A seeded contributor may now be referenced by a real Quark source or by an unrelated,
  // unclassified source. Either reference makes it non-removable in this cleanup.
  const retainedSeedContributorIds = new Set(sources.rows.filter((row) => seedIds.contributors.has(row.contributor_id)).map((row) => row.contributor_id));
  const removableContributorIds = values(new Set(values(seedIds.contributors).filter((id) => !retainedSeedContributorIds.has(id))));
  const seedLinkPairs = new Set((seed.links ?? []).map((row) => `${row.rawSourceId}\u0000${row.lifeEventId}`));
  const removableSeedLinks = links.rows.filter((row) => seedLinkPairs.has(`${row.raw_source_id}\u0000${row.life_event_id}`));
  const date17RunIds = runs.rows.filter((row) => row.target_id === WALK_EVENT_ID && sameIds(new Set(row.source_ids ?? []), date17Ids)).map((row) => row.id);
  const date17JobIds = jobs.rows.filter((row) => sameIds(new Set(row.source_ids ?? []), date17Ids)).map((row) => row.id);
  const date17TraceIds = traces.rows.filter((row) => dateOf(row.occurred_at) === "2026-08-17" && sameIds(new Set(row.source_ids ?? []), date17Ids)).map((row) => row.id);
  const seedEventIds = values(seedIds.events);
  const eventLinks = links.rows.filter((row) => seedEventIds.includes(row.life_event_id));
  const seedMediaRows = media.rows.filter((row) => seedIds.media.has(row.id));
  const seedAssetRows = (await db.query("select * from media_assets where id = any($1)", [values(seedIds.mediaAssets)])).rows;
  const seedLocationRows = (await db.query("select * from media_locations where id = any($1)", [values(seedIds.mediaLocations)])).rows;
  const seedSourceRows = sources.rows.filter((row) => seedIds.rawSources.has(row.id));
  const seedEventRows = events.rows.filter((row) => seedIds.events.has(row.id));
  const seedTraceRows = traces.rows.filter((row) => seedIds.dailyTraces.has(row.id));
  const seedGrowthRows = (await db.query("select * from growth_records where id = any($1)", [values(seedIds.growthRecords)])).rows;
  const seedCareRows = (await db.query("select * from care_records where id = any($1)", [values(seedIds.careRecords)])).rows;
  const seedEpisodeRows = (await db.query("select * from care_episodes where id = any($1)", [values(seedIds.careEpisodes)])).rows;
  const seedFocusRows = (await db.query("select * from monthly_focus_goals where id = any($1)", [values(seedIds.monthlyFocusGoals)])).rows;
  const seedSnapshotRows = (await db.query("select * from monthly_snapshot where id = $1", [seed.monthlySnapshot?.id])).rows;
  const seedContributorRows = contributors.rows.filter((row) => removableContributorIds.includes(row.id));

  const backup = {
    format: "nianlife-mock-seed-cleanup-v1", createdAt: new Date().toISOString(), seedPath, manifestPath,
    restore: "Restore only after review: use the backup JSON arrays in foreign-key order with psql or a parameterized pg script; never bulk-import it over current production.",
    expected: { realAssetCount: 107, date17MediaCount: 12 },
    selected: { seedSourceMemoryLinks: removableSeedLinks, allLinksToSeedEvents: eventLinks, seedMediaLocations: seedLocationRows, seedMedia: seedMediaRows, seedMediaAssets: seedAssetRows, seedRawSources: seedSourceRows, seedLifeEvents: seedEventRows, seedDailyTraces: seedTraceRows, seedGrowthRecords: seedGrowthRows, seedCareRecords: seedCareRows, seedCareEpisodes: seedEpisodeRows, seedMonthlySnapshot: seedSnapshotRows, seedMonthlyFocusGoals: seedFocusRows, removableSeedContributors: seedContributorRows, eventWalk: events.rows.find((row) => row.id === WALK_EVENT_ID), date17RealMedia: walkRealMedia, date17RealSources: date17Sources, date17RealLinks: walkRealLinks, date17OrganizerRuns: runs.rows.filter((row) => date17RunIds.includes(row.id)), date17OrganizerJobs: jobs.rows.filter((row) => date17JobIds.includes(row.id)), date17DailyTraces: traces.rows.filter((row) => date17TraceIds.includes(row.id)) },
  };
  const summary = { dryRun, delete: { ...countByTable(backup.selected), removableSeedContributorIds: seedContributorRows.map((row) => row.id) }, preserve: { realAssets: realAssets.length, realMedia: realMedia.length, realSources: realSourceIds.size, realLocations: locations.rows.filter((row) => realAssetIds.has(row.media_asset_id)).length, retainedSeedContributors: values(retainedSeedContributorIds).length }, date17: { media: walkRealMedia.length, sources: date17Ids.size, links: walkRealLinks.length, runs: runs.rows.filter((row) => sameIds(new Set(row.source_ids ?? []), date17Ids)).map((row) => ({ id: row.id, action: row.action, targetId: row.target_id, fallbackReason: row.fallback_reason })), jobs: jobs.rows.filter((row) => sameIds(new Set(row.source_ids ?? []), date17Ids)).map((row) => ({ id: row.id, status: row.status, attempts: row.attempts, resultAction: row.result_action, resultTargetId: row.result_target_id, lastError: row.last_error })), traces: traces.rows.filter((row) => dateOf(row.occurred_at) === "2026-08-17" && (row.source_ids ?? []).some((id) => date17Ids.has(id))).map((row) => row.id), traceTargets: traces.rows.filter((row) => runs.rows.filter((run) => sameIds(new Set(run.source_ids ?? []), date17Ids)).some((run) => run.target_id === row.id)).map((row) => row.id) } };
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) process.exitCode = 0;
  else {
    await mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `mock-seed-cleanup-${safeTimestamp()}.json`);
    await writeFile(backupPath, JSON.stringify(backup, null, 2), { encoding: "utf8", flag: "wx" });
    // A cleanup must use one connection from BEGIN through COMMIT. Pool.query() is not a
    // transaction boundary because successive statements may acquire different connections.
    const tx = await pool.connect();
    await tx.query("begin");
    try {
      await tx.query("delete from source_memory_links where life_event_id = any($1)", [seedEventIds]);
      await tx.query("delete from organizer_jobs where id = any($1)", [date17JobIds]);
      await tx.query("delete from organizer_runs where id = any($1)", [date17RunIds]);
      await tx.query("delete from daily_traces where id = any($1)", [[...values(seedIds.dailyTraces), ...date17TraceIds]]);
      await tx.query("update media set life_event_id = null where id = any($1)", [values(realMediaIds)]);
      await tx.query("update raw_sources set related_life_event_id = null, status = 'uploaded' where id = any($1)", [values(date17Ids)]);
      await tx.query("delete from life_events where id = any($1)", [seedEventIds]);
      await tx.query("delete from media_locations where id = any($1)", [values(seedIds.mediaLocations)]);
      await tx.query("delete from media where id = any($1)", [values(seedIds.media)]);
      await tx.query("delete from media_assets where id = any($1)", [values(seedIds.mediaAssets)]);
      await tx.query("delete from raw_sources where id = any($1)", [values(seedIds.rawSources)]);
      await tx.query("delete from growth_records where id = any($1)", [values(seedIds.growthRecords)]);
      await tx.query("delete from care_records where id = any($1)", [values(seedIds.careRecords)]);
      await tx.query("delete from care_episodes where id = any($1)", [values(seedIds.careEpisodes)]);
      await tx.query("delete from monthly_focus_goals where id = any($1)", [values(seedIds.monthlyFocusGoals)]);
      await tx.query("delete from monthly_snapshot where id = $1", [seed.monthlySnapshot?.id]);
      await tx.query("delete from contributors where id = any($1)", [removableContributorIds]);
      await tx.query("update profiles set bio = null where id = $1", [PROFILE_ID]);
      await tx.query("commit");
      console.log(JSON.stringify({ committed: true, backupPath }, null, 2));
    } catch (error) { await tx.query("rollback"); throw error; } finally { tx.release(); }
  }
} finally { await pool.end(); }
