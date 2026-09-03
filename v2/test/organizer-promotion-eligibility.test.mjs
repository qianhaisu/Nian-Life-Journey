import test from "node:test";
import assert from "node:assert/strict";
import { applyGroundingToAxis, groundClaims } from "../lib/organizer/claim-grounding.ts";
import { routeV5 } from "../lib/organizer/worthiness-v5.ts";
import { createV6RoutingPolicy, createV7PromotionRoutingPolicy, V7_PROMOTION_ROUTING_POLICY_ID } from "../lib/organizer/routing-policies.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";

// Promotion eligibility: what may count as the fact that justifies a MEMORY.
//
// The defect. `promotableGroundedFactCount` counts a grounded claim only when the editor labelled it
// `assertionKind === "raw_fact"`. On the 47-window labelled corpus 85 claims were
// `mayGroundDevelopmentalSignal = true` and 47 of them were not `raw_fact` — so a supported,
// affirmative, subject-resolved, settled claim could be refused promotion material purely for a
// contract label that is not a truth signal (validator.ts *demotes* a hedged raw_fact INTO
// attributed_claim, so the class holds both 「好像是第一次」 and a caregiver's 「他会自己吃了」).
//
// `promotionEligibleFactCount` decides it from what grounding proved instead. These cases pin the
// SEMANTICS, never a phrase from any particular corpus case: each one is a minimal constructed
// window built from the same helpers, and the assertions are about eligibility and route.

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };

const DIGEST_DAD = senderDigestForDisplayName("Ted");
const DIGEST_MUM = senderDigestForDisplayName("阿静");
const DIGEST_NANNY = senderDigestForDisplayName("hxx\\.");
const DIGEST_UNKNOWN = "unknown-participant-digest";

let seq = 0;
function item(text, opts = {}) {
  seq += 1;
  const id = `item:${String(seq).padStart(24, "0")}`;
  const parts = text.split(/(?<=[。！？!?\n])/u).filter((p) => p.trim());
  const spans = [];
  let cursor = 0;
  (parts.length ? parts : [text]).forEach((part, index) => {
    spans.push({ id: `span-${index}`, start: cursor, end: cursor + part.length });
    cursor += part.length;
  });
  return {
    itemId: id, sourceId: opts.sourceId ?? `src-${seq}`, sentAt: "2026-03-01T10:00:00.000Z",
    senderRole: opts.senderRole ?? "speaker-a", senderDigest: opts.senderDigest ?? DIGEST_MUM,
    text, contentTypes: opts.contentTypes ?? ["daily"], mediaRefs: opts.mediaRefs ?? [],
    locator: { document: "d", recordOrdinal: seq }, spans, tier: opts.tier ?? "firsthand_observation",
  };
}
function windowOf(items, extra = {}) {
  return {
    windowId: "window:test", conversationId: "conversation:test", profileId: "profile-zhangnian",
    activityDate: "2026-03-01", timeRange: { from: "2026-03-01T10:00:00.000Z", to: "2026-03-01T11:00:00.000Z" },
    items, mediaBindings: extra.mediaBindings ?? [], neighbors: extra.neighbors ?? { before: [], after: [] },
    priorContext: { dailyTraces: [], lifeEvents: [] },
    stats: { messageCount: items.length, imageCount: extra.imageCount ?? 0, senderCount: new Set(items.map((i) => i.senderDigest)).size, droppedCount: 0 },
  };
}
const ref = (it, n = 0) => `${it.itemId}#span-${n}`;

const AXIS_ZERO = {
  developmentalTransition: { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: { score: 0, kind: "none", evidenceRefs: [] },
  distinctiveFamilyMoment: { score: 0, evidenceRefs: [] },
  relationshipSignificance: { score: 0, evidenceRefs: [] },
  futureRecallValue: { score: 0, evidenceRefs: [] },
  noDistinctiveMemorySignal: false,
};
// A strong capability signal, so the only thing left deciding the route is the promotion fact count.
const capabilityAxis = (refs) => ({ ...AXIS_ZERO, newCapabilityOrIndependence: { score: 3, kind: "developmental_ability", evidenceRefs: refs } });

function verdictOf(coreFacts, axis, extra = {}) {
  return {
    windowId: "window:test", subjectRelevance: "primary", subjectIds: [], temporalStatus: "past",
    occurredAtProposal: { value: "2026-03-01", basis: "sent_at", evidenceRefs: [] },
    coreFacts, quotableLines: [], worthinessDimensions: {}, duplicateCandidates: [],
    uncertainty: { time: "low", subject: "low", semantics: "low" }, sensitivityFlags: [],
    prohibitedInferences: [], proposedAction: "life_event_candidate", selectionReason: "t", confidence: 0.9,
    worthinessAxis: axis, ...extra,
  };
}

/**
 * Builds one window with a named antecedent plus the claim span, grounds it, and routes it through
 * BOTH policies off the SAME verdict — the same construction the corpus runner uses, so no delta
 * here can come from anything but the policy.
 */
function judge(claimText, { assertionKind = "raw_fact", claimant, senderDigest = DIGEST_MUM, statement = "小年会自己吃了", anchor = "今天小年在家。", axis } = {}) {
  const anchorItem = item(anchor, { senderDigest: DIGEST_DAD });
  const claimItem = item(claimText, { senderDigest });
  const window = windowOf([anchorItem, claimItem]);
  const refs = [ref(claimItem)];
  const verdict = verdictOf([{ statement, assertionKind, claimant, evidenceRefs: refs }], axis ?? capabilityAxis(refs));
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);
  const lookup = () => ({
    worthiness: verdict.worthinessAxis,
    evidence: { evidenceConfidence: "medium", evidenceRefs: [] },
    subjectResolution: "explicit",
    grounding,
  });
  const v6 = createV6RoutingPolicy(lookup).decide({ window, verdict });
  const v7 = createV7PromotionRoutingPolicy(lookup).decide({ window, verdict });
  return { grounding, axis: verdict.worthinessAxis, claim: grounding.claims[0], v6: v6.action, v7: v7.action };
}

const promoted = (action) => action === "life_event_candidate";

// ------------------------------------------------------------------ 1-2: what may now contribute

test("1. a grounded raw_fact may contribute to promotion", () => {
  const r = judge("小年今天会自己吃了。", { assertionKind: "raw_fact" });
  assert.equal(r.claim.mayGroundPromotion, true, r.claim.promotionBlockers.join(","));
  assert.equal(r.grounding.promotionEligibleFactCount, 1);
  // The case both policies already agreed on — v7 must not disturb it.
  assert.equal(r.grounding.promotableGroundedFactCount, 1);
  assert.ok(promoted(r.v6) && promoted(r.v7));
});

test("2. a grounded FACTUAL attributed_claim may contribute — this is the defect being fixed", () => {
  const r = judge("小年现在已经会自己吃了。", { assertionKind: "attributed_claim", claimant: "雪姨", senderDigest: DIGEST_NANNY });
  assert.equal(r.claim.assertionStatus, "supported_assertion");
  assert.equal(r.claim.subject.resolved, true);
  assert.equal(r.claim.epistemicStatus, "settled");
  assert.equal(r.claim.mayGroundPromotion, true, r.claim.promotionBlockers.join(","));
  // The whole delta, in two numbers on ONE grounding result.
  assert.equal(r.grounding.promotableGroundedFactCount, 0, "frozen V6 refuses it for its label alone");
  assert.equal(r.grounding.promotionEligibleFactCount, 1);
  assert.equal(promoted(r.v6), false, "V6 blocks on no_unhedged_fact");
  assert.equal(promoted(r.v7), true);
});

// ------------------------------------------------------------------ 3-7: what still may not

test("3. a question framed as an attributed_claim does not contribute", () => {
  const r = judge("小年会自己吃了吗？", { assertionKind: "attributed_claim", claimant: "雪姨" });
  assert.equal(r.claim.assertionStatus, "question");
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(r.grounding.promotionEligibleFactCount, 0);
  assert.equal(promoted(r.v7), false);
});

test("4. a speculative attributed_claim does not become a flat fact", () => {
  // Phase B's worked example. The grounded fact may be "妈妈觉得他可能饿了"; it may never be
  // "张年饿了", and making attributed_claim promotion-eligible must not change that.
  const r = judge("我觉得他可能饿了。", { assertionKind: "attributed_claim", claimant: "妈妈", statement: "妈妈觉得他可能饿了" });
  assert.equal(r.claim.assertionStatus, "supported_assertion", "it IS a supported assertion about what she said");
  assert.equal(r.claim.epistemicStatus, "hedged");
  assert.deepEqual(r.claim.epistemicMarkers.sort(), ["epistemic_hedge", "inner_state_matrix"]);
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(r.grounding.promotionEligibleFactCount, 0);
  assert.equal(promoted(r.v7), false);
});

test("5. a plan does not contribute", () => {
  const r = judge("明天开始让小年自己吃。", { assertionKind: "attributed_claim", claimant: "妈妈" });
  assert.equal(r.claim.assertionStatus, "plan_or_hypothetical");
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);
});

test("6. a hypothetical does not contribute", () => {
  const r = judge("如果小年会自己吃就好了。", { assertionKind: "attributed_claim", claimant: "妈妈" });
  assert.equal(r.claim.assertionStatus, "plan_or_hypothetical");
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);
});

test("7. a negated or not-yet achievement does not contribute", () => {
  for (const text of ["小年不会自己吃。", "小年还不会自己吃。"]) {
    const r = judge(text, { assertionKind: "attributed_claim", claimant: "雪姨" });
    assert.equal(r.claim.polarity, "negated", text);
    assert.ok(r.claim.promotionBlockers.includes("negated_or_not_yet"), text);
    assert.equal(r.claim.mayGroundPromotion, false, text);
    assert.equal(promoted(r.v7), false, text);
  }
});

// ------------------------------------------------------------------ 8-9: who the claim is about

test("8. an unresolved subject does not contribute", () => {
  // No name, no pronoun anywhere: frozen V6 subject behaviour, zero-anaphora off.
  const r = judge("已经会自己吃了。", { assertionKind: "attributed_claim", claimant: "雪姨", anchor: "今天天气不错。" });
  assert.equal(r.claim.subject.resolved, false);
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);
});

test("9. a claim about another child does not contribute to 张年", () => {
  const r = judge("他会自己吃了。", { assertionKind: "attributed_claim", claimant: "雪姨", anchor: "今天小年和小伙伴一起吃饭。" });
  assert.equal(r.claim.subject.basis, "unresolved_competing_person");
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);
});

// ------------------------------------------------------------------ 10-11: attribution preserved

test("10. an attributed caregiver OBSERVATION may support a capability", () => {
  const r = judge("小年自己拿勺子吃完了一整碗。", { assertionKind: "attributed_claim", claimant: "雪姨", senderDigest: DIGEST_NANNY });
  assert.equal(r.claim.observationMode, "reported");
  assert.equal(r.claim.mayGroundPromotion, true, r.claim.promotionBlockers.join(","));
  assert.equal(promoted(r.v7), true);
});

test("11. an attributed INNER-STATE interpretation keeps its attribution and cannot promote", () => {
  const r = judge("雪姨说他好像不太喜欢自己吃。", { assertionKind: "attributed_claim", claimant: "雪姨", senderDigest: DIGEST_NANNY });
  assert.equal(r.claim.epistemicStatus, "hedged");
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);
});

// ------------------------------------------------------------------ 12-13: evidence and novelty

test("12. an unsupported evidence ref cannot contribute", () => {
  const anchorItem = item("今天小年在家。", { senderDigest: DIGEST_DAD });
  const window = windowOf([anchorItem]);
  const refs = ["item:000000000000000000000000#span-0"]; // never present in the window
  const verdict = verdictOf([{ statement: "小年会自己吃了", assertionKind: "attributed_claim", claimant: "雪姨", evidenceRefs: refs }], capabilityAxis(refs));
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);
  assert.equal(grounding.claims[0].assertionStatus, "unsupported");
  assert.equal(grounding.claims[0].mayGroundPromotion, false);
  assert.equal(grounding.promotionEligibleFactCount, 0);
});

test("13. a quote from an unknown speaker cannot promote a reported claim", () => {
  const r = judge("小年会自己吃了。", { assertionKind: "attributed_claim", claimant: "某人", senderDigest: DIGEST_UNKNOWN });
  assert.equal(r.claim.observationMode, "reported");
  assert.ok(r.claim.promotionBlockers.includes("reported_by_unknown_speaker"));
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);
});

test("13b. an embedded interrogative still cannot establish an ability (HV2-N03's guard)", () => {
  const r = judge("看一下他有没有自己吃。", { assertionKind: "attributed_claim", claimant: "妈妈" });
  assert.ok(r.claim.promotionBlockers.includes("unsettled_proposition"), r.claim.promotionBlockers.join(","));
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);
});

// ------------------------------------------------------------------ 14-15: the frozen contracts

test("14. FROZEN V6 INVARIANT: the frozen count and the frozen route are both byte-compatible", () => {
  // The exhaustive form of "V6 is testably unchanged". Across the full cross-product of claim
  // language x assertionKind:
  //
  //   a) promotableGroundedFactCount is still EXACTLY `raw_fact && mayContributeToWorthiness`, so
  //      nothing v7 added leaks into the quantity V6 routes on. Note this count is deliberately
  //      reproduced here in its loose original form — a NEGATED raw_fact satisfies it, because
  //      mayContributeToWorthiness does not test polarity. v7 tightens that; V6 must not.
  //   b) the V6 route is still routeV5 over the grounded axis fed that same count — recomputed
  //      here from the public pieces rather than trusted, so a change inside the policy adapter
  //      would fail this test.
  const TEXTS = [
    "小年会自己吃了。", "小年会自己吃了吗？", "我觉得他可能饿了。", "明天开始让小年自己吃。",
    "小年还不会自己吃。", "看一下他有没有自己吃。", "真的", "今天天气很好。", "他今天自己吃了。",
  ];
  let checked = 0, negatedRawFactsCounted = 0;
  for (const text of TEXTS) {
    for (const kind of ["raw_fact", "attributed_claim"]) {
      const r = judge(text, { assertionKind: kind, claimant: kind === "attributed_claim" ? "雪姨" : undefined });
      const frozenCount = kind === "raw_fact" && r.claim.mayContributeToWorthiness ? 1 : 0;
      assert.equal(r.grounding.promotableGroundedFactCount, frozenCount, `${text} / ${kind}: frozen count`);
      if (frozenCount === 1 && r.claim.polarity === "negated") negatedRawFactsCounted += 1;

      const gated = applyGroundingToAxis(r.axis, r.grounding);
      const expected = routeV5({
        worthiness: gated.axis,
        evidence: { evidenceConfidence: "medium", evidenceRefs: [] },
        subjectResolution: "explicit",
        subjectRelevance: "primary",
        temporalStatus: "past",
        rawFactCount: r.grounding.promotableGroundedFactCount,
        traceEvidenceCount: r.grounding.traceEvidenceCount,
      });
      assert.equal(r.v6, expected.action, `${text} / ${kind}: frozen route`);
      checked += 1;
    }
  }
  assert.equal(checked, TEXTS.length * 2);
  assert.ok(negatedRawFactsCounted > 0, "the corpus of texts must actually exercise V6's polarity-blind count");
});

test("15. the zero-anaphora experiment stays off by default and inert under v7", () => {
  // V7-promotion and V7-zero-anaphora are independent. A claim with neither name nor pronoun must
  // stay unresolved under the new promotion policy exactly as it does under V6.
  const r = judge("已经会自己吃了。", { assertionKind: "attributed_claim", claimant: "雪姨", anchor: "今天小年在家。" });
  assert.equal(r.grounding.version, "claim-grounding-v1", "default grounding version is unchanged");
  assert.equal(r.claim.subject.basis, "unresolved_no_reference");
  assert.equal(r.claim.mayGroundPromotion, false);
  assert.equal(promoted(r.v7), false);

  // ...and turning it on is still an explicit, separate opt-in that v7 does not imply.
  const anchorItem = item("今天小年在家。", { senderDigest: DIGEST_DAD });
  const claimItem = item("已经会自己吃了。", { senderDigest: DIGEST_NANNY });
  const window = windowOf([anchorItem, claimItem]);
  const refs = [ref(claimItem)];
  const verdict = verdictOf([{ statement: "小年会自己吃了", assertionKind: "attributed_claim", claimant: "雪姨", evidenceRefs: refs }], capabilityAxis(refs));
  const withZa = groundClaims(window, verdict, SUBJECT, { ...OPTS, zeroAnaphoraAntecedent: true });
  assert.equal(withZa.claims[0].subject.basis, "antecedent_in_window_zero_anaphora");
  assert.equal(withZa.version, "claim-grounding-v7-zero-anaphora");
});

test("16. the two v7s are separately named and cannot be confused", () => {
  assert.equal(V7_PROMOTION_ROUTING_POLICY_ID, "worthiness-v7-promotion-grounded");
  assert.equal(createV6RoutingPolicy(() => undefined).id, "worthiness-v6-grounded");
});
