import { getStore } from "@/lib/db/repository";
import { hotStorage, selectLocation } from "@/lib/storage/hot-storage";
import type { MediaAsset, MediaLocation, RawSource } from "@/lib/types";
import type { OrganizerMediaInput } from "./types";

export interface MediaInputResolver {
  resolve(sources: RawSource[], maxInputs?: number): Promise<OrganizerMediaInput[]>;
}

function maxImageInputs(env: NodeJS.ProcessEnv = process.env) {
  const value = Number.parseInt(env.AI_ORGANIZER_MAX_IMAGE_INPUTS ?? "6", 10);
  return Number.isFinite(value) ? Math.min(6, Math.max(1, value)) : 6;
}

function canUseAsInput(source: RawSource, asset: MediaAsset) {
  if (source.sourceType === "chat_screenshot") return asset.mediaType === "photo";
  if (source.sourceType === "family_photo" || source.sourceType === "daycare_photo") return asset.mediaType === "photo";
  if (source.sourceType === "family_video") return asset.mediaType === "video";
  return false;
}

function chooseRepresentative<T>(items: T[], limit: number) {
  if (items.length <= limit) return items;
  const result: T[] = [];
  for (let index = 0; index < limit; index += 1) result.push(items[Math.floor(index * (items.length - 1) / Math.max(1, limit - 1))]);
  return result;
}

// The resolver intentionally reads only ready Hot Storage derivatives. It has
// no path to Quark originals and never emits a public URL.
export class HotStorageMediaInputResolver implements MediaInputResolver {
  async resolve(sources: RawSource[], maxInputs = maxImageInputs()) {
    const store = await getStore();
    const candidates: Array<{ source: RawSource; mediaId: string; asset: MediaAsset; location: MediaLocation }> = [];
    for (const source of sources) {
      for (const mediaId of source.mediaIds) {
        const media = store.media.find((item) => item.id === mediaId);
        const asset = media?.mediaAssetId ? store.mediaAssets.find((item) => item.id === media.mediaAssetId) : undefined;
        if (!asset || !canUseAsInput(source, asset)) continue;
        const locations = store.mediaLocations.filter((item) => item.mediaAssetId === asset.id);
        const requested = asset.mediaType === "video" ? "poster" as const : "thumbnail" as const;
        const location = selectLocation(locations, asset, requested);
        if (!location || location.provider !== "hot" || location.status !== "ready" || !location.providerRef.startsWith("media/")) continue;
        candidates.push({ source, mediaId, asset, location });
      }
    }
    candidates.sort((a, b) => {
      const sourceOrder = a.source.capturedAt.localeCompare(b.source.capturedAt);
      return sourceOrder || a.mediaId.localeCompare(b.mediaId);
    });
    const selected = chooseRepresentative(candidates, Math.min(6, maxInputs));
    const inputs: OrganizerMediaInput[] = [];
    for (const item of selected) {
      const bytes = await hotStorage.get(item.location.providerRef);
      if (!bytes) continue;
      inputs.push({ sourceId: item.source.id, mediaId: item.mediaId, variant: item.location.variant as "thumbnail" | "web" | "poster", mimeType: item.location.mimeType ?? item.asset.mimeType, bytes, width: item.location.width ?? item.asset.width, height: item.location.height ?? item.asset.height });
    }
    return inputs;
  }
}
