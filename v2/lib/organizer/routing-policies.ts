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
import type { SubjectResolution } from "./subject-resolver";
import type { EvidenceAxis } from "./worthiness-v2";

export const V4_ROUTING_POLICY_ID = "worthiness-v4";

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
