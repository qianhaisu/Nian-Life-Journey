import type { LifeEvent, Media, OrganizerRunMetadata } from "@/lib/types";
import { mayNarrateAsDepicting, type MediaBindingTier } from "@/lib/organizer/evidence/media-tier";

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
// is: the picture was adopted by the story's own Organizer run, bound to a message this story was
// written from, at a tier that may be narrated as depicting the Memory.
//
// WHICH TIER, and why not the attachable one (2026-09-11 review decision).
//
// The first version of this basis accepted `mayAttachToMemory` — `confirmed` OR `strong_contextual`.
// That was wrong, and the numbers showed it: 12 of the 17 stories it restored got their LEAD
// photograph from `strong_contextual`, a tier whose own definition (lib/organizer/evidence/
// media-tier.ts) is "same speaker, same conversational beat, deterministic time bound. Good enough
// to place a picture near a story; NOT enough to assert it depicts the claim."
//
// A picture inside a story card is that assertion. It does not stop being one by being demoted from
// lead to supporting frame: anything printed inside the card is read as belonging to those words.
// 2026-02-19「妈妈说张小年严重依赖奶嘴」was the case that settled it — a real photograph of him, same
// speaker, 90 seconds, adopted by the Writer, and no pacifier anywhere in the frame.
//
// So the gate here is `mayNarrateAsDepicting`, the same predicate the Writer is held to, and the
// answer for a picture related only by adjacency is: not in the story. It keeps its place in the
// day's own photographs (「这一天的照片」), which claims only the date — the one relation it has.
//
// This is still per-item, still explicable, and still refuses everything Basis A refuses it for:
//   - A photograph with NO adopted record cannot pass. That is what keeps the 2026-09-10 finding
//     intact: all 530 (published story, photograph) pairs in production come from the same-day
//     backfill (scripts/t18-backfill-media-binding.mjs) and carry no binding record at all, so this
//     basis restores exactly 0 of them — measured against production 2026-09-11, not argued.
//   - `refused` bindings never count, and neither does any tier below `confirmed`.
//   - It only ever FILTERS an event's existing media_ids. A photograph a person took back by
//     removing it from media_ids, or by the NO_HERO_MEDIA_ID sentinel, stays taken back — nothing
//     here can add a picture the event no longer lists.
//
// BASIS C — somebody looked at the picture and said it belongs.
//
// The two bases above are both derived: they ask what the Organizer read and what it bound. Neither
// can ever reach a story written before the binding record existed, and production is full of those
// — all 212 published stories carry no `mediaBinding` block at all, so Basis B restores exactly none
// of them. The only thing that can is a record of somebody having looked.
//
// That record is a row in `content_quality_reviews`, the ledger this archive already keeps for
// every other "somebody decided" — `target_kind = "media_binding"`, `target_id = "<eventId>|<mediaId>"`,
// `decision = "approved"`. It needs no schema change, and the pages that ask this question already
// read that table for publication decisions, so it costs no extra query.
//
// WHAT THE ROW MUST NOT PRETEND TO BE. A row written after an agent opened the photograph says so
// in its own columns — `provider`/`model` name the agent, `reason_codes` carries the kind of check.
// It is NOT written into `organizer_run.mediaBinding`, which is the output record of one Organizer
// run and would be claiming that run produced a binding it never produced; and it does not describe
// itself as a person's confirmation. Whoever reads the ledger can tell which it was. This module
// only asks whether an approved row exists for exactly this pair; it does not grade the reviewer.
//
// EXACTLY THIS PAIR. A confirmation is per (story, photograph) and matches nothing else: not the
// same photograph under another story, not another photograph under the same story, not a target_id
// that does not split into exactly two non-empty halves. Any decision other than `approved` is not
// a confirmation, and neither is a row of any other kind.
//
// What this is NOT: a claim that the unproven bindings are wrong. Most have simply never had their
// relationship recorded. Unproven and disproven are different things, and pictures whose
// association cannot be shown are not deleted, not unbound and not hidden — they move to the
// month's own photo section, where they are presented as the month's photographs rather than as
// any story's illustration.
type AssociationEvent = Pick<LifeEvent, "id" | "sourceIds"> & { organizerRun?: Pick<OrganizerRunMetadata, "mediaBinding"> | null };

/** The review-ledger kind that records "somebody looked at this picture, for this story". */
export const STORY_PHOTO_REVIEW_KIND = "media_binding";

/** One confirmation, addressed to exactly one (story, photograph) pair. */
export type StoryPhotoConfirmations = ReadonlySet<string>;

export function storyPhotoKey(eventId: string, mediaId: string): string {
  return `${eventId}|${mediaId}`;
}

/**
 * Reads confirmations out of whatever slice of the review ledger a caller already has. Anything
 * that is not an approved `media_binding` row naming exactly two non-empty halves is ignored —
 * a malformed target_id must not become a wildcard.
 */
export function storyPhotoConfirmationsFrom(
  reviews: ReadonlyArray<{ targetKind?: string | null; targetId?: string | null; decision?: unknown }>,
): StoryPhotoConfirmations {
  const confirmed = new Set<string>();
  for (const review of reviews) {
    if (review.targetKind !== STORY_PHOTO_REVIEW_KIND) continue;
    if (review.decision !== "approved") continue;
    const parts = (review.targetId ?? "").split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    confirmed.add(storyPhotoKey(parts[0], parts[1]));
  }
  return confirmed;
}

export function isStoryAssociated(
  event: AssociationEvent,
  media: Pick<Media, "id" | "rawSourceId">,
  confirmations?: StoryPhotoConfirmations,
): boolean {
  if (media.rawSourceId && event.sourceIds.includes(media.rawSourceId)) return true;
  if (confirmations?.has(storyPhotoKey(event.id, media.id))) return true;
  const adopted = event.organizerRun?.mediaBinding?.adopted?.find((binding) => binding.mediaId === media.id);
  if (!adopted?.boundSourceId) return false;
  if (!mayNarrateAsDepicting(adopted.tier as MediaBindingTier)) return false;
  return event.sourceIds.includes(adopted.boundSourceId);
}

// Why a picture is shown beside a story, in the words the archive recorded at the time. Returns
// undefined for a picture that may not be shown at all, so a caller cannot print a reason for one.
export function storyAssociationBasis(
  event: AssociationEvent,
  media: Pick<Media, "id" | "rawSourceId">,
  confirmations?: StoryPhotoConfirmations,
): string | undefined {
  if (!isStoryAssociated(event, media, confirmations)) return undefined;
  if (media.rawSourceId && event.sourceIds.includes(media.rawSourceId)) return "the picture arrived in one of the messages this story was written from";
  if (confirmations?.has(storyPhotoKey(event.id, media.id))) return "a reviewer opened this picture and recorded that it belongs to this story";
  return event.organizerRun?.mediaBinding?.adopted?.find((binding) => binding.mediaId === media.id)?.basis;
}

// The subset of an event's attached media that may be presented as part of its story. Order is
// preserved so downstream hero/supporting selection keeps behaving the way it reads.
export function storyAssociatedMedia<T extends Pick<Media, "id" | "rawSourceId">>(
  event: AssociationEvent,
  media: T[],
  confirmations?: StoryPhotoConfirmations,
): T[] {
  return media.filter((item) => isStoryAssociated(event, item, confirmations));
}
