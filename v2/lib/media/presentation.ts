import type { Media } from "@/lib/types";
import { NO_HERO_MEDIA_ID, isHeroEligible, isThumbnailEligible } from "@/lib/media/hero";

// Display-only decisions about photos. Nothing here touches Media identity, storage or the import
// pipeline; it decides how an existing record is *shown*.

export type Orientation = "portrait" | "landscape" | "square";

export function orientationOf(media: Pick<Media, "width" | "height">): Orientation {
  if (!media.width || !media.height) return "landscape";
  const ratio = media.width / media.height;
  if (ratio < 0.9) return "portrait";
  if (ratio > 1.1) return "landscape";
  return "square";
}

// CSS aspect-ratio string so the image box matches the photo instead of forcing a crop.
export function aspectRatioOf(media: Pick<Media, "width" | "height">): string | undefined {
  if (!media.width || !media.height) return undefined;
  return `${media.width} / ${media.height}`;
}

// A picture much taller than any camera takes. A phone screenshot is the shape of the screen;
// cameras are 4:3 (1.33) or 16:9 (1.78), and a portrait crop rarely passes 2:1.
//
// This is a WEAK ORDERING SIGNAL and nothing else. It is not a screenshot test, not a privacy
// filter, and never a reason to withhold a picture: a day's photographs still contain every row
// they contained, and expanding a group shows all of them. All it decides is which ones a reader
// meets first, because the default preview was arrival order and a reader opening 2025-11 met a
// full-page article capture before the pictures of the child.
//
// Deliberately not the test I tried first. Matching exact device resolutions was checked by opening
// all eleven pictures it flagged in 2025-11: the six at 1080x1920 were ordinary photographs of him
// (a shopping trolley, a bottle, a pram) because 1080x1920 is both a phone screen and a perfectly
// normal photo/video frame. Only the aspect half survived — its five hits there were all captures.
// Archive-wide that class is 1,190 of 9,808 family-visible rows, with just 4 rows between 1.9 and
// 2.0, so the boundary is not cutting through a crowd. Five samples do not prove 1,190 are right,
// which is exactly why this may only reorder.
export const READING_TALL_RATIO = 2;

export function isScreenShaped(media: Pick<Media, "width" | "height">): boolean {
  if (!media.width || !media.height) return false;
  return media.height / media.width >= READING_TALL_RATIO || media.width / media.height >= READING_TALL_RATIO;
}

/** Same pictures, same relative order within each class — screen-shaped ones simply read later. */
export function photographsFirst<T extends Pick<Media, "width" | "height">>(photos: T[]): T[] {
  const camera = photos.filter((item) => !isScreenShaped(item));
  const screens = photos.filter((item) => isScreenShaped(item));
  return screens.length === 0 ? photos : [...camera, ...screens];
}

// Two kinds of engineering label reach `alt` and neither is a caption. The importer stamps
// "WeChat image" on every picture it cannot describe, and photos that arrived as files keep their
// filename ("微信图片_20260828174027_6453_721.jpg"). A family reader must never be shown either —
// the filename one had been printing verbatim under photographs on the front page — and a screen
// reader saying "WeChat image" 900 times helps nobody. The fallback is deliberately neutral: it
// says what the thing is and where it sits, never a guess at what the photo shows.
const PLACEHOLDER_ALTS = new Set(["wechat image", "wechat video", "image", "video", "photo"]);

// A stored file rather than a description: anything ending in a media extension.
const FILENAME_ALT = /\.(jpe?g|png|gif|webp|heic|heif|bmp|tiff?|mp4|mov|m4v|avi|mkv|webm)$/i;

// Whether an `alt` is something a person wrote about the photo, as opposed to something the
// import pipeline left behind.
export function isPresentableAlt(alt: string | undefined | null): boolean {
  const trimmed = alt?.trim() ?? "";
  if (!trimmed) return false;
  if (PLACEHOLDER_ALTS.has(trimmed.toLowerCase())) return false;
  return !FILENAME_ALT.test(trimmed);
}

export function presentableAlt(media: Pick<Media, "alt" | "type">, context?: string): string {
  const alt = media.alt?.trim() ?? "";
  if (isPresentableAlt(alt)) return alt;
  const noun = media.type === "video" ? "一段视频" : "一张照片";
  return context ? `${context} · ${noun}` : noun;
}

// A memory page's pictures, in the order the page reads: at most ONE hero between the title and
// the story (the event's own heroMediaId when it qualifies, else the first photo that does), a few
// supporting frames after the story, and a count for the rest — they stay reachable through the
// evidence disclosure. A story with no qualifying hero is a text page, which is a valid page: no
// picture is stretched to fill the slot.
export const STORY_SUPPORTING_MAX = 6;

export type StoryMediaLayout = { hero?: Media; supporting: Media[]; remaining: number };

export function storyLayout(candidates: Media[], preferredId?: string): StoryMediaLayout {
  // Reviewed, no photo: unlike an unset heroMediaId, this does not fall back to the event's other
  // attached media (see lib/media/hero.ts's NO_HERO_MEDIA_ID) — the story is text-only, full stop.
  if (preferredId === NO_HERO_MEDIA_ID) return { hero: undefined, supporting: [], remaining: 0 };
  const drawable = candidates.filter(isThumbnailEligible);
  const preferred = preferredId ? drawable.find((item) => item.id === preferredId) : undefined;
  const hero = preferred && isHeroEligible(preferred) ? preferred : drawable.find(isHeroEligible);
  const supporting = drawable.filter((item) => item.id !== hero?.id).slice(0, STORY_SUPPORTING_MAX);
  return { hero, supporting, remaining: drawable.length - (hero ? 1 : 0) - supporting.length };
}
