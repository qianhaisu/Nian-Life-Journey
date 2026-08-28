import { newId, appendUpload, getStore } from "@/lib/db/repository";
import type { Media, MediaAsset, MediaLocation, RawSource } from "@/lib/types";
import { derivativePlan } from "@/lib/storage/hot-storage";

export type QuarkFile = { providerRef: string; path?: string; filename: string; mimeType: string; size?: number; takenAt?: string; checksum?: string; width?: number; height?: number; durationSeconds?: number };
export interface QuarkClient {
  list(scope: { folder?: string; from?: string; to?: string; query?: string; cursor?: string }): Promise<{ files: QuarkFile[]; cursor?: string }>;
  download(providerRef: string): Promise<Uint8Array>;
}

export async function ingestQuarkFile(file: QuarkFile, options: { profileId: string; contributorId: string; visibility: "private" | "family" | "public" }) {
  const currentStore = await getStore();
  const existing = currentStore.mediaLocations.find((location) => location.provider === "quark" && location.variant === "original" && location.providerRef === file.providerRef);
  if (existing) return { sourceId: currentStore.mediaAssets.find((asset) => asset.id === existing.mediaAssetId)?.rawSourceId, assetId: existing.mediaAssetId, mediaId: currentStore.media.find((media) => media.mediaAssetId === existing.mediaAssetId)?.id, duplicate: true };
  const sourceId = newId("source"); const assetId = newId("asset"); const mediaId = newId("media"); const now = new Date().toISOString();
  const type = file.mimeType.startsWith("video/") ? "video" : "photo";
  const asset: MediaAsset = { id: assetId, profileId: options.profileId, rawSourceId: sourceId, mediaType: type, mimeType: file.mimeType, width: file.width, height: file.height, durationSeconds: file.durationSeconds, takenAt: file.takenAt, checksum: file.checksum, originalFilename: file.filename, createdAt: now };
  const media: Media = { id: mediaId, profileId: options.profileId, rawSourceId: sourceId, mediaAssetId: assetId, type, src: "/api/media/" + mediaId, originalFilename: file.filename, mimeType: file.mimeType, fileSize: file.size, alt: file.filename, takenAt: file.takenAt ?? now, visibility: options.visibility, width: file.width ?? 1200, height: file.height ?? 900, durationSeconds: file.durationSeconds };
  const locations: MediaLocation[] = [{ id: newId("location"), mediaAssetId: assetId, provider: "quark", variant: "original", providerRef: file.providerRef, mimeType: file.mimeType, fileSize: file.size, width: file.width, height: file.height, status: "ready", quarkPathSnapshot: file.path, createdAt: now, updatedAt: now }];
  for (const item of derivativePlan(asset)) locations.push({ id: newId("location"), mediaAssetId: assetId, provider: "hot", variant: item.variant, providerRef: "", status: "pending", createdAt: now, updatedAt: now });
  const source: RawSource = { id: sourceId, profileId: options.profileId, sourceType: type === "video" ? "family_video" : "family_photo", contentTypes: ["daily", "family"], contributorId: options.contributorId, capturedAt: file.takenAt ?? now, importedAt: now, mediaIds: [mediaId], sourceLabel: "Quark 自动备份", visibility: options.visibility, status: "uploaded", originalFilename: file.filename, metadata: { provider: "quark", providerRef: file.providerRef, quarkPathSnapshot: file.path } };
  await appendUpload({ source, media: [media], assets: [asset], locations });
  return { sourceId, assetId, mediaId };
}
