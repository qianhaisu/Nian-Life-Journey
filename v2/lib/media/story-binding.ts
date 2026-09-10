import type { LifeEvent, Media } from "@/lib/types";

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
// One thing in this database does record association: which raw sources a story was written from.
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
// A second basis is meant to exist and does not yet: an explicit human confirmation that a
// picture belongs to a story. `content_quality_reviews` today carries only life_event,
// life_event_trace, daily_trace and monthly_snapshot decisions — there is no media-binding kind and
// nothing writes one, so no photograph anywhere is human-confirmed. When that record exists, it
// joins here as a second accepted basis; it is deliberately not faked in the meantime.
//
// What this is NOT: a claim that the other bindings are wrong. Most of them have simply never had
// their relationship recorded. Unproven and disproven are different things, and pictures whose
// association cannot be shown are not deleted, not unbound and not hidden — they move to the
// month's own photo section, where they are presented as the month's photographs rather than as
// any story's illustration.
export function isStoryAssociated(event: Pick<LifeEvent, "sourceIds">, media: Pick<Media, "rawSourceId">): boolean {
  if (!media.rawSourceId) return false;
  return event.sourceIds.includes(media.rawSourceId);
}

// The subset of an event's attached media that may be presented as part of its story. Order is
// preserved so downstream hero/supporting selection keeps behaving the way it reads.
export function storyAssociatedMedia<T extends Pick<Media, "rawSourceId">>(event: Pick<LifeEvent, "sourceIds">, media: T[]): T[] {
  return media.filter((item) => isStoryAssociated(event, item));
}
