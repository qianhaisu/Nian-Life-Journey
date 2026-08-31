#!/usr/bin/env node
// One-time closed-loop ingestion of the quark-photo-prep-20260831 WorkBuddy artifact:
// verified local originals -> re-verified SHA-256 identity -> permanent object storage (R2) ->
// RawSource/Media -> one Organizer job per captured date -> worker drain -> DailyTrace/LifeEvent.
//
// Idempotent by construction: every id (asset/source/media/location) is derived from the file's
// SHA-256, and the checksum/providerRef unique constraints in postgres-repository.ts make re-running
// this script a no-op for already-ingested photos (see persistUpload). Never trusts the local
// WorkBuddy artifact's own checksum claim without recomputing it from the bytes on disk.
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

process.env.REPOSITORY_BACKEND = "postgres";
if (!process.env.DATABASE_URL) fail("DATABASE_URL is required (postgres backend)");
if (process.env.MEDIA_STORAGE_PROVIDER !== "r2") fail("MEDIA_STORAGE_PROVIDER must be r2 so originals/derivatives land in permanent storage, not local disk");
if (!process.env.GEMINI_API_KEY || !process.env.AI_MODEL) fail("GEMINI_API_KEY and AI_MODEL are required for the real Gemini V2 Organizer path");
process.env.MEMORY_ORGANIZER = "ai";
process.env.AI_ORGANIZER_ENABLED = "true";
process.env.AI_PROVIDER = "gemini";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const repo = await import("../lib/db/repository.ts");
const { sourceImageMetadata, createDerivatives } = await import("../lib/media/processing.ts");
const { hotStorage } = await import("../lib/storage/hot-storage.ts");
const { mediaDeliveryUrl } = await import("../lib/media/paths.ts");
const { runOrganizerWorker } = await import("../lib/organizer/worker.ts");

const PROFILE_ID = "profile-zhangnian";
const CONTRIBUTOR_ID = "contributor-system-import";
const VISIBILITY = "family";
const MAX_GEMINI_JOBS = 20;

const ARTIFACT_DIR = path.resolve(__dirname, "../../.github/skills/quarkclouddrive/workbuddy/storage/quark-photo-prep-20260831");
const TASK_ITEMS_PATH = path.join(ARTIFACT_DIR, "artifacts", "task-items.jsonl");
const ORIGINALS_DIR = path.join(ARTIFACT_DIR, "originals");

function capturedAtIso(item) {
  // capture_time.text is Asia/Shanghai wall-clock time (matches the +08:00 window the artifact was built with).
  return new Date(`${item.capture_time.text.replace(" ", "T")}+08:00`).toISOString();
}

async function readVerified(item) {
  const resolved = await realpath(item.local_path);
  const originalsRoot = await realpath(ORIGINALS_DIR);
  if (!resolved.toLowerCase().startsWith(originalsRoot.toLowerCase())) throw new Error("local_path escapes the originals directory");
  const bytes = await readFile(resolved);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== item.sha256) throw new Error(`sha256 mismatch: manifest=${item.sha256} recomputed=${sha256}`);
  return { bytes, sha256 };
}

async function ingestOne(item) {
  const existingAsset = await repo.findMediaAssetByChecksum(item.sha256);
  if (existingAsset) {
    if (!existingAsset.rawSourceId) throw new Error(`existing asset ${existingAsset.id} has no rawSourceId; needs manual reconciliation`);
    return { status: "reused", filename: item.filename, sha256: item.sha256, rawSourceId: existingAsset.rawSourceId, capturedAt: capturedAtIso(item) };
  }

  const { bytes, sha256 } = await readVerified(item);
  const dims = await sourceImageMetadata(bytes);
  const capturedAt = capturedAtIso(item);
  const now = new Date().toISOString();
  const assetId = `asset-quark-sha-${sha256}`;
  const sourceId = `source-quark-sha-${sha256}`;
  const mediaId = `media-quark-sha-${sha256}`;

  const asset = { id: assetId, profileId: PROFILE_ID, rawSourceId: sourceId, mediaType: "photo", mimeType: item.format_type, width: dims.width, height: dims.height, takenAt: capturedAt, checksum: sha256, originalFilename: item.filename, archiveStatus: "archived", archiveVerifiedAt: now, createdAt: now };

  const originalKey = `media/originals/${assetId}${item.ext}`;
  await hotStorage.put({ key: originalKey, body: bytes, mimeType: item.format_type, checksum: sha256, fileSize: bytes.byteLength });
  const locations = [{ id: `location-quark-sha-${sha256}-original`, mediaAssetId: assetId, provider: "hot", variant: "original", providerRef: originalKey, mimeType: item.format_type, fileSize: bytes.byteLength, width: dims.width, height: dims.height, status: "archived", createdAt: now, updatedAt: now }];
  for (const derivative of await createDerivatives(asset, bytes)) {
    const extension = derivative.mimeType === "image/webp" ? "webp" : "svg";
    const key = `media/derivatives/${assetId}/${derivative.variant}.${extension}`;
    await hotStorage.put({ key, body: derivative.body, mimeType: derivative.mimeType });
    locations.push({ id: `location-quark-sha-${sha256}-${derivative.variant}`, mediaAssetId: assetId, provider: "hot", variant: derivative.variant, providerRef: key, mimeType: derivative.mimeType, fileSize: derivative.body.byteLength, width: derivative.width, height: derivative.height, status: "ready", createdAt: now, updatedAt: now });
  }

  const source = { id: sourceId, profileId: PROFILE_ID, sourceType: "family_photo", contentTypes: ["daily", "family"], contributorId: CONTRIBUTOR_ID, capturedAt, importedAt: now, mediaIds: [mediaId], sourceLabel: "Quark 照片初始化", visibility: VISIBILITY, status: "uploaded", originalFilename: item.filename, metadata: { provider: "quark", checksum: sha256 } };
  const media = { id: mediaId, profileId: PROFILE_ID, rawSourceId: sourceId, mediaAssetId: assetId, type: "photo", src: mediaDeliveryUrl(mediaId, "web"), originalFilename: item.filename, mimeType: item.format_type, fileSize: bytes.byteLength, alt: item.filename, takenAt: capturedAt, visibility: VISIBILITY, width: dims.width, height: dims.height };

  await repo.appendUpload({ source, media: [media], assets: [asset], locations });
  return { status: "created", filename: item.filename, sha256, rawSourceId: sourceId, capturedAt };
}

async function main() {
  const raw = await readFile(TASK_ITEMS_PATH, "utf8");
  const allItems = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const items = allItems.filter((item) => item.kind === "photo" && item.download_status === "success" && item.checksum_duplicate === false && item.date_label === "in_window" && item.capture_time?.reliable === true);

  console.log(`task-items total=${allItems.length} eligible-unique=${items.length}`);

  const created = [];
  const reused = [];
  const failed = [];
  for (const item of items) {
    try {
      const result = await ingestOne(item);
      (result.status === "created" ? created : reused).push(result);
    } catch (error) {
      failed.push({ filename: item.filename, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const byDate = new Map();
  for (const record of [...created, ...reused]) {
    const date = record.capturedAt.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, new Set());
    byDate.get(date).add(record.rawSourceId);
  }

  const dates = [...byDate.keys()].sort();
  if (dates.length > MAX_GEMINI_JOBS) console.log(`WARNING: ${dates.length} dates exceed the ${MAX_GEMINI_JOBS}-call Gemini budget; storage/enqueue still proceeds for all, but only the first ${MAX_GEMINI_JOBS} jobs will be drained this run.`);

  const jobs = [];
  for (const date of dates) {
    const sourceIds = [...byDate.get(date)].sort();
    const job = await repo.enqueueOrganizerJob({ sourceIds, profileId: PROFILE_ID });
    jobs.push({ date, sourceCount: sourceIds.length, jobId: job.id, jobStatus: job.status });
  }

  const drainLimit = Math.min(MAX_GEMINI_JOBS, jobs.length);
  const outcomes = await runOrganizerWorker({ once: true, maxJobs: drainLimit });

  console.log(JSON.stringify({
    created: created.length,
    reused: reused.length,
    failed,
    dates: jobs,
    workerOutcomes: outcomes.map((o) => ({ jobId: o.job.id, ok: o.ok, action: o.ok ? o.action : undefined, error: o.ok ? undefined : o.error })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
