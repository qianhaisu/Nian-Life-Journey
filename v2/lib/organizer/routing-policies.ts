// Routing policy adapters.
//
// The validator owns the RoutingPolicy interface and defaults to v1. This file provides the v4
// adapter that evaluation injects. It lives apart from worthiness-v4.ts so the scoring module stays
// free of any dependency on the validator.
//
// The adapter fails LOUDLY when it cannot find the v4 axis for a window. That is deliberate: the
// defect this whole refactor exists to prevent was a v4 evaluation quietly producing v1 decisions,
// so "axis missing" must never degrade into "route like v1".
import type { RoutingPolicy } from "./validator";
import type { RouteDecision } from "./worthiness";
import { routeV4, type WorthinessAxisV4 } from "./worthiness-v4";
import { routeV5 } from "./worthiness-v5";
import type { SubjectResolution } from "./subject-resolver";
import type { EvidenceAxis } from "./worthiness-v2";
import { applyGroundingToAxis, type GroundingResult } from "./claim-grounding";

export const V4_ROUTING_POLICY_ID = "worthiness-v4";
export const V5_ROUTING_POLICY_ID = "worthiness-v5";

export type V4RoutingLookup = (windowId: string) => {
  worthiness: WorthinessAxisV4;
  evidence: EvidenceAxis;
  subjectResolution: SubjectResolution["level"];
} | undefined;

export function createV4RoutingPolicy(lookup: V4RoutingLookup): RoutingPolicy {
  return {
    id: V4_ROUTING_POLICY_ID,
    decide({ window, verdict }): RouteDecision {
      const context = lookup(window.windowId);
      if (!context) {
        throw new Error(`V4 routing policy has no axis for window ${window.windowId}. Refusing to route rather than falling back to v1.`);
      }
      const decision = routeV4({
        worthiness: context.worthiness,
        evidence: context.evidence,
        subjectResolution: context.subjectResolution,
        // The verdict reaching the validator is the contract-validated one, so these are the same
        // values every hard rule was applied to.
        subjectRelevance: verdict.subjectRelevance,
        temporalStatus: verdict.temporalStatus,
        rawFactCount: verdict.coreFacts.filter((fact) => fact.assertionKind === "raw_fact").length,
      });
      // The validator's RouteDecision carries a glimmer-pool flag that v4 does not model; v4 keeps
      // ordinary days as plain traces.
      return { action: decision.action, reviewRequirement: decision.reviewRequirement, toGlimmerPool: false };
    },
  };
}

// v6 = v5 routing over a CLAIM-GROUNDED axis.
//
// v5's gates and signal definitions are untouched. What changes is what reaches them: every
// dimension whose cited evidence is not a supported assertion about a resolved subject is zeroed
// first, and `rawFactCount` counts only grounded facts. HV2-N03's capability score came from the
// interrogative 「会自己站了？」 plus the backchannel 「真的」; after grounding that dimension is 0,
// so the strong signal never exists and there is nothing for a threshold to catch.
export const V6_ROUTING_POLICY_ID = "worthiness-v6-grounded";

export type V6RoutingLookup = (windowId: string) => {
  worthiness: WorthinessAxisV4;
  evidence: EvidenceAxis;
  subjectResolution: SubjectResolution["level"];
  grounding: GroundingResult;
} | undefined;

export function createV6RoutingPolicy(lookup: V6RoutingLookup, onDecision?: (windowId: string, detail: { zeroed: string[]; reasonCodes: string[]; promotableGroundedFactCount: number; traceEvidenceCount: number }) => void): RoutingPolicy {
  return {
    id: V6_ROUTING_POLICY_ID,
    decide({ window, verdict }): RouteDecision {
      const context = lookup(window.windowId);
      if (!context) {
        throw new Error(`V6 routing policy has no axis for window ${window.windowId}. Refusing to route rather than falling back to v1.`);
      }
      const gated = applyGroundingToAxis(context.worthiness, context.grounding);
      onDecision?.(window.windowId, { zeroed: gated.zeroed, reasonCodes: gated.reasonCodes, promotableGroundedFactCount: context.grounding.promotableGroundedFactCount, traceEvidenceCount: context.grounding.traceEvidenceCount });
      const decision = routeV5({
        worthiness: gated.axis,
        evidence: context.evidence,
        subjectResolution: context.subjectResolution,
        subjectRelevance: verdict.subjectRelevance,
        temporalStatus: verdict.temporalStatus,
        // Grounded facts only: an ungrounded "fact" must not satisfy the no_unhedged_fact gate.
        rawFactCount: context.grounding.promotableGroundedFactCount,
        // ...but failing that gate must cost the window its Memory, not its existence. Supplying
        // this is what separates "not promotable" from "not real" (see worthiness-v4.ts).
        traceEvidenceCount: context.grounding.traceEvidenceCount,
      });
      return { action: decision.action, reviewRequirement: decision.reviewRequirement, toGlimmerPool: false };
    },
  };
}

// v7 = v6 with ONE substitution: the promotion fact count.
//
// Naming, because there are now two things called v7 and they live in different namespaces:
//
//   claim-grounding-v7-zero-anaphora   a GROUNDING option (subject resolution). Built, measured,
//                                      NOT adopted; opt-in via `zeroAnaphoraAntecedent`, default
//                                      off. It is not a routing policy and has no policy id.
//   worthiness-v7-promotion-grounded   this ROUTING POLICY. Independent of the above and usable
//                                      with it off, which is how it is measured and shipped.
//
// What changes. V6 feeds routeV5 `promotableGroundedFactCount` — grounded facts the editor happened
// to label `raw_fact`. This feeds `promotionEligibleFactCount`, which asks what grounding proved
// instead: supported assertion, resolved subject, affirmative, settles its own proposition,
// epistemically settled, and attributable when reported. See claim-grounding.ts for the full
// argument and for why that is stricter, not looser, everywhere except the label.
//
// Everything else is deliberately identical — same axis, same grounding gates, same routeV5, same
// thresholds, same signal definitions, same trace-retention count. A route that moves between V6 and
// V7 moved for exactly one reason.
export const V7_PROMOTION_ROUTING_POLICY_ID = "worthiness-v7-promotion-grounded";

export function createV7PromotionRoutingPolicy(lookup: V6RoutingLookup, onDecision?: (windowId: string, detail: { zeroed: string[]; reasonCodes: string[]; promotionEligibleFactCount: number; traceEvidenceCount: number }) => void): RoutingPolicy {
  return {
    id: V7_PROMOTION_ROUTING_POLICY_ID,
    decide({ window, verdict }): RouteDecision {
      const context = lookup(window.windowId);
      if (!context) {
        throw new Error(`V7 promotion routing policy has no axis for window ${window.windowId}. Refusing to route rather than falling back to v1.`);
      }
      const gated = applyGroundingToAxis(context.worthiness, context.grounding);
      onDecision?.(window.windowId, { zeroed: gated.zeroed, reasonCodes: gated.reasonCodes, promotionEligibleFactCount: context.grounding.promotionEligibleFactCount, traceEvidenceCount: context.grounding.traceEvidenceCount });
      const decision = routeV5({
        worthiness: gated.axis,
        evidence: context.evidence,
        subjectResolution: context.subjectResolution,
        subjectRelevance: verdict.subjectRelevance,
        temporalStatus: verdict.temporalStatus,
        rawFactCount: context.grounding.promotionEligibleFactCount,
        traceEvidenceCount: context.grounding.traceEvidenceCount,
      });
      return { action: decision.action, reviewRequirement: decision.reviewRequirement, toGlimmerPool: false };
    },
  };
}

// v5 = v4 plus the rule that a promotion requires a strong signal. Same lookup, same axis.
export function createV5RoutingPolicy(lookup: V4RoutingLookup): RoutingPolicy {
  return {
    id: V5_ROUTING_POLICY_ID,
    decide({ window, verdict }): RouteDecision {
      const context = lookup(window.windowId);
      if (!context) {
        throw new Error(`V5 routing policy has no axis for window ${window.windowId}. Refusing to route rather than falling back to v1.`);
      }
      const decision = routeV5({
        worthiness: context.worthiness,
        evidence: context.evidence,
        subjectResolution: context.subjectResolution,
        subjectRelevance: verdict.subjectRelevance,
        temporalStatus: verdict.temporalStatus,
        rawFactCount: verdict.coreFacts.filter((fact) => fact.assertionKind === "raw_fact").length,
      });
      return { action: decision.action, reviewRequirement: decision.reviewRequirement, toGlimmerPool: false };
    },
  };
}
