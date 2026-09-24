#!/usr/bin/env node
// Fill media_geo from the EXIF GPS block of Quark iPhone originals already on disk
// (docs/travel-module-plan.md §1.3, travel module phase 0).
//
// Input: a quark-history batch root (default: the 2026-09-03 batch) whose manifests/ hold the
// task-item lists written by quark-history-init*.mjs. Those rows are the only trustworthy bridge
// between a local file and a media_assets row: the asset id is `asset-quark-sha-<sha256>` of the
// bytes that were ingested — for HEIC that is the CONVERTED JPEG's sha256, while the GPS block lives
// in the HEIC (`source_heic_path`), which heic-convert throws away. So EXIF is always read from the
// original file, and the row records which bytes it came from (source_file_sha256).
//
// Idempotent: one row per asset (primary key), re-runs upsert the same values. Never touches
// media_assets, media, raw_sources. Dry-run by default; --apply writes. Assets missing from the
// database are skipped and counted, never created.
//
//   node --import tsx scripts/media-geo-backfill.mjs [--batch-root <dir>] [--apply] [--limit N]
//   (through .data/run-on-rds.mjs for production, like every other write script)
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import exifr from "exifr";
import pg from "pg";

const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const APPLY = process.argv.includes("--apply");
const LIMIT = Number(option("--limit") ?? 0) || Infinity;
const BATCH_ROOT = option("--batch-root") ?? "C:/Users/teddy/NianlifeOps/quark-history/2026-09-03";
const MANIFEST_DIR = path.join(BATCH_ROOT, "manifests");

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(2); }

const readJsonl = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
const items = [
  ...readJsonl(path.join(MANIFEST_DIR, "quark-history-task-items.jsonl")).map((row) => ({ ...row, exifPath: row.local_path, exifSha: row.sha256 })),
  ...readJsonl(path.join(MANIFEST_DIR, "quark-heic-converted-task-items.jsonl")).map((row) => ({ ...row, exifPath: row.source_heic_path ?? row.local_path, exifSha: row.source_heic_sha256 ?? row.sha256 })),
].filter((row) => row.kind === "photo" && row.sha256 && row.exifPath);

const normalize = (p) => p.replace(/\\/g, "/");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const known = new Set((await client.query(`select id from media_assets where id like 'asset-quark-sha-%'`)).rows.map((r) => r.id));
const existing = new Set((await client.query(`select media_asset_id from media_geo`)).rows.map((r) => r.media_asset_id));

const tally = { items: items.length, assetMissing: 0, fileMissing: 0, shaMismatch: 0, noGps: 0, withGps: 0, written: 0, alreadyHad: 0, errors: 0 };
const rows = [];
let seen = 0;
for (const item of items) {
  if (seen++ >= LIMIT) break;
  const assetId = `asset-quark-sha-${item.sha256}`;
  if (!known.has(assetId)) { tally.assetMissing++; continue; }
  const file = normalize(item.exifPath);
  if (!fs.existsSync(file)) { tally.fileMissing++; continue; }
  try {
    // The manifest's sha256 is a claim; the bytes on disk are the fact (same rule as the ingest).
    const actual = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== item.exifSha) { tally.shaMismatch++; continue; }
    const gps = await exifr.gps(file);
    if (!gps || !Number.isFinite(gps.latitude) || !Number.isFinite(gps.longitude)) { tally.noGps++; continue; }
    const meta = await exifr.parse(file, { pick: ["DateTimeOriginal", "GPSAltitude"], reviveValues: false }).catch(() => null);
    const takenAtExif = typeof meta?.DateTimeOriginal === "string" ? meta.DateTimeOriginal : null;
    const altitude = Number.isFinite(meta?.GPSAltitude) ? meta.GPSAltitude : null;
    tally.withGps++;
    if (existing.has(assetId)) tally.alreadyHad++;
    rows.push({ assetId, latitude: gps.latitude, longitude: gps.longitude, altitude, takenAtExif, sha: actual });
  } catch (error) {
    tally.errors++;
    if (tally.errors <= 5) console.error("exif error:", path.basename(file), String(error?.message ?? error));
  }
}

if (APPLY && rows.length) {
  await client.query("begin");
  try {
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = [];
      const params = [];
      chunk.forEach((r, j) => {
        const b = j * 7;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`);
        params.push(r.assetId, r.latitude, r.longitude, r.altitude, r.takenAtExif, "exif", r.sha);
      });
      const res = await client.query(
        `insert into media_geo (media_asset_id, latitude, longitude, altitude, taken_at_exif, source, source_file_sha256)
         values ${values.join(",")}
         on conflict (media_asset_id) do update set latitude = excluded.latitude, longitude = excluded.longitude,
           altitude = excluded.altitude, taken_at_exif = excluded.taken_at_exif, source = excluded.source,
           source_file_sha256 = excluded.source_file_sha256`, params);
      tally.written += res.rowCount ?? 0;
    }
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
}

const after = (await client.query(`select count(*)::int as n from media_geo`)).rows[0].n;
console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", batchRoot: BATCH_ROOT, ...tally, mediaGeoRowsAfter: after }, null, 1));
await client.end();
