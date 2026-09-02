// Worthiness scoring and routing for Memory Editor v2.
//
// The one structural difference from v1: the evidence axis is not an input here. Provenance decides
// whether a window is ELIGIBLE to be judged; it never contributes a point to how much the moment is
// worth. In v1 the two were summed, and after identity enrichment every window in the archive —
// signal and noise alike — scored maximum on firsthand evidence, so the sum stopped discriminating.
import type { DimensionScore } from "./contract";

export const WORTHINESS_V2_VERSION = "worthiness-v2";

export type TransitionBasis = "explicit_in_window" | "supported_by_prior_context" | "unknown";
export type ConfidenceLevel = "high" | "medium" | "low";

export type DevelopmentalTransition = { score: 0 | 1 | 2 | 3; basis: TransitionBasis; evidenceRefs: string[] };

export type WorthinessAxis = {
  developmentalTransition: DevelopmentalTransition;
  newCapabilityOrIndependence: DimensionScore;
  distinctiveFamilyMoment: DimensionScore;
  relationshipSignificance: DimensionScore;
  futureRecallValue: DimensionScore;
  /** Higher means MORE routine. This is the only dimension that subtracts. */
  ordinaryRoutineCharacter: DimensionScore;
};

export type EvidenceAxis = {
  subjectConfidence: ConfidenceLevel;
  evidenceConfidence: ConfidenceLevel;
  attributionConfidence: ConfidenceLevel;
  firsthandOrReported: "firsthand" | "reported" | "mixed";
  corroboratingSpeakers: number;
};

// A transition claim with no stated basis is an assumption about the child's development. It may
// still be recorded (score 1 = "possibly"), but it can never carry a window on its own.
export function effectiveTransitionScore(transition: DevelopmentalTransition): 0 | 1 | 2 | 3 {
  if (transition.basis === "unknown") return Math.min(transition.score, 1) as 0 | 1;
  return transition.score;
}

const WEIGHTS = {
  developmentalTransition: 3.0,
  newCapabilityOrIndependence: 2.5,
  distinctiveFamilyMoment: 2.0,
  futureRecallValue: 2.0,
  relationshipSignificance: 1.5,
} as const;
const POSITIVE_MAX = 3 * Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
const ROUTINE_PENALTY_PER_POINT = 6;

export type WorthinessV2Result = { score: number; effectiveTransition: number; routinePenalty: number };

export function computeWorthinessV2(axis: WorthinessAxis): WorthinessV2Result {
  const effectiveTransition = effectiveTransitionScore(axis.developmentalTransition);
  const weighted =
    effectiveTransition * WEIGHTS.developmentalTransition +
    axis.newCapabilityOrIndependence.score * WEIGHTS.newCapabilityOrIndependence +
    axis.distinctiveFamilyMoment.score * WEIGHTS.distinctiveFamilyMoment +
    axis.futureRecallValue.score * WEIGHTS.futureRecallValue +
    axis.relationshipSignificance.score * WEIGHTS.relationshipSignificance;
  const routinePenalty = axis.ordinaryRoutineCharacter.score * ROUTINE_PENALTY_PER_POINT;
  const score = Math.max(0, Math.min(100, Math.round((100 * weighted) / POSITIVE_MAX) - routinePenalty));
  return { score, effectiveTransition, routinePenalty };
}

// ---- Deterministic routing ---------------------------------------------------------------------
// Gates are eligibility, not merit: they ask "can this window be judged at all", and every one of
// them restates a rule the pipeline already enforces elsewhere.
export type RoutingInput = {
  worthiness: WorthinessAxis;
  evidence: EvidenceAxis;
  subjectRelevance: string;
  temporalStatus: string;
  rawFactCount: number;
};

export type RoutingDecision = {
  action: "life_event_candidate" | "daily_trace" | "store_only";
  reviewRequirement: "needs_review" | "n/a";
  strongSignals: string[];
  mediumSignals: string[];
  blockedBy: string[];
};

function gateFailures(input: RoutingInput): string[] {
  const failures: string[] = [];
  if (input.subjectRelevance !== "primary") failures.push("subject_not_primary");
  if (input.evidence.subjectConfidence === "low") failures.push("low_subject_confidence");
  if (input.evidence.evidenceConfidence === "low") failures.push("low_evidence_confidence");
  if (input.rawFactCount < 1) failures.push("no_unhedged_fact");
  if (input.temporalStatus !== "past" && input.temporalStatus !== "present") failures.push("not_observed");
  return failures;
}

export function routeV2(input: RoutingInput): RoutingDecision {
  const blockedBy = gateFailures(input);
  const axis = input.worthiness;
  const transition = effectiveTransitionScore(axis.developmentalTransition);

  const strongSignals: string[] = [];
  if (transition >= 2) strongSignals.push("developmental_transition");
  if (axis.newCapabilityOrIndependence.score >= 2) strongSignals.push("new_capability");
  if (axis.distinctiveFamilyMoment.score >= 3) strongSignals.push("highly_distinctive_moment");

  const mediumSignals: string[] = [];
  if (axis.distinctiveFamilyMoment.score === 2) mediumSignals.push("distinctive_moment");
  if (axis.relationshipSignificance.score >= 2) mediumSignals.push("relationship");
  if (axis.futureRecallValue.score >= 2) mediumSignals.push("future_recall");
  if (transition === 1) mediumSignals.push("possible_transition");

  if (blockedBy.length) return { action: "store_only", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };

  // A day the family themselves describe as routine does not become a memory on medium signals
  // alone — that is the density trap, where a lively ordinary day out-signals a quiet real one.
  // A strong, evidenced signal still wins: routine days are exactly where first steps happen.
  const routineDominant = axis.ordinaryRoutineCharacter.score >= 2;
  if (strongSignals.length >= 1) return { action: "life_event_candidate", reviewRequirement: "needs_review", strongSignals, mediumSignals, blockedBy };
  if (!routineDominant && mediumSignals.length >= 2) return { action: "life_event_candidate", reviewRequirement: "needs_review", strongSignals, mediumSignals, blockedBy };
  if (mediumSignals.length >= 1 || axis.ordinaryRoutineCharacter.score >= 1) return { action: "daily_trace", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
  return { action: "store_only", reviewRequirement: "n/a", strongSignals, mediumSignals, blockedBy };
}

// The H1–H9 validator is written against the v1 dimension names, and it stays the authority on
// safety. Mapping the v2 axis onto those names keeps every hard rule live — in particular H8, which
// independently requires unhedged text evidence before a milestone claim may stand, and so acts as a
// deterministic second check on the model's own `basis`.
export function toV1WorthinessDimensions(axis: WorthinessAxis) {
  return {
    milestone: { score: effectiveTransitionScore(axis.developmentalTransition), evidenceRefs: axis.developmentalTransition.evidenceRefs },
    change: { score: axis.newCapabilityOrIndependence.score, evidenceRefs: axis.newCapabilityOrIndependence.evidenceRefs },
    futureRecall: { score: axis.futureRecallValue.score, evidenceRefs: axis.futureRecallValue.evidenceRefs },
    relationship: { score: axis.relationshipSignificance.score, evidenceRefs: axis.relationshipSignificance.evidenceRefs },
    emotion: { score: axis.distinctiveFamilyMoment.score, evidenceRefs: axis.distinctiveFamilyMoment.evidenceRefs },
    everydayTexture: { score: 0, evidenceRefs: [] },
  };
}
