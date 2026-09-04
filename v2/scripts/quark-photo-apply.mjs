// Reusable, parameterized closed-loop ingestion core for WorkBuddy Quark photo artifacts.
//
// This is the SINGLE import implementation for the "download originals -> SHA-256 identity ->
// permanent object storage -> RawSource/Media -> organizer job -> worker drain" pipeline. It is
// shared by:
//   - scripts/quark-photo-init.mjs      (one-shot baseline initialization)
//   - tools/quark-connector/apply-artifact.ts  (npm run quark:sync:apply)
//
// There must NOT be a second import implementation. Both entry points only feed this module a
// different config (artifact directory, mode, permanent-skip set, labels).
//
// Idempotency is by construction: every id (asset/source/media/location) is derived from the
// file's SHA-256, and `findMediaAssetByChecksum` makes re-running a no-op for already-ingested
// photos. The local artifact's own checksum claim is never trusted without recomputing it from
// the bytes on disk. Permanently-skipped files (the 6 corrupted HEIC originals) are recognized by
// their SHA-256 and never re-attempted unless their recorded size changes.
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_PROFILE_ID = "profile-zhangnian";
export const DEFAULT_CONTRIBUTOR_ID = "contributor-system-import";
export const DEFAULT_VISIBILITY = "family";
export const DEFAULT_SOURCE_LABEL = "Quark 照片同步";
export const DEFAULT_MAX_GEMINI_JOBS = 20;

export function capturedAtIso(item) {
  // capture_time.text is Asia/Shanghai wall-clock time (matches the +08:00 window the artifact was built with).
  return new Date(`${item.capture_time.text.replace(" ", "T")}+08:00`).toISOString();
}

async function readVerified(item, originalsDir) {
  const resolved = await realpath(item.local_path);
  const originalsRoot = await realpath(originalsDir);
  if (!resolved.toLowerCase().startsWith(originalsRoot.toLowerCase())) throw new Error("local_path escapes the originals directory");
  const bytes = await readFile(resolved);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== item.sha256) throw new Error(`sha256 mismatch: manifest=${item.sha256} recomputed=${sha256}`);
  return { bytes, sha256 };
}

async function ingestOne(item, ctx) {
  const existingAsset = await ctx.repo.findMediaAssetByChecksum(item.sha256);
  if (existingAsset) {
    if (!existingAsset.rawSourceId) throw new Error(`existing asset ${existingAsset.id} has no rawSourceId; needs manual reconciliation`);
    return { status: "reused", filename: item.filename, sha256: item.sha256, rawSourceId: existingAsset.rawSourceId, capturedAt: capturedAtIso(item) };
  }

  const capturedAt = capturedAtIso(item);
  const wouldCreate = { status: "would_create", filename: item.filename, sha256: item.sha256, rawSourceId: `source-quark-sha-${item.sha256}`, capturedAt };
  if (ctx.mode !== "apply") return wouldCreate;

  const { bytes, sha256 } = await readVerified(item, ctx.originalsDir);
  const dims = await ctx.sourceImageMetadata(bytes);
  const now = new Date().toISOString();
  const assetId = `asset-quark-sha-${sha256}`;
  const sourceId = `source-quark-sha-${sha256}`;
  const mediaId = `media-quark-sha-${sha256}`;

  const asset = { id: assetId, profileId: ctx.profileId, rawSourceId: sourceId, mediaType: "photo", mimeType: item.format_type, width: dims.width, height: dims.height, takenAt: capturedAt, checksum: sha256, originalFilename: item.filename, archiveStatus: "archived", archiveVerifiedAt: now, createdAt: now };

  const originalKey = `media/originals/${assetId}${item.ext}`;
  await ctx.hotStorage.put({ key: originalKey, body: bytes, mimeType: item.format_type, checksum: sha256, fileSize: bytes.byteLength });
  const locations = [{ id: `location-quark-sha-${sha256}-original`, mediaAssetId: assetId, provider: "hot", variant: "original", providerRef: originalKey, mimeType: item.format_type, fileSize: bytes.byteLength, width: dims.width, height: dims.height, status: "archived", createdAt: now, updatedAt: now }];
  for (const derivative of await ctx.createDerivatives(asset, bytes)) {
    const extension = derivative.mimeType === "image/webp" ? "webp" : "svg";
    const key = `media/derivatives/${assetId}/${derivative.variant}.${extension}`;
    await ctx.hotStorage.put({ key, body: derivative.body, mimeType: derivative.mimeType });
    locations.push({ id: `location-quark-sha-${sha256}-${derivative.variant}`, mediaAssetId: assetId, provider: "hot", variant: derivative.variant, providerRef: key, mimeType: derivative.mimeType, fileSize: derivative.body.byteLength, width: derivative.width, height: derivative.height, status: "ready", createdAt: now, updatedAt: now });
  }

  const source = { id: sourceId, profileId: ctx.profileId, sourceType: "family_photo", contentTypes: ["daily", "family"], contributorId: ctx.contributorId, capturedAt, importedAt: now, mediaIds: [mediaId], sourceLabel: ctx.sourceLabel, visibility: ctx.visibility, status: "uploaded", originalFilename: item.filename, metadata: { provider: "quark", checksum: sha256 } };
  const media = { id: mediaId, profileId: ctx.profileId, rawSourceId: sourceId, mediaAssetId: assetId, type: "photo", src: ctx.mediaDeliveryUrl(mediaId, "web"), originalFilename: item.filename, mimeType: item.format_type, fileSize: bytes.byteLength, alt: item.filename, takenAt: capturedAt, visibility: ctx.visibility, width: dims.width, height: dims.height };

  await ctx.repo.appendUpload({ source, media: [media], assets: [asset], locations });
  return { status: "created", filename: item.filename, sha256, rawSourceId: sourceId, capturedAt };
}

function eligibleItems(items) {
  return items.filter((item) => item.kind === "photo" && item.download_status === "success" && item.checksum_duplicate === false && item.date_label === "in_window" && item.capture_time?.reliable === true);
}

/**
 * Applies (or dry-runs) a WorkBuddy Quark photo artifact against Nianlife storage.
 *
 * @param {object} config
 * @param {string} config.artifactDir          Task directory containing `artifacts/task-items.jsonl` and `originals/`.
 * @param {string} [config.taskItemsPath]       Override for the task-items.jsonl path.
 * @param {string} [config.originalsDir]        Override for the originals directory.
 * @param {"dry-run"|"apply"} [config.mode]     Defaults to "dry-run" (never writes storage/DB).
 * @param {Map<string,{filename?:string,skip_reason?:string,size?:number}>} [config.permanentSkip]
 *                                              SHA-256 -> skip record. Skipped unless the recorded size changed.
 * @param {string} [config.profileId]
 * @param {string} [config.contributorId]
 * @param {string} [config.visibility]
 * @param {string} [config.sourceLabel]
 * @param {number} [config.maxGeminiJobs]
 * @param {boolean} [config.organize]            Whether an apply enqueues Organizer jobs and drains the worker.
 *                                               Defaults to FALSE: ingestion alone is what gives a photo its
 *                                               `family_photo` source identity, which is the whole of `trusted`
 *                                               in mediaPrivilegeOf and the only condition for a picture to enter
 *                                               a month's body. Judging what those pictures mean is a separate,
 *                                               later decision (Teddy, 2026-09-04). With this off the run makes
 *                                               zero AI calls: no job is enqueued, the worker is never imported,
 *                                               and no key is required. The enqueue/drain path itself is intact —
 *                                               pass `organize: true` to get it back.
 * @param {boolean} [config.requireGemini]       When true (default), an apply that would ingest NEW photos AND
 *                                               organize them fails closed before any write unless GEMINI_API_KEY
 *                                               and AI_MODEL are present. A pure no-op (0 new), or a run that does
 *                                               not organize, never requires them.
 * @param {object} [config.deps]                Injectable dependencies for testing (repo/hotStorage/processing/worker/paths).
 * @returns {Promise<object>} structured summary.
 */
export async function applyQuarkPhotoArtifact(config) {
  const {
    artifactDir,
    taskItemsPath,
    originalsDir,
    mode = "dry-run",
    permanentSkip = new Map(),
    profileId = DEFAULT_PROFILE_ID,
    contributorId = DEFAULT_CONTRIBUTOR_ID,
    visibility = DEFAULT_VISIBILITY,
    sourceLabel = DEFAULT_SOURCE_LABEL,
    maxGeminiJobs = DEFAULT_MAX_GEMINI_JOBS,
    organize = false,
    requireGemini = true,
    deps = {},
  } = config;

  if (!artifactDir && !taskItemsPath) throw new Error("applyQuarkPhotoArtifact: artifactDir (or taskItemsPath) is required");
  if (mode !== "dry-run" && mode !== "apply") throw new Error(`applyQuarkPhotoArtifact: invalid mode "${mode}"`);

  const repo = deps.repo ?? (await import("../lib/db/repository.ts"));
  const { sourceImageMetadata, createDerivatives } = deps.processing ?? (await import("../lib/media/processing.ts"));
  const hotStorage = deps.hotStorage ?? (await import("../lib/storage/hot-storage.ts")).hotStorage;
  const { mediaDeliveryUrl } = deps.paths ?? (await import("../lib/media/paths.ts"));
  // Imported only when this run will actually organize. A run that only ingests must not so much
  // as load the worker module, so there is no reachable path from here to an AI provider.
  const runOrganizerWorker = deps.worker?.runOrganizerWorker ?? (mode === "apply" && organize ? (await import("../lib/organizer/worker.ts")).runOrganizerWorker : async () => []);

  const resolvedTaskItems = taskItemsPath ?? path.join(artifactDir, "artifacts", "task-items.jsonl");
  const resolvedOriginals = originalsDir ?? path.join(artifactDir, "originals");

  const raw = await readFile(resolvedTaskItems, "utf8");
  const allItems = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const items = eligibleItems(allItems);

  const ctx = { repo, sourceImageMetadata, createDerivatives, hotStorage, mediaDeliveryUrl, profileId, contributorId, visibility, sourceLabel, originalsDir: resolvedOriginals, mode };

  // Fail-closed preflight (apply only): if this run would ingest any NEW photo, the Organizer will
  // be drained and needs Gemini. Refuse BEFORE writing anything when Gemini is missing, so a partial
  // write can never be left behind. A pure no-op (all reused/skipped) skips this entirely.
  if (mode === "apply" && organize && requireGemini) {
    let wouldCreate = 0;
    for (const item of items) {
      const skip = permanentSkip.get(item.sha256);
      if (skip) {
        const sizeChanged = typeof skip.size === "number" && typeof item.size === "number" && skip.size !== item.size;
        if (!sizeChanged) continue;
      }
      const existing = await repo.findMediaAssetByChecksum(item.sha256);
      if (!existing) wouldCreate += 1;
    }
    if (wouldCreate > 0) {
      if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required to apply newly-ingested photos (Organizer drain needs it)");
      if (!process.env.AI_MODEL) throw new Error("AI_MODEL is required to apply newly-ingested photos (Organizer drain needs it)");
    }
  }

  const created = [];
  const reused = [];
  const permanentlySkipped = [];
  const failed = [];

  for (const item of items) {
    const skip = permanentSkip.get(item.sha256);
    if (skip) {
      const sizeChanged = typeof skip.size === "number" && typeof item.size === "number" && skip.size !== item.size;
      if (!sizeChanged) {
        permanentlySkipped.push({ filename: item.filename, sha256: item.sha256, skip_reason: skip.skip_reason ?? "permanent_skip" });
        continue;
      }
      // Size changed -> the remote file may now be valid; fall through to normal ingestion.
    }
    try {
      const result = await ingestOne(item, ctx);
      // "would_create" (dry-run) counts as "new" alongside "created" (apply).
      (result.status === "created" || result.status === "would_create" ? created : reused).push(result);
    } catch (error) {
      failed.push({ filename: item.filename, sha256: item.sha256, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const byDate = new Map();
  for (const record of created) {
    const date = record.capturedAt.slice(0, 10);
    if (!byDate.has(date)) byDate.set(date, new Set());
    byDate.get(date).add(record.rawSourceId);
  }
  const dateKeys = [...byDate.keys()].sort();

  let dates = [];
  let workerOutcomes = [];
  if (mode === "apply" && !organize) {
    // Ingest-only. The dates are still reported, so the photographed days this run added are
    // visible and can be organized later on purpose — they are not silently dropped.
    dates = dateKeys.map((date) => ({ date, sourceCount: byDate.get(date).size, enqueued: false }));
  } else if (mode === "apply") {
    // Organizer work is driven solely by NEW sources. Reused sources were already organized when
    // they were first ingested, so re-enqueueing them would both duplicate organizer jobs and
    // re-invoke Gemini on a supposedly-idempotent re-run.
    if (dateKeys.length === 0) {
      workerOutcomes = [];
    } else {
      if (dateKeys.length > maxGeminiJobs) console.log(`WARNING: ${dateKeys.length} dates exceed the ${maxGeminiJobs}-call Gemini budget; storage/enqueue still proceeds for all, but only the first ${maxGeminiJobs} jobs will be drained this run.`);
      for (const date of dateKeys) {
        const sourceIds = [...byDate.get(date)].sort();
        const job = await repo.enqueueOrganizerJob({ sourceIds, profileId });
        dates.push({ date, sourceCount: sourceIds.length, jobId: job.id, jobStatus: job.status });
      }
      const drainLimit = Math.min(maxGeminiJobs, dates.length);
      workerOutcomes = await runOrganizerWorker({ once: true, maxJobs: drainLimit });
    }
  } else {
    // dry-run: report which dates WOULD enqueue, but never enqueue or drain.
    dates = dateKeys.map((date) => ({ date, sourceCount: byDate.get(date).size, wouldEnqueue: true }));
  }

  const summary = {
    mode,
    organize,
    total: allItems.length,
    eligible: items.length,
    newCount: created.length,
    reusedCount: reused.length,
    skippedCount: permanentlySkipped.length,
    failedCount: failed.length,
  };

  return {
    ...summary,
    created,
    reused,
    permanentlySkipped,
    failed,
    dates,
    workerOutcomes: workerOutcomes.map((o) => ({ jobId: o.job.id, ok: o.ok, action: o.ok ? o.action : undefined, error: o.ok ? undefined : o.error })),
    summary,
  };
}
