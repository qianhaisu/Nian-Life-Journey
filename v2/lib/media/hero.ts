import type { Media } from "@/lib/types";

// A hero image is shown at or near full page width. Anything smaller reads as an upscaled
// mosaic instead of a photo, so both dimensions are bounded, not just one.
export const HERO_MIN_SHORT_SIDE = 480;
export const HERO_MIN_LONG_SIDE = 720;

// The same size rules, usable on any object that carries type and dimensions (Media rows and the
// MediaRef view model alike). Production has shipped 20x20 WeChat UI icons, 67x120 sticker thumbs
// and 21x16 fragments as real rows; a size floor is the one signal that rules all of them out
// without pretending to understand image content.
export function heroSized(item: { type?: string; width?: number; height?: number }): boolean {
  if (item.type !== undefined && item.type !== "photo") return false;
  if (!item.width || !item.height) return false;
  const shortSide = Math.min(item.width, item.height);
  const longSide = Math.max(item.width, item.height);
  return shortSide >= HERO_MIN_SHORT_SIDE && longSide >= HERO_MIN_LONG_SIDE;
}

export function thumbnailSized(item: { width?: number; height?: number }): boolean {
  if (!item.width || !item.height) return false;
  return Math.min(item.width, item.height) >= THUMBNAIL_MIN_SIDE;
}

// Unknown dimensions, non-photo media (video posters, documents), and anything under the size
// floor are excluded — the floor alone already rules out stickers/emoji/thumbnails in practice.
export function isHeroEligible(media: Media | undefined | null): media is Media {
  if (!media) return false;
  return heroSized(media);
}

// A heroMediaId of exactly this value means "reviewed, and no photo belongs on this story" — not
// "unset". An unset/undefined heroMediaId still falls back to whatever eligible photo the event
// carries (below); this sentinel exists because that fallback is otherwise unconditional, so it is
// the only way to bind "no picture" to an event that still has ineligible or mismatched media
// attached. Real media ids are always provider-prefixed (wechat-media:, media-quark-sha-, ...), so
// a bare "none" can never collide with one.
export const NO_HERO_MEDIA_ID = "none";

// Eligible candidates in preference order: the event's own heroMediaId first (if it qualifies),
// then the rest of its photos in their existing order. Callers that render an <img> should walk
// this list on load failure instead of trusting the first entry alone — a candidate can pass the
// dimension check yet still have no ready derivative in storage.
export function heroCandidates(preferredId: string | undefined, candidates: Media[]): Media[] {
  if (preferredId === NO_HERO_MEDIA_ID) return [];
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
  return thumbnailSized(media);
}
