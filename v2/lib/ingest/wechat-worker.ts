import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ChatImportBundle, ChatMediaRef } from "./chat-import-bundle";
import { chatImportBatchId } from "./chat-import-bundle";
import { buildWechatMessageItem } from "./wechat-import";
import { assertWechatSnapshot, hashWechatFile, loadWechatBundle, type WechatBundleOptions, type WechatSnapshotEntry } from "./wechat-snapshot";
import { normalizeSha256 } from "@/lib/db/chat-import-persistence";
import { createDerivatives, sourceImageMetadata } from "@/lib/media/processing";
import { hotStorage, type HotStorage } from "@/lib/storage/hot-storage";
import type { ChatImportTask, MediaAsset, MediaLocation } from "@/lib/types";
import type { Repository, UploadPersistInput } from "@/lib/db/repository-interface";
import * as defaultRepository from "@/lib/db/repository";

export type WechatWorkerOptions = WechatBundleOptions & {
  sourceRoot: string;
  profileId: string;
  contributorId: string;
  leaseOwner?: string;
  leaseMs?: number;
  taskId?: string;
  retryFailed?: boolean;
  repository?: Repository;
  storage?: HotStorage;
  // Messages are persisted (RawSource/MediaAsset/MediaLocation) and checkpointed in batches, not
  // one at a time — see the module doc comment above the main loop for why. Default 50, clamped to
  // [20, 100] since neither extreme is safe: too small brings back the per-message round-trip cost
  // this exists to eliminate, too large makes a crash replay (and the lease it must fit inside)
  // expensive.
  messageBatchSize?: number;
  // Bounded R2 upload concurrency within a batch. Default 4, clamped to [2, 4] — never unbounded
  // Promise.all across a batch's media.
  mediaConcurrency?: number;
};

type WechatWorkerRepository = Pick<Repository, "createChatImportTask" | "getChatImportTask" | "claimChatImportTask" | "heartbeatChatImportTask" | "saveChatImportCheckpoint" | "requestChatImportCancel" | "acknowledgeChatImportCancel" | "failChatImportTask" | "retryChatImportTask" | "completeChatImportTask" | "completeChatImportWithWarnings" | "persistUpload" | "persistChatImportMessage" | "persistChatImportBatch">;

export type WechatWorkerReport = {
  taskId?: string;
  status: ChatImportTask["status"] | "rejected" | "busy";
  safeErrorCode?: string;
  createdMessages: number;
  reusedMessages: number;
  createdMediaAssets: number;
  reusedMediaAssets: number;
  createdMediaLocations: number;
  reusedMediaLocations: number;
  uploadedObjects: number;
  reusedObjects: number;
  uploadedBytes: number;
  warningCounts: Array<{ code: string; count: number }>;
  checkpoint?: ChatImportTask["checkpoint"];
};

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const stageOrder: ChatImportTask["currentStage"][] = ["snapshot_validation", "bundle_parse", "raw_source_persist", "media_validate", "media_upload", "media_link", "finalize"];
const checksumFor = (ref: ChatMediaRef) => {
  const normalized = normalizeSha256(ref.checksum);
  return normalized && /^sha256:[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
};

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  const n = value ?? fallback;
  if (!Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Bounded-concurrency map: at most `limit` workers in flight at once, never an unbounded
// Promise.all over the whole batch. Results come back in input order regardless of completion
// order. If any worker throws, the error propagates once every already-dispatched worker has
// settled (in-flight uploads are never abandoned mid-write) — matching "已在进行的上传安全收尾
// 后再checkpoint": we never persist or checkpoint a batch whose uploads didn't all finish cleanly.
async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  let firstError: unknown;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (firstError === undefined) firstError = error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  if (firstError !== undefined) throw firstError;
  return results;
}

async function withRetry<T>(attempts: number, run: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      // WECHAT_MEDIA_HASH_CHANGED and identity violations are never transient — retrying them
      // would just repeat the same fail-closed outcome while masking it as a retry loop.
      if (error instanceof Error && error.message === "WECHAT_MEDIA_HASH_CHANGED") throw error;
    }
  }
  throw lastError;
}

function warningCountsFor(bundle: ChatImportBundle) {
  const counts = new Map<string, number>();
  const add = (code: string, count = 1) => counts.set(code, (counts.get(code) ?? 0) + count);
  for (const warning of bundle.warnings) add(warning.code, warning.count);
  for (const message of bundle.messages) for (const ref of message.mediaRefs) {
    if (ref.availability !== "present") { if (ref.availability !== "deferred_by_limit") add(`media_${ref.availability}`); }
    else if (!checksumFor(ref)) add("media_invalid_checksum");
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count }));
}

function warningTotal(warnings: Array<{ code: string; count: number }>) {
  return warnings.reduce((total, warning) => total + warning.count, 0);
}

function monotonicStage(current: ChatImportTask["currentStage"], requested: ChatImportTask["currentStage"]) {
  return stageOrder.indexOf(current) > stageOrder.indexOf(requested) ? current : requested;
}

function objectKey(checksum: string) {
  return `media/original/${checksum.replace(/^sha256:/, "")}.jpg`;
}

function derivativeKey(checksum: string, variant: "thumbnail" | "web") {
  return `media/derivatives/${checksum.replace(/^sha256:/, "")}/${variant}.webp`;
}

function bytesChecksum(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

type StoredMediaObject = { key: string; variant: "original" | "thumbnail" | "web"; mimeType: string; size: number; width?: number; height?: number; uploaded: boolean };

async function uploadVerified(entry: WechatSnapshotEntry, checksum: string, storage: HotStorage) {
  const sourceHash = await hashWechatFile(entry);
  if (sourceHash.checksum !== checksum || sourceHash.size !== entry.size) throw new Error("WECHAT_MEDIA_HASH_CHANGED");
  const key = objectKey(checksum);
  const existing = await storage.verify(key, checksum);
  let originalUploaded = false;
  if (existing.exists) {
    if (!existing.checksumVerified) await storage.delete(key);
    else originalUploaded = false;
  }
  if (!existing.exists || !existing.checksumVerified) {
    await withRetry(2, async () => {
      let actualChecksum = "";
      let actualSize = 0;
      const body = (async function* () {
        const stream = createReadStream(entry.absolutePath);
        const hash = createHash("sha256");
        for await (const chunk of stream) {
          hash.update(chunk);
          actualSize += chunk.byteLength;
          yield chunk;
        }
        actualChecksum = `sha256:${hash.digest("hex")}`;
      })();
      try {
        await storage.put({ key, body, mimeType: "image/jpeg", checksum, fileSize: entry.size });
      } catch (error) {
        await storage.delete(key).catch(() => undefined);
        throw error;
      }
      if (actualChecksum !== checksum || actualSize !== entry.size) {
        await storage.delete(key).catch(() => undefined);
        throw new Error("WECHAT_MEDIA_HASH_CHANGED");
      }
    });
    originalUploaded = true;
  }

  const bytes = new Uint8Array(await readFile(entry.absolutePath));
  if (bytes.byteLength !== entry.size || bytesChecksum(bytes) !== checksum) {
    await storage.delete(key).catch(() => undefined);
    throw new Error("WECHAT_MEDIA_HASH_CHANGED");
  }
  const dimensions = await sourceImageMetadata(bytes);
  const derivativeObjects: StoredMediaObject[] = [];
  const asset = { id: `media-asset:${checksum.slice("sha256:".length)}`, profileId: "", mediaType: "photo" as const, mimeType: "image/jpeg", checksum, createdAt: "" };
  for (const derivative of await createDerivatives(asset, bytes)) {
    const derivativeChecksum = bytesChecksum(derivative.body);
    const derivativeObjectKey = derivativeKey(checksum, derivative.variant as "thumbnail" | "web");
    const derivativeExisting = await storage.verify(derivativeObjectKey, derivativeChecksum);
    let uploaded = false;
    if (!derivativeExisting.exists || !derivativeExisting.checksumVerified) {
      await withRetry(2, async () => {
        if (derivativeExisting.exists) await storage.delete(derivativeObjectKey);
        await storage.put({ key: derivativeObjectKey, body: derivative.body, mimeType: derivative.mimeType, checksum: derivativeChecksum, fileSize: derivative.body.byteLength });
        const verification = await storage.verify(derivativeObjectKey, derivativeChecksum);
        if (!verification.exists || !verification.checksumVerified) {
          await storage.delete(derivativeObjectKey).catch(() => undefined);
          throw new Error("WECHAT_MEDIA_UPLOAD_VERIFY_FAILED");
        }
      });
      uploaded = true;
    }
    derivativeObjects.push({ key: derivativeObjectKey, variant: derivative.variant as "thumbnail" | "web", mimeType: derivative.mimeType, size: derivative.body.byteLength, width: derivative.width, height: derivative.height, uploaded });
  }
  const verification = await storage.verify(key, checksum);
  if (!verification.exists || !verification.checksumVerified) {
    await storage.delete(key).catch(() => undefined);
    throw new Error("WECHAT_MEDIA_UPLOAD_VERIFY_FAILED");
  }
  return { objects: [{ key, variant: "original" as const, mimeType: "image/jpeg", size: verification.fileSize ?? sourceHash.size, width: dimensions.width, height: dimensions.height, uploaded: originalUploaded }, ...derivativeObjects] };
}

function hotLocation(assetId: string, object: StoredMediaObject, now: string): MediaLocation {
  const id = `hot-location:${digest(`${object.variant} ${object.key}`)}`;
  return { id, mediaAssetId: assetId, provider: "hot", variant: object.variant, providerRef: object.key, status: object.variant === "original" ? "awaiting_archive" : "ready", mimeType: object.mimeType, fileSize: object.size, width: object.width, height: object.height, createdAt: now, updatedAt: now };
}

function reportFrom(task: ChatImportTask | null, values: Omit<WechatWorkerReport, "taskId" | "status" | "safeErrorCode" | "checkpoint"> & { safeErrorCode?: string }): WechatWorkerReport {
  return { ...values, taskId: task?.id, status: task?.status ?? "rejected", safeErrorCode: values.safeErrorCode, checkpoint: task?.checkpoint };
}

// --- Batch processing ---------------------------------------------------------------------
// The worker used to do everything per message: a heartbeat, up to three checkpoint saves, and
// (for a message with media) two separate persist transactions per photo — one for the "wechat"
// provider location, one for "hot". Measured against real PostgreSQL that was ~55 round trips per
// message (~8s/message on Neon), because each round trip pays full network latency and each
// transaction pays its own BEGIN/COMMIT round trip on top.
//
// Batching changes the unit of work from "one message" to "one batch of messageBatchSize
// messages": one heartbeat, bounded-concurrency uploads for the batch's unique media, ONE combined
// UploadPersistInput per message (wechat + hot provider assets/locations merged, instead of two
// separate persist calls), ONE persistChatImportBatch call for the whole batch (bulk multi-row
// INSERT ... ON CONFLICT ... RETURNING per table), and ONE checkpoint save. Crash safety is
// unchanged in kind, only in granularity: checkpoint only advances past a message once the WHOLE
// batch's persist call has committed, so a crash mid-batch (during upload or during persist) simply
// means the entire unconfirmed batch gets replayed on resume — safe because RawSource/MediaAsset/
// MediaLocation identity is enforced by database unique constraints and R2 object identity is
// checksum-verified before any object is considered "already there".
type BatchMediaUpload = { entry: WechatSnapshotEntry; checksum: string };
type BatchUploadOutcome = { objects: StoredMediaObject[] };

async function uploadBatchMedia(uploads: BatchMediaUpload[], storage: HotStorage, concurrency: number) {
  const outcomes = await mapWithConcurrency(uploads, concurrency, async (task) => uploadVerified(task.entry, task.checksum, storage));
  const byChecksum = new Map<string, BatchUploadOutcome>();
  uploads.forEach((task, index) => byChecksum.set(task.checksum, outcomes[index]));
  return byChecksum;
}

function buildBatchItems(
  bundle: ChatImportBundle,
  batchMessages: ChatImportBundle["messages"],
  byPath: Map<string, WechatSnapshotEntry>,
  uploadedByChecksum: Map<string, BatchUploadOutcome>,
  options: { profileId: string; contributorId: string; now: string },
) {
  const items: UploadPersistInput[] = [];
  const warningCounts: Array<{ code: string; count: number }> = [];
  const addWarning = (code: string, count = 1) => {
    const existing = warningCounts.find((w) => w.code === code);
    if (existing) existing.count += count;
    else warningCounts.push({ code, count });
  };
  let uploadedObjects = 0;
  let uploadedBytes = 0;
  const seenUploadedKeys = new Set<string>();

  for (const message of batchMessages) {
    const { input, warningCounts: itemWarnings } = buildWechatMessageItem(bundle, message, options);
    for (const warning of itemWarnings) addWarning(warning.code, warning.count);
    for (const ref of message.mediaRefs) {
      const checksum = checksumFor(ref);
      if (ref.availability !== "present" || !checksum) continue;
      const entry = byPath.get(ref.relativePath);
      if (!entry || entry.kind !== "jpeg") continue;
      const uploaded = uploadedByChecksum.get(checksum);
      if (!uploaded) continue;
      const assetId = `media-asset:${checksum.slice("sha256:".length)}`;
      const original = uploaded.objects.find((object) => object.variant === "original");
      if (!original) throw new Error("WECHAT_MEDIA_ORIGINAL_MISSING");
      // buildWechatMessageItem already pushed the "wechat" provider MediaAsset for this exact
      // checksum (same deterministic id) — only the hot-provider MediaLocation rows are new here.
      // Pushing a second asset object for the same id/checksum would double-count it as both
      // created and reused when persistChatImportBatch resolves the per-item result.
      for (const object of uploaded.objects) {
        input.locations!.push(hotLocation(assetId, object, options.now));
        if (object.uploaded && !seenUploadedKeys.has(object.key)) { seenUploadedKeys.add(object.key); uploadedObjects += 1; uploadedBytes += object.size; }
      }
    }
    items.push(input);
  }
  return { items, warningCounts, uploadedObjects, uploadedBytes };
}

export async function runWechatImportWorker(options: WechatWorkerOptions): Promise<WechatWorkerReport> {
  const repository: WechatWorkerRepository = options.repository ?? defaultRepository;
  const storage = options.storage ?? hotStorage;
  const leaseOwner = options.leaseOwner ?? `wechat-worker:${randomUUID()}`;
  const messageBatchSize = clamp(options.messageBatchSize, 50, 20, 100);
  const mediaConcurrency = clamp(options.mediaConcurrency, 4, 2, 4);
  const loaded = await loadWechatBundle(options.sourceRoot, options);
  const warningCounts = warningCountsFor(loaded.bundle);
  const now = options.now ?? new Date().toISOString();
  const importBatchId = chatImportBatchId(loaded.bundle.exportSnapshot, options.since);
  let task = options.taskId ? await repository.getChatImportTask(options.taskId) : await repository.createChatImportTask({ profileId: options.profileId, importBatchId, maxAttempts: 3, now });
  if (!task) return reportFrom(null, { safeErrorCode: "CHAT_IMPORT_TASK_NOT_FOUND", createdMessages: 0, reusedMessages: 0, createdMediaAssets: 0, reusedMediaAssets: 0, createdMediaLocations: 0, reusedMediaLocations: 0, uploadedObjects: 0, reusedObjects: 0, uploadedBytes: 0, warningCounts });
  if (options.taskId && task.importBatchId !== importBatchId) return reportFrom(task, { safeErrorCode: "WECHAT_SNAPSHOT_MISMATCH", createdMessages: 0, reusedMessages: 0, createdMediaAssets: 0, reusedMediaAssets: 0, createdMediaLocations: 0, reusedMediaLocations: 0, uploadedObjects: 0, reusedObjects: 0, uploadedBytes: 0, warningCounts });
  if ((task.status === "failed" || task.status === "cancelled") && options.retryFailed) {
    task = (await repository.retryChatImportTask(task.id, now)) ?? task;
  }
  if (task.status === "completed" || task.status === "completed_with_warnings" || task.status === "cancelled" || task.status === "failed") return reportFrom(task, { createdMessages: 0, reusedMessages: 0, createdMediaAssets: 0, reusedMediaAssets: 0, createdMediaLocations: 0, reusedMediaLocations: 0, uploadedObjects: 0, reusedObjects: 0, uploadedBytes: 0, warningCounts });

  const claimed = await repository.claimChatImportTask({ taskId: task.id, leaseOwner, leaseMs: options.leaseMs, now });
  if (!claimed) return reportFrom(await repository.getChatImportTask(task.id), { safeErrorCode: "CHAT_IMPORT_TASK_BUSY", createdMessages: 0, reusedMessages: 0, createdMediaAssets: 0, reusedMediaAssets: 0, createdMediaLocations: 0, reusedMediaLocations: 0, uploadedObjects: 0, reusedObjects: 0, uploadedBytes: 0, warningCounts });
  task = claimed;
  const expectedSnapshot = task.checkpoint?.snapshotDigest;
  if (expectedSnapshot && expectedSnapshot !== loaded.snapshot.rootFingerprint) {
    const failed = await repository.failChatImportTask({ taskId: task.id, leaseOwner, safeErrorCode: "WECHAT_SNAPSHOT_MISMATCH", now });
    return reportFrom(failed ?? task, { safeErrorCode: "WECHAT_SNAPSHOT_MISMATCH", createdMessages: 0, reusedMessages: 0, createdMediaAssets: 0, reusedMediaAssets: 0, createdMediaLocations: 0, reusedMediaLocations: 0, uploadedObjects: 0, reusedObjects: 0, uploadedBytes: 0, warningCounts });
  }
  let createdMessages = 0;
  let reusedMessages = 0;
  let createdMediaAssets = 0;
  let reusedMediaAssets = 0;
  let createdMediaLocations = 0;
  let reusedMediaLocations = 0;
  let uploadedObjectsTotal = 0;
  let reusedObjectsTotal = 0;
  let uploadedBytesTotal = 0;
  let current = task;
  const checkpoint = task.checkpoint;
  const messages = loaded.bundle.messages.filter((message) => !checkpoint || message.sourceLocator.recordOrdinal > checkpoint.messageOrdinal);
  const byPath = new Map(loaded.snapshot.files.map((entry) => [entry.relativePath, entry]));

  try {
    await assertWechatSnapshot(options.sourceRoot, loaded.snapshot.rootFingerprint);
    const initialCheckpoint = checkpoint ?? { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: 0 };
    if (!checkpoint) {
      current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: initialCheckpoint, currentStage: "bundle_parse", processedMessages: task.processedMessages, createdMessages: task.createdMessages, reusedMessages: task.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now })) ?? current;
      current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: initialCheckpoint, currentStage: "raw_source_persist", processedMessages: task.processedMessages, createdMessages: task.createdMessages, reusedMessages: task.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now })) ?? current;
    }

    for (let batchStart = 0; batchStart < messages.length; batchStart += messageBatchSize) {
      const batchMessages = messages.slice(batchStart, batchStart + messageBatchSize);

      // One heartbeat (and cancel check) per batch, not per message.
      const heartbeat = await repository.heartbeatChatImportTask({ taskId: task.id, leaseOwner, leaseMs: options.leaseMs, now: new Date().toISOString() });
      if (!heartbeat) throw new Error("CHAT_IMPORT_LEASE_LOST");
      if (heartbeat.cancelRequestedAt) {
        const cancelled = await repository.acknowledgeChatImportCancel({ taskId: task.id, leaseOwner, now: new Date().toISOString() });
        return reportFrom(cancelled ?? heartbeat, { createdMessages, reusedMessages, createdMediaAssets, reusedMediaAssets, createdMediaLocations, reusedMediaLocations, uploadedObjects: uploadedObjectsTotal, reusedObjects: reusedObjectsTotal, uploadedBytes: uploadedBytesTotal, warningCounts });
      }

      const stage = ["raw_source_persist", "bundle_parse", "snapshot_validation"].includes(current.currentStage) ? "media_validate" : current.currentStage;
      const lastMessage = batchMessages[batchMessages.length - 1];
      current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: batchMessages[0].sourceLocator.recordOrdinal - 1 }, currentStage: stage, processedMessages: current.processedMessages, createdMessages: current.createdMessages, reusedMessages: current.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now: new Date().toISOString() })) ?? current;

      // Unique media across the whole batch, deduped by checksum — the same photo referenced by
      // two messages in one batch is uploaded once.
      const uploadsByChecksum = new Map<string, BatchMediaUpload>();
      for (const message of batchMessages) for (const ref of message.mediaRefs) {
        const checksum = checksumFor(ref);
        if (ref.availability !== "present" || !checksum || uploadsByChecksum.has(checksum)) continue;
        const entry = byPath.get(ref.relativePath);
        if (!entry || entry.kind !== "jpeg") continue;
        uploadsByChecksum.set(checksum, { entry, checksum });
      }
      const uploadedByChecksum = await uploadBatchMedia([...uploadsByChecksum.values()], storage, mediaConcurrency);

      // A second heartbeat/cancel check after uploads (the slow phase) finish, before we commit
      // anything for this batch — "已在进行的上传安全收尾后再checkpoint". If cancellation landed
      // during uploads, none of this batch's work is persisted or checkpointed; it will be safely
      // replayed (re-verified, not re-uploaded, since the objects already exist) on resume.
      const postUploadHeartbeat = await repository.heartbeatChatImportTask({ taskId: task.id, leaseOwner, leaseMs: options.leaseMs, now: new Date().toISOString() });
      if (!postUploadHeartbeat) throw new Error("CHAT_IMPORT_LEASE_LOST");
      if (postUploadHeartbeat.cancelRequestedAt) {
        const cancelled = await repository.acknowledgeChatImportCancel({ taskId: task.id, leaseOwner, now: new Date().toISOString() });
        return reportFrom(cancelled ?? postUploadHeartbeat, { createdMessages, reusedMessages, createdMediaAssets, reusedMediaAssets, createdMediaLocations, reusedMediaLocations, uploadedObjects: uploadedObjectsTotal, reusedObjects: reusedObjectsTotal, uploadedBytes: uploadedBytesTotal, warningCounts });
      }

      current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: batchMessages[0].sourceLocator.recordOrdinal - 1 }, currentStage: monotonicStage(current.currentStage, "media_upload"), processedMessages: current.processedMessages, createdMessages: current.createdMessages, reusedMessages: current.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now: new Date().toISOString() })) ?? current;

      // warningCountsFor(loaded.bundle) above already computed the complete, authoritative warning
      // counts for the whole conversation up front (independent of batching/resume position) — the
      // per-item warnings buildBatchItems returns cover the exact same refs and must NOT be added
      // on top, or every warning would be double-counted.
      const built = buildBatchItems(loaded.bundle, batchMessages, byPath, uploadedByChecksum, { profileId: options.profileId, contributorId: options.contributorId, now });
      uploadedObjectsTotal += built.uploadedObjects;
      uploadedBytesTotal += built.uploadedBytes;

      const persisted = await repository.persistChatImportBatch(built.items);
      let batchCreatedMessages = 0;
      let batchReusedMessages = 0;
      for (const result of persisted.items) {
        if (result.sourceCreated) { createdMessages += 1; batchCreatedMessages += 1; }
        else { reusedMessages += 1; batchReusedMessages += 1; }
        createdMediaAssets += result.createdAssetIds.length;
        reusedMediaAssets += result.reusedAssetIds.length;
        createdMediaLocations += result.createdLocationIds.length;
        reusedMediaLocations += result.reusedLocationIds.length;
      }
      // Objects that already existed (verified, not re-uploaded) count as reused for reporting.
      for (const outcome of uploadedByChecksum.values()) for (const object of outcome.objects) if (!object.uploaded) reusedObjectsTotal += 1;

      const mediaDigest = digest(batchMessages.flatMap((m) => m.mediaRefs.map((ref) => `${ref.id}:${ref.checksum ?? ref.availability}`)).sort().join(" "));
      current = (await repository.saveChatImportCheckpoint({
        taskId: task.id,
        leaseOwner,
        checkpoint: { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: lastMessage.sourceLocator.recordOrdinal, mediaDigest },
        currentStage: monotonicStage(current.currentStage, "media_link"),
        processedMessages: current.processedMessages + batchMessages.length,
        createdMessages: current.createdMessages + batchCreatedMessages,
        reusedMessages: current.reusedMessages + batchReusedMessages,
        warnings: warningTotal(warningCounts),
        warningCounts,
        now: new Date().toISOString(),
      })) ?? current;
    }

    // current.processedMessages is already correct here — each batch iteration accumulated it
    // from the durable per-batch checkpoint, and it's untouched (still whatever the task started
    // this run at) if there were no messages left to process. Recomputing from the claimed task
    // snapshot's own processedMessages is NOT a safe fallback: some repository implementations
    // mutate a task object in place and return the same reference, so `task` (captured once at
    // claim time) can silently reflect later updates by the time we get here, double-counting.
    current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: current.checkpoint ?? { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: 0 }, currentStage: "finalize", processedMessages: current.processedMessages, createdMessages: current.createdMessages, reusedMessages: current.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now: new Date().toISOString() })) ?? current;
    const completed = warningTotal(warningCounts) ? await repository.completeChatImportWithWarnings({ taskId: task.id, leaseOwner, warningCounts, now: new Date().toISOString() }) : await repository.completeChatImportTask({ taskId: task.id, leaseOwner, now: new Date().toISOString() });
    return reportFrom(completed ?? current, { createdMessages, reusedMessages, createdMediaAssets, reusedMediaAssets, createdMediaLocations, reusedMediaLocations, uploadedObjects: uploadedObjectsTotal, reusedObjects: reusedObjectsTotal, uploadedBytes: uploadedBytesTotal, warningCounts });
  } catch (error) {
    const safeErrorCode = error instanceof Error && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(error.message) ? error.message : "CHAT_IMPORT_WORKER_FAILED";
    const failed = await repository.failChatImportTask({ taskId: task.id, leaseOwner, safeErrorCode, now: new Date().toISOString() }).catch(() => null);
    return reportFrom(failed ?? current, { safeErrorCode, createdMessages, reusedMessages, createdMediaAssets, reusedMediaAssets, createdMediaLocations, reusedMediaLocations, uploadedObjects: uploadedObjectsTotal, reusedObjects: reusedObjectsTotal, uploadedBytes: uploadedBytesTotal, warningCounts });
  }
}
