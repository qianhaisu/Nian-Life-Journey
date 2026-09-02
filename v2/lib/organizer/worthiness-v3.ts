// Worthiness scoring and routing v3.
//
// What v2 got wrong: `ordinaryRoutineCharacter` was a subtractive worthiness dimension. Family group
// chat is inherently routine, so the model returned 3 on 16 of 19 development windows — a near
// constant, worth a flat −18, which crushed every score into 0–15 and suppressed signal and noise
// alike. It also made the "two medium signals" path unreachable, so nothing but a strong signal
// could ever promote.
//
// v3 removes the punishment entirely. Routineness is no longer a worthiness dimension at all; it is
// `noDistinctiveMemorySignal`, consulted ONLY when no positive signal fired, to separate "an
// ordinary day about the child" (daily_trace) from "nothing here" (store_only). An ordinary day that
// contains a well-supported capability gain or transition is fully eligible — which is the point,
// because first steps happen on ordinary days.
//
// Second change: a capability claim no longer needs a novelty word. 「放在床上他就自己会爬」 is strong
// evidence that he can crawl independently; it is NOT evidence that this was the first time. v3 lets
// that stand on its own as `newCapabilityOrIndependence`, while `developmentalTransition` stays
// strict and basis-gated. A capability the archive caught late is still worth keeping.
import type { DimensionScore } from "./contract";
import { effectiveTransitionScore, type DevelopmentalTransition, type EvidenceAxis } from "./worthiness-v2";

export const WORTHINESS_V3_VERSION = "worthiness-v3";

export type WorthinessAxisV3 = {
  developmentalTransition: DevelopmentalTransition;
  newCapabilityOrIndependence: DimensionScore;
  distinctiveFamilyMoment: DimensionScore;
  relationshipSignificance: DimensionScore;
  futureRecallValue: DimensionScore;
  /** Routing-only. True when the window holds nothing distinctive — never a score penalty. */
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

export type WorthinessV3Result = { score: number; effectiveTransition: number };

export function computeWorthinessV3(axis: WorthinessAxisV3): WorthinessV3Result {
  const effectiveTransition = effectiveTransitionScore(axis.developmentalTransition);
  const weighted =
    effectiveTransition * WEIGHTS.developmentalTransition +
    axis.newCapabilityOrIndependence.score * WEIGHTS.newCapabilityOrIndependence +
    axis.distinctiveFamilyMoment.score * WEIGHTS.distinctiveFamilyMoment +
    axis.futureRecallValue.score * WEIGHTS.futureRecallValue +
    axis.relationshipSignificance.score * WEIGHTS.relationshipSignificance;
  return { score: Math.max(0, Math.min(100, Math.round((100 * weighted) / POSITIVE_MAX))), effectiveTransition };
}

export type RoutingInputV3 = {
  worthiness: WorthinessAxisV3;
  evidence: EvidenceAxis;
  subjectRelevance: string;
  temporalStatus: string;
  rawFactCount: number;
};

export type RoutingDecisionV3 = {
  action: "life_event_candidate" | "daily_trace" | "store_only";
  reviewRequirement: "needs_review" | "n/a";
  strongSignals: string[];
  mediumSignals: string[];
  blockedBy: string[];
};

function gateFailures(input: RoutingInputV3): string[] {
  const failures: string[] = [];
  if (input.subjectRelevance !== "primary") failures.push("subject_not_primary");
  if (input.evidence.subjectConfidence === "low") failures.push("low_subject_confidence");
  if (input.evidence.evidenceConfidence === "low") failures.push("low_evidence_confidence");
  if (input.rawFactCount < 1) failures.push("no_unhedged_fact");
  if (input.temporalStatus !== "past" && input.temporalStatus !== "present") failures.push("not_observed");
  return failures;
}

export function routeV3(input: RoutingInputV3): RoutingDecisionV3 {
  const blockedBy = gateFailures(input);
  const axis = input.worthiness;
  const transition = effectiveTransitionScore(axis.developmentalTransition);

  const strongSignals: string[] = [];
  if (transition >= 2) strongSignals.push("developmental_transition");
  // Independent of any novelty claim: being able to do it is its own kind of worth.
  if (axis.newCapabilityOrIndependence.score >= 2) strongSignals.push("capability_or_independence");
  if (axis.distinctiveFamilyMoment.score >= 3) strongSignals.push("highly_distinctive_moment");

  const mediumSignals: string[] = [];
  if (axis.distinctiveFamilyMoment.score === 2) mediumSignals.push("distinctive_moment");
  if (axis.relationshipSignificance.score >= 2) mediumSignals.push("relationship");
  if (axis.futureRecallValue.score >= 2) mediumSignals.push("future_recall");
  if (transition === 1) mediumSignals.push("possible_transition");
  if (axis.newCapabilityOrIndependence.score === 1) mediumSignals.push("partial_capability");

  if (blockedBy.length) return { action: "store_only", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
  if (strongSignals.length >= 1) return { action: "life_event_candidate", reviewRequirement: "needs_review", strongSignals, mediumSignals, blockedBy };
  if (mediumSignals.length >= 2) return { action: "life_event_candidate", reviewRequirement: "needs_review", strongSignals, mediumSignals, blockedBy };
  if (mediumSignals.length === 1) return { action: "daily_trace", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
  // Nothing positive fired. This is the only place routineness is consulted, and all it decides is
  // whether an ordinary day about the child is worth a trace or worth nothing.
  return { action: axis.noDistinctiveMemorySignal ? "daily_trace" : "store_only", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
}

export function toV1WorthinessDimensionsV3(axis: WorthinessAxisV3) {
  return {
    milestone: { score: effectiveTransitionScore(axis.developmentalTransition), evidenceRefs: axis.developmentalTransition.evidenceRefs },
    change: { score: axis.newCapabilityOrIndependence.score, evidenceRefs: axis.newCapabilityOrIndependence.evidenceRefs },
    futureRecall: { score: axis.futureRecallValue.score, evidenceRefs: axis.futureRecallValue.evidenceRefs },
    relationship: { score: axis.relationshipSignificance.score, evidenceRefs: axis.relationshipSignificance.evidenceRefs },
    emotion: { score: axis.distinctiveFamilyMoment.score, evidenceRefs: axis.distinctiveFamilyMoment.evidenceRefs },
    everydayTexture: { score: 0, evidenceRefs: [] },
  };
}
