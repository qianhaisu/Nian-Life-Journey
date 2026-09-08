#!/usr/bin/env node
// P1-2b (phase 2): standalone pure-JS HEIC-converted JPEG ingestion.
// No --import tsx, no drizzle. Uses pg + sharp + @aws-sdk/client-s3 directly.
// This avoids the ~150 MB tsx/drizzle startup overhead that caused OOM on this machine.
//
// Idempotent: SHA-256 dedup via bulk prefetch. Re-run safe.
// source_label matches the 224 non-HEIC rows already in DB: "Quark 历史素材 2026-09-03"

import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- Env loading (no dotenv package needed) ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "../.env.local");
const envText = await readFile(envPath, "utf8");
for (const line of envText.split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const key = line.slice(0, i).trim();
  let val = line.slice(i + 1).trim();
  // Strip surrounding quotes (dotenv behavior)
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  process.env[key] = val; // always set, env-file wins
}
process.env.REPOSITORY_BACKEND = "postgres";

const DB_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL required"); process.exit(1); }

// Phase 3B2: unlike wechat-worker.ts/app/actions.ts, THIS script's "original" write is not a
// staging copy pending Quark archival — it writes status: "archived" directly (see below), i.e.
// the object it puts IS the permanent copy, same tier as the derivatives. So both original and
// derivative here follow the same provider decision, mirroring
// v2/lib/storage/hot-storage.ts's activeMediaProvider()/resolveHotBackend() semantics without
// importing that module (this script intentionally avoids --import tsx/drizzle for startup
// memory — see the file header). MEDIA_STORAGE_PROVIDER=oss routes both to OSS and tags
// provider "oss"; anything else (including unset) keeps the exact prior behavior: R2, tagged
// "hot". There is no HOT_STORAGE_BACKEND equivalent here because this script has no "existing
// hot rows" concern — every row it writes is new, created in this same run.
const ACTIVE_PROVIDER = process.env.MEDIA_STORAGE_PROVIDER === "oss" ? "oss" : "hot";
if (ACTIVE_PROVIDER === "hot") {
  for (const v of ["R2_ACCOUNT_ID","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY","R2_BUCKET"]) {
    if (!process.env[v]) { console.error(`${v} required (MEDIA_STORAGE_PROVIDER is not "oss", so R2 is the active backend)`); process.exit(1); }
  }
} else {
  for (const v of ["OSS_ENDPOINT","OSS_REGION","OSS_ACCESS_KEY_ID","OSS_ACCESS_KEY_SECRET","OSS_BUCKET"]) {
    if (!process.env[v]) { console.error(`${v} required (MEDIA_STORAGE_PROVIDER=oss)`); process.exit(1); }
  }
}

// --- Constants ---
const BATCH_ROOT = "C:/Users/teddy/NianlifeOps/quark-history/2026-09-03";
const TASK_ITEMS = path.join(BATCH_ROOT, "manifests/quark-heic-converted-task-items.jsonl");
const ORIGINALS_DIR = path.join(BATCH_ROOT, "heic-converted");
const FAILED_OUT = path.join(BATCH_ROOT, "manifests/apply-failed-heic-direct.jsonl");
const SOURCE_LABEL = "Quark 历史素材 2026-09-03";
const PROFILE_ID = "profile-zhangnian";
const CONTRIBUTOR_ID = "contributor-system-import";
const VISIBILITY = "family";

// --- Early-exit guard ---
let completed = false;
process.on("exit", (code) => {
  if (!completed) {
    console.error(JSON.stringify({ ok: false, error: "QUARK_HEIC_DIRECT_EARLY_EXIT", exitCode: code }));
    if (code === 0) process.exitCode = 1;
  }
});

// --- Lazy imports (loaded after env check) ---
const { default: pgPkg } = await import("pg");
const Pool = pgPkg.Pool ?? pgPkg.default?.Pool;
const { default: sharp } = await import("sharp");
const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

// --- DB pool ---
const pool = new Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 30000,
});

// --- Object storage client: R2 (default) or OSS (MEDIA_STORAGE_PROVIDER=oss) ---
const s3 = ACTIVE_PROVIDER === "oss"
  ? new S3Client({
      region: process.env.OSS_REGION,
      endpoint: process.env.OSS_ENDPOINT,
      forcePathStyle: true,
      credentials: { accessKeyId: process.env.OSS_ACCESS_KEY_ID, secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET },
    })
  : new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
const BUCKET = ACTIVE_PROVIDER === "oss" ? process.env.OSS_BUCKET : process.env.R2_BUCKET;

// --- Helpers ---
function capturedAtIso(item) {
  return new Date(`${item.capture_time.text.replace(" ", "T")}+08:00`).toISOString();
}

function eligibleItems(items) {
  return items.filter(
    (i) => i.kind === "photo" &&
      i.download_status === "success" &&
      i.checksum_duplicate === false &&
      i.date_label === "in_window" &&
      i.capture_time?.reliable === true
  );
}

async function objectPut(key, body, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
}

async function getImageDims(bytes) {
  const meta = await sharp(bytes).metadata();
  return { width: meta.width, height: meta.height };
}

async function makeDerivatives(bytes) {
  const results = [];
  for (const [variant, width] of [["thumbnail", 480], ["web", 1280]]) {
    const { data, info } = await sharp(bytes)
      .clone()
      .resize({ width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: variant === "thumbnail" ? 78 : 84 })
      .toBuffer({ resolveWithObject: true });
    results.push({ variant, body: data, width: info.width, height: info.height, mimeType: "image/webp" });
  }
  return results;
}

// --- Prefetch all existing checksums ---
console.log("[quark-heic-direct] starting — prefetching existing checksums...");
const prefetchRes = await pool.query(
  "SELECT checksum, id, raw_source_id FROM media_assets WHERE checksum IS NOT NULL"
);
const existingByChecksum = new Map();
for (const row of prefetchRes.rows) {
  // DB stores checksums with "sha256:" prefix (normalizeSha256 convention). Strip it for lookup.
  const key = row.checksum.replace(/^sha256:/i, "").toLowerCase();
  existingByChecksum.set(key, { id: row.id, rawSourceId: row.raw_source_id });
}
console.log(`[quark-heic-direct] prefetch done: ${existingByChecksum.size} existing checksums`);

// --- Load manifest ---
const raw = await readFile(TASK_ITEMS, "utf8");
const allItems = raw.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const items = eligibleItems(allItems);
console.log(`[quark-heic-direct] ${items.length} eligible items (${allItems.length} total in manifest)`);

const originalsRoot = await realpath(ORIGINALS_DIR);

const created = [];
const reused = [];
const failed = [];
let idx = 0;
let consecutiveFails = 0;

for (const item of items) {
  idx++;
  const checksumKey = item.sha256.toLowerCase();

  if (existingByChecksum.has(checksumKey)) {
    reused.push({ filename: item.filename, sha256: item.sha256 });
    consecutiveFails = 0;
    if (idx % 100 === 0) console.log(`[${idx}/${items.length}] reused: ${item.filename}`);
    continue;
  }

  try {
    // Verify file
    const resolved = await realpath(item.local_path);
    if (!resolved.toLowerCase().startsWith(originalsRoot.toLowerCase())) {
      throw new Error("local_path escapes originals directory");
    }
    const bytes = await readFile(resolved);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (sha256 !== item.sha256) {
      throw new Error(`sha256 mismatch: manifest=${item.sha256} recomputed=${sha256}`);
    }

    const dims = await getImageDims(bytes);
    const now = new Date().toISOString();
    const capturedAt = capturedAtIso(item);

    const assetId = `asset-quark-sha-${sha256}`;
    const sourceId = `source-quark-sha-${sha256}`;
    const mediaId = `media-quark-sha-${sha256}`;
    const originalKey = `media/originals/${assetId}${item.ext}`;
    const mediaSrc = `/api/media/${mediaId}?variant=web`;

    // Upload original — permanent copy, follows ACTIVE_PROVIDER (see the guard block above).
    await objectPut(originalKey, bytes, item.format_type);

    const locations = [{
      id: `location-quark-sha-${sha256}-original`,
      mediaAssetId: assetId,
      provider: ACTIVE_PROVIDER,
      variant: "original",
      providerRef: originalKey,
      mimeType: item.format_type,
      fileSize: bytes.byteLength,
      width: dims.width,
      height: dims.height,
      status: "archived",
      createdAt: now,
      updatedAt: now,
    }];

    // Create and upload derivatives
    const derivatives = await makeDerivatives(bytes);
    for (const deriv of derivatives) {
      const ext = "webp";
      const key = `media/derivatives/${assetId}/${deriv.variant}.${ext}`;
      await objectPut(key, deriv.body, deriv.mimeType);
      locations.push({
        id: `location-quark-sha-${sha256}-${deriv.variant}`,
        mediaAssetId: assetId,
        provider: ACTIVE_PROVIDER,
        variant: deriv.variant,
        providerRef: key,
        mimeType: deriv.mimeType,
        fileSize: deriv.body.byteLength,
        width: deriv.width,
        height: deriv.height,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      });
    }

    // DB transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // raw_sources — ON CONFLICT (id) handles re-runs and concurrent inserts
      await client.query(
        `INSERT INTO raw_sources (id, profile_id, contributor_id, source_type, content_types, captured_at, imported_at,
          media_ids, source_label, status, visibility, original_filename, metadata, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (id) DO NOTHING`,
        [
          sourceId, PROFILE_ID, CONTRIBUTOR_ID, "family_photo",
          JSON.stringify(["daily", "family"]),
          capturedAt, now,
          JSON.stringify([mediaId]),
          SOURCE_LABEL, "uploaded", VISIBILITY,
          item.filename,
          JSON.stringify({ provider: "quark", checksum: sha256 }),
          now, now,
        ]
      );

      // media_assets — store checksum with sha256: prefix (normalizeSha256 convention)
      await client.query(
        `INSERT INTO media_assets (id, profile_id, raw_source_id, media_type, mime_type, width, height,
          taken_at, checksum, original_filename, archive_status, archive_verified_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO NOTHING`,
        [
          assetId, PROFILE_ID, sourceId, "photo",
          item.format_type, dims.width, dims.height,
          capturedAt, `sha256:${sha256}`, item.filename,
          "archived", now, now,
        ]
      );

      // media_locations
      for (const loc of locations) {
        await client.query(
          `INSERT INTO media_locations (id, media_asset_id, provider, variant, provider_ref, mime_type,
            file_size, width, height, status, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (provider, provider_ref) DO NOTHING`,
          [
            loc.id, loc.mediaAssetId, loc.provider, loc.variant, loc.providerRef,
            loc.mimeType, loc.fileSize, loc.width, loc.height, loc.status,
            loc.createdAt, loc.updatedAt,
          ]
        );
      }

      // media (display layer)
      const webLoc = locations.find((l) => l.variant === "web");
      const thumbLoc = locations.find((l) => l.variant === "thumbnail");
      const webKey = webLoc ? webLoc.providerRef : null;
      const thumbKey = thumbLoc ? thumbLoc.providerRef : null;
      await client.query(
        `INSERT INTO media (id, profile_id, raw_source_id, media_asset_id, type, src, thumbnail_src,
          object_key, thumbnail_object_key, original_filename, mime_type, file_size, alt,
          taken_at, visibility, width, height)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO NOTHING`,

        [
          mediaId, PROFILE_ID, sourceId, assetId, "photo",
          mediaSrc,
          thumbLoc ? `/api/media/${mediaId}?variant=thumbnail` : mediaSrc,
          webKey, thumbKey,
          item.filename, item.format_type, bytes.byteLength,
          item.filename, capturedAt, VISIBILITY,
          dims.width, dims.height,
        ]
      );

      await client.query("COMMIT");
    } catch (txErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    existingByChecksum.set(checksumKey, { id: assetId, rawSourceId: sourceId });
    created.push({ filename: item.filename, sha256, capturedAt });
    consecutiveFails = 0;
    console.log(`[${idx}/${items.length}] created: ${item.filename} (${capturedAt.slice(0,10)})`);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    failed.push({ filename: item.filename, sha256: item.sha256, reason: msg });
    consecutiveFails++;
    console.error(`[${idx}/${items.length}] FAILED: ${item.filename} — ${msg}`);
    if (consecutiveFails >= 10) {
      console.error(`STOPPING: ${consecutiveFails} consecutive failures. Last: ${msg}`);
      break;
    }
  }
}

await pool.end().catch(() => {});

completed = true;
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify({
  eligible: items.length,
  created: created.length,
  reused: reused.length,
  failed: failed.length,
}, null, 2));

if (failed.length > 0) {
  await mkdir(path.dirname(FAILED_OUT), { recursive: true });
  await writeFile(FAILED_OUT, failed.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf8");
  console.log(`${failed.length} failed — written to ${FAILED_OUT}`);
}
