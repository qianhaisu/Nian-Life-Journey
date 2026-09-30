import type { Media, MediaAsset } from "@/lib/types";

export type DisplayMedia = Media & { displayKey?: string };

/** Exact file identity only. No time, dimensions, filename or visual similarity guesses. */
export function identifyDisplayMedia(media: readonly Media[], assets: readonly MediaAsset[]): DisplayMedia[] {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return media.map((item) => {
    const asset = item.mediaAssetId ? byId.get(item.mediaAssetId) : undefined;
    if (item.type !== "photo" || !asset || asset.profileId !== item.profileId || asset.mediaType !== "photo") return item;
    const checksum = asset.checksum?.trim().replace(/^sha256:/i, "").toLowerCase();
    const identity = checksum && /^[a-f0-9]{64}$/.test(checksum) ? `sha256:${checksum}` : `asset:${asset.id}`;
    return { ...item, displayKey: `${item.profileId}:photo:${identity}` };
  });
}

type DisplayItem = { id: string; type?: string; displayKey?: string };
export function displayIdentity(item: DisplayItem): string {
  return item.type === "photo" && item.displayKey ? item.displayKey : `id:${item.id}`;
}

/** Preserve curated order and source rows. Eligibility must be checked before calling this. */
export function uniqueDisplayMedia<T extends DisplayItem>(items: readonly T[], prefer?: (next: T, previous: T) => boolean): T[] {
  const unique = new Map<string, T>();
  for (const item of items) {
    const key = displayIdentity(item);
    const previous = unique.get(key);
    if (!previous || prefer?.(item, previous)) unique.set(key, item);
  }
  return [...unique.values()];
}
