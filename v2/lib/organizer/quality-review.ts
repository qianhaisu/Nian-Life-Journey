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
 */
export function normalizeQualityDecision(value: unknown): QualityDecision {
  return isQualityDecision(value) ? value : "needs_human_review";
}

export type QualityReview = {
  id: string;
  profileId: string;
  targetKind: "life_event" | "daily_trace";
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

export function indexReviews(reviews: Array<Omit<QualityReview, "decision"> & { decision: unknown }>): ReviewIndex {
  const index: ReviewIndex = new Map();
  for (const review of reviews) index.set(`${review.targetKind}:${review.targetId}`, normalizeQualityDecision(review.decision));
  return index;
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

/**
 * Whether an event's media BINDING may be presented as part of its story. The legacy rule
 * organizer attached every same-day chat image to the event it created — production's
 * "好想站起来的这一天" carries a flight-booking screenshot bound that way, and its heroMediaId is a
 * 120x67 sticker. Sharing a calendar day is not evidence a picture belongs to a story, so
 * rule-bound media never reach a story layer, a memory lead, or a month cover; they remain intact
 * and reachable in the evidence disclosure. A human-authored event, or a future pipeline that
 * grades bindings (confirmed / strong_contextual), is trusted. Approving an event's TEXT through
 * the quality ledger says nothing about its pictures — the two decisions stay separate.
 */
// T18, 2026-09-04: T7's subject-gate pipeline is exactly the "future pipeline that grades
// bindings" this function's own comment anticipated. Its media_ids/heroMediaId are never a
// same-day blanket harvest — they come from lib/publication-moments.ts's pickDayPhotos, gated on
// MediaPrivilege (a Quark family-photo import, or the daycare group Teddy confirmed is entirely
// about him), the identical function the month page itself uses. Trusting this exact
// organizerVersion is trusting that specific, narrow binding — not AI authorship in general.
const TRUSTED_BINDING_ORGANIZER_VERSIONS: ReadonlySet<string> = new Set(["organizer-v2-t7-subject-gate"]);

export function mediaBindingTrusted(event: Pick<LifeEvent, "createdBy" | "organizerVersion" | "organizerRun">): boolean {
  if (event.organizerVersion && TRUSTED_BINDING_ORGANIZER_VERSIONS.has(event.organizerVersion)) return true;
  return !requiresQualityReview(event);
}

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
