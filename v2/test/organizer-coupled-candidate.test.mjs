import test from "node:test";
import assert from "node:assert/strict";
import { groundClaims, applyGroundingToAxis } from "../lib/organizer/claim-grounding.ts";
import { validate } from "../lib/organizer/validator.ts";
import { FROZEN_V6_JUDGMENT, COUPLED_CANDIDATE_JUDGMENT, JUDGMENT_POLICIES, groundingOptionsFor } from "../lib/organizer/judgment-policy.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";

// The coupled candidate is zero-anaphora subject resolution AND grounded promotion eligibility,
// judged as one change. These cases pin what it must NOT cost.
//
// Every guard below is checked against the COUPLED policy, not against frozen V6 — the whole point
// is that loosening subject resolution is the change most likely to break them, and it is now on.
// Nothing here is written around RC-08 or RC-09: each case is a minimal constructed window, and no
// assertion mentions a corpus case.

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const BASE = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const V6 = groundingOptionsFor(FROZEN_V6_JUDGMENT, BASE);
const COUPLED = groundingOptionsFor(COUPLED_CANDIDATE_JUDGMENT, BASE);

const DIGEST_MUM = senderDigestForDisplayName("阿静");

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
    itemId: id, sourceId: opts.sourceId ?? `src-${seq}`, sentAt: opts.sentAt ?? "2026-03-01T10:00:00.000Z",
    senderRole: "speaker-a", senderDigest: opts.senderDigest ?? DIGEST_MUM,
    text, contentTypes: ["daily"], mediaRefs: opts.mediaRefs ?? [],
    locator: { document: "d", recordOrdinal: seq }, spans, tier: opts.tier ?? "firsthand_observation",
  };
}
function windowOf(items, neighbors = { before: [], after: [] }) {
  return {
    windowId: "window:test", conversationId: "conversation:test", profileId: "profile-zhangnian",
    activityDate: "2026-03-01", timeRange: { from: "2026-03-01T10:00:00.000Z", to: "2026-03-01T11:00:00.000Z" },
    items, mediaBindings: [], neighbors, priorContext: { dailyTraces: [], lifeEvents: [] },
    stats: { messageCount: items.length, imageCount: 0, senderCount: 1, droppedCount: 0 },
  };
}
const ref = (it, n = 0) => `${it.itemId}#span-${n}`;

const AXIS_STRONG_CAPABILITY = (refs) => ({
  developmentalTransition: { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: { score: 3, kind: "developmental_ability", evidenceRefs: refs },
  distinctiveFamilyMoment: { score: 0, evidenceRefs: [] },
  relationshipSignificance: { score: 0, evidenceRefs: [] },
  futureRecallValue: { score: 0, evidenceRefs: [] },
  noDistinctiveMemorySignal: false,
});

function verdictOf(coreFacts, axis) {
  return {
    windowId: "window:test", subjectRelevance: "primary", subjectIds: [], temporalStatus: "past",
    occurredAtProposal: { value: "2026-03-01", basis: "sent_at", evidenceRefs: [] },
    coreFacts, quotableLines: [], worthinessDimensions: {}, duplicateCandidates: [],
    uncertainty: { time: "low", subject: "low", semantics: "low" }, sensitivityFlags: [],
    prohibitedInferences: [], proposedAction: "life_event_candidate", selectionReason: "t", confidence: 0.9,
    worthinessAxis: axis,
  };
}

/** Routes one window+verdict through a JudgmentPolicy end to end. One grounding, one route. */
function route(policy, window, verdict, opts = {}) {
  const grounding = groundClaims(window, verdict, SUBJECT, groundingOptionsFor(policy, BASE));
  const gated = applyGroundingToAxis(verdict.worthinessAxis, grounding);
  const lookup = () => ({
    worthiness: verdict.worthinessAxis,
    evidence: opts.evidence ?? { evidenceConfidence: "medium", evidenceRefs: [] },
    subjectResolution: opts.subjectResolution ?? "explicit",
    grounding,
  });
  const result = validate(window, verdict, {
    now: "2026-03-02T00:00:00.000Z", existingLifeEvents: [], recentSameTypeCount: 0,
    routingPolicy: policy.createRoutingPolicy(lookup, () => {}), claimGrounding: grounding,
  });
  return { action: result.outcome.action, grounding, gated, result };
}

// ---------------------------------------------------------------- the coupling itself

test("the coupled candidate carries BOTH halves and frozen V6 carries neither", () => {
  assert.equal(COUPLED.zeroAnaphoraAntecedent, true);
  assert.equal(COUPLED_CANDIDATE_JUDGMENT.routingPolicyId, "worthiness-v7-promotion-grounded");
  assert.equal(V6.zeroAnaphoraAntecedent, undefined, "frozen V6 grounding must be the default path");
  assert.equal(FROZEN_V6_JUDGMENT.routingPolicyId, "worthiness-v6-grounded");
});

test("selecting a policy cannot yield a half-policy", () => {
  for (const policy of Object.values(JUDGMENT_POLICIES)) {
    const zeroAnaphora = Boolean(groundingOptionsFor(policy, BASE).zeroAnaphoraAntecedent);
    const grounded = policy.routingPolicyId === "worthiness-v7-promotion-grounded";
    assert.equal(zeroAnaphora, grounded, `${policy.id} mixes one half with the other's counterpart`);
  }
});

test("a policy may only ADD to the caller's base grounding options", () => {
  const base = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
  const merged = groundingOptionsFor(COUPLED_CANDIDATE_JUDGMENT, base);
  assert.equal(merged.registry, FAMILY_REGISTRY);
  assert.equal(merged.singleChildHousehold, true);
});

// ---------------------------------------------------------------- precision guards, ALL under the
// ---------------------------------------------------------------- coupled policy

test("question guard: an interrogative never becomes a promotable fact", () => {
  const asked = item("会自己站了？");
  const named = item("小年今天很精神。");
  const window = windowOf([named, asked]);
  const verdict = verdictOf(
    [{ statement: "张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(asked)] }],
    AXIS_STRONG_CAPABILITY([ref(asked)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.promotionEligibleFactCount, 0, "a question settles nothing");
  assert.notEqual(coupled.action, "life_event_candidate");
  assert.ok(coupled.gated.zeroed.includes("newCapabilityOrIndependence"), "the strong signal must be zeroed");
});

test("plan/hypothetical guard: an intention never becomes an occurrence", () => {
  const plan = item("明天准备带他去学走路。");
  const window = windowOf([item("小年今天在家。"), plan]);
  const verdict = verdictOf(
    [{ statement: "张小年学会走路了", assertionKind: "raw_fact", evidenceRefs: [ref(plan)] }],
    AXIS_STRONG_CAPABILITY([ref(plan)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.promotionEligibleFactCount, 0);
  assert.notEqual(coupled.action, "life_event_candidate");
});

test("negation/not-yet guard: a not-yet state is never an achievement", () => {
  const notYet = item("小年还不会自己站。");
  const window = windowOf([notYet, item("再等等吧。")]);
  const verdict = verdictOf(
    [{ statement: "张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(notYet)] }],
    AXIS_STRONG_CAPABILITY([ref(notYet)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.promotionEligibleFactCount, 0, "negated polarity must refuse promotion");
  assert.ok(coupled.grounding.claims[0].promotionBlockers.includes("negated_or_not_yet"));
  assert.notEqual(coupled.action, "life_event_candidate");
});

test("competing-person guard: another child in scope fails a subjectless claim closed", () => {
  // The exact shape zero-anaphora could have broken: no name, no pronoun, and a second child
  // present. The antecedent walk must never start.
  const other = item("表姐家的小女孩也来了。");
  const bare = item("已经会自己站了。");
  const named = item("小年今天在客厅玩。");
  const window = windowOf([named, other, bare]);
  const verdict = verdictOf(
    [{ statement: "张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(bare)] }],
    AXIS_STRONG_CAPABILITY([ref(bare)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.claims[0].subject.resolved, false, "a competing person must block the walk");
  assert.ok(coupled.grounding.claims[0].subject.blockers.includes("competing_person_in_scope"));
  assert.equal(coupled.grounding.promotionEligibleFactCount, 0);
  assert.notEqual(coupled.action, "life_event_candidate");
});

test("competing-person guard holds when the other child is only in a NEIGHBOUR message", () => {
  const bare = item("已经会自己走了。");
  const named = item("小年今天在客厅玩。");
  const window = windowOf([named, bare], { before: [item("同学家的孩子来玩")], after: [] });
  const verdict = verdictOf(
    [{ statement: "张小年会自己走了", assertionKind: "raw_fact", evidenceRefs: [ref(bare)] }],
    AXIS_STRONG_CAPABILITY([ref(bare)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.claims[0].subject.resolved, false);
  assert.notEqual(coupled.action, "life_event_candidate");
});

test("other-child protection: a subjectless claim needs an in-window naming, never a bare prior", () => {
  const bare = item("已经会自己站了。");
  const window = windowOf([item("今天天气不错。"), bare]);
  const verdict = verdictOf(
    [{ statement: "张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(bare)] }],
    AXIS_STRONG_CAPABILITY([ref(bare)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.claims[0].subject.resolved, false, "nothing names the child: no antecedent");
  assert.notEqual(coupled.action, "life_event_candidate");
});

test("other-child protection: a first-person span is never attributed to the child", () => {
  const mine = item("我已经会自己做了。");
  const named = item("小年今天在家。");
  const window = windowOf([named, mine]);
  const verdict = verdictOf(
    [{ statement: "张小年会自己做了", assertionKind: "raw_fact", evidenceRefs: [ref(mine)] }],
    AXIS_STRONG_CAPABILITY([ref(mine)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.claims[0].subject.resolved, false);
  assert.ok(coupled.grounding.claims[0].subject.blockers.includes("first_person_span"));
});

test("speculative inner state is never flattened into a fact", () => {
  const guess = item("小年好像是饿了吧。");
  const window = windowOf([guess, item("再喂点试试。")]);
  const verdict = verdictOf(
    [{ statement: "张小年饿了", assertionKind: "raw_fact", evidenceRefs: [ref(guess)] }],
    AXIS_STRONG_CAPABILITY([ref(guess)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.promotionEligibleFactCount, 0, "a hedge must refuse promotion");
  assert.equal(coupled.grounding.claims[0].epistemicStatus, "hedged");
});

test("evidence subset invariant: a claim citing no resolvable span grounds nothing", () => {
  const window = windowOf([item("小年今天在家。"), item("嗯嗯。")]);
  const verdict = verdictOf(
    [{ statement: "张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: ["item:does-not-exist#span-0"] }],
    AXIS_STRONG_CAPABILITY(["item:does-not-exist#span-0"]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.equal(coupled.grounding.claims[0].supportingSpans.length, 0);
  assert.equal(coupled.grounding.promotionEligibleFactCount, 0);
  assert.notEqual(coupled.action, "life_event_candidate");
});

test("novelty protection: a milestone claim with no textual support is capped, not promoted", () => {
  // worthinessDimensions.milestone >= 2 without a supporting raw_fact must be zeroed by the
  // validator (H8) under the coupled policy exactly as under frozen V6.
  const photo = item("[图片]", { mediaRefs: ["m1"] });
  const window = windowOf([item("小年今天在家。"), photo]);
  const verdict = {
    ...verdictOf([{ statement: "张小年第一次自己站起来", assertionKind: "raw_fact", evidenceRefs: [ref(photo)] }], AXIS_STRONG_CAPABILITY([ref(photo)])),
    worthinessDimensions: { milestone: { score: 3, evidenceRefs: [ref(photo)] } },
  };
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.ok(
    coupled.result.reasonCodes.includes("media_binding_too_weak"),
    `expected a weak-media cap, saw: ${coupled.result.reasonCodes.join(",")}`,
  );
});

// ---------------------------------------------------------------- retention independence

test("DailyTrace retention is monotone and independent of promotion eligibility", () => {
  // The same window under both policies: the coupled candidate may add a Memory, never remove a
  // day. This is the RC-25 invariant, restated at the policy level rather than the router level.
  const named = item("小年今天在客厅玩了很久。");
  const window = windowOf([named, item("嗯嗯。")]);
  const verdict = verdictOf(
    [{ statement: "张小年在客厅玩", assertionKind: "attributed_claim", evidenceRefs: [ref(named)] }],
    { ...AXIS_STRONG_CAPABILITY([]), newCapabilityOrIndependence: { score: 0, kind: "none", evidenceRefs: [] }, noDistinctiveMemorySignal: true },
  );
  const rank = { store_only: 0, daily_trace: 1, life_event_candidate: 2 };
  const v6 = route(FROZEN_V6_JUDGMENT, window, verdict);
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.ok(rank[coupled.action] >= rank[v6.action], `coupled policy downgraded ${v6.action} -> ${coupled.action}`);
  assert.equal(coupled.action, "daily_trace", "a real, attributable, ordinary day is kept");
});

test("a day belonging to another child is not retained as a trace under either policy", () => {
  const other = item("表姐家的小女孩今天会自己站了。");
  const window = windowOf([other, item("真厉害。")]);
  const verdict = verdictOf(
    [{ statement: "会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(other)] }],
    { ...AXIS_STRONG_CAPABILITY([ref(other)]), noDistinctiveMemorySignal: true },
  );
  for (const policy of [FROZEN_V6_JUDGMENT, COUPLED_CANDIDATE_JUDGMENT]) {
    const routed = route(policy, window, verdict);
    assert.equal(routed.grounding.traceEvidenceCount, 0, `${policy.id}: another child's day is not 张年's trace`);
  }
});

// ---------------------------------------------------------------- no per-case special casing

test("no case is exempted: the embedded-interrogative guard still applies under the coupled policy", () => {
  // The guard that keeps RC-08 a miss. It must remain a general rule, not something the coupled
  // policy quietly steps around.
  const embedded = item("看一下他有没有自己站起来。");
  const named = item("小年今天在客厅。");
  const window = windowOf([named, embedded]);
  const verdict = verdictOf(
    [{ statement: "张小年自己站起来了", assertionKind: "raw_fact", evidenceRefs: [ref(embedded)] }],
    AXIS_STRONG_CAPABILITY([ref(embedded)]),
  );
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);
  assert.ok(
    coupled.grounding.claims[0].promotionBlockers.includes("unsettled_proposition"),
    `expected the embedded-interrogative guard, saw: ${coupled.grounding.claims[0].promotionBlockers.join(",")}`,
  );
  assert.equal(coupled.grounding.promotionEligibleFactCount, 0);
});

test("the coupled policy promotes on grounded evidence alone, with no case-specific rule", () => {
  // The positive control: a subjectless span in a window that names the child, a settled
  // affirmative assertion by a known caregiver. This is what the candidate is FOR, and it must work
  // from the general rule rather than from anything resembling a corpus phrase.
  const named = item("小年今天特别有精神。");
  const bare = item("已经会自己站起来了。");
  const window = windowOf([named, bare]);
  const verdict = verdictOf(
    [{ statement: "张小年会自己站起来了", assertionKind: "attributed_claim", evidenceRefs: [ref(bare)] }],
    AXIS_STRONG_CAPABILITY([ref(bare)]),
  );
  const v6 = route(FROZEN_V6_JUDGMENT, window, verdict);
  const coupled = route(COUPLED_CANDIDATE_JUDGMENT, window, verdict);

  assert.equal(v6.grounding.claims[0].subject.resolved, false, "frozen V6 stops at the missing reference");
  assert.notEqual(v6.action, "life_event_candidate");

  assert.equal(coupled.grounding.claims[0].subject.basis, "antecedent_in_window_zero_anaphora");
  assert.equal(coupled.grounding.promotionEligibleFactCount, 1);
  assert.equal(coupled.action, "life_event_candidate");
});
