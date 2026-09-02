import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSpan, normalizeSpanText } from "../lib/organizer/speech-act.ts";
import { groundClaims, applyGroundingToAxis, resolveClaimSubject, CLAIM_GROUNDING_VERSION } from "../lib/organizer/claim-grounding.ts";
import { createV6RoutingPolicy, V6_ROUTING_POLICY_ID } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };

// Synthetic windows only. Holdout V2 is spent and is deliberately not used as a fixture source
// here; these encode the failure MODES it exposed, written from scratch.
let seq = 0;
function item(text, opts = {}) {
  seq += 1;
  const id = `item:${String(seq).padStart(24, "0")}`;
  // One span per sentence-ish chunk, mirroring evidence/window.ts spans().
  const parts = text.split(/(?<=[。！？!?\n])/u).filter((p) => p.trim());
  const spans = [];
  let cursor = 0;
  (parts.length ? parts : [text]).forEach((part, index) => {
    spans.push({ id: `span-${index}`, start: cursor, end: cursor + part.length });
    cursor += part.length;
  });
  return {
    itemId: id, sourceId: opts.sourceId ?? `src-${seq}`, sentAt: "2026-03-01T10:00:00.000Z",
    senderRole: opts.senderRole ?? "speaker-a", senderDigest: opts.senderDigest ?? "digest-a",
    text, contentTypes: ["daily"], mediaRefs: [], locator: { document: "d", recordOrdinal: seq },
    spans, tier: "firsthand_observation",
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

function verdictOf(coreFacts, axisOverrides = {}) {
  const dim = (score, evidenceRefs = []) => ({ score, evidenceRefs });
  return {
    windowId: "window:test", subjectRelevance: "primary", subjectIds: [], temporalStatus: "past",
    occurredAtProposal: { value: "2026-03-01", basis: "sent_at", evidenceRefs: [] },
    coreFacts, quotableLines: [], worthinessDimensions: {}, duplicateCandidates: [],
    uncertainty: { time: "low", subject: "low", semantics: "low" }, sensitivityFlags: [],
    prohibitedInferences: [], proposedAction: "life_event_candidate", selectionReason: "t", confidence: 0.9,
    worthinessAxis: {
      developmentalTransition: { score: 0, basis: "unknown", evidenceRefs: [] },
      newCapabilityOrIndependence: { score: 0, kind: "none", evidenceRefs: [] },
      distinctiveFamilyMoment: dim(0), relationshipSignificance: dim(0), futureRecallValue: dim(0),
      noDistinctiveMemorySignal: false, ...axisOverrides,
    },
  };
}

// ---- speech act -------------------------------------------------------------------------------

test("an interrogative is a question, not an assertion, whatever it is about", () => {
  for (const text of ["会自己站了？", "他会走了吗", "是不是会说话了", "他能自己吃饭吗？", "会不会翻身了"]) {
    assert.equal(analyzeSpan(text).speechAct, "question", text);
  }
});

test("a plain capability report is an assertion", () => {
  for (const text of ["他会自己站了", "张小年会喊妈妈了", "小年宝贝会走路了", "他现在手控制的很灵了"]) {
    assert.equal(analyzeSpan(text).speechAct, "assertion", text);
  }
});

test("backchannels carry no proposition of their own", () => {
  for (const text of ["真的", "对", "对啊", "嗯嗯", "好的", "可以可以", "哈哈哈哈", "没错"]) {
    assert.equal(analyzeSpan(text).contentBearing, false, text);
  }
  assert.equal(analyzeSpan("他真的会走了").contentBearing, true);
});

test("not-yet and negation set polarity, and stay assertions", () => {
  const notYet = analyzeSpan("小年不会自主入睡，还需要老师抱哄睡");
  assert.equal(notYet.speechAct, "assertion");
  assert.equal(notYet.polarity, "negated");
  assert.equal(analyzeSpan("他还不会走路").polarity, "negated");
});

test("plans and hypotheticals are not observed states", () => {
  for (const text of ["明天带他去打疫苗", "打算下周开始加辅食", "等他会说话了再买", "我感觉他离睡整觉不远了"]) {
    assert.equal(analyzeSpan(text).speechAct, "plan_or_hypothetical", text);
  }
});

test("exporter escaping and sticker tokens are stripped before analysis", () => {
  assert.equal(normalizeSpanText("特别喝奶的时候\\[发怒\\]\\[发怒\\]\n"), "特别喝奶的时候");
  assert.equal(analyzeSpan("\\[表情包\\]").contentBearing, false);
});

// ---- the confirmed HV2-N03 failure mode ---------------------------------------------------------

test("a question about a capability plus a backchannel cannot ground a capability signal", () => {
  const a = item("雪姨早，张小年有个好消息给你\n");
  const q = item("会自己站了？\n");
  const yes = item("真的\n");
  const w = windowOf([a, q, yes]);
  const verdict = verdictOf(
    [{ statement: "家人说张小年会自己站了", assertionKind: "attributed_claim", claimant: "家人", evidenceRefs: [ref(q), ref(yes)] }],
    { newCapabilityOrIndependence: { score: 2, kind: "developmental_ability", evidenceRefs: [ref(q), ref(yes)] } },
  );
  const grounding = groundClaims(w, verdict, SUBJECT, OPTS);

  assert.equal(grounding.claims[0].assertionStatus, "question");
  assert.equal(grounding.claims[0].mayContributeToWorthiness, false);
  assert.equal(grounding.claims[0].mayGroundDevelopmentalSignal, false);
  assert.equal(grounding.promotableGroundedFactCount, 0);

  const gated = applyGroundingToAxis(verdict.worthinessAxis, grounding);
  assert.equal(gated.axis.newCapabilityOrIndependence.score, 0, "the strong signal must not survive grounding");
  assert.ok(gated.zeroed.includes("newCapabilityOrIndependence"));
  assert.ok(gated.reasonCodes.includes("ungrounded_capability"));
});

test("the same window still routes to something safe rather than failing open", () => {
  const q = item("会自己站了？\n");
  const yes = item("真的\n");
  const w = windowOf([item("张小年有个好消息给你\n"), q, yes]);
  const verdict = verdictOf(
    [{ statement: "家人说张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(q), ref(yes)] }],
    { newCapabilityOrIndependence: { score: 2, kind: "developmental_ability", evidenceRefs: [ref(q)] } },
  );
  const grounding = groundClaims(w, verdict, SUBJECT, OPTS);
  const policy = createV6RoutingPolicy(() => ({
    worthiness: verdict.worthinessAxis,
    evidence: { subjectConfidence: "high", evidenceConfidence: "high", attributionConfidence: "high", firsthandOrReported: "firsthand", corroboratingSpeakers: 2 },
    subjectResolution: "explicit",
    grounding,
  }));
  const result = validate(w, verdict, {
    now: "2026-03-02T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0,
    routingPolicy: policy, expectedRoutingPolicyId: V6_ROUTING_POLICY_ID,
  });
  assert.notEqual(result.outcome.action, "life_event_candidate");
});

// ---- claim-level subject resolution -------------------------------------------------------------

test("an explicit name in the claim's own span resolves it, even with another child in the window", () => {
  const named = item("小年宝贝会走路了\n");
  const other = item("就是这个小女孩，比张小年大40多天\n");
  const w = windowOf([named, other]);
  const subject = resolveClaimSubject(w, [{ ref: ref(named), sourceId: named.sourceId, itemId: named.itemId, text: "小年宝贝会走路了\n", speechAct: "assertion", polarity: "affirmative", contentBearing: true, markers: [], speakerDigest: "d", speaker: { known: false } }], SUBJECT, OPTS);
  assert.equal(subject.resolved, true);
  assert.equal(subject.basis, "explicit_in_span");
});

test("another child in the window blocks a PRONOUN-only claim from inheriting the subject", () => {
  const pronoun = item("他会自己站了\n");
  const other = item("就是这个小女孩\n");
  const w = windowOf([item("张小年今天很开心\n"), pronoun, other]);
  const grounding = groundClaims(w, verdictOf([
    { statement: "他会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(pronoun)] },
  ]), SUBJECT, OPTS);
  assert.equal(grounding.claims[0].subject.resolved, false);
  assert.equal(grounding.claims[0].subject.basis, "unresolved_competing_person");
  assert.equal(grounding.claims[0].mayContributeToWorthiness, false);
});

test("a comparative to the subject is itself a competing referent", () => {
  const pronoun = item("他会自己站了\n");
  const w = windowOf([item("张小年今天很开心\n"), pronoun, item("比张小年大40多天\n")]);
  const grounding = groundClaims(w, verdictOf([
    { statement: "他会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(pronoun)] },
  ]), SUBJECT, OPTS);
  assert.equal(grounding.claims[0].subject.basis, "unresolved_competing_person");
});

test("a pronoun-only claim RESOLVES through a bounded antecedent when no one competes", () => {
  const antecedent = item("张小年今天特别精神\n");
  const claim = item("他现在手控制的很灵了\n");
  const w = windowOf([antecedent, claim]);
  const verdict = verdictOf(
    [{ statement: "他现在手控制得很灵", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] }],
    { newCapabilityOrIndependence: { score: 2, kind: "developmental_ability", evidenceRefs: [ref(claim)] } },
  );
  const grounding = groundClaims(w, verdict, SUBJECT, OPTS);
  assert.equal(grounding.claims[0].subject.resolved, true, "a supported pronoun claim must not be refused");
  assert.equal(grounding.claims[0].subject.basis, "antecedent_in_window");
  assert.equal(grounding.claims[0].mayGroundDevelopmentalSignal, true);
  assert.equal(grounding.promotableGroundedFactCount, 1);
  const gated = applyGroundingToAxis(verdict.worthinessAxis, grounding);
  assert.equal(gated.axis.newCapabilityOrIndependence.score, 2, "a genuine grounded capability must survive");
  assert.deepEqual(gated.zeroed, []);
});

test("a pronoun with no antecedent anywhere fails closed", () => {
  const claim = item("他现在手控制的很灵了\n");
  const w = windowOf([item("今天天气不错\n"), claim]);
  const grounding = groundClaims(w, verdictOf([
    { statement: "他手控制得很灵", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] },
  ]), SUBJECT, OPTS);
  assert.equal(grounding.claims[0].subject.resolved, false);
  assert.equal(grounding.claims[0].subject.basis, "unresolved_no_antecedent");
});

test("a claim with no person reference at all is unresolved, not defaulted to the child", () => {
  const claim = item("嫦娥姐姐从陕西给我们寄来一箱黄桃\n");
  const w = windowOf([claim]);
  const grounding = groundClaims(w, verdictOf([
    { statement: "家人收到一箱黄桃", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] },
  ]), SUBJECT, OPTS);
  assert.equal(grounding.claims[0].subject.resolved, false);
  assert.equal(grounding.claims[0].subject.basis, "unresolved_no_reference");
});

// ---- polarity and irrealis ----------------------------------------------------------------------

test("a not-yet state stays a fact but cannot ground a capability", () => {
  const claim = item("小年不会自主入睡，还需要老师抱哄睡\n");
  const w = windowOf([claim]);
  const verdict = verdictOf(
    [{ statement: "小年不会自主入睡", assertionKind: "attributed_claim", claimant: "老师", evidenceRefs: [ref(claim)] }],
    { newCapabilityOrIndependence: { score: 2, kind: "developmental_ability", evidenceRefs: [ref(claim)] } },
  );
  const grounding = groundClaims(w, verdict, SUBJECT, OPTS);
  assert.equal(grounding.claims[0].assertionStatus, "supported_assertion");
  assert.equal(grounding.claims[0].polarity, "negated");
  assert.equal(grounding.claims[0].mayContributeToWorthiness, true, "it is still a real fact");
  assert.equal(grounding.claims[0].mayGroundDevelopmentalSignal, false, "but not an acquired ability");
  assert.equal(applyGroundingToAxis(verdict.worthinessAxis, grounding).axis.newCapabilityOrIndependence.score, 0);
});

test("planned behaviour does not become an occurred capability", () => {
  const claim = item("等他会说话了再买\n");
  const w = windowOf([item("张小年在旁边玩\n"), claim]);
  const verdict = verdictOf(
    [{ statement: "家人讨论等他会说话后再买", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] }],
    { newCapabilityOrIndependence: { score: 2, kind: "developmental_ability", evidenceRefs: [ref(claim)] } },
  );
  const grounding = groundClaims(w, verdict, SUBJECT, OPTS);
  assert.equal(grounding.claims[0].assertionStatus, "plan_or_hypothetical");
  assert.equal(grounding.claims[0].observationMode, "plan_or_hypothetical");
  assert.equal(applyGroundingToAxis(verdict.worthinessAxis, grounding).axis.newCapabilityOrIndependence.score, 0);
});

// ---- auditability -------------------------------------------------------------------------------

test("every grounded claim carries the full auditable record", () => {
  const antecedent = item("张小年今天很好\n");
  const claim = item("他会自己坐了\n", { senderDigest: senderDigestForDisplayName("Ted") });
  const w = windowOf([antecedent, claim]);
  const g = groundClaims(w, verdictOf([
    { statement: "他会自己坐了", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] },
  ]), SUBJECT, OPTS).claims[0];

  assert.equal(g.text, "他会自己坐了");
  assert.deepEqual(g.sourceIds, [claim.sourceId]);
  assert.deepEqual(g.evidenceRefs, [ref(claim)]);
  assert.equal(g.supportingSpans[0].text, "他会自己坐了\n");
  assert.equal(g.speakers[0].relationshipToSubject, "father", "speaker identity when known");
  assert.equal(g.subject.subjectId, "profile-zhangnian");
  assert.equal(g.subject.basis, "antecedent_in_window");
  assert.equal(g.assertionStatus, "supported_assertion");
  assert.equal(g.polarity, "affirmative");
  assert.equal(g.observationMode, "observed_firsthand");
  assert.ok(Array.isArray(g.reasons));
  assert.equal(CLAIM_GROUNDING_VERSION, "claim-grounding-v1");
});

test("grounding never invents a ref: an unresolvable ref yields no span and no contribution", () => {
  const claim = item("他会自己坐了\n");
  const w = windowOf([item("张小年今天很好\n"), claim]);
  const g = groundClaims(w, verdictOf([
    { statement: "凭空的说法", assertionKind: "raw_fact", evidenceRefs: ["item:doesnotexist#span-0"] },
  ]), SUBJECT, OPTS).claims[0];
  assert.equal(g.supportingSpans.length, 0);
  assert.equal(g.assertionStatus, "unsupported");
  assert.equal(g.mayContributeToWorthiness, false);
});

// ---- validator integration: a non-assertion never becomes an emitted fact ----------------------

test("without grounding the validator is byte-identical to before (frozen v5 path unaffected)", () => {
  const q = item("会自己站了？\n");
  const w = windowOf([item("张小年有个好消息\n"), q]);
  const verdict = verdictOf([{ statement: "家人说张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(q)] }]);
  const ctx = { now: "2026-03-02T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0 };
  const before = validate(w, verdict, ctx);
  // The frozen path never inspects speech act, so it raises no grounding reason code at all.
  assert.ok(!before.reasonCodes.some((c) => c.startsWith("claim_not_an_assertion")));
  // And the same call WITH grounding is the only thing that changes the result.
  const withGrounding = validate(w, verdict, { ...ctx, claimGrounding: groundClaims(w, verdict, SUBJECT, OPTS) });
  assert.ok(withGrounding.reasonCodes.some((c) => c.startsWith("claim_not_an_assertion")));
});

test("with grounding, a question-derived claim is dropped from the emitted facts", () => {
  const q = item("会自己站了？\n");
  const w = windowOf([item("张小年有个好消息\n"), q]);
  const verdict = verdictOf([{ statement: "家人说张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(q)] }]);
  const g = groundClaims(w, verdict, SUBJECT, OPTS);
  const after = validate(w, verdict, { now: "2026-03-02T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0, claimGrounding: g });
  const emitted = JSON.stringify(after.outcome.traceLines ?? after.outcome.coreFacts ?? []);
  assert.ok(!emitted.includes("会自己站了"), "a question must not become an occurred fact");
  assert.ok(after.reasonCodes.some((c) => c.startsWith("claim_not_an_assertion")));
});

test("with grounding, a genuine asserted fact still survives", () => {
  const a = item("张小年会喊妈妈了\n");
  const w = windowOf([a]);
  const verdict = verdictOf([{ statement: "张小年会喊妈妈了", assertionKind: "raw_fact", evidenceRefs: [ref(a)] }]);
  const g = groundClaims(w, verdict, SUBJECT, OPTS);
  const after = validate(w, verdict, { now: "2026-03-02T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0, claimGrounding: g });
  assert.ok(!after.reasonCodes.some((c) => c.startsWith("claim_not_an_assertion")), "a real assertion must not be dropped");
  assert.equal(g.promotableGroundedFactCount, 1);
});

test("a negated fact is kept as a fact — it is real, it is just not an acquired ability", () => {
  const a = item("小年不会自主入睡\n");
  const w = windowOf([a]);
  const verdict = verdictOf([{ statement: "小年不会自主入睡", assertionKind: "raw_fact", evidenceRefs: [ref(a)] }]);
  const g = groundClaims(w, verdict, SUBJECT, OPTS);
  assert.equal(g.claims[0].assertionStatus, "supported_assertion");
  assert.equal(g.claims[0].polarity, "negated");
  const after = validate(w, verdict, { now: "2026-03-02T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0, claimGrounding: g });
  // The precise property: grounding did NOT drop it. (What the v1 router then does with an
  // all-zero axis is a separate concern and not what this test is about.)
  assert.ok(!after.reasonCodes.some((c) => c.startsWith("claim_not_an_assertion")), "a negated assertion is still an assertion");
});

// ---- corrections found on the shadow corpus -----------------------------------------------------

test("an embedded indirect question is a report, not a question", () => {
  // 「看一下你有没有哄他」 REPORTS what the child checks for; it asks nothing.
  const embedded = analyzeSpan("一边哭，一边睁开眼睛看一下你有没有哄他");
  assert.equal(embedded.speechAct, "assertion");
  assert.ok(embedded.markers.includes("embedded_a_not_a"));
  // The matrix form is still a question.
  assert.equal(analyzeSpan("你有没有哄他").speechAct, "question");
  // And a terminal question mark always wins, embedded verb or not.
  assert.equal(analyzeSpan("我看看他会不会站？").speechAct, "question");
});

test("sentence-final 吧 is a suggestion, not a question", () => {
  assert.equal(analyzeSpan("还是打疫苗吧").speechAct, "assertion");
  assert.equal(analyzeSpan("我们明天去吧").speechAct, "plan_or_hypothetical");
  // The confirmation tags remain questions.
  assert.equal(analyzeSpan("他会走了对吧").speechAct, "question");
  assert.equal(analyzeSpan("他会走了吗").speechAct, "question");
});

test("a pronoun claim resolves anywhere in the episode the child is named, not only within N messages", () => {
  const named = item("张小年今天状态很好\n");
  const filler = Array.from({ length: 12 }, (_, i) => item(`闲聊${i}\n`));
  const claim = item("我又把高度调高了，他现在离活得太吓人\n");
  const w = windowOf([named, ...filler, claim]);
  const g = groundClaims(w, verdictOf([
    { statement: "家人把婴儿床调高", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] },
  ]), SUBJECT, OPTS);
  assert.equal(g.claims[0].subject.resolved, true, "the episode is the bound; an arbitrary window inside it is not");
  assert.equal(g.claims[0].subject.basis, "antecedent_in_window");
});

test("widening the antecedent scope did NOT reopen the competing-person hole", () => {
  const named = item("张小年今天状态很好\n");
  const filler = Array.from({ length: 12 }, (_, i) => item(`闲聊${i}\n`));
  const other = item("就是这个小女孩，比张小年大40多天\n");
  const claim = item("他会自己站了\n");
  const w = windowOf([named, ...filler, other, claim]);
  const g = groundClaims(w, verdictOf([
    { statement: "他会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] },
  ]), SUBJECT, OPTS);
  assert.equal(g.claims[0].subject.basis, "unresolved_competing_person");
  assert.equal(g.claims[0].mayGroundDevelopmentalSignal, false);
});

test("an A-not-A frame is not propositional negation, and cannot establish an ability either", () => {
  const s = analyzeSpan("一边哭，一边睁开眼睛看一下你有没有哄他");
  assert.equal(s.speechAct, "assertion", "embedded, so it reports rather than asks");
  assert.equal(s.polarity, "affirmative", "the 没有 in 有没有 is grammar, not a claim that nothing happened");

  // But the embedded proposition is unsettled, so it must not be the evidence for an ability.
  const claim = item("一边哭，一边睁开眼睛看一下你有没有哄他\n");
  const w = windowOf([item("张小年今天有点闹\n"), claim]);
  const verdict = verdictOf(
    [{ statement: "张年会观察有没有人哄他", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] }],
    { newCapabilityOrIndependence: { score: 2, kind: "developmental_ability", evidenceRefs: [ref(claim)] } },
  );
  const g = groundClaims(w, verdict, SUBJECT, OPTS);
  assert.equal(g.claims[0].assertionStatus, "supported_assertion");
  assert.equal(g.claims[0].mayContributeToWorthiness, true, "it is a real report");
  assert.equal(g.claims[0].mayGroundDevelopmentalSignal, false, "but its embedded proposition is open");
  assert.equal(applyGroundingToAxis(verdict.worthinessAxis, g).axis.newCapabilityOrIndependence.score, 0);
});

test("a plainly asserted ability is unaffected by the embedded-interrogative rule", () => {
  const claim = item("张小年会喊妈妈了\n");
  const w = windowOf([claim]);
  const verdict = verdictOf(
    [{ statement: "张小年会喊妈妈了", assertionKind: "raw_fact", evidenceRefs: [ref(claim)] }],
    { newCapabilityOrIndependence: { score: 3, kind: "developmental_ability", evidenceRefs: [ref(claim)] } },
  );
  const g = groundClaims(w, verdict, SUBJECT, OPTS);
  assert.equal(g.claims[0].mayGroundDevelopmentalSignal, true);
  assert.equal(applyGroundingToAxis(verdict.worthinessAxis, g).axis.newCapabilityOrIndependence.score, 3);
});
