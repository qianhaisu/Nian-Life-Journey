import { createHash } from "node:crypto";
import { mediaDeliveryUrl } from "@/lib/media/paths";
import type { ChatImportBundle, ChatMediaRef } from "./chat-import-bundle";
import { chatImportBatchId, validateChatImportBundle } from "./chat-import-bundle";
import { normalizeSha256 } from "@/lib/db/chat-import-persistence";
import type { Media, MediaAsset, MediaLocation, RawSource } from "@/lib/types";
import type { Repository, UploadPersistInput } from "@/lib/db/repository-interface";

export interface ChatImportResult {
  importBatchId: string;
  createdMessages: number;
  reusedMessages: number;
  mediaAssets: number;
  reusedMediaAssets: number;
  mediaLocations: number;
  reusedMediaLocations: number;
  warnings: number;
  warningCounts: Array<{ code: string; count: number }>;
  status: "completed" | "completed_with_warnings";
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const sanitizeText = (value: string) => value.replace(/!\[[^\]]*\]\([^)]*\)/g, "[media]");
const safeChecksum = (value: string | undefined) => {
  const normalized = normalizeSha256(value);
  return normalized && /^sha256:[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
};

function addWarning(counts: Map<string, number>, code: string, count = 1) {
  counts.set(code, (counts.get(code) ?? 0) + count);
}

function evidenceState(ref: ChatMediaRef) {
  return { digest: digest(ref.relativePath), state: ref.availability };
}

// Builds the "wechat" provider side of one message's persistence input — the RawSource, and (for
// each present media ref with a valid checksum) the wechat-provider MediaAsset/MediaLocation/Media
// rows — without persisting anything. Pulled out of the loop below so the batch worker
// (wechat-worker.ts) can build many of these purely in memory, merge in the hot-storage side, and
// persist a whole batch in one call instead of one persist call per message.
export function buildWechatMessageItem(bundle: ChatImportBundle, message: ChatImportBundle["messages"][number], options: { profileId: string; contributorId: string; now?: string }): { input: UploadPersistInput; warningCounts: Array<{ code: string; count: number }> } {
  const now = options.now ?? new Date().toISOString();
  const importBatchId = chatImportBatchId(bundle.exportSnapshot);
  const warnings = new Map<string, number>();
  const sourceId = `wechat-message:${message.messageId}`;
  const mediaIds: string[] = [];
  const evidenceRefs: Array<{ digest: string; state: ChatMediaRef["availability"] }> = [];
  const assets: MediaAsset[] = [];
  const locations: MediaLocation[] = [];
  const media: Media[] = [];
  const documentDigest = digest(message.sourceLocator.document);

  for (const ref of message.mediaRefs) {
    evidenceRefs.push(evidenceState(ref));
    const checksum = safeChecksum(ref.checksum);
    if (ref.availability !== "present") {
      if (ref.availability !== "deferred_by_limit") addWarning(warnings, `media_${ref.availability}`);
      continue;
    }
    if (!checksum) {
      addWarning(warnings, "media_invalid_checksum");
      continue;
    }
    const checksumHex = checksum.slice("sha256:".length);
    const assetId = `media-asset:${checksumHex}`;
    const mediaId = `wechat-media:${digest(`${message.messageId} ${ref.id}`)}`;
    const providerRef = `wechat:document:${documentDigest}:path:${digest(ref.relativePath)}:ref:${digest(ref.id)}`;
    mediaIds.push(mediaId);
    assets.push({ id: assetId, profileId: options.profileId, rawSourceId: sourceId, mediaType: "photo", mimeType: ref.mimeType ?? "image/jpeg", width: ref.width, height: ref.height, checksum, archiveStatus: "awaiting_archive", createdAt: now });
    locations.push({ id: `wechat-location:${digest(providerRef)}`, mediaAssetId: assetId, provider: "wechat", variant: "original", providerRef, status: "ready", mimeType: ref.mimeType ?? "image/jpeg", fileSize: ref.fileSize, width: ref.width, height: ref.height, createdAt: now, updatedAt: now });
    media.push({ id: mediaId, profileId: options.profileId, rawSourceId: sourceId, mediaAssetId: assetId, type: "photo", src: mediaDeliveryUrl(mediaId, "web"), mimeType: ref.mimeType ?? "image/jpeg", fileSize: ref.fileSize, alt: "WeChat image", takenAt: message.sentAt, visibility: "family", width: ref.width ?? 1200, height: ref.height ?? 900 });
  }

  const source: RawSource = {
    id: sourceId,
    profileId: options.profileId,
    sourceType: "wechat",
    contentTypes: ["family"],
    contributorId: options.contributorId,
    capturedAt: message.sentAt,
    importedAt: now,
    text: sanitizeText(message.text),
    mediaIds,
    sourceLabel: message.conversationId,
    visibility: "family",
    status: "uploaded",
    provider: "wechat",
    providerExternalId: message.messageId,
    metadata: {
      provider: "wechat",
      conversationDigest: digest(message.conversationId),
      senderDigest: digest(message.senderId),
      documentDigest,
      recordOrdinal: message.sourceLocator.recordOrdinal,
      importBatchId,
      parserVersion: bundle.parserVersion,
      mediaEvidence: evidenceRefs,
    },
  };
  const warningCounts = [...warnings.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count }));
  return { input: { source, media, assets, locations }, warningCounts };
}

export async function importWechatBundle(bundle: ChatImportBundle, repository: Pick<Repository, "persistUpload"> & Partial<Pick<Repository, "persistChatImportMessage">>, options: { profileId: string; contributorId: string; now?: string }): Promise<ChatImportResult> {
  validateChatImportBundle(bundle);
  const now = options.now ?? new Date().toISOString();
  const importBatchId = chatImportBatchId(bundle.exportSnapshot);
  const warnings = new Map<string, number>();
  for (const warning of bundle.warnings) addWarning(warnings, warning.code, warning.count);
  let createdMessages = 0;
  let reusedMessages = 0;
  let mediaAssets = 0;
  let reusedMediaAssets = 0;
  let mediaLocations = 0;
  let reusedMediaLocations = 0;

  for (const message of bundle.messages) {
    const { input, warningCounts: itemWarnings } = buildWechatMessageItem(bundle, message, { ...options, now });
    for (const warning of itemWarnings) addWarning(warnings, warning.code, warning.count);
    const persisted = repository.persistChatImportMessage ? await repository.persistChatImportMessage(input) : await repository.persistUpload(input);
    if (persisted.sourceCreated) createdMessages += 1;
    else reusedMessages += 1;
    mediaAssets += persisted.createdAssetIds.length;
    reusedMediaAssets += persisted.reusedAssetIds.length;
    mediaLocations += persisted.createdLocationIds.length;
    reusedMediaLocations += persisted.reusedLocationIds.length;
  }

  const warningCounts = [...warnings.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count }));
  return { importBatchId, createdMessages, reusedMessages, mediaAssets, reusedMediaAssets, mediaLocations, reusedMediaLocations, warnings: warningCounts.reduce((total, warning) => total + warning.count, 0), warningCounts, status: warningCounts.length ? "completed_with_warnings" : "completed" };
}
