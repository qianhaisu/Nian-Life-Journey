// Judgment policies — a grounding half and a routing half, bound together as one named thing.
//
// Why this file exists. Both open experiments are half-policies, and each is inert or misleading on
// its own. The 2026-09-03 recall closure measured RC-09 — a clean positive — in all four cells of
// the grid and found it promotes in exactly one, 3/3 calls:
//
//                                promotableGroundedFactCount | promotionEligibleFactCount
//   zero-anaphora OFF                    miss                |          miss
//   zero-anaphora ON                     miss                |         MEMORY
//
// Zero-anaphora alone lets the strong signal survive grounding, but both of RC-09's claims are
// `attributed_claim`, so `no_unhedged_fact` still blocks. Grounded promotion alone cannot resolve
// the claim's subject, so there is nothing to promote. Clean-positive recall is 1/4 for frozen V6,
// 1/4 for either half alone, and 2/4 only for the pair.
//
// Judging either half as an independent production feature therefore understates it and produced
// two separate "not adopted" verdicts for what is really one change. Binding them into a single
// descriptor makes the coupling structural: a caller selects a JudgmentPolicy and gets both halves,
// or neither. There is deliberately no exported way to take one half from here.
//
// NOTHING here is enabled globally. The app never sets `routingPolicy` at all — validator.ts falls
// back to V1 — so these are selected explicitly by evaluation scripts and by nothing else. Frozen V6
// is not modified by this file; it is only named by it.
import type { RoutingPolicy } from "./validator";
import type { GroundingOptions } from "./claim-grounding";
import {
  createV6RoutingPolicy,
  createV7PromotionRoutingPolicy,
  V6_ROUTING_POLICY_ID,
  V7_PROMOTION_ROUTING_POLICY_ID,
  type V6RoutingLookup,
} from "./routing-policies";

/**
 * What a policy observed while routing one window, with the promotion count NORMALISED.
 *
 * The two halves report it under different names — frozen V6 emits `promotableGroundedFactCount`,
 * the grounded-promotion half emits `promotionEligibleFactCount` — and a caller comparing the two
 * should not have to know which. `promotionCount` is whichever number that policy actually fed to
 * routing, so a run log records the decision rather than the implementation.
 */
export type JudgmentDecisionDetail = {
  zeroed: string[];
  reasonCodes: string[];
  promotionCount: number;
  traceEvidenceCount: number;
};

export type JudgmentPolicy = {
  /** Stable id recorded on every run so a stored result can never be mistaken for another policy. */
  id: string;
  description: string;
  /** The routing half. */
  routingPolicyId: string;
  createRoutingPolicy: (lookup: V6RoutingLookup, onDecision?: (windowId: string, detail: JudgmentDecisionDetail) => void) => RoutingPolicy;
  /**
   * The grounding half, as options to merge into the caller's base (registry, household). Frozen V6
   * contributes none — its grounding is the default path, byte-for-byte.
   */
  grounding: Readonly<GroundingOptions>;
};

export const FROZEN_V6_JUDGMENT: JudgmentPolicy = {
  id: "judgment-v6-frozen",
  description: "Frozen V6: claim grounding on the default path, promotion counted by the editor's raw_fact label.",
  routingPolicyId: V6_ROUTING_POLICY_ID,
  createRoutingPolicy: (lookup, onDecision) =>
    createV6RoutingPolicy(lookup, onDecision && ((windowId, detail) => onDecision(windowId, {
      zeroed: detail.zeroed, reasonCodes: detail.reasonCodes,
      promotionCount: detail.promotableGroundedFactCount, traceEvidenceCount: detail.traceEvidenceCount,
    }))),
  grounding: Object.freeze({}),
};

/**
 * The coupled candidate, approved 2026-09-03 for FRESH SHADOW EVALUATION ONLY — not for adoption.
 *
 * Both halves at once and never one of them:
 *
 *   zero-anaphora subject resolution   a claim whose span carries no name and no pronoun may take
 *                                      the bounded antecedent walk a pronoun-bearing claim already
 *                                      takes. It REUSES every existing guard rather than relaxing
 *                                      one — the competing-person check still runs at window +
 *                                      neighbour scope, an antecedent must still be an explicit
 *                                      naming inside the same episode, and a first-person span is
 *                                      never attributed to the child.
 *
 *   grounded promotion eligibility     promotion material decided by what grounding proved rather
 *                                      than by `assertionKind`. Stricter than the frozen count on
 *                                      every axis except the label: it additionally requires
 *                                      affirmative polarity, a proposition the span settles, an
 *                                      epistemically settled claim, and a known speaker when the
 *                                      claim is reported.
 *
 * What it deliberately does NOT do: no threshold moves, no new capability vocabulary, no per-case
 * exemption, and no change to any gate that decides whether a day was real or whose it was.
 */
export const COUPLED_CANDIDATE_JUDGMENT: JudgmentPolicy = {
  id: "judgment-v7-coupled-za-promotion",
  description: "Frozen V6 + zero-anaphora subject resolution + grounded promotion eligibility, as one candidate.",
  routingPolicyId: V7_PROMOTION_ROUTING_POLICY_ID,
  createRoutingPolicy: (lookup, onDecision) =>
    createV7PromotionRoutingPolicy(lookup, onDecision && ((windowId, detail) => onDecision(windowId, {
      zeroed: detail.zeroed, reasonCodes: detail.reasonCodes,
      promotionCount: detail.promotionEligibleFactCount, traceEvidenceCount: detail.traceEvidenceCount,
    }))),
  grounding: Object.freeze({ zeroAnaphoraAntecedent: true }),
};

export const JUDGMENT_POLICIES: Readonly<Record<string, JudgmentPolicy>> = Object.freeze({
  [FROZEN_V6_JUDGMENT.id]: FROZEN_V6_JUDGMENT,
  [COUPLED_CANDIDATE_JUDGMENT.id]: COUPLED_CANDIDATE_JUDGMENT,
});

/**
 * Grounding options for a policy, over the caller's base. The base carries the things that are not
 * policy at all — the identity registry and the household prior — and a policy may only ADD to it.
 */
export function groundingOptionsFor(policy: JudgmentPolicy, base: GroundingOptions = {}): GroundingOptions {
  return { ...base, ...policy.grounding };
}
