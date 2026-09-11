import type { LifeEvent, Media, OrganizerRunMetadata } from "@/lib/types";
import { mayAttachToMemory, type MediaBindingTier } from "@/lib/organizer/evidence/media-tier";

// What makes a photograph part of a STORY, as opposed to part of the same day.
//
// A hero or a thumbnail set beside a story is a claim: "this picture is this story". The archive
// has to be able to show why that claim is true. Until 2026-09-10 it could not: every story image
// on the site was chosen by lib/publication-moments.ts's pickDayPhotos — the day matches, the
// photo is big enough, its source is a trusted one, it sorts first. None of that is about the
// story. 08-19「能跟着老师的音乐互动了」ended up illustrated with a daycare meal board that way,
// and that was not a bug in the selection, it was the selection working as designed.
//
// So the rule is now: same day, nearby time, adequate size and sort order are NOT association, in
// any combination. Neither is the presence of a heroMediaId — 523 of the archive's 524 bound
// stories got theirs from a same-day backfill (scripts/t18-backfill-media-binding.mjs), so the
// column records a past selection, not evidence.
//
// BASIS A — the message the picture arrived in.
//
// `LifeEvent.sourceIds` is the material the organizer read; `Media.rawSourceId` is the material a
// picture arrived in. When they meet, the photograph is literally part of what the story was
// written from — a picture attached to one of those very messages. That is traceable, per-item,
// and survives being asked "why this photo?".
//
// Verified against production 2026-09-10: the two directions of that relation agree exactly
// (all 9,356 media rows are listed back by their own raw source), so testing `rawSourceId` against
// the event's sources is the same statement as walking the sources' media lists, and needs no
// extra table at read time.
//
// BASIS B — the message the picture was bound TO.
//
// Basis A alone is the right question for a photograph that arrived in a message someone also wrote
// words in. It is the WRONG question for almost every WeChat photograph, and measuring it said so:
// of the 35 (story, photograph) pairs the Organizer has actually adopted, Basis A accepts 6.
//
// The reason is in the export format. A WeChat photo does not arrive attached to a sentence — it
// arrives as its own message whose entire body is the exporter's `[media]` placeholder (265 of 299
// media-bearing messages, measured on the windows the Organizer ran). A story is never written FROM
// a placeholder, so the placeholder is never in `sourceIds`, so Basis A refuses a picture the
// Organizer bound to the very sentence the story quotes. That is hiding a photograph for a
// property of the file format rather than for anything about the photograph.
//
// What the archive records instead is the binding itself. `organizer_run.mediaBinding.adopted`
// carries, per photograph: the message it was bound to (`boundSourceId` — a message that actually
// says something), the tier that binding earned, and a human-readable `basis`. So the second basis
// is: the picture was adopted by the story's own Organizer run, at a tier that may be attached to a
// Memory (lib/organizer/evidence/media-tier.ts — `confirmed` or `strong_contextual`, the same table
// the Writer is held to), and the message it was bound to is one of the story's sources.
//
// This is still per-item, still explicable, and still refuses everything Basis A refuses it for:
//   - A photograph with NO adopted record cannot pass. That is what keeps the 2026-09-10 finding
//     intact: all 530 (published story, photograph) pairs in production come from the same-day
//     backfill (scripts/t18-backfill-media-binding.mjs) and carry no binding record at all, so this
//     basis restores exactly 0 of them — measured against production 2026-09-11, not argued.
//   - `refused` bindings never count, and neither does a tier the policy will not attach.
//   - It only ever FILTERS an event's existing media_ids. A photograph a person took back by
//     removing it from media_ids, or by the NO_HERO_MEDIA_ID sentinel, stays taken back — nothing
//     here can add a picture the event no longer lists.
//
// A third basis is meant to exist and does not yet: an explicit human confirmation that a picture
// belongs to a story. `content_quality_reviews` today carries only life_event, life_event_trace,
// daily_trace and monthly_snapshot decisions — there is no media-binding kind and nothing writes
// one. When that record exists it joins here; it is deliberately not faked in the meantime.
//
// What this is NOT: a claim that the unproven bindings are wrong. Most have simply never had their
// relationship recorded. Unproven and disproven are different things, and pictures whose
// association cannot be shown are not deleted, not unbound and not hidden — they move to the
// month's own photo section, where they are presented as the month's photographs rather than as
// any story's illustration.
type AssociationEvent = Pick<LifeEvent, "sourceIds"> & { organizerRun?: Pick<OrganizerRunMetadata, "mediaBinding"> | null };

export function isStoryAssociated(event: AssociationEvent, media: Pick<Media, "id" | "rawSourceId">): boolean {
  if (media.rawSourceId && event.sourceIds.includes(media.rawSourceId)) return true;
  const adopted = event.organizerRun?.mediaBinding?.adopted?.find((binding) => binding.mediaId === media.id);
  if (!adopted?.boundSourceId) return false;
  if (!mayAttachToMemory(adopted.tier as MediaBindingTier)) return false;
  return event.sourceIds.includes(adopted.boundSourceId);
}

// Why a picture is shown beside a story, in the words the archive recorded at the time. Returns
// undefined for a picture that may not be shown at all, so a caller cannot print a reason for one.
export function storyAssociationBasis(event: AssociationEvent, media: Pick<Media, "id" | "rawSourceId">): string | undefined {
  if (!isStoryAssociated(event, media)) return undefined;
  if (media.rawSourceId && event.sourceIds.includes(media.rawSourceId)) return "the picture arrived in one of the messages this story was written from";
  return event.organizerRun?.mediaBinding?.adopted?.find((binding) => binding.mediaId === media.id)?.basis;
}

// The subset of an event's attached media that may be presented as part of its story. Order is
// preserved so downstream hero/supporting selection keeps behaving the way it reads.
export function storyAssociatedMedia<T extends Pick<Media, "id" | "rawSourceId">>(event: AssociationEvent, media: T[]): T[] {
  return media.filter((item) => isStoryAssociated(event, item));
}
