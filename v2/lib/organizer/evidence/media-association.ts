// Media association tiers.
//
// Hard rule: temporal co-occurrence alone never implies that a photo depicts a story. A Quark photo
// taken on the same calendar day as a WeChat memory is day-level evidence — it says "this happened
// somewhere in this day", not "this is a picture of that moment". Only a photo that arrived inside
// the conversation carrying the story, or immediately around it from the same speaker, may be shown
// as the memory's own media.
//
// This matters most on a day that holds several unrelated moments: a morning at the park and an
// evening at home share a date and nothing else, so a date match would attach the wrong picture to
// the wrong story with full confidence and no way for a reader to tell.
//
// Day- and month-level media are not discarded. They stay browsable through the day's DailyTrace,
// the MonthChapter and the photo archive — surfaces whose claim is "from this day/month", which is
// exactly what the evidence supports.
import type { MediaBinding } from "./types";
import { BINDING_THRESHOLD } from "./media-binding";

export type MediaAssociationTier = "confirmed" | "strong_contextual" | "day_level" | "month_level" | "unbound";

// Confirmed: the media and the words arrived as one message — the sender attached them to that text.
// Strong contextual: same speaker, seconds apart, in the same evidence window.
// Day level: same activity day only (cross-source, cross-sender, or a weak in-window guess).
// Month level: same month only — browsable, never attached.
export const EVENT_ELIGIBLE_TIERS: readonly MediaAssociationTier[] = ["confirmed", "strong_contextual"];

/** May this media be stored as a LifeEvent's own media / rendered as part of the story? */
export function mayAttachToLifeEvent(tier: MediaAssociationTier): boolean {
  return EVENT_ELIGIBLE_TIERS.includes(tier);
}

/** May this media appear in day/month browsing surfaces (DailyTrace, MonthChapter, archive)? */
export function mayAppearInDayBrowsing(tier: MediaAssociationTier): boolean {
  return tier !== "unbound";
}

// Maps the deterministic in-window binding rules onto the tier vocabulary. The 0.75 threshold that
// H4 already enforces for coreFacts is the same line that separates attachable from day-level here,
// so a photo can never support a written claim while being too weak to show, or vice versa.
export function tierForBinding(binding: Pick<MediaBinding, "confidence" | "rule">): MediaAssociationTier {
  if (binding.rule === "same_message_mixed" || binding.confidence >= 1) return "confirmed";
  if (binding.confidence >= BINDING_THRESHOLD) return "strong_contextual";
  if (binding.confidence > 0) return "day_level";
  return "day_level";
}

const dayOf = (iso: string) => iso.slice(0, 10);
const monthOf = (iso: string) => iso.slice(0, 7);

// Cross-source association (a Quark photo against a WeChat-derived event). There is deliberately no
// path to "confirmed" or "strong_contextual" here: nothing about a separate upload can establish
// that it depicts a particular moment, however well the timestamps line up.
export function crossSourceTier(input: { mediaCapturedAt: string; eventOccurredAt: string }): MediaAssociationTier {
  if (dayOf(input.mediaCapturedAt) === dayOf(input.eventOccurredAt)) return "day_level";
  if (monthOf(input.mediaCapturedAt) === monthOf(input.eventOccurredAt)) return "month_level";
  return "unbound";
}

export type MediaAssociation = { mediaId: string; tier: MediaAssociationTier; basis: string };

// Splits a window's bindings into the media a LifeEvent may own and the media that stays day-level.
// Callers persisting a LifeEvent must use `eventMedia` for mediaIds/heroMediaId and leave
// `dayLevelMedia` to the day and month surfaces.
export function partitionWindowMedia(bindings: Array<Pick<MediaBinding, "mediaId" | "confidence" | "rule">>): {
  eventMedia: MediaAssociation[];
  dayLevelMedia: MediaAssociation[];
} {
  const eventMedia: MediaAssociation[] = [];
  const dayLevelMedia: MediaAssociation[] = [];
  for (const binding of bindings) {
    const tier = tierForBinding(binding);
    const association = { mediaId: binding.mediaId, tier, basis: binding.rule };
    if (mayAttachToLifeEvent(tier)) eventMedia.push(association);
    else dayLevelMedia.push(association);
  }
  return { eventMedia, dayLevelMedia };
}
