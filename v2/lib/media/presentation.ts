import type { Media } from "@/lib/types";
import { isHeroEligible, isThumbnailEligible } from "@/lib/media/hero";

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

// The importer stamps "WeChat image" on every picture it cannot describe. That is an engineering
// label, not a caption, and a screen reader saying "WeChat image" 900 times helps nobody. The
// fallback is deliberately neutral — never a guessed description of what the photo shows.
const PLACEHOLDER_ALTS = new Set(["wechat image", "wechat video", "image", "video", "photo"]);

export function presentableAlt(media: Pick<Media, "alt" | "type">, context?: string): string {
  const alt = media.alt?.trim() ?? "";
  if (alt && !PLACEHOLDER_ALTS.has(alt.toLowerCase())) return alt;
  const noun = media.type === "video" ? "一段视频" : "一张照片";
  return context ? `${context} · ${noun}` : noun;
}

// One editorial layout per photo count. Counts are folded into the nearest rule, not into "grid
// of everything": a day with 14 photos reads as 8 chosen ones plus "还有 6 张".
export type SequenceLayout = "single" | "triptych" | "spread" | "contact";

export const SEQUENCE_LIMITS: Record<SequenceLayout, number> = { single: 1, triptych: 3, spread: 8, contact: 20 };

export type MediaSequence = {
  layout: SequenceLayout;
  shown: Media[];
  // Photos beyond the layout's limit, still reachable via the evidence disclosure.
  remaining: number;
};

export function sequenceFor(candidates: Media[], preferredId?: string): MediaSequence {
  const photos = candidates.filter(isThumbnailEligible);
  const preferred = preferredId ? photos.find((item) => item.id === preferredId) : undefined;
  const ordered = preferred ? [preferred, ...photos.filter((item) => item.id !== preferredId)] : photos;
  // A lead photo must stand on its own at page width; the rest only need to survive a grid cell.
  const lead = ordered.find(isHeroEligible);
  const sequence = lead ? [lead, ...ordered.filter((item) => item.id !== lead.id)] : ordered;
  const count = sequence.length;
  const layout: SequenceLayout = count <= 1 ? "single" : count <= 3 ? "triptych" : count <= 8 ? "spread" : "contact";
  const shown = sequence.slice(0, SEQUENCE_LIMITS[layout]);
  return { layout, shown, remaining: count - shown.length };
}
