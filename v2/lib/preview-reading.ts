// The private reading surface: a year of this archive read straight through, including the stories
// a reviewer has marked readable but nobody has published yet.
//
// WHY IT IS A SEPARATE LAYER AND NOT A LOOSER QUERY. The family's pages read published stories, and
// what "published" means is one thing in one place: an `approved` row in the review ledger for
// `life_event:<id>` (lib/organizer/quality-review.ts). Nothing here widens that. A draft reaches
// this surface only because a reviewer wrote a SECOND, differently-kinded row that says "this one
// may be read privately", and that row cannot publish anything — the publication gate never looks
// at it. So the boundary between draft and published is not a setting anyone can get wrong on a
// busy evening; the two states are two different ledger rows read by two different code paths, and
// a draft is labelled as a draft everywhere it is drawn.
//
// WHY THE GATE IGNORES `decision`. postgres-repository.ts's assembleStore() runs every review row
// through normalizeQualityDecision(), whose QualityDecision union does not include the markers this
// file looks for — by the time a row reaches `store.qualityReviews` an unrecognised decision has
// already been rewritten to "needs_human_review". A-6's trace tier was caught by exactly this
// (lib/family-archive.ts documents it), so this uses the same decision-column-safe key it does:
// target_kind + provider + prompt_version, three columns reviewFromRow() leaves alone.
import { thumbnailSized } from "@/lib/media/hero";
import { confirmedStoryPhotoIdsByEvent } from "@/lib/media/story-binding";
import { isGarbageLifeEvent, memoryTitle, toMediaRef, type MediaRef, type MonthChapter } from "@/lib/memory-chapters";
import { eventRendersCleanly } from "@/lib/organizer/quality-review";
import { calendarDayOf } from "@/lib/timeline-dates";
import { ageSpan, timeSignatureFor, type TimeSignature } from "@/lib/time-signature";
import type { LifeEvent, Media } from "@/lib/types";

/** Every life_event row's readable fields, whatever its review decision (getAllEventIdentities). */
export type EventIdentity = Pick<LifeEvent, "id" | "title" | "story" | "occurredAt">;

// The markers the 数据 track writes. Kept together so the handoff is one thing to read.
export const PREVIEW_EVENT_KIND = "life_event_preview";
export const MONTHLY_REVIEW_DRAFT_KIND = "monthly_review_draft";
export const PREVIEW_PROVIDER = "nianlife-preview";
export const PREVIEW_EVENT_PROMPT_VERSION = "preview-read-v1";
export const MONTHLY_REVIEW_DRAFT_PROMPT_VERSION = "monthly-review-draft-v1";

type ReviewRow = {
  // id and reviewedAt are read only to tell two decisions about the same target apart: the ledger
  // keeps every one, and the latest is the one that counts (lib/media/story-binding.ts).
  id?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
  provider?: string | null;
  promptVersion?: string | null;
  reasonCodes?: string[] | null;
  decision?: unknown;
  reviewedAt?: string | null;
};

function marks(review: ReviewRow, kind: string, promptVersion: string): boolean {
  return review.targetKind === kind && review.provider === PREVIEW_PROVIDER && review.promptVersion === promptVersion;
}

/** The stories a reviewer marked readable in private. Empty set = the preview shows published only. */
export function previewEventIdsFrom(reviews: ReadonlyArray<ReviewRow>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const review of reviews) {
    if (!marks(review, PREVIEW_EVENT_KIND, PREVIEW_EVENT_PROMPT_VERSION)) continue;
    if (review.targetId) ids.add(review.targetId);
  }
  return ids;
}

/**
 * The private month-review drafts, by month. The review itself lives in the marker row's
 * `reason_codes`, one line per element, deliberately NOT in monthly_snapshots: that table holds one
 * row per (profile, month), so writing a draft there would overwrite the month's real review —
 * the one thing 「不覆盖正式回顾」 rules out. Nothing on the family's pages reads this.
 */
export function monthlyReviewDraftsFrom(reviews: ReadonlyArray<ReviewRow>): Map<string, string[]> {
  const drafts = new Map<string, string[]>();
  for (const review of reviews) {
    if (!marks(review, MONTHLY_REVIEW_DRAFT_KIND, MONTHLY_REVIEW_DRAFT_PROMPT_VERSION)) continue;
    const month = review.targetId ?? "";
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const lines = (review.reasonCodes ?? []).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    drafts.set(month, lines);
  }
  return drafts;
}

/**
 * Which photographs a reviewer opened and recorded as belonging to which story (Basis C,
 * lib/media/story-binding.ts) — the one association a draft can have, since a draft's own
 * media_ids and source_ids are not part of what the identity read returns.
 */
export function confirmedPhotoIdsByEvent(reviews: ReadonlyArray<ReviewRow>): Map<string, string[]> {
  // Shares the published surface's reader rather than repeating the filter, so the private page and
  // the family's pages can never disagree about which pictures a story is allowed to carry. They
  // did on 2026-09-12: three drafts had a picture retracted and this page kept drawing two of them.
  return confirmedStoryPhotoIdsByEvent(reviews);
}

export type PreviewStory = {
  id: string;
  day: string;
  signature: TimeSignature;
  title: string;
  // The story as the archive stored it, paragraph by paragraph. Never truncated here: this surface
  // exists to be read through, so an excerpt would defeat it.
  paragraphs: string[];
  // A story that is not on the family's pages. Drawn as a draft wherever it appears.
  draft: boolean;
  photo?: MediaRef;
};

export type PreviewMonth = {
  month: string;
  label: string;
  ageLabel?: string;
  stories: PreviewStory[];
  // The private month review, when one has been written for this month. A month without one keeps
  // its heading and its stories and says nothing else — 材料不足时不伪装成回顾 (原则七).
  review?: string[];
  // 原则七 asks a month review for 「4–8 张有意义的媒体」, and the only pictures that qualify as
  // meaningful here are the ones somebody recorded a reason for: part of a story's own material, or
  // opened and recorded as being of him. A month with none of those gets a text-only review rather
  // than a strip of pictures chosen because they happened to fall in the right month.
  reviewPhotos: MediaRef[];
};

export const REVIEW_PHOTOS_MAX = 6;

export type PreviewYear = {
  year: string;
  ageSpan?: string;
  // Ascending: a year read the way it was lived, January first. Every month the archive holds is
  // here even when it has nothing readable yet — that empty heading is the quiet index.
  months: PreviewMonth[];
  readable: boolean;
};

export type PreviewYearInput = {
  year: string;
  // The year's months as the archive knows them (lib/memory-chapters.ts), any order.
  months: MonthChapter[];
  identities: EventIdentity[];
  publishedIds: ReadonlySet<string>;
  previewIds: ReadonlySet<string>;
  reviewDrafts: Map<string, string[]>;
  photosByEvent: Map<string, string[]>;
  // Deliverable, family-visible media only (lib/family-archive.ts's `media`).
  media: Media[];
  // A published story's own lead photograph, already decided by the family-facing layer.
  leadById: Map<string, MediaRef>;
  // The pictures something recorded a reason for: `confirmed` (a story's own material) ∪ `checked`
  // (opened and recorded as being of him). Only these may illustrate a month review.
  vouchedPhotoIds?: ReadonlySet<string>;
  birthDay?: string;
};

export function buildPreviewYear({ year, months, identities, publishedIds, previewIds, reviewDrafts, photosByEvent, media, leadById, vouchedPhotoIds, birthDay }: PreviewYearInput): PreviewYear {
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const byMonth = new Map<string, PreviewStory[]>();

  for (const event of identities) {
    const published = publishedIds.has(event.id);
    if (!published && !previewIds.has(event.id)) continue;
    const day = calendarDayOf(event.occurredAt);
    if (!day || day.slice(0, 4) !== year) continue;
    // The same two text gates the family's pages apply. A draft is unpublished, not exempt: a row
    // whose story is a "[media]" placeholder is not reading material for anybody.
    if (isGarbageLifeEvent(event)) continue;
    if (!eventRendersCleanly(event as LifeEvent)) continue;
    const signature = timeSignatureFor(event.occurredAt, birthDay);
    if (!signature) continue;
    const paragraphs = (event.story ?? "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const photo = published
      ? leadById.get(event.id)
      : (photosByEvent.get(event.id) ?? [])
        .map((id) => mediaById.get(id))
        .filter((item): item is Media => Boolean(item) && item!.type === "photo" && thumbnailSized(item!))
        .map((item) => toMediaRef(item, memoryTitle(event)))[0];
    const month = day.slice(0, 7);
    const story: PreviewStory = { id: event.id, day, signature, title: memoryTitle(event), paragraphs, draft: !published, photo };
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(story);
    else byMonth.set(month, [story]);
  }

  for (const stories of byMonth.values()) {
    stories.sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  }

  // Illustration for a review, built only from pictures with a recorded reason and only for the
  // months that actually have a review. Taken in that month, drawable, ordered as the month ran.
  const reviewPhotosOf = (month: string): MediaRef[] => {
    if (!reviewDrafts.has(month) || !vouchedPhotoIds?.size) return [];
    return media
      .filter((item) => item.type === "photo" && vouchedPhotoIds.has(item.id) && thumbnailSized(item) && calendarDayOf(item.takenAt)?.slice(0, 7) === month)
      .sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? "") || a.id.localeCompare(b.id))
      .slice(0, REVIEW_PHOTOS_MAX)
      .map((item) => toMediaRef(item, `${year} 年 ${Number(month.slice(5, 7))} 月`));
  };

  const monthKeys = [...new Set([...months.map((item) => item.month), ...byMonth.keys(), ...reviewDrafts.keys()])]
    .filter((month) => month.slice(0, 4) === year)
    .sort();
  const labelled = new Map(months.map((item) => [item.month, item]));
  const previewMonths: PreviewMonth[] = monthKeys.map((month) => ({
    month,
    label: labelled.get(month)?.label ?? `${year} 年 ${Number(month.slice(5, 7))} 月`,
    ageLabel: labelled.get(month)?.ageLabel,
    stories: byMonth.get(month) ?? [],
    review: reviewDrafts.get(month),
    reviewPhotos: reviewPhotosOf(month),
  }));

  return {
    year,
    ageSpan: ageSpan(birthDay, monthKeys),
    months: previewMonths,
    readable: previewMonths.some((month) => month.stories.length > 0 || Boolean(month.review)),
  };
}
