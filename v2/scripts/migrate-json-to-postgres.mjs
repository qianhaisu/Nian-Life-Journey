#!/usr/bin/env node
// One-time, repeatable JSON -> PostgreSQL backfill.
//
//   node --import tsx scripts/migrate-json-to-postgres.mjs --dry-run [--json=/path/to/nian-life.json]
//   node --import tsx scripts/migrate-json-to-postgres.mjs           (writes; requires DATABASE_URL)
//
// --dry-run never opens a database connection: it only reads the JSON file, validates it, and
// reports what a real run would do. A real run does the whole import in one transaction, every
// insert is onConflictDoNothing (existing rows are never overwritten, re-running is a no-op for
// rows already migrated), and any failure rolls the entire transaction back — never a partial
// import. Exit codes: 0 clean, 1 validation/referential error, 2 database error.
import { readFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const jsonArg = args.find((a) => a.startsWith("--json="));
const jsonPath = jsonArg ? jsonArg.slice("--json=".length) : path.join(process.cwd(), ".data", "nian-life.json");

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

let store;
try {
  store = JSON.parse(await readFile(jsonPath, "utf8"));
} catch (error) {
  fail(1, `Could not read/parse ${jsonPath}: ${error instanceof Error ? error.message : error}`);
}

// [storeKey, entity label, id field or null for the singleton profile/monthlySnapshot rows]
const COLLECTIONS = [
  ["contributors", "Contributor", "id"],
  ["rawSources", "RawSource", "id"],
  ["mediaAssets", "MediaAsset", "id"],
  ["mediaLocations", "MediaLocation", "id"],
  ["media", "Media", "id"],
  ["events", "LifeEvent", "id"],
  ["links", "SourceMemoryLink", null],
  ["connectorStates", "ConnectorState", "id"],
  ["organizerRuns", "OrganizerRun", "id"],
  ["dailyTraces", "DailyTrace", "id"],
  ["growthRecords", "GrowthRecord", "id"],
  ["careRecords", "CareRecord", "id"],
  ["careEpisodes", "CareEpisode", "id"],
  ["monthlyFocusGoals", "MonthlyFocusGoal", "id"],
];

const counts = {};
const errors = [];
const warnings = [];

if (!store.profile?.id) errors.push("store.profile is missing or has no id — every other entity is scoped to it.");
if (!store.monthlySnapshot?.id) warnings.push("store.monthlySnapshot is missing — the monthly_snapshot table will stay empty.");

for (const [key, label, idField] of COLLECTIONS) {
  const rows = store[key] ?? [];
  counts[label] = rows.length;
  if (idField) {
    const seen = new Set();
    for (const row of rows) {
      if (!row[idField]) { errors.push(`${label}: a row is missing "${idField}".`); continue; }
      if (seen.has(row[idField])) errors.push(`${label}: duplicate id "${row[idField]}" within the JSON file.`);
      seen.add(row[idField]);
    }
  }
}

// Referential checks: dangling references are reported, not fatal — the JSON store never enforced
// foreign keys, so a soft inconsistency here reflects pre-existing data, not a migration bug.
const ids = (key) => new Set((store[key] ?? []).map((row) => row.id));
const contributorIds = ids("contributors");
const mediaAssetIds = ids("mediaAssets");
const rawSourceIds = ids("rawSources");
const eventIds = ids("events");

for (const source of store.rawSources ?? []) {
  if (source.contributorId && !contributorIds.has(source.contributorId)) warnings.push(`RawSource ${source.id}: contributorId "${source.contributorId}" not found in contributors.`);
}
for (const asset of store.mediaAssets ?? []) {
  if (asset.rawSourceId && !rawSourceIds.has(asset.rawSourceId)) warnings.push(`MediaAsset ${asset.id}: rawSourceId "${asset.rawSourceId}" not found in rawSources.`);
}
for (const location of store.mediaLocations ?? []) {
  if (!mediaAssetIds.has(location.mediaAssetId)) errors.push(`MediaLocation ${location.id}: mediaAssetId "${location.mediaAssetId}" not found in mediaAssets.`);
}
for (const link of store.links ?? []) {
  if (!rawSourceIds.has(link.rawSourceId)) warnings.push(`SourceMemoryLink: rawSourceId "${link.rawSourceId}" not found in rawSources.`);
  if (!eventIds.has(link.lifeEventId)) warnings.push(`SourceMemoryLink: lifeEventId "${link.lifeEventId}" not found in events.`);
}

console.log(`Source: ${jsonPath}`);
console.log("Counts:");
console.log(`  Profile              1`);
console.log(`  MonthlySnapshot      ${store.monthlySnapshot ? 1 : 0}`);
for (const [, label] of COLLECTIONS) console.log(`  ${label.padEnd(20)} ${counts[label]}`);
if (warnings.length) { console.log(`\nReference warnings (${warnings.length}, non-fatal):`); for (const w of warnings) console.log(`  - ${w}`); }
if (errors.length) { console.log(`\nErrors (${errors.length}):`); for (const e of errors) console.log(`  - ${e}`); }

if (errors.length) fail(1, "\nAborting: fix the errors above before importing.");

if (dryRun) {
  console.log("\nDry run only — no database connection was opened, nothing was written.");
  process.exit(0);
}

const { getDb, closePool } = await import("../lib/db/client.ts");
const schema = await import("../lib/db/schema.ts");

let db;
try {
  db = getDb();
} catch (error) {
  fail(2, `Could not resolve a database connection: ${error instanceof Error ? error.message : error}`);
}

const IMPORT_ORDER = [
  ["profile", schema.profiles, (p) => [p]],
  ["contributors", schema.contributors, (rows) => rows],
  ["rawSources", schema.rawSources, (rows) => rows],
  ["mediaAssets", schema.mediaAssets, (rows) => rows],
  ["mediaLocations", schema.mediaLocations, (rows) => rows],
  ["media", schema.media, (rows) => rows],
  ["events", schema.lifeEvents, (rows) => rows],
  ["links", schema.sourceMemoryLinks, (rows) => rows],
  ["connectorStates", schema.connectorStates, (rows) => rows],
  ["organizerRuns", schema.organizerRuns, (rows) => rows],
  ["dailyTraces", schema.dailyTraces, (rows) => rows],
  ["growthRecords", schema.growthRecords, (rows) => rows],
  ["careRecords", schema.careRecords, (rows) => rows],
  ["careEpisodes", schema.careEpisodes, (rows) => rows],
  ["monthlySnapshot", schema.monthlySnapshot, (s) => (s ? [s] : [])],
  ["monthlyFocusGoals", schema.monthlyFocusGoals, (rows) => rows],
];

try {
  const inserted = await db.transaction(async (tx) => {
    const result = {};
    for (const [key, table, toRows] of IMPORT_ORDER) {
      const rows = toRows(key === "profile" ? store.profile : store[key]);
      if (!rows.length) { result[key] = 0; continue; }
      // .returning() with no column list — sourceMemoryLinks has a composite key, not an `id` column.
      const written = await tx.insert(table).values(rows).onConflictDoNothing().returning();
      result[key] = written.length;
    }
    return result;
  });
  console.log("\nImported (rows actually written; conflicts with existing rows were skipped, not overwritten):");
  for (const [key] of IMPORT_ORDER) console.log(`  ${key.padEnd(20)} ${inserted[key]}`);
  await closePool();
  process.exit(0);
} catch (error) {
  console.error(`\nImport failed, transaction rolled back — no partial data was written.\n${error instanceof Error ? error.stack : error}`);
  await closePool();
  process.exit(2);
}
