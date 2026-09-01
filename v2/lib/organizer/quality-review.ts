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
  return artifact.organizerRun?.organizerType === "rule";
}

export type ReviewIndex = Map<string, QualityDecision>;

export function indexReviews(reviews: QualityReview[]): ReviewIndex {
  const index: ReviewIndex = new Map();
  for (const review of reviews) index.set(`${review.targetKind}:${review.targetId}`, review.decision);
  return index;
}

export function isEventPublishable(event: LifeEvent, reviews: ReviewIndex): boolean {
  if (!requiresQualityReview(event)) return true;
  return decisionPublishes(reviews.get(`life_event:${event.id}`));
}

export function isTracePublishable(trace: DailyTrace, reviews: ReviewIndex): boolean {
  if (!requiresQualityReview(trace)) return true;
  return decisionPublishes(reviews.get(`daily_trace:${trace.id}`));
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
