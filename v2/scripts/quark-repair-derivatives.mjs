#!/usr/bin/env node
// Repair script: finds Quark media_assets with no location records and re-creates
// originals + derivatives from the WorkBuddy artifact originals directory.
//
// Safe to run multiple times: checks for existing locations before writing.
// Usage: node scripts/quark-repair-derivatives.mjs [--dry-run]

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, realpath, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { config as loadDotenv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
if (DRY_RUN) console.log("[dry-run mode]\n");

process.env.REPOSITORY_BACKEND = "postgres";
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (!DRY_RUN && process.env.MEDIA_STORAGE_PROVIDER !== "r2") { console.error("MEDIA_STORAGE_PROVIDER=r2 required for real run"); process.exit(1); }

const { default: pg } = await import("pg");
const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
await pgClient.connect();

async function dbq(sql, params = []) {
  const { rows } = await pgClient.query(sql, params);
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
    return out;
  });
}

// Find assets with no location records
const missingLocations = await dbq(`
  SELECT ma.id, ma.mime_type, ma.width, ma.height, ma.taken_at, ma.checksum, ma.original_filename, ma.raw_source_id
  FROM media_assets ma
  WHERE ma.id LIKE 'asset-quark-sha-%'
    AND NOT EXISTS (SELECT 1 FROM media_locations ml WHERE ml.media_asset_id = ma.id)
`);

console.log(`Assets with missing locations: ${missingLocations.length}`);
for (const a of missingLocations) console.log(`  ${a.original_filename} (sha256: ${a.checksum?.slice(0,12)}...)`);

if (missingLocations.length === 0) {
  console.log("Nothing to repair.");
  await pgClient.end();
  process.exit(0);
}

const ARTIFACT_DIR = path.resolve(__dirname, "../../.github/skills/quarkclouddrive/workbuddy/storage/quark-photo-prep-20260831");
const ORIGINALS_DIR = path.join(ARTIFACT_DIR, "originals");

// Map original filename -> local path
const originalsRoot = await realpath(ORIGINALS_DIR);
const localFiles = await readdir(originalsRoot);
const byFilename = new Map(localFiles.map(f => [f, path.join(originalsRoot, f)]));

const { createDerivatives } = await import("../lib/media/processing.ts");
const { hotStorage } = await import("../lib/storage/hot-storage.ts");
const { findMediaAssetByChecksum, appendMediaAssetWithLocation } = await import("../lib/db/repository.ts");

// appendMediaAssetWithLocation may not exist yet; we'll use direct SQL for location insert
async function insertLocation(loc) {
  const now = new Date().toISOString();
  await pgClient.query(`
    INSERT INTO media_locations (id, media_asset_id, provider, variant, provider_ref, mime_type, file_size, width, height, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    ON CONFLICT (provider, provider_ref) DO NOTHING
  `, [loc.id, loc.mediaAssetId, loc.provider, loc.variant, loc.providerRef, loc.mimeType, loc.fileSize, loc.width, loc.height, loc.status, now, now]);
}

const results = [];
for (const asset of missingLocations) {
  const sha256 = asset.checksum;
  const assetId = asset.id; // asset-quark-sha-{sha256}
  const filename = asset.original_filename;

  const localPath = byFilename.get(filename);
  if (!localPath) {
    console.error(`  [SKIP] ${filename}: not found in originals directory`);
    results.push({ filename, status: "missing_file" });
    continue;
  }

  let bytes;
  try {
    bytes = await readFile(localPath);
  } catch (e) {
    console.error(`  [SKIP] ${filename}: read error: ${e.message}`);
    results.push({ filename, status: "read_error", error: e.message });
    continue;
  }

  const recomputedSha = createHash("sha256").update(bytes).digest("hex");
  // DB may store checksum with "sha256:" prefix; strip before comparing raw hex.
  const normalizedDbSha = sha256?.replace(/^sha256:/i, "") ?? "";
  if (recomputedSha !== normalizedDbSha) {
    console.error(`  [SKIP] ${filename}: sha256 mismatch (DB: ${normalizedDbSha} file: ${recomputedSha})`);
    results.push({ filename, status: "sha256_mismatch" });
    continue;
  }
  // Use the raw hex (no prefix) for R2 key construction
  const rawSha = recomputedSha;

  const ext = filename.toLowerCase().endsWith(".heic") ? ".heic" : filename.toLowerCase().endsWith(".png") ? ".png" : ".jpg";
  const mimeType = asset.mime_type;

  if (DRY_RUN) {
    console.log(`  [dry-run] Would repair ${filename}`);
    results.push({ filename, status: "would_repair" });
    continue;
  }

  try {
    const originalKey = `media/originals/${assetId}${ext}`;
    await hotStorage.put({ key: originalKey, body: bytes, mimeType, checksum: rawSha, fileSize: bytes.byteLength });
    await insertLocation({ id: `location-quark-sha-${rawSha}-original`, mediaAssetId: assetId, provider: "hot", variant: "original", providerRef: originalKey, mimeType, fileSize: bytes.byteLength, width: asset.width, height: asset.height, status: "archived" });

    const pseudoAsset = { id: assetId, mediaType: "photo", mimeType };
    const derivatives = await createDerivatives(pseudoAsset, bytes);
    for (const deriv of derivatives) {
      const derivExt = deriv.mimeType === "image/webp" ? "webp" : "svg";
      const derivKey = `media/derivatives/${assetId}/${deriv.variant}.${derivExt}`;
      await hotStorage.put({ key: derivKey, body: deriv.body, mimeType: deriv.mimeType });
      await insertLocation({ id: `location-quark-sha-${rawSha}-${deriv.variant}`, mediaAssetId: assetId, provider: "hot", variant: deriv.variant, providerRef: derivKey, mimeType: deriv.mimeType, fileSize: deriv.body.byteLength, width: deriv.width, height: deriv.height, status: "ready" });
    }

    console.log(`  [OK] ${filename}: uploaded original + ${derivatives.length} derivatives`);
    results.push({ filename, status: "repaired", derivatives: derivatives.map(d => d.variant) });
  } catch (e) {
    console.error(`  [FAIL] ${filename}: ${e.message}`);
    results.push({ filename, status: "failed", error: e.message });
  }
}

console.log("\n=== Summary ===");
const byStatus = {};
for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log(byStatus);

await pgClient.end();
