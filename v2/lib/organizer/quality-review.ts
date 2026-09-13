// Publication gate for organizer-derived content.
//
// The rule-based organizer produced LifeEvents titled with raw group-chat text ("我今天和周三换了
// 今天去公司"), and DailyTraces whose only entry was a media placeholder or an import label. Those
// are not memories about the child, so rule-derived artifacts are FAIL CLOSED: they are published
// only when the quality ledger holds an "approved" review for them.
//
// This deliberately does not touch `visibility`. Visibility is the family's own sharing choice;
// conflating it with "did this pass quality review" would destroy that signal and make the decision
// impossible to roll back. Publication = visibility AND review.
import type { DailyTrace, LifeEvent } from "@/lib/types";

export const QUALITY_REVIEW_POLICY_VERSION = "quality-review-v1";

export type QualityDecision = "approved" | "downgrade_to_daily_trace" | "store_only" | "rejected_unrelated" | "needs_human_review";

export const QUALITY_DECISIONS: readonly QualityDecision[] = ["approved", "downgrade_to_daily_trace", "store_only", "rejected_unrelated", "needs_human_review"];

export function isQualityDecision(value: unknown): value is QualityDecision {
  return typeof value === "string" && (QUALITY_DECISIONS as readonly string[]).includes(value);
}

/**
 * The ONE typed representation of a ledger decision. `decision` is a text column, so a row can hold
 * a string this union does not name — the V2 adapter wrote "needs_review" for the RC-12 canary
 * before the union and the writer were aligned, and a future tool could write anything at all.
 *
 * Unknown text becomes `needs_human_review`, never `approved`: an unrecognised decision must keep
 * the artifact hidden and ask for a human, which is the same direction every other rule in this file
 * fails. Nothing here rewrites the stored row — the mapping is a read-time interpretation, so an
 * existing ledger row stays exactly as it was written and stays auditable.
 *
 * A-10 (2026-09-06): call this ONLY at the point that actually computes a fail-closed publication
 * decision (indexReviews(), isEventPublishable(), isTracePublishable()) — never at generic
 * read/hydration time (e.g. a repository mapping every row to its typed shape). Doing the latter
 * silently rewrites a real stored value (A-6's `decision='trace_eligible'` rows, for one) into
 * `needs_human_review` before any caller ever sees it, which is indistinguishable from an actual
 * human review outcome that never happened. A generic reader that needs `QualityReview.decision`
 * should get the raw stored string back, not a fail-closed guess.
 */
export function normalizeQualityDecision(value: unknown): QualityDecision {
  return isQualityDecision(value) ? value : "needs_human_review";
}

export type QualityReview = {
  id: string;
  profileId: string;
  // T20-B, 2026-09-04: "monthly_snapshot" records the review decision for a generated month
  // review ("这个月的张年") — the same ledger, not a second one. Publication itself still gates
  // on isSnapshotPublishable (an approved life_event must exist for the month); this row is the
  // audit trail Cowork's spec asked for, not yet a second hard gate.
  targetKind: "life_event" | "daily_trace" | "monthly_snapshot";
  targetId: string;
  decision: QualityDecision;
  gateA?: string;
  subjectRelevance?: string;
  worthinessScore?: number;
  reasonCodes: string[];
  provider: string;
  model?: string;
  promptVersion: string;
  policyVersion: string;
  reviewFingerprint: string;
  reviewedAt: string;
};

// Only "approved" publishes. Everything else — including needs_human_review — stays hidden until a
// human says otherwise, because the failure this gate exists to stop is publishing too much.
export function decisionPublishes(decision: QualityDecision | undefined): boolean {
  return decision === "approved";
}

// Which artifacts the gate applies to. Rule-derived output must be reviewed; anything a human
// created, or a future reviewed AI path, is not caught by this net.
export function requiresQualityReview(artifact: { createdBy?: string; organizerVersion?: string; organizerRun?: { organizerType?: string } | null }): boolean {
  if (artifact.createdBy === "rule") return true;
  if (artifact.organizerVersion?.startsWith("rule")) return true;
  if (artifact.organizerRun?.organizerType === "rule") return true;
  // AI-authored artifacts fail CLOSED.
  //
  // This used to return false for them, on the reasoning that a canary would always write its own
  // ledger row. That held only while no AI artifact could exist — every one of production's 82
  // LifeEvents and 154 DailyTraces is rule-derived. The V2 production adapter changes that, and the
  // old rule would have meant a generated Memory whose review row failed to write is published to
  // the family immediately, with nothing showing it was never read by a human.
  //
  // So a missing row no longer means "publish". For AI content the explicit ledger decision is the
  // only thing that can publish it, which is what "explicit ledger decision is authoritative for AI
  // publication" has to mean if it means anything. Affects zero existing rows.
  if (artifact.createdBy === "ai") return true;
  return artifact.organizerRun?.organizerType === "ai";
}

export type ReviewIndex = Map<string, QualityDecision>;

/** One (targetKind, targetId) whose most recent decision is not single-valued. */
export type ReviewConflict = {
  /** `${targetKind}:${targetId}` — the same key the index uses. */
  key: string;
  /** The tied recency the conflicting rows share, verbatim; "" when none of them recorded one. */
  reviewedAt: string;
  /** The distinct decisions tied at that recency, normalized and sorted. Always 2 or more. */
  decisions: QualityDecision[];
  /** What the index holds instead. Always `needs_human_review` — a conflict never publishes. */
  resolved: QualityDecision;
};

export type IndexedReviews = { index: ReviewIndex; conflicts: ReviewConflict[] };

type IndexableReview = Omit<QualityReview, "decision"> & { decision: unknown };

// Recency as a comparable number. `reviewed_at` is a `timestamp({ mode: "string" })` column, so it
// arrives as text ("2026-09-05 16:49:54.123"); every row in a given read comes from the same column
// in the same format, so parsing them all the same way orders them consistently.
//
// A row with no usable `reviewedAt` ranks BELOW every row that has one: a decision that recorded
// when it was made is the better authority on what is current than one that did not. Callers that
// pass bare `{ targetKind, targetId, decision }` (most tests, several audit scripts) therefore keep
// working unchanged — with one row per key the ranking never matters, and with several it is the
// timestamped one that wins.
function recencyOf(review: IndexableReview): number {
  const raw = (review as { reviewedAt?: unknown }).reviewedAt;
  if (typeof raw !== "string" || raw === "") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * The CURRENT decision for each (targetKind, targetId): the one with the most recent `reviewedAt`.
 *
 * Why this is not "the last row we happened to read". Until 2026-09-13 this function was a bare
 * `for (…) index.set(key, decision)` over the rows in the order they arrived, and every caller on a
 * render path feeds it `db.select().from(contentQualityReviews)` with no ORDER BY. The unique index
 * is (target_kind, target_id, prompt_version), so a single artifact may legitimately carry several
 * `life_event` rows, and which one won was whatever order Postgres returned that time — not stable
 * across query plans, and not necessarily the decision anyone made last. Production held exactly one
 * such artifact, event-v2-eccbfb1e9acff375d66a9f230e74c402: approved 2026-09-05, then store_only
 * 2026-09-11 by r11-downgrade-v1. The intent was plainly to take it back down; the old reader could
 * have published it on any given render. That is also the whole of the "212 approved rows / 211
 * approved artifacts" discrepancy.
 *
 * Ties are NOT broken arbitrarily. Two rows sharing the newest `reviewedAt` and disagreeing about
 * what to do cannot be resolved by picking one — an `id` or insertion-order tiebreak would be a coin
 * flip wearing a rule's clothes, and half its outcomes publish something nobody decided to publish.
 * A conflict therefore resolves to `needs_human_review`: it withholds, it asks for a person, and it
 * is the same direction every other rule in this file fails. The conflict is reported rather than
 * swallowed, so the ledger can be repaired instead of silently tolerated.
 *
 * Decisions are compared AFTER normalization, because normalization is what the publication answer
 * is computed from: two rows reading `trace_eligible` and `needs_human_review` both mean "not
 * published" here and are not a conflict worth reporting. Rows are never rewritten or dropped —
 * every decision stays in the ledger; this only chooses which one is current.
 *
 * `targetKind` stays part of the key, so a `daily_trace`, a `life_event_trace`, a `media_binding` or
 * a `life_event_queue169` row can never stand in for a `life_event` publication decision.
 */
export function indexReviewsWithConflicts(reviews: Array<IndexableReview>): IndexedReviews {
  const newest = new Map<string, { recency: number; reviewedAt: string; decisions: Set<QualityDecision> }>();
  for (const review of reviews) {
    const key = `${review.targetKind}:${review.targetId}`;
    const recency = recencyOf(review);
    const decision = normalizeQualityDecision(review.decision);
    const held = newest.get(key);
    if (!held || recency > held.recency) {
      const reviewedAt = typeof (review as { reviewedAt?: unknown }).reviewedAt === "string" ? (review as { reviewedAt: string }).reviewedAt : "";
      newest.set(key, { recency, reviewedAt, decisions: new Set([decision]) });
      continue;
    }
    if (recency === held.recency) held.decisions.add(decision);
    // Anything older than what we hold is superseded and contributes nothing.
  }

  const index: ReviewIndex = new Map();
  const conflicts: ReviewConflict[] = [];
  for (const [key, held] of newest) {
    if (held.decisions.size === 1) {
      index.set(key, [...held.decisions][0]);
      continue;
    }
    index.set(key, "needs_human_review");
    conflicts.push({ key, reviewedAt: held.reviewedAt, decisions: [...held.decisions].sort(), resolved: "needs_human_review" });
  }
  return { index, conflicts };
}

/**
 * The index alone, with any conflict reported to the server log rather than swallowed.
 *
 * Every publication read in the app funnels through here, so this is the one place that can notice a
 * contradictory ledger at all. Withholding the artifact is already handled above; staying silent
 * about WHY would leave a row nobody can find and nobody can fix. Each distinct conflict is logged
 * once per process, so a render path cannot turn a standing ledger problem into per-request noise.
 * Callers that want to act on conflicts rather than read about them use indexReviewsWithConflicts().
 */
export function indexReviews(reviews: Array<IndexableReview>): ReviewIndex {
  const { index, conflicts } = indexReviewsWithConflicts(reviews);
  if (conflicts.length > 0) reportReviewConflicts(conflicts);
  return index;
}

const reportedConflicts = new Set<string>();

export function reportReviewConflicts(conflicts: readonly ReviewConflict[]): void {
  for (const line of describeReviewConflicts(conflicts)) {
    if (reportedConflicts.has(line)) continue;
    reportedConflicts.add(line);
    console.warn(`quality-review: ${line}`);
  }
}

/** One line per conflicting artifact, for a log or a report. Empty array in, empty array out. */
export function describeReviewConflicts(conflicts: readonly ReviewConflict[]): string[] {
  return conflicts.map((c) => `${c.key} has ${c.decisions.length} conflicting decisions at the same reviewed_at (${c.reviewedAt || "no timestamp"}): ${c.decisions.join(", ")} — withheld as ${c.resolved}`);
}

// An explicit ledger decision binds whoever created the artifact. AI-derived content is not fail
// closed (there is no row until someone writes one), but once a row says needs_human_review or
// rejected, the page must not show the artifact — that is how an Organizer canary stays gated
// without pretending to be rule-derived. Only a missing row falls back to provenance.
export function isEventPublishable(event: LifeEvent, reviews: ReviewIndex): boolean {
  const decision = reviews.get(`life_event:${event.id}`);
  if (decision !== undefined) return decisionPublishes(decision);
  return !requiresQualityReview(event);
}

export function isTracePublishable(trace: DailyTrace, reviews: ReviewIndex): boolean {
  const decision = reviews.get(`daily_trace:${trace.id}`);
  if (decision !== undefined) return decisionPublishes(decision);
  return !requiresQualityReview(trace);
}

// Belt-and-braces text gate. Even an approved artifact must never render an import label, a markdown
// media path, a bare placeholder or a stringified undefined. If this fires on published content it
// means the writer stage regressed, and hiding is the right answer.
const TECHNICAL_TEXT = /\[(media|图片|视频|表情包|语音|文件|动画表情)\]|\]\(media\/|^\s*undefined\s*$|undefined\s*(cm|kg)|Quark 照片初始化|^\s*\d+\s*条聊天记录\s*$|https?:\/\//i;

export function containsTechnicalPlaceholder(text: string | undefined | null): boolean {
  if (!text) return false;
  return TECHNICAL_TEXT.test(text);
}

export function eventRendersCleanly(event: LifeEvent): boolean {
  return !containsTechnicalPlaceholder(event.title) && !containsTechnicalPlaceholder(event.story);
}

// Retired 2026-09-10: `mediaBindingTrusted(event)`.
//
// It answered "may this event's media_ids be presented as part of its story?" at the level of the
// whole event — trusted if a human wrote it, or if its organizerVersion was on a list. The list
// held exactly one entry, "organizer-v2-t7-subject-gate", justified by the claim that its bindings
// "are never a same-day blanket harvest" because they came from pickDayPhotos. pickDayPhotos chose
// by day, size, source trust and sort order, so the justification was the harvest describing
// itself in narrower words, and 523 of the archive's 524 bound stories inherited it.
//
// The question is not answerable per event anyway: two pictures attached to the same story can
// have entirely different claims on it. It is now asked per picture, in lib/media/story-binding.ts
// — is this photograph part of the material this story was written from? Callers that used to gate
// on this (the memory lead, the event detail page's story layer, and the `confirmed` half of
// MediaPrivilege) filter their candidates through that instead.

// A MonthlySnapshot is a written summary of a month. It may only be shown when that month actually
// has published memories behind it. The archive shipped with a seeded snapshot for 2026-08 whose
// highlights ("开始说车车", "走路更稳") are demo strings, and it was being used as the month
// container for memories that happened in 2025. Fail closed: no approved LifeEvent in the month,
// no summary. The row itself is kept for audit — this only decides display.
export function isSnapshotPublishable(snapshotMonth: string | undefined, approvedEventMonths: Iterable<string>): boolean {
  if (!snapshotMonth) return false;
  for (const month of approvedEventMonths) if (month === snapshotMonth) return true;
  return false;
}
