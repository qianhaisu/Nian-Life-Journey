import { createHash } from "node:crypto";
import { appendUpload, getStore, newId } from "@/lib/db/repository";
import { createDerivatives, sourceImageMetadata } from "@/lib/media/processing";
import { mediaDeliveryUrl } from "@/lib/media/paths";
import { hotStorage } from "@/lib/storage/hot-storage";
import { organizeSources } from "@/lib/organizer/rule-based";
import type { Media, MediaAsset, MediaLocation, MediaType, RawSource } from "@/lib/types";

export type QuarkScope = { folder?: string; from?: string; to?: string; query?: string; cursor?: string };
export type QuarkFile = { providerRef: string; path?: string; filename: string; mimeType: string; mediaType?: MediaType; size?: number; takenAt?: string; checksum?: string; width?: number; height?: number; durationSeconds?: number };
export type QuarkFolder = { providerRef: string; path?: string; filename: string };
export type QuarkListPage = { files: QuarkFile[]; folders?: QuarkFolder[]; cursor?: string };
export type QuarkAdapterErrorCode = "QUARK_AUTH_REQUIRED" | "QUARK_AGENT_UNSUPPORTED" | "QUARK_CLI_UNAVAILABLE" | "QUARK_COMMAND_FAILED" | "QUARK_SCOPE_REQUIRED" | "QUARK_SCOPE_UNSUPPORTED" | "QUARK_SCOPE_LIMIT" | "QUARK_PAGINATION_UNSUPPORTED" | "QUARK_CAPABILITY_UNSUPPORTED" | "QUARK_INVALID_OUTPUT" | "QUARK_METADATA_INVALID" | "QUARK_DOWNLOAD_FAILED" | "QUARK_ARTIFACT_INVALID" | "QUARK_ARTIFACT_TOO_LARGE";
export type QuarkAuthStatus = { status: "connected" | "auth_required" | "unsupported" | "unavailable"; code?: QuarkAdapterErrorCode; officialCode?: number; officialMessage?: string; message: string };

export class QuarkAdapterError extends Error {
  readonly code: QuarkAdapterErrorCode;
  readonly officialCode?: number;
  readonly officialMessage: string;
  readonly action: string;
  readonly retryable: boolean;

  constructor(code: QuarkAdapterErrorCode, message: string, options: { officialCode?: number; action?: string; retryable?: boolean } = {}) {
    super(message);
    this.name = "QuarkAdapterError";
    this.code = code;
    this.officialCode = options.officialCode;
    this.officialMessage = message;
    this.action = options.action ?? "connector";
    this.retryable = options.retryable ?? false;
  }

  toJSON() {
    return { code: this.code, officialCode: this.officialCode, officialMessage: this.officialMessage, action: this.action, retryable: this.retryable };
  }
}

export function toQuarkStructuredError(error: unknown, action = "connector") {
  if (error instanceof QuarkAdapterError) return error.toJSON();
  return { code: "QUARK_COMMAND_FAILED" as const, officialCode: undefined, officialMessage: error instanceof Error ? error.message : String(error), action, retryable: true };
}

export function isQuarkAuthError(error: unknown) {
  if (error instanceof QuarkAdapterError) return error.code === "QUARK_AUTH_REQUIRED" || error.code === "QUARK_AGENT_UNSUPPORTED";
  const message = error instanceof Error ? error.message : String(error);
  return /auth|oauth|token|unauthor|forbidden|expired|授权|认证|未授权/i.test(message);
}

export interface QuarkClient {
  list(scope: QuarkScope): Promise<QuarkListPage>;
  download(providerRef: string): Promise<Uint8Array>;
  checkAuth?(): Promise<QuarkAuthStatus>;
}

export type QuarkImportOptions = { profileId: string; contributorId: string; visibility: "private" | "family" | "public" };

export async function ingestQuarkFile(file: QuarkFile, options: QuarkImportOptions, client?: Pick<QuarkClient, "download">) {
  if (!file.providerRef || !file.filename || !file.mimeType || file.providerRef.length > 512 || /(^|[\\/])\.\.($|[\\/])|[\u0000\r\n]/.test(file.providerRef)) throw new QuarkAdapterError("QUARK_METADATA_INVALID", "Quark file metadata is incomplete", { action: "import" });
  const currentStore = await getStore();
  const existing = currentStore.mediaLocations.find((location) => location.provider === "quark" && location.variant === "original" && location.providerRef === file.providerRef);
  if (existing) return { sourceId: currentStore.mediaAssets.find((asset) => asset.id === existing.mediaAssetId)?.rawSourceId, assetId: existing.mediaAssetId, mediaId: currentStore.media.find((media) => media.mediaAssetId === existing.mediaAssetId)?.id, duplicate: true };

  const sourceId = newId("source");
  const assetId = newId("asset");
  const mediaId = newId("media");
  const now = new Date().toISOString();
  const type: MediaType = file.mediaType ?? (file.mimeType.startsWith("video/") ? "video" : file.mimeType === "application/pdf" ? "document" : "photo");
  const visibility = type === "document" ? "private" : options.visibility;
  let bytes: Uint8Array | undefined;
  if (client) {
    try { bytes = await client.download(file.providerRef); }
    catch (error) {
      if (error instanceof QuarkAdapterError) throw error;
      throw new QuarkAdapterError("QUARK_DOWNLOAD_FAILED", error instanceof Error ? error.message : String(error), { action: "read-file", retryable: true });
    }
  }
  if (bytes && file.size !== undefined && bytes.byteLength !== file.size) throw new QuarkAdapterError("QUARK_DOWNLOAD_FAILED", "Quark file size verification failed", { action: "read-file", retryable: true });
  const downloadedChecksum = bytes ? createHash("sha256").update(bytes).digest("hex") : undefined;
  if (bytes && file.checksum && file.checksum.length === 64 && downloadedChecksum?.toLowerCase() !== file.checksum.toLowerCase()) throw new QuarkAdapterError("QUARK_DOWNLOAD_FAILED", "Quark file checksum verification failed", { action: "read-file", retryable: false });
  const dimensions = type === "photo" && bytes ? await sourceImageMetadata(bytes) : { width: file.width, height: file.height };
  const checksum = file.checksum ?? downloadedChecksum;
  const asset: MediaAsset = { id: assetId, profileId: options.profileId, rawSourceId: sourceId, mediaType: type, mimeType: file.mimeType, width: dimensions.width, height: dimensions.height, durationSeconds: file.durationSeconds, takenAt: file.takenAt, checksum, originalFilename: file.filename, archiveStatus: "archived", archiveVerifiedAt: now, createdAt: now };
  const locations: MediaLocation[] = [{ id: newId("location"), mediaAssetId: assetId, provider: "quark", variant: "original", providerRef: file.providerRef, mimeType: file.mimeType, fileSize: file.size ?? bytes?.byteLength, width: dimensions.width, height: dimensions.height, status: "archived", quarkPathSnapshot: file.path, createdAt: now, updatedAt: now }];

  if (bytes) {
    for (const derivative of await createDerivatives(asset, bytes)) {
      const extension = derivative.mimeType === "image/webp" ? "webp" : "svg";
      const key = `media/derivatives/${assetId}/${derivative.variant}.${extension}`;
      await hotStorage.put({ key, body: derivative.body, mimeType: derivative.mimeType });
      locations.push({ id: newId("location"), mediaAssetId: assetId, provider: "hot", variant: derivative.variant, providerRef: key, mimeType: derivative.mimeType, fileSize: derivative.body.byteLength, width: derivative.width, height: derivative.height, status: "ready", createdAt: now, updatedAt: now });
    }
  }

  const source: RawSource = { id: sourceId, profileId: options.profileId, sourceType: type === "video" ? "family_video" : type === "document" ? "other_document" : "family_photo", contentTypes: ["daily", "family"], contributorId: options.contributorId, capturedAt: file.takenAt ?? now, importedAt: now, mediaIds: [mediaId], sourceLabel: "Quark 自动备份", visibility, status: "uploaded", originalFilename: file.filename, metadata: { provider: "quark", providerRef: file.providerRef, quarkPathSnapshot: file.path } };
  const width = dimensions.width ?? (type === "document" ? 960 : type === "video" ? 1280 : 1200);
  const height = dimensions.height ?? (type === "document" ? 1280 : type === "video" ? 720 : 900);
  const variant = type === "photo" ? "web" : type === "video" ? "poster" : "document_preview";
  const media: Media = { id: mediaId, profileId: options.profileId, rawSourceId: sourceId, mediaAssetId: assetId, type, src: mediaDeliveryUrl(mediaId, variant), originalFilename: file.filename, mimeType: file.mimeType, fileSize: file.size ?? bytes?.byteLength, alt: file.filename, takenAt: file.takenAt ?? now, visibility, width, height, durationSeconds: file.durationSeconds };
  await appendUpload({ source, media: [media], assets: [asset], locations });
  await organizeSources([sourceId]);
  return { sourceId, assetId, mediaId, organized: true };
}
