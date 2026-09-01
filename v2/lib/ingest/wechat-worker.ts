import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ChatImportBundle, ChatMediaRef } from "./chat-import-bundle";
import { chatImportBatchId } from "./chat-import-bundle";
import { importWechatBundle } from "./wechat-import";
import { assertWechatSnapshot, hashWechatFile, loadWechatBundle, type WechatBundleOptions, type WechatSnapshotEntry } from "./wechat-snapshot";
import { normalizeSha256 } from "@/lib/db/chat-import-persistence";
import { createDerivatives, sourceImageMetadata } from "@/lib/media/processing";
import { hotStorage, type HotStorage } from "@/lib/storage/hot-storage";
import type { ChatImportTask, MediaAsset, MediaLocation, RawSource } from "@/lib/types";
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
};

type WechatWorkerRepository = Pick<Repository, "createChatImportTask" | "getChatImportTask" | "claimChatImportTask" | "heartbeatChatImportTask" | "saveChatImportCheckpoint" | "requestChatImportCancel" | "acknowledgeChatImportCancel" | "failChatImportTask" | "retryChatImportTask" | "completeChatImportTask" | "completeChatImportWithWarnings" | "persistUpload" | "persistChatImportMessage">;

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
      if (derivativeExisting.exists) await storage.delete(derivativeObjectKey);
      await storage.put({ key: derivativeObjectKey, body: derivative.body, mimeType: derivative.mimeType, checksum: derivativeChecksum, fileSize: derivative.body.byteLength });
      const verification = await storage.verify(derivativeObjectKey, derivativeChecksum);
      if (!verification.exists || !verification.checksumVerified) {
        await storage.delete(derivativeObjectKey).catch(() => undefined);
        throw new Error("WECHAT_MEDIA_UPLOAD_VERIFY_FAILED");
      }
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

function locationSource(bundle: ChatImportBundle, message: ChatImportBundle["messages"][number], options: WechatWorkerOptions, now: string): RawSource {
  return { id: `wechat-message:${message.messageId}`, profileId: options.profileId, sourceType: "wechat", contentTypes: ["family"], contributorId: options.contributorId, capturedAt: message.sentAt, importedAt: now, mediaIds: [], sourceLabel: message.conversationId, visibility: "private", status: "uploaded", provider: "wechat", providerExternalId: message.messageId, metadata: { provider: "wechat", conversationDigest: digest(message.conversationId), senderDigest: digest(message.senderId), documentDigest: digest(message.sourceLocator.document), recordOrdinal: message.sourceLocator.recordOrdinal, importBatchId: chatImportBatchId(bundle.exportSnapshot), parserVersion: bundle.parserVersion } };
}

function hotLocation(assetId: string, object: StoredMediaObject, now: string): MediaLocation {
  const id = `hot-location:${digest(`${object.variant}\u0000${object.key}`)}`;
  return { id, mediaAssetId: assetId, provider: "hot", variant: object.variant, providerRef: object.key, status: object.variant === "original" ? "awaiting_archive" : "ready", mimeType: object.mimeType, fileSize: object.size, width: object.width, height: object.height, createdAt: now, updatedAt: now };
}

async function linkHotLocation(repository: WechatWorkerRepository, bundle: ChatImportBundle, message: ChatImportBundle["messages"][number], checksum: string, objects: StoredMediaObject[], options: WechatWorkerOptions, now: string) {
  const checksumHex = checksum.slice("sha256:".length);
  const assetId = `media-asset:${checksumHex}`;
  const source = locationSource(bundle, message, options, now);
  const original = objects.find((object) => object.variant === "original");
  if (!original) throw new Error("WECHAT_MEDIA_ORIGINAL_MISSING");
  const asset: MediaAsset = { id: assetId, profileId: options.profileId, rawSourceId: source.id, mediaType: "photo", mimeType: "image/jpeg", width: original.width, height: original.height, checksum, archiveStatus: "awaiting_archive", createdAt: now };
  const input: UploadPersistInput = { source, media: [], assets: [asset], locations: objects.map((object) => hotLocation(assetId, object, now)) };
  return repository.persistUpload(input);
}

function reportFrom(task: ChatImportTask | null, values: Omit<WechatWorkerReport, "taskId" | "status" | "safeErrorCode" | "checkpoint"> & { safeErrorCode?: string }): WechatWorkerReport {
  return { ...values, taskId: task?.id, status: task?.status ?? "rejected", safeErrorCode: values.safeErrorCode, checkpoint: task?.checkpoint };
}

export async function runWechatImportWorker(options: WechatWorkerOptions): Promise<WechatWorkerReport> {
  const repository: WechatWorkerRepository = options.repository ?? defaultRepository;
  const storage = options.storage ?? hotStorage;
  const leaseOwner = options.leaseOwner ?? `wechat-worker:${randomUUID()}`;
  const loaded = await loadWechatBundle(options.sourceRoot, options);
  const warningCounts = warningCountsFor(loaded.bundle);
  const now = options.now ?? new Date().toISOString();
  const importBatchId = chatImportBatchId(loaded.bundle.exportSnapshot);
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
  const uploadedKeys = new Set<string>();
  const reusedKeys = new Set<string>();
  let uploadedBytes = 0;
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

    for (const message of messages) {
      const heartbeat = await repository.heartbeatChatImportTask({ taskId: task.id, leaseOwner, leaseMs: options.leaseMs, now: new Date().toISOString() });
      if (!heartbeat) throw new Error("CHAT_IMPORT_LEASE_LOST");
      if (heartbeat.cancelRequestedAt) {
        const cancelled = await repository.acknowledgeChatImportCancel({ taskId: task.id, leaseOwner, now: new Date().toISOString() });
        return reportFrom(cancelled ?? heartbeat, { createdMessages, reusedMessages, createdMediaAssets, reusedMediaAssets, createdMediaLocations, reusedMediaLocations, uploadedObjects: uploadedKeys.size, reusedObjects: reusedKeys.size, uploadedBytes, warningCounts });
      }
      let stage = current.currentStage;
      if (["raw_source_persist", "bundle_parse", "snapshot_validation"].includes(stage)) stage = "media_validate";
      current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: message.sourceLocator.recordOrdinal - 1 }, currentStage: stage, processedMessages: current.processedMessages, createdMessages: current.createdMessages, reusedMessages: current.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now: new Date().toISOString() })) ?? current;

      const singleBundle: ChatImportBundle = { ...loaded.bundle, messages: [message], mediaRefs: message.mediaRefs };
      const verifiedObjectsByRef = new Map<string, StoredMediaObject[]>();
      for (const ref of message.mediaRefs) {
        const checksum = checksumFor(ref);
        if (ref.availability !== "present" || !checksum) continue;
        const entry = byPath.get(ref.relativePath);
        if (!entry || entry.kind !== "jpeg") continue;
        const uploaded = await uploadVerified(entry, checksum, storage);
        verifiedObjectsByRef.set(ref.id, uploaded.objects);
        for (const object of uploaded.objects) {
          if (object.uploaded) { if (!uploadedKeys.has(object.key)) { uploadedKeys.add(object.key); uploadedBytes += object.size; } }
          else reusedKeys.add(object.key);
        }
      }
      current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: message.sourceLocator.recordOrdinal }, currentStage: monotonicStage(current.currentStage, "media_upload"), processedMessages: current.processedMessages, createdMessages: current.createdMessages, reusedMessages: current.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now: new Date().toISOString() })) ?? current;

      const imported = await importWechatBundle(singleBundle, repository, { profileId: options.profileId, contributorId: options.contributorId, now });
      if (imported.createdMessages) createdMessages += imported.createdMessages;
      if (imported.reusedMessages) reusedMessages += imported.reusedMessages;
      createdMediaAssets += imported.mediaAssets;
      reusedMediaAssets += imported.reusedMediaAssets;
      createdMediaLocations += imported.mediaLocations;
      reusedMediaLocations += imported.reusedMediaLocations;
      imported.warningCounts.forEach((warning) => { if (!warningCounts.some((item) => item.code === warning.code)) warningCounts.push(warning); });
      for (const ref of message.mediaRefs) {
        const checksum = checksumFor(ref);
        if (ref.availability !== "present" || !checksum) continue;
        const entry = byPath.get(ref.relativePath);
        if (!entry || entry.kind !== "jpeg") continue;
        const objects = verifiedObjectsByRef.get(ref.id);
        if (!objects) continue;
        const linked = await linkHotLocation(repository, loaded.bundle, message, checksum, objects, options, now);
        createdMediaAssets += linked.createdAssetIds.length;
        reusedMediaAssets += linked.reusedAssetIds.length;
        createdMediaLocations += linked.createdLocationIds.length;
        reusedMediaLocations += linked.reusedLocationIds.length;
      }
      current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: message.sourceLocator.recordOrdinal, mediaDigest: digest(message.mediaRefs.map((ref) => `${ref.id}:${ref.checksum ?? ref.availability}`).sort().join("\u0000")) }, currentStage: monotonicStage(current.currentStage, "media_link"), processedMessages: current.processedMessages + 1, createdMessages: current.createdMessages + imported.createdMessages, reusedMessages: current.reusedMessages + imported.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now: new Date().toISOString() })) ?? current;
    }
    current = (await repository.saveChatImportCheckpoint({ taskId: task.id, leaseOwner, checkpoint: current.checkpoint ?? { snapshotDigest: loaded.snapshot.rootFingerprint, documentOrdinal: 0, messageOrdinal: 0 }, currentStage: "finalize", processedMessages: Math.max(current.processedMessages, task.processedMessages + messages.length), createdMessages: current.createdMessages, reusedMessages: current.reusedMessages, warnings: warningTotal(warningCounts), warningCounts, now: new Date().toISOString() })) ?? current;
    const completed = warningTotal(warningCounts) ? await repository.completeChatImportWithWarnings({ taskId: task.id, leaseOwner, warningCounts, now: new Date().toISOString() }) : await repository.completeChatImportTask({ taskId: task.id, leaseOwner, now: new Date().toISOString() });
    return reportFrom(completed ?? current, { createdMessages, reusedMessages, createdMediaAssets, reusedMediaAssets, createdMediaLocations, reusedMediaLocations, uploadedObjects: uploadedKeys.size, reusedObjects: reusedKeys.size, uploadedBytes, warningCounts });
  } catch (error) {
    const safeErrorCode = error instanceof Error && /^[A-Z][A-Z0-9_:-]{0,63}$/.test(error.message) ? error.message : "CHAT_IMPORT_WORKER_FAILED";
    const failed = await repository.failChatImportTask({ taskId: task.id, leaseOwner, safeErrorCode, now: new Date().toISOString() }).catch(() => null);
    return reportFrom(failed ?? current, { safeErrorCode, createdMessages, reusedMessages, createdMediaAssets, reusedMediaAssets, createdMediaLocations, reusedMediaLocations, uploadedObjects: uploadedKeys.size, reusedObjects: reusedKeys.size, uploadedBytes, warningCounts });
  }
}
