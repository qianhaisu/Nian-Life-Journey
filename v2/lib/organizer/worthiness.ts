// MemoryWorthiness scoring and routing (§7.3 / §4 of the task). Rule-computed dimensions are
// derived here from window/context data; model-scored dimensions come from the verdict. The score
// only decides routing — it is never surfaced as an objective measure of importance.
import type { EvidenceWindow } from "./evidence/types";
import type { DimensionScore, MemoryEditorVerdict, RuleDimension, ScoredDimension } from "./contract";

const WEIGHTS: Record<ScoredDimension | RuleDimension, number> = {
  milestone: 3.0, change: 2.5, uniqueness: 2.0, specificity: 2.0, futureRecall: 2.0,
  evidenceStrength: 1.5, relationship: 1.5, emotion: 1.0, everydayTexture: 1.0,
  redundancy: 0, uncertainty: 0,
};
const POSITIVE_MAX = 3 * (WEIGHTS.milestone + WEIGHTS.change + WEIGHTS.uniqueness + WEIGHTS.specificity + WEIGHTS.futureRecall + WEIGHTS.evidenceStrength + WEIGHTS.relationship + WEIGHTS.emotion + WEIGHTS.everydayTexture);

export type WorthinessInput = { window: EvidenceWindow; verdict: MemoryEditorVerdict; recentSameTypeCount: number; boundImageCount: number };

function ruleUniqueness(recentSameTypeCount: number): 0 | 1 | 2 | 3 { if (recentSameTypeCount === 0) return 2; if (recentSameTypeCount <= 3) return 1; return 0; }
function ruleSpecificity(window: EvidenceWindow): 0 | 1 | 2 | 3 {
  const text = window.items.map((item) => item.text).join("");
  const hasQuote = /[""「」]/.test(text);
  const hasNumberOrPlace = /\d/.test(text) || /公园|学校|医院|家里|教室/.test(text);
  const hasVerb = /[跑走踢爬跳追说吃穿画唱玩递给掰抱亲摸分享]/.test(text);
  if (hasQuote && (hasNumberOrPlace || hasVerb)) return 3;
  if (hasVerb || hasNumberOrPlace) return 2;
  if (text.trim().length > 0) return 1;
  return 0;
}
function ruleEvidenceStrength(window: EvidenceWindow, verdict: MemoryEditorVerdict): 0 | 1 | 2 | 3 {
  const tiers = window.items.map((item) => item.tier);
  const strong = tiers.some((tier) => tier === "authoritative_document" || tier === "firsthand_observation");
  const multi = new Set(window.items.map((item) => item.senderRole)).size > 1;
  if (strong && multi) return 3;
  if (strong) return 2;
  if (verdict.coreFacts.some((fact) => fact.assertionKind === "attributed_claim")) return 1;
  return 0;
}

export function computeRuleDimensions(input: WorthinessInput): Record<RuleDimension, 0 | 1 | 2 | 3> {
  const redundancy: 0 | 1 | 2 | 3 = input.recentSameTypeCount > 6 ? 3 : input.recentSameTypeCount > 2 ? 2 : input.recentSameTypeCount > 0 ? 1 : 0;
  const uMarks = [input.verdict.uncertainty.time, input.verdict.uncertainty.subject, input.verdict.uncertainty.semantics].filter((level) => level !== "low").length;
  const uncertainty: 0 | 1 | 2 | 3 = input.verdict.subjectRelevance === "ambiguous" ? 3 : (uMarks >= 3 ? 3 : uMarks === 2 ? 2 : uMarks === 1 ? 1 : 0);
  return { uniqueness: ruleUniqueness(input.recentSameTypeCount), specificity: ruleSpecificity(input.window), evidenceStrength: ruleEvidenceStrength(input.window, input.verdict), redundancy, uncertainty };
}

export type WorthinessResult = { score: number; dimensions: Partial<Record<ScoredDimension, DimensionScore>> & Record<RuleDimension, 0 | 1 | 2 | 3>; sensitivityGate: boolean };

export function computeWorthiness(input: WorthinessInput): WorthinessResult {
  const rule = computeRuleDimensions(input);
  const scoredKeys: ScoredDimension[] = ["milestone", "change", "futureRecall", "relationship", "emotion", "everydayTexture"];
  let weighted = 0;
  for (const key of scoredKeys) weighted += (input.verdict.worthinessDimensions[key]?.score ?? 0) * WEIGHTS[key];
  weighted += rule.uniqueness * WEIGHTS.uniqueness + rule.specificity * WEIGHTS.specificity + rule.evidenceStrength * WEIGHTS.evidenceStrength;
  const base = Math.round((100 * weighted) / POSITIVE_MAX);
  const score = Math.max(0, Math.min(100, base - 4 * rule.redundancy - 5 * rule.uncertainty));
  const sensitivityGate = input.verdict.sensitivityFlags.length > 0;
  return { score, dimensions: { ...input.verdict.worthinessDimensions, ...rule }, sensitivityGate };
}

export type RouteDecision = { action: "store_only" | "daily_trace" | "life_event_candidate"; reviewRequirement: "auto_accept" | "needs_review" | "n/a"; toGlimmerPool: boolean };

// Default thresholds (§4.2). Hard-rule overrides (H1–H9) are applied by the Validator before this
// runs, so route() only sees an already-safe candidate.
export function route(worthiness: WorthinessResult, verdict: MemoryEditorVerdict): RouteDecision {
  const { score } = worthiness;
  const forceReview = worthiness.sensitivityGate
    || (verdict.temporalStatus === "uncertain" && score >= 65)
    || verdict.subjectRelevance === "ambiguous"
    || (verdict.worthinessDimensions.milestone?.score ?? 0) >= 2;
  if (score < 20) return { action: "store_only", reviewRequirement: "n/a", toGlimmerPool: false };
  if (score < 45) return { action: "daily_trace", reviewRequirement: "n/a", toGlimmerPool: false };
  if (score < 65) return { action: "daily_trace", reviewRequirement: "n/a", toGlimmerPool: true };
  if (score < 80 || forceReview) return { action: "life_event_candidate", reviewRequirement: "needs_review", toGlimmerPool: false };
  const strongEnough = worthiness.dimensions.evidenceStrength >= 2 && worthiness.dimensions.uncertainty <= 1;
  return { action: "life_event_candidate", reviewRequirement: strongEnough ? "auto_accept" : "needs_review", toGlimmerPool: false };
}
