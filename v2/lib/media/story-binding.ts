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

// A SECOND, NARROWER RECORD: "somebody opened this photograph and recorded that it is a photograph
// of this child" — no story attached.
//
// Basis A/B/C above all answer "does this picture belong to these words". Most of the archive's
// photography belongs to no words at all: a day that was photographed and never written about. For
// those, the only claim anything in this archive can currently make is the source — the family's own
// album — and a source says who took a picture, never who is in it. That is how a white cat on a
// bench came to open 2025-11's 「这个月的日子」 as a page-width picture (lib/publication-moments.ts,
// openChronicle).
//
// So this is the same shape as Basis C and nothing more: a row in `content_quality_reviews` with
// target_kind = "media_subject_check", target_id = "<mediaId>", decision = "approved", written after
// somebody actually opened the file. It is NOT a detector, NOT a face match, and NOT a claim about
// any picture without a row — an unmarked photograph is unproven, not rejected, and keeps every
// place it already has. The one thing a marked picture earns is the right to open a section.
export const PHOTO_SUBJECT_REVIEW_KIND = "media_subject_check";

/**
 * The photographs somebody opened and recorded as being of this child. Reads the same slice of the
 * review ledger the pages already load, and ignores anything that is not a row of that exact kind
 * naming exactly one media id.
 *
 * THE LATEST DECISION WINS, and 2026-09-13 is when that started being true. This function used to
 * be `for (…) if (approved) checked.add(id)` — every approved row counted forever, so a later
 * `rejected` for the same picture could not take it back, while `storyPhotoConfirmationsFrom()` two
 * screens down had always taken the latest. Two readers of one ledger disagreeing about what a
 * withdrawal means is the same class of fault as the publication gate's (commit c8de1ea), and this
 * side of it mattered more from the moment this set began deciding what is shown by default rather
 * than only what may open a section.
 *
 * It changes nothing today: production holds 2 approved rows of this kind and no rejections
 * (exposure-evidence.json, 601 photographs). It decides whether a withdrawal written tomorrow is
 * honoured.
 */
export function checkedPhotoIdsFrom(
  reviews: ReadonlyArray<{ id?: string | null; targetKind?: string | null; targetId?: string | null; decision?: unknown; reviewedAt?: string | null }>,
): ReadonlySet<string> {
  const latest = new Map<string, { decision: unknown; rank: string }>();
  for (const review of reviews) {
    if (review.targetKind !== PHOTO_SUBJECT_REVIEW_KIND) continue;
    const id = (review.targetId ?? "").trim();
    // A subject check names one picture. A `|` means it is a (story, photograph) pair — a
    // media_binding row filed under the wrong kind — and it is not evidence about the picture.
    if (!id || id.includes("|")) continue;
    const rank = `${review.reviewedAt ?? ""}|${review.id ?? ""}`;
    const held = latest.get(id);
    if (!held || rank > held.rank) latest.set(id, { decision: review.decision, rank });
  }
  const checked = new Set<string>();
  for (const [id, held] of latest) if (held.decision === "approved") checked.add(id);
  return checked;
}

/**
 * May this picture be drawn as part of THIS story — as its illustration or its hero?
 *
 * Deliberately narrower than `isStoryAssociated()`, and the difference is the whole point. That
 * function answers "is there a recorded relation between these words and this picture", and its
 * Basis A says yes whenever the file arrived in one of the messages the story was written from —
 * true, useful, and produced by nobody looking at anything. Basis B is the Organizer's own adoption
 * of a binding, which is likewise not a person.
 *
 * The question a display gate has to answer is different: did a PERSON decide this picture belongs
 * beside these words. Only Basis C is that, so only Basis C is accepted here (总指挥 2026-09-13:
 * 「Basis A 和 confirmed 集合不能独立充当人工审核证明」).
 *
 * `storyPhotoConfirmationsFrom()` already resolves withdrawals by taking each pair's latest
 * decision, so a binding taken back stops being displayable here without anything else changing.
 *
 * What this is NOT: a claim about the content of the picture. A binding says "these two belong
 * together", not "this is a photograph of this child" — that is `media_subject_check`, read by
 * `checkedPhotoIdsFrom()`. Neither stands in for the other, which is why the two are separate
 * functions rather than one merged privilege.
 */
export function isReviewedForStoryDisplay(
  event: Pick<LifeEvent, "id">,
  media: Pick<Media, "id">,
  confirmations?: StoryPhotoConfirmations,
): boolean {
  return Boolean(confirmations?.has(storyPhotoKey(event.id, media.id)));
}

/** One confirmation, addressed to exactly one (story, photograph) pair. */
export type StoryPhotoConfirmations = ReadonlySet<string>;

export function storyPhotoKey(eventId: string, mediaId: string): string {
  return `${eventId}|${mediaId}`;
}

/** The shape of a review row these helpers need. Callers pass whole rows; nothing else is read. */
export type StoryPhotoReviewRow = {
  id?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
  decision?: unknown;
  reviewedAt?: string | null;
};

/**
 * The LAST decision recorded for each (story, photograph) pair, keyed by target_id.
 *
 * Why the latest rather than every row: a `media_binding` decision used to be one-way. Both readers
 * below OR-ed the approved rows together, so once a row said approved nothing could take it back —
 * a later rejected row simply did not count. On 2026-09-12 the mismatch surfaced: three drafts had
 * their pictures taken out of media_ids and a rejected row written for each, and the private preview
 * page went on drawing two of them beside the stories, because it was still reading the superseded
 * approved rows.
 *
 * Corrected 2026-09-13: this comment used to claim the publication gate already read the ledger this
 * way, via `distinct on (target_id) … order by reviewed_at desc`. It did not. That SQL exists only
 * in one-off scripts (scripts/a7-export-approved-2025.mjs and friends); the gate itself was a bare
 * last-row-wins loop over an unordered whole-table read, which is a different thing and was the
 * weaker of the two readers, not the model for this one. It now genuinely does take the latest —
 * see indexReviewsWithConflicts() in lib/organizer/quality-review.ts, which also declines to break a
 * same-timestamp tie in favour of publishing. The two readers agree on recency; they differ on ties,
 * because only one of them can put a picture in front of the family by guessing wrong.
 *
 * Nothing is rewritten or deleted to make this work — every decision stays in the ledger, which is
 * the point of a ledger, and this picks the one that is current. A malformed target_id is dropped
 * rather than treated as a wildcard. `reviewedAt` ties break on `id` so the answer is stable.
 */
function latestStoryPhotoDecisions(reviews: ReadonlyArray<StoryPhotoReviewRow>): Map<string, StoryPhotoReviewRow> {
  const latest = new Map<string, StoryPhotoReviewRow>();
  for (const review of reviews) {
    if (review.targetKind !== STORY_PHOTO_REVIEW_KIND) continue;
    const parts = (review.targetId ?? "").split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    const key = storyPhotoKey(parts[0], parts[1]);
    const held = latest.get(key);
    if (!held) { latest.set(key, review); continue; }
    const a = `${review.reviewedAt ?? ""}|${review.id ?? ""}`;
    const b = `${held.reviewedAt ?? ""}|${held.id ?? ""}`;
    if (a > b) latest.set(key, review);
  }
  return latest;
}

/**
 * Reads confirmations out of whatever slice of the review ledger a caller already has. A pair is
 * confirmed when its most recent `media_binding` row says approved — see
 * latestStoryPhotoDecisions for why recency is what decides it.
 */
export function storyPhotoConfirmationsFrom(
  reviews: ReadonlyArray<StoryPhotoReviewRow>,
): StoryPhotoConfirmations {
  const confirmed = new Set<string>();
  for (const [key, review] of latestStoryPhotoDecisions(reviews)) {
    if (review.decision === "approved") confirmed.add(key);
  }
  return confirmed;
}

/**
 * The same answer grouped by story, for callers that need the picture ids rather than a membership
 * test. Order follows the order the rows arrived in, so a story with two confirmed pictures keeps
 * drawing them in the order the ledger recorded them.
 */
export function confirmedStoryPhotoIdsByEvent(
  reviews: ReadonlyArray<StoryPhotoReviewRow>,
): Map<string, string[]> {
  const confirmed = storyPhotoConfirmationsFrom(reviews);
  const byEvent = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const review of reviews) {
    if (review.targetKind !== STORY_PHOTO_REVIEW_KIND) continue;
    const parts = (review.targetId ?? "").split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    const key = storyPhotoKey(parts[0], parts[1]);
    if (!confirmed.has(key) || seen.has(key)) continue;
    seen.add(key);
    const existing = byEvent.get(parts[0]);
    if (existing) existing.push(parts[1]);
    else byEvent.set(parts[0], [parts[1]]);
  }
  return byEvent;
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

/**
 * The subset that may actually be DRAWN beside this story — reviewed bindings only.
 *
 * Kept separate from `storyAssociatedMedia()` on purpose. That one answers the archive's question
 * ("is there a recorded relation"), which Basis A can satisfy by arrival position alone; this one
 * answers the page's ("did a person put this picture beside these words"), which only Basis C can.
 * Two questions, two functions, so a future caller cannot reach for the loose one by accident and
 * put an unreviewed picture in front of the family.
 *
 * 总指挥 2026-09-13: 「Basis A 和 confirmed 集合不能独立充当人工审核证明」.
 */
export function storyDisplayMedia<T extends Pick<Media, "id" | "rawSourceId">>(
  event: AssociationEvent,
  media: T[],
  confirmations?: StoryPhotoConfirmations,
): T[] {
  return media.filter((item) => isReviewedForStoryDisplay(event, item, confirmations));
}
