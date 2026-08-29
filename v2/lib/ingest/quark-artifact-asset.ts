// Creates/updates MediaAsset + MediaLocation(provider="quark") from a mapped artifact item.
// This never downloads bytes, never computes a checksum, and never creates a RawSource/Media/organizer run.
import { appendMediaAssetWithLocation, findMediaLocationByProviderRef, newId, updateMediaAssetWithLocation } from "@/lib/db/repository";
import type { MediaAsset, MediaLocation } from "@/lib/types";
import { QuarkAdapterError } from "./quark";
import type { QuarkArtifactMediaInput } from "./quark-artifact";

export type QuarkArtifactIngestOptions = { profileId: string };
export type QuarkArtifactIngestResult = { providerRef: string; assetId: string; locationId: string; created: boolean };

export async function ingestQuarkArtifactAsset(input: QuarkArtifactMediaInput, options: QuarkArtifactIngestOptions): Promise<QuarkArtifactIngestResult> {
  if (!input.providerRef || input.providerRef.length > 512 || /(^|[\\/])\.\.(?:$|[\\/])|[\u0000\r\n]/.test(input.providerRef) || !input.filename || !input.mimeType) {
    throw new QuarkAdapterError("QUARK_METADATA_INVALID", "Quark artifact item metadata is incomplete", { action: "ingest-artifact", retryable: false });
  }
  const now = new Date().toISOString();
  const existing = await findMediaLocationByProviderRef("quark", input.providerRef);
  if (existing && !existing.asset) {
    throw new QuarkAdapterError("QUARK_METADATA_INVALID", "Quark provider reference has no associated media asset", { action: "ingest-artifact", retryable: false });
  }
  if (existing?.asset) {
    const locationPatch: Partial<MediaLocation> = { mimeType: input.mimeType };
    if (input.size !== undefined) locationPatch.fileSize = input.size;
    if (input.sourcePath !== undefined) locationPatch.quarkPathSnapshot = input.sourcePath;
    if (input.sourceParentRef !== undefined) locationPatch.sourceParentRef = input.sourceParentRef;
    if (input.sourceCreatedAt !== undefined) locationPatch.sourceCreatedAt = input.sourceCreatedAt;
    if (input.sourceUpdatedAt !== undefined) locationPatch.sourceUpdatedAt = input.sourceUpdatedAt;
    const updated = await updateMediaAssetWithLocation(
      existing.asset.id,
      existing.location.id,
      { originalFilename: input.filename, mimeType: input.mimeType },
      locationPatch,
    );
    const asset = updated?.asset ?? existing.asset;
    const location = updated?.location ?? existing.location;
    return { providerRef: input.providerRef, assetId: asset.id, locationId: location.id, created: false };
  }

  const assetId = newId("asset");
  const locationId = newId("location");
  const asset: MediaAsset = { id: assetId, profileId: options.profileId, mediaType: input.mediaType, mimeType: input.mimeType, takenAt: input.capturedAt, checksum: input.checksum, originalFilename: input.filename, archiveStatus: "archived", archiveVerifiedAt: now, createdAt: now };
  const location: MediaLocation = { id: locationId, mediaAssetId: assetId, provider: "quark", variant: "original", providerRef: input.providerRef, mimeType: input.mimeType, fileSize: input.size, status: "archived", quarkPathSnapshot: input.sourcePath, sourceParentRef: input.sourceParentRef, sourceCreatedAt: input.sourceCreatedAt, sourceUpdatedAt: input.sourceUpdatedAt, createdAt: now, updatedAt: now };
  await appendMediaAssetWithLocation(asset, location);
  return { providerRef: input.providerRef, assetId, locationId, created: true };
}
