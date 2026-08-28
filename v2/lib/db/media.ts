import type { Media, MediaAsset, MediaLocation, MediaVariant } from "@/lib/types";
import type { Store } from "@/lib/db/repository";
import { mediaDeliveryUrl, normalizeMediaUrl } from "@/lib/media/paths";
import { selectLocation } from "@/lib/storage/hot-storage";

export function assetForMedia(store: Store, media: Media): MediaAsset | undefined {
  return store.mediaAssets.find((asset) => asset.id === media.mediaAssetId);
}

export function locationForMedia(store: Store, media: Media, variant: MediaVariant = "web"): MediaLocation | undefined {
  const asset = assetForMedia(store, media);
  if (!asset) return undefined;
  return selectLocation(store.mediaLocations.filter((location) => location.mediaAssetId === asset.id), asset, variant) ?? undefined;
}

export function deliveryUrl(media: Media, location?: MediaLocation) {
  return location && location.provider === "hot" && location.variant !== "original" ? mediaDeliveryUrl(media.id, location.variant) : normalizeMediaUrl(media.src);
}
