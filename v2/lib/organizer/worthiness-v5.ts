// Routing v5 — one rule on top of v4.
//
// Product decision: two medium signals must not, by themselves, create a Memory. A promotion now
// requires at least one STRONG worthiness signal.
//
// The v4 development run showed why. The categorical capability fix worked exactly as designed —
// 「他吃的身上和餐椅全是面」 was scored `ordinary_action` and contributed nothing to the score or to
// any strong signal. But the window was promoted anyway through `distinctive_moment` +
// `future_recall`, so the ordinary-but-pleasant tomato-noodles day became a Memory through the other
// door. That door is now closed.
//
// Medium signals keep their other jobs: they still separate a richer trace from ordinary noise, and
// they remain available for trace prioritisation and editorial ranking. They simply cannot promote.
//
// Deliberately implemented as routeV4 plus a single demotion, not as a reimplementation: v5 must not
// be able to drift from v4's gate, signal or capability semantics, because none of those were part
// of this decision.
import { routeV4, type RoutingDecisionV4, type RoutingInputV4 } from "./worthiness-v4";

export const WORTHINESS_V5_VERSION = "worthiness-v5";

export type RoutingDecisionV5 = RoutingDecisionV4 & {
  /** Set when v4 would have promoted on medium signals alone and v5 held it as a trace. */
  demotedFromMediumOnlyPromotion?: boolean;
  /** Medium signals still distinguish a richer trace from ordinary noise. */
  traceRichness?: "rich" | "ordinary";
};

export function routeV5(input: RoutingInputV4): RoutingDecisionV5 {
  const decision = routeV4(input);

  // A strong signal still promotes, exactly as in v4. This is the path that keeps a real capability
  // or an evidenced transition — including B3/B8-style meaningful_independence.
  if (decision.action !== "life_event_candidate" || decision.strongSignals.length >= 1) {
    if (decision.action === "daily_trace") {
      return { ...decision, traceRichness: decision.mediumSignals.length >= 2 ? "rich" : "ordinary" };
    }
    return decision;
  }

  // Medium-only promotion: the one case v5 changes.
  return {
    ...decision,
    action: "daily_trace",
    reviewRequirement: "n/a",
    demotedFromMediumOnlyPromotion: true,
    traceRichness: "rich",
  };
}
