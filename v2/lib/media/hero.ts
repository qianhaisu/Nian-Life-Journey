import type { Media } from "@/lib/types";

// A hero image is shown at or near full page width. Anything smaller reads as an upscaled
// mosaic instead of a photo, so both dimensions are bounded, not just one.
export const HERO_MIN_SHORT_SIDE = 480;
export const HERO_MIN_LONG_SIDE = 720;

// Unknown dimensions, non-photo media (video posters, documents), and anything under the size
// floor are excluded — the floor alone already rules out stickers/emoji/thumbnails in practice.
export function isHeroEligible(media: Media | undefined | null): media is Media {
  if (!media) return false;
  if (media.type !== "photo") return false;
  if (!media.width || !media.height) return false;
  const shortSide = Math.min(media.width, media.height);
  const longSide = Math.max(media.width, media.height);
  return shortSide >= HERO_MIN_SHORT_SIDE && longSide >= HERO_MIN_LONG_SIDE;
}

// Eligible candidates in preference order: the event's own heroMediaId first (if it qualifies),
// then the rest of its photos in their existing order. Callers that render an <img> should walk
// this list on load failure instead of trusting the first entry alone — a candidate can pass the
// dimension check yet still have no ready derivative in storage.
export function heroCandidates(preferredId: string | undefined, candidates: Media[]): Media[] {
  const eligible = candidates.filter(isHeroEligible);
  const preferred = preferredId ? eligible.find((item) => item.id === preferredId) : undefined;
  if (!preferred) return eligible;
  return [preferred, ...eligible.filter((item) => item.id !== preferredId)];
}

export function selectHeroMedia(preferredId: string | undefined, candidates: Media[]): Media | undefined {
  return heroCandidates(preferredId, candidates)[0];
}

// A gallery/evidence thumbnail is rendered into a fixed cell (~135–426px wide). WeChat exports carry
// 20x20 UI icons and ~67x120 sticker thumbnails; stretched into that cell they read as broken
// fragments rather than photos. Same idea as the hero floor, one step lower: this is the smallest
// image that can fill a grid cell without obvious upscaling.
export const THUMBNAIL_MIN_SIDE = 160;

export function isThumbnailEligible(media: Media | undefined | null): media is Media {
  if (!media) return false;
  if (!media.width || !media.height) return false;
  return Math.min(media.width, media.height) >= THUMBNAIL_MIN_SIDE;
}
