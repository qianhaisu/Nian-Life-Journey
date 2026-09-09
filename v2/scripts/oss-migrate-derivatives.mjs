#!/usr/bin/env node
// One-time, resumable migration: copies the existing "hot" (R2) ready thumbnail/web derivative
// objects to OSS, verifies each copy by independently recomputing SHA-256 (never trusts a
// multipart ETag), and only then adds a NEW media_locations row (provider="oss"). Never updates
// or deletes any existing "hot"/"quark" row — additive only. Candidate scope is fixed and must
// match docs/STATUS.md's 2026-09-09 OSS migration plan exactly: provider='hot', variant IN
// ('thumbnail','web'), status='ready'. Originals (variant='original', any provider) are always
// out of scope — this script never touches them.
//
// Usage:
//   node --import tsx scripts/oss-migrate-derivatives.mjs --limit 50            (validation slice)
//   node --import tsx scripts/oss-migrate-derivatives.mjs                       (process all pending)
//   node --import tsx scripts/oss-migrate-derivatives.mjs --limit 500 --batch-size 200
//
// Required env: DATABASE_URL (RDS), OSS_ENDPOINT/OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/
// OSS_ACCESS_KEY_SECRET, and whatever hotStorage needs to read the existing R2 objects
// (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET, or HOT_STORAGE_BACKEND=r2 +
// MEDIA_STORAGE_PROVIDER=r2). Never prints any credential value.
//
// Resume model: the database is the source of truth for "already migrated" (a media_locations
// row with provider='oss' and the same provider_ref as the source 'hot' row already exists).
// The append-only JSONL log below is an audit trail only, not the resume mechanism — losing it
// costs nothing but a log, resuming still works purely from what's already in Postgres.

import { createHash } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, closePool } from "../lib/db/client.ts";
import * as t from "../lib/db/schema.ts";
import { newId } from "../lib/db/repository-interface.ts";
import { hotStorage, getOssStorage } from "../lib/storage/hot-storage.ts";

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
  if (m) args.set(m[1], m[2] ?? "true");
}
const LIMIT = args.has("limit") ? Number(args.get("limit")) : Infinity;
const BATCH_SIZE = Number(args.get("batch-size") ?? 200);
const CONCURRENCY = Number(args.get("concurrency") ?? 8);
const OBJECT_TIMEOUT_MS = Number(args.get("object-timeout-ms") ?? 30_000);
const FAILURE_STOP_RATIO = 0.05;

const LOG_DIR = args.get("log-dir") ?? "/tmp/nianlife-oss-migration";
const LOG_FILE = path.join(LOG_DIR, "oss-migrate-derivatives.log.jsonl");

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`TIMEOUT after ${ms}ms: ${label}`)), ms)),
  ]);
}

async function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
  await appendFile(LOG_FILE, line, "utf8").catch(() => {});
}

function sha256Of(chunks) {
  const hash = createHash("sha256");
  for (const chunk of chunks) hash.update(chunk);
  return hash.digest("hex");
}

async function readAllChunks(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

// Reads an OSS object fully (if it exists) and returns its bytes + sha256, or null if absent.
async function readOssObjectIfExists(oss, key) {
  const bytes = await oss.get(key);
  if (!bytes) return null;
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, sha256: hash };
}

async function migrateOne(db, oss, candidate) {
  const { id: hotLocationId, mediaAssetId, variant, providerRef: key, mimeType, fileSize: expectedFileSize } = candidate;

  // Step 1: does an "oss" location already exist for this exact key? DB is the source of truth
  // for "already migrated" -- caller filters these out before calling migrateOne, this is a
  // belt-and-braces re-check for the rare race where two invocations overlap.
  const [existingOssRow] = await db.select().from(t.mediaLocations).where(and(eq(t.mediaLocations.provider, "oss"), eq(t.mediaLocations.providerRef, key)));
  if (existingOssRow) return { status: "already_migrated", hotLocationId, key };

  // Step 2: read the source R2 object (never modified, never deleted).
  const sourceStream = await withTimeout(hotStorage.getStream(key), OBJECT_TIMEOUT_MS, `hotStorage.getStream(${key})`);
  if (!sourceStream) return { status: "failed", hotLocationId, key, reason: "source object missing from hot/R2" };
  const sourceChunks = await withTimeout(readAllChunks(sourceStream), OBJECT_TIMEOUT_MS, `read source stream(${key})`);
  const sourceBytes = Buffer.concat(sourceChunks);
  const sourceSha256 = sha256Of(sourceChunks);
  if (expectedFileSize != null && sourceBytes.byteLength !== expectedFileSize) {
    return { status: "failed", hotLocationId, key, reason: `source byte length ${sourceBytes.byteLength} != recorded file_size ${expectedFileSize}` };
  }

  // Step 3: if an object already sits at this key in OSS (e.g. a prior run's OSS write
  // succeeded but crashed before the DB insert), never blindly overwrite it. Compare hashes.
  const existingOssObject = await withTimeout(readOssObjectIfExists(oss, key), OBJECT_TIMEOUT_MS, `check existing OSS object(${key})`);
  if (existingOssObject) {
    if (existingOssObject.sha256 !== sourceSha256) {
      return { status: "conflict", hotLocationId, key, reason: "an OSS object already exists at this key with DIFFERENT content -- not overwritten" };
    }
    // Bytes already match -- skip the redundant PUT, go straight to the DB insert below.
  } else {
    await withTimeout(oss.put({ key, body: sourceBytes, mimeType: mimeType ?? "application/octet-stream", fileSize: sourceBytes.byteLength, checksum: `sha256:${sourceSha256}` }), OBJECT_TIMEOUT_MS, `oss.put(${key})`);
  }

  // Step 4: read back from OSS and independently recompute SHA-256 -- never trust a multipart
  // ETag as content identity (docs/CLAUDE.md red line).
  const verifyBytes = await withTimeout(oss.get(key), OBJECT_TIMEOUT_MS, `oss.get(${key}) for verify`);
  if (!verifyBytes) return { status: "failed", hotLocationId, key, reason: "OSS object unreadable immediately after write" };
  const verifySha256 = createHash("sha256").update(verifyBytes).digest("hex");
  if (verifySha256 !== sourceSha256 || verifyBytes.byteLength !== sourceBytes.byteLength) {
    return { status: "failed", hotLocationId, key, reason: `post-write verify mismatch: sha256 ${verifySha256} vs source ${sourceSha256}, size ${verifyBytes.byteLength} vs ${sourceBytes.byteLength}` };
  }

  // Step 5: only now add the new location row. onConflictDoNothing is a second, DB-level
  // idempotency guard (unique on provider+provider_ref) in case of a concurrent duplicate insert.
  const now = new Date().toISOString();
  const inserted = await db.insert(t.mediaLocations).values({
    id: newId("location"),
    mediaAssetId,
    provider: "oss",
    variant,
    providerRef: key,
    mimeType: mimeType ?? undefined,
    fileSize: sourceBytes.byteLength,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing({ target: [t.mediaLocations.provider, t.mediaLocations.providerRef] }).returning();

  return { status: "migrated", hotLocationId, key, sha256: sourceSha256, fileSize: sourceBytes.byteLength, ossLocationId: inserted[0]?.id ?? null };
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runner));
  return results;
}

async function main() {
  await mkdir(LOG_DIR, { recursive: true });
  const db = getDb();
  const oss = getOssStorage();

  console.log(`[start] limit=${LIMIT === Infinity ? "none" : LIMIT} batch-size=${BATCH_SIZE} concurrency=${CONCURRENCY} object-timeout-ms=${OBJECT_TIMEOUT_MS}`);

  const candidateRows = await db.select({ id: t.mediaLocations.id, mediaAssetId: t.mediaLocations.mediaAssetId, variant: t.mediaLocations.variant, providerRef: t.mediaLocations.providerRef, mimeType: t.mediaLocations.mimeType, fileSize: t.mediaLocations.fileSize })
    .from(t.mediaLocations)
    .where(and(eq(t.mediaLocations.provider, "hot"), inArray(t.mediaLocations.variant, ["thumbnail", "web"]), eq(t.mediaLocations.status, "ready")))
    .orderBy(t.mediaLocations.id);

  const existingOssRefs = new Set((await db.select({ providerRef: t.mediaLocations.providerRef }).from(t.mediaLocations).where(eq(t.mediaLocations.provider, "oss"))).map((r) => r.providerRef));

  const pending = candidateRows.filter((row) => !existingOssRefs.has(row.providerRef));
  console.log(`[scope] candidate total=${candidateRows.length} already_migrated=${candidateRows.length - pending.length} pending=${pending.length}`);

  const toProcess = pending.slice(0, LIMIT === Infinity ? pending.length : LIMIT);
  console.log(`[plan] will attempt ${toProcess.length} objects this run`);

  let migrated = 0, alreadyMigrated = 0, failed = 0, conflicts = 0;
  let totalBytes = 0;
  const failureDetails = [];

  for (let offset = 0; offset < toProcess.length; offset += BATCH_SIZE) {
    const batch = toProcess.slice(offset, offset + BATCH_SIZE);
    console.log(`[batch] ${offset}-${offset + batch.length} of ${toProcess.length}`);
    const results = await pool(batch, CONCURRENCY, async (candidate) => {
      try {
        const result = await migrateOne(db, oss, candidate);
        await log(result);
        return result;
      } catch (error) {
        const result = { status: "failed", hotLocationId: candidate.id, key: candidate.providerRef, reason: error instanceof Error ? error.message : String(error) };
        await log(result);
        return result;
      }
    });

    let batchFailed = 0;
    for (const r of results) {
      if (r.status === "migrated") { migrated += 1; totalBytes += r.fileSize ?? 0; }
      else if (r.status === "already_migrated") { alreadyMigrated += 1; }
      else if (r.status === "conflict") { conflicts += 1; batchFailed += 1; failureDetails.push(r); }
      else { failed += 1; batchFailed += 1; failureDetails.push(r); }
    }

    const batchFailureRatio = batchFailed / batch.length;
    console.log(`[batch-result] size=${batch.length} migrated_this_batch=${results.filter((r) => r.status === "migrated").length} failed_this_batch=${batchFailed} ratio=${(batchFailureRatio * 100).toFixed(1)}%`);
    if (batchFailureRatio > FAILURE_STOP_RATIO) {
      console.error(`[HARD STOP] batch failure ratio ${(batchFailureRatio * 100).toFixed(1)}% exceeds ${FAILURE_STOP_RATIO * 100}% -- stopping, not continuing to next batch.`);
      console.error(`[HARD STOP] failure details (first 20): ${JSON.stringify(failureDetails.slice(-batchFailed).slice(0, 20), null, 2)}`);
      break;
    }
  }

  console.log(`[RESULT] migrated=${migrated} already_migrated=${alreadyMigrated} failed=${failed} conflicts=${conflicts} bytes_written=${totalBytes}`);
  if (failureDetails.length) console.log(`[RESULT] failure/conflict details: ${JSON.stringify(failureDetails, null, 2)}`);
  console.log(`[RESULT] log file: ${LOG_FILE}`);
}

main()
  .then(async () => { await closePool(); process.exit(0); })
  .catch(async (err) => { console.error(`[FATAL] ${err instanceof Error ? err.stack : err}`); await closePool().catch(() => {}); process.exit(1); });
