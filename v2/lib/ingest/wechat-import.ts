import { createHash } from "node:crypto";
import type { ChatImportBundle } from "./chat-import-bundle";
import type { Media, MediaAsset, MediaLocation, RawSource } from "@/lib/types";

export interface ChatImportResult { importBatchId: string; createdMessages: number; reusedMessages: number; mediaAssets: number; warnings: number; status: "completed" | "completed_with_warnings"; }
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Persists one Bundle through the existing repository boundary; Organizer is deliberately not called. */
export async function importWechatBundle(bundle: ChatImportBundle, repository: { getStore(): Promise<any>; appendUpload(input: { source: RawSource; media: Media[]; assets?: MediaAsset[]; locations?: MediaLocation[] }): Promise<RawSource> }, options: { profileId: string; contributorId: string; now?: string }): Promise<ChatImportResult> {
  const importBatchId = `wechat-import:${bundle.exportSnapshot.rootFingerprint}`; const store = await repository.getStore(); const existing = new Set((store.rawSources ?? []).map((s: RawSource) => s.id)); let createdMessages = 0; let reusedMessages = 0; let mediaAssets = 0; let warnings = bundle.warnings.reduce((n, w) => n + w.count, 0);
  for (const message of bundle.messages) {
    const sourceId = `wechat-message:${message.messageId}`; if (existing.has(sourceId)) { reusedMessages += 1; continue; }
    const mediaIds: string[] = []; const assets: MediaAsset[] = []; const locations: MediaLocation[] = []; const media: Media[] = [];
    for (const ref of message.mediaRefs) { if (ref.availability !== "present" || !ref.checksum) { warnings += 1; continue; } const assetId = `media-asset:${ref.checksum.replace(/^sha256:/, "")}`; mediaIds.push(assetId); if (!(store.mediaAssets ?? []).some((a: MediaAsset) => a.id === assetId)) { assets.push({ id: assetId, profileId: options.profileId, rawSourceId: sourceId, mediaType: "photo", mimeType: "image/jpeg", checksum: ref.checksum, originalFilename: undefined, createdAt: options.now ?? new Date().toISOString() }); mediaAssets += 1; } locations.push({ id: `wechat-location:${digest(ref.relativePath)}`, mediaAssetId: assetId, provider: "wechat", variant: "original", providerRef: ref.relativePath, status: "ready", mimeType: "image/jpeg", createdAt: options.now ?? new Date().toISOString(), updatedAt: options.now ?? new Date().toISOString() }); }
    const source: RawSource = { id: sourceId, profileId: options.profileId, sourceType: "wechat", contentTypes: ["family"], contributorId: options.contributorId, capturedAt: message.sentAt, importedAt: options.now ?? new Date().toISOString(), text: message.text, mediaIds, sourceLabel: message.conversationId, visibility: "private", status: "uploaded", metadata: { provider: "wechat", conversationId: message.conversationId, senderId: message.senderId, direction: "unknown", document: message.sourceLocator.document, recordOrdinal: message.sourceLocator.recordOrdinal, importBatchId, parserVersion: bundle.parserVersion }, };
    await repository.appendUpload({ source, media, assets, locations }); createdMessages += 1;
  }
  return { importBatchId, createdMessages, reusedMessages, mediaAssets, warnings, status: warnings ? "completed_with_warnings" : "completed" };
}
