// Worthiness scoring and routing v4.
//
// v3 rescued the crawling day with `newCapabilityOrIndependence >= 2` and, with the same mechanism
// at the same threshold, promoted the tomato-noodles meal. That is not a threshold that was set too
// low — "the child did something" and "the child can now do something" are different claims, and no
// number on one axis separates them. So capability becomes CATEGORICAL:
//
//   developmental_ability   — a meaningful ability (crawls unaided, pulls to stand, self-feeds)
//   meaningful_independence — doing something himself that previously needed an adult
//   ordinary_action         — he did a thing (ate noodles, went downstairs, played)
//
// Only the first two are capability at all. An ordinary_action contributes nothing to the capability
// signal and nothing to the score through that dimension, at any score the model assigns it. An
// ordinary day can still be kept — through distinctiveness, relationship or a real transition — it
// just cannot be kept for being ordinary.
import type { DimensionScore } from "./contract";
import { effectiveTransitionScore, type DevelopmentalTransition, type EvidenceAxis } from "./worthiness-v2";
import type { SubjectResolution } from "./subject-resolver";

export const WORTHINESS_V4_VERSION = "worthiness-v4";

export type CapabilityKind = "developmental_ability" | "meaningful_independence" | "ordinary_action" | "none";

export type CapabilityDimension = DimensionScore & { kind: CapabilityKind };

const QUALIFYING_CAPABILITY: readonly CapabilityKind[] = ["developmental_ability", "meaningful_independence"];

export function isQualifyingCapability(kind: CapabilityKind): boolean {
  return QUALIFYING_CAPABILITY.includes(kind);
}

/** An ordinary action scores zero as capability however highly the model rated the doing of it. */
export function effectiveCapabilityScore(capability: CapabilityDimension): number {
  return isQualifyingCapability(capability.kind) ? capability.score : 0;
}

export type WorthinessAxisV4 = {
  developmentalTransition: DevelopmentalTransition;
  newCapabilityOrIndependence: CapabilityDimension;
  distinctiveFamilyMoment: DimensionScore;
  relationshipSignificance: DimensionScore;
  futureRecallValue: DimensionScore;
  noDistinctiveMemorySignal: boolean;
};

const WEIGHTS = {
  developmentalTransition: 3.0,
  newCapabilityOrIndependence: 2.5,
  distinctiveFamilyMoment: 2.0,
  futureRecallValue: 2.0,
  relationshipSignificance: 1.5,
} as const;
const POSITIVE_MAX = 3 * Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);

export function computeWorthinessV4(axis: WorthinessAxisV4): { score: number; effectiveTransition: number; effectiveCapability: number } {
  const effectiveTransition = effectiveTransitionScore(axis.developmentalTransition);
  const effectiveCapability = effectiveCapabilityScore(axis.newCapabilityOrIndependence);
  const weighted =
    effectiveTransition * WEIGHTS.developmentalTransition +
    effectiveCapability * WEIGHTS.newCapabilityOrIndependence +
    axis.distinctiveFamilyMoment.score * WEIGHTS.distinctiveFamilyMoment +
    axis.futureRecallValue.score * WEIGHTS.futureRecallValue +
    axis.relationshipSignificance.score * WEIGHTS.relationshipSignificance;
  return { score: Math.max(0, Math.min(100, Math.round((100 * weighted) / POSITIVE_MAX))), effectiveTransition, effectiveCapability };
}

export type RoutingInputV4 = {
  worthiness: WorthinessAxisV4;
  evidence: EvidenceAxis;
  subjectRelevance: string;
  subjectResolution: SubjectResolution["level"];
  temporalStatus: string;
  /**
   * Facts that may drive a MEMORY PROMOTION. Under v6 this is the claim-grounded count: a claim
   * only counts once its evidence is a supported assertion about a resolved subject.
   */
  rawFactCount: number;
  /**
   * Evidence that may keep this window as a DailyTrace, independent of whether anything in it is
   * promotable. Optional, and OMITTED by v4/v5 — when it is undefined the routing below behaves
   * exactly as it always has, which is what keeps frozen v5 frozen.
   *
   * Why it exists: `rawFactCount` was doing two unrelated jobs. Claim Grounding correctly zeroes it
   * for a window whose only "fact" came from a question, and because `no_unhedged_fact` is one of
   * the gates whose failure returns store_only, a real ordinary day was being thrown away as well
   * as being refused a Memory. Evidence confidence and Memory worthiness are orthogonal (and so are
   * "nothing here is promotable" and "nothing here happened"): a day the family spent wondering
   * whether he could stand yet is not a Memory, but it IS a true trace of that day.
   */
  traceEvidenceCount?: number;
};

export type RoutingDecisionV4 = {
  action: "life_event_candidate" | "daily_trace" | "store_only";
  reviewRequirement: "needs_review" | "n/a";
  strongSignals: string[];
  mediumSignals: string[];
  blockedBy: string[];
  /** Set when a promotion-only gate failed but the window was still kept as a trace. */
  retainedDespitePromotionGate?: boolean;
};

/**
 * The gates that decide only whether something may become a MEMORY. Every other gate is also a
 * retention gate, and deliberately so:
 *
 *   subject_unresolved / subject_not_primary  the window may not be about 张年 at all — writing it
 *                                             into his archive as a trace is the other-child
 *                                             leakage this whole layer exists to prevent
 *   not_observed                              a plan is not a record of a day that happened
 *   low_evidence_confidence                   the evidence itself is not trustworthy enough to
 *                                             assert anything, including "this happened today"
 *
 * `no_unhedged_fact` is the only one that is purely about promotion material. It says nothing about
 * whether the day was real or whose it was.
 */
const PROMOTION_ONLY_GATES: ReadonlySet<string> = new Set(["no_unhedged_fact"]);

function gateFailures(input: RoutingInputV4): string[] {
  const failures: string[] = [];
  // Gate A now consults the bounded resolver: an explicit or contextually-resolved subject passes,
  // an unresolved one never does, whatever the model claimed.
  if (input.subjectResolution === "unresolved") failures.push("subject_unresolved");
  if (input.subjectRelevance !== "primary") failures.push("subject_not_primary");
  if (input.evidence.evidenceConfidence === "low") failures.push("low_evidence_confidence");
  if (input.rawFactCount < 1) failures.push("no_unhedged_fact");
  if (input.temporalStatus !== "past" && input.temporalStatus !== "present") failures.push("not_observed");
  return failures;
}

export function routeV4(input: RoutingInputV4): RoutingDecisionV4 {
  const blockedBy = gateFailures(input);
  const axis = input.worthiness;
  const transition = effectiveTransitionScore(axis.developmentalTransition);
  const capability = effectiveCapabilityScore(axis.newCapabilityOrIndependence);

  const strongSignals: string[] = [];
  if (transition >= 2) strongSignals.push("developmental_transition");
  if (capability >= 2) strongSignals.push(`capability:${axis.newCapabilityOrIndependence.kind}`);
  if (axis.distinctiveFamilyMoment.score >= 3) strongSignals.push("highly_distinctive_moment");

  const mediumSignals: string[] = [];
  if (axis.distinctiveFamilyMoment.score === 2) mediumSignals.push("distinctive_moment");
  if (axis.relationshipSignificance.score >= 2) mediumSignals.push("relationship");
  if (axis.futureRecallValue.score >= 2) mediumSignals.push("future_recall");
  if (transition === 1) mediumSignals.push("possible_transition");
  if (capability === 1) mediumSignals.push("partial_capability");

  if (blockedBy.length) {
    // Retention is decided separately from promotion, but ONLY when the caller supplied the trace
    // evidence count. v4/v5 never do, so their behaviour here is unchanged.
    const retentionBlockers = blockedBy.filter((gate) => !PROMOTION_ONLY_GATES.has(gate));
    const mayRetain = input.traceEvidenceCount !== undefined && retentionBlockers.length === 0 && input.traceEvidenceCount >= 1;
    if (!mayRetain) return { action: "store_only", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
    return { action: "daily_trace", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy, retainedDespitePromotionGate: true };
  }
  if (strongSignals.length >= 1) return { action: "life_event_candidate", reviewRequirement: "needs_review", strongSignals, mediumSignals, blockedBy };
  if (mediumSignals.length >= 2) return { action: "life_event_candidate", reviewRequirement: "needs_review", strongSignals, mediumSignals, blockedBy };
  if (mediumSignals.length === 1) return { action: "daily_trace", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
  return { action: axis.noDistinctiveMemorySignal ? "store_only" : "daily_trace", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
}

export function toV1WorthinessDimensionsV4(axis: WorthinessAxisV4) {
  return {
    milestone: { score: effectiveTransitionScore(axis.developmentalTransition), evidenceRefs: axis.developmentalTransition.evidenceRefs },
    change: { score: effectiveCapabilityScore(axis.newCapabilityOrIndependence), evidenceRefs: axis.newCapabilityOrIndependence.evidenceRefs },
    futureRecall: { score: axis.futureRecallValue.score, evidenceRefs: axis.futureRecallValue.evidenceRefs },
    relationship: { score: axis.relationshipSignificance.score, evidenceRefs: axis.relationshipSignificance.evidenceRefs },
    emotion: { score: axis.distinctiveFamilyMoment.score, evidenceRefs: axis.distinctiveFamilyMoment.evidenceRefs },
    everydayTexture: { score: 0, evidenceRefs: [] },
  };
}
