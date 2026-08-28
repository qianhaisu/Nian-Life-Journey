import { createHash } from "node:crypto";
import { appendUpload, getStore, newId } from "@/lib/db/repository";
import { createDerivatives, sourceImageMetadata } from "@/lib/media/processing";
import { hotStorage } from "@/lib/storage/hot-storage";
import { organizeSources } from "@/lib/organizer/rule-based";
import type { Media, MediaAsset, MediaLocation, RawSource } from "@/lib/types";

export type QuarkFile = { providerRef: string; path?: string; filename: string; mimeType: string; size?: number; takenAt?: string; checksum?: string; width?: number; height?: number; durationSeconds?: number };

export interface QuarkClient {
  list(scope: { folder?: string; from?: string; to?: string; query?: string; cursor?: string }): Promise<{ files: QuarkFile[]; cursor?: string }>;
  download(providerRef: string): Promise<Uint8Array>;
}

export async function ingestQuarkFile(file: QuarkFile, options: { profileId: string; contributorId: string; visibility: "private" | "family" | "public" }, client?: Pick<QuarkClient, "download">) {
  const currentStore = await getStore();
  const existing = currentStore.mediaLocations.find((location) => location.provider === "quark" && location.variant === "original" && location.providerRef === file.providerRef);
  if (existing) return { sourceId: currentStore.mediaAssets.find((asset) => asset.id === existing.mediaAssetId)?.rawSourceId, assetId: existing.mediaAssetId, mediaId: currentStore.media.find((media) => media.mediaAssetId === existing.mediaAssetId)?.id, duplicate: true };

  const sourceId = newId("source");
  const assetId = newId("asset");
  const mediaId = newId("media");
  const now = new Date().toISOString();
  const type = file.mimeType.startsWith("video/") ? "video" : file.mimeType === "application/pdf" ? "document" : "photo";
  const visibility = type === "document" ? "private" : options.visibility;
  const bytes = client ? await client.download(file.providerRef) : undefined;
  const dimensions = type === "photo" && bytes ? await sourceImageMetadata(bytes) : { width: file.width, height: file.height };
  const checksum = file.checksum ?? (bytes ? createHash("sha256").update(bytes).digest("hex") : undefined);
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
  const media: Media = { id: mediaId, profileId: options.profileId, rawSourceId: sourceId, mediaAssetId: assetId, type, src: `/api/media/${mediaId}?variant=${variant}`, originalFilename: file.filename, mimeType: file.mimeType, fileSize: file.size ?? bytes?.byteLength, alt: file.filename, takenAt: file.takenAt ?? now, visibility, width, height, durationSeconds: file.durationSeconds };
  await appendUpload({ source, media: [media], assets: [asset], locations });
  await organizeSources([sourceId]);
  return { sourceId, assetId, mediaId, organized: true };
}
