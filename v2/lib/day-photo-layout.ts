import type { GalleryPhoto } from "@/components/photo-viewer";
import { mediaDeliveryUrl } from "@/lib/media/paths";
import type { MediaRef } from "@/lib/memory-chapters";

export type ThumbnailChoice = {
  src: string;
  fallbackSrc?: string;
  alt: string;
};

export type PartitionedDayPhotos = {
  /** First first-screen still photo shown as the day's hero plate, or null when the day has no still photo. */
  hero: GalleryPhoto | null;
  /** Per-paragraph inline media groups aligned with `paragraphs` (length === paragraphCount). Never duplicates `hero` or earlier groups. */
  paragraphGroups: GalleryPhoto[][];
  /** Remaining deliverable media not already rendered in `hero` or `paragraphGroups`, for the end-of-article grid. */
  remainingMedia: GalleryPhoto[];
  /** Complete ordered list of still photos on this day in reading order (`hero` -> inline groups -> remaining stills), for ViewerModal. */
  viewerPhotos: GalleryPhoto[];
  /** Direct lookup from mediaId to its 0-based index inside `viewerPhotos`. */
  viewerIndexById: Record<string, number>;
};

const isVideo = (item: Pick<GalleryPhoto, "type">): boolean => item.type === "video";

/**
 * Resolves a compact thumbnail URL + full-res fallback for cards (previous/next day, month highlights)
 * without triggering unnecessary 404s when static mock assets are used instead of `/api/media/*` derivatives.
 */
export function resolveCardThumbnail(
  photos: readonly MediaRef[],
  preferredIds?: readonly string[],
): ThumbnailChoice | undefined {
  if (photos.length === 0) return undefined;
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  let picked: MediaRef | undefined;
  if (preferredIds && preferredIds.length > 0) {
    picked = preferredIds.map((id) => byId.get(id)).find((item): item is MediaRef => item !== undefined && !isVideo(item));
    if (!picked) {
      picked = preferredIds.map((id) => byId.get(id)).find((item): item is MediaRef => item !== undefined);
    }
  }
  if (!picked) {
    picked = photos.find((item) => !isVideo(item)) ?? photos[0];
  }
  if (!picked) return undefined;

  if (isVideo(picked)) {
    const poster = picked.posterSrc ?? (picked.src.startsWith("/api/media/") ? mediaDeliveryUrl(picked.id, "poster") : undefined);
    if (!poster) return undefined;
    return { src: poster, alt: picked.alt };
  }

  const primary = picked.thumbnailSrc
    ?? (picked.src.startsWith("/api/media/") ? mediaDeliveryUrl(picked.id, "thumbnail") : picked.src);
  return {
    src: primary,
    fallbackSrc: primary !== picked.src ? picked.src : undefined,
    alt: picked.alt,
  };
}

/**
 * Splits a day's curated deliverable media across:
 *   1. `hero`: first deliverable still photo in `firstScreenMediaIds` (falling back to the day's first still photo)
 *   2. `paragraphGroups`: anchored inline media after each paragraph (`paragraphMedia[i]`), strictly deduplicated
 *   3. `remainingMedia`: any remaining media not already rendered above (empty when all photos were already placed!)
 *
 * Also computes `viewerPhotos` in exact top-to-bottom visual reading order so clicking ANY still photo
 * (hero, inline paragraph photo, or end-of-article grid photo) opens the full-day ViewerModal positioned
 * at that exact photo with its optional `caption` attached.
 */
export function partitionDayPhotos({
  photos,
  firstScreenMediaIds = [],
  paragraphMedia,
  paragraphCount,
  photoCaptions,
}: {
  photos: readonly MediaRef[];
  firstScreenMediaIds?: readonly string[];
  paragraphMedia?: readonly (readonly string[])[];
  paragraphCount: number;
  photoCaptions?: Readonly<Record<string, string>>;
}): PartitionedDayPhotos {
  const enriched: GalleryPhoto[] = photos.map((photo) => {
    const rawCaption = photoCaptions?.[photo.id];
    const caption = typeof rawCaption === "string" && rawCaption.trim().length > 0 ? rawCaption.trim() : undefined;
    return {
      ...photo,
      alt: caption ?? photo.alt,
      caption,
    };
  });

  const byId = new Map(enriched.map((item) => [item.id, item]));
  const usedIds = new Set<string>();

  let hero: GalleryPhoto | null = null;
  for (const id of firstScreenMediaIds) {
    const candidate = byId.get(id);
    if (candidate && !isVideo(candidate)) {
      hero = candidate;
      break;
    }
  }
  if (!hero) {
    hero = enriched.find((item) => !isVideo(item)) ?? null;
  }
  if (hero) {
    usedIds.add(hero.id);
  }

  const count = Math.max(0, paragraphCount);
  const paragraphGroups: GalleryPhoto[][] = Array.from({ length: count }, (_, index) => {
    const ids = paragraphMedia?.[index];
    if (!ids || ids.length === 0) return [];
    const group: GalleryPhoto[] = [];
    for (const id of ids) {
      if (usedIds.has(id)) continue;
      const item = byId.get(id);
      if (!item) continue;
      usedIds.add(item.id);
      group.push(item);
    }
    return group;
  });

  const remainingMedia = enriched.filter((item) => !usedIds.has(item.id));

  const viewerPhotos: GalleryPhoto[] = [
    ...(hero ? [hero] : []),
    ...paragraphGroups.flat().filter((item) => !isVideo(item)),
    ...remainingMedia.filter((item) => !isVideo(item)),
  ];

  const viewerIndexById: Record<string, number> = {};
  viewerPhotos.forEach((item, index) => {
    viewerIndexById[item.id] = index;
  });

  return {
    hero,
    paragraphGroups,
    remainingMedia,
    viewerPhotos,
    viewerIndexById,
  };
}
