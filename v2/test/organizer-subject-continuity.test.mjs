// Regression cases for bounded same-conversation subject continuity (Decision 1, 2026-09-03).
// Synthetic conversations only; no spent calibration material is reused here.
import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceWindows, windowFingerprint } from "../lib/organizer/evidence/window.ts";
import { attachContinuityContext, resolveByConversationContinuity, firstPronounItem, SUBJECT_CONTINUITY_VERSION } from "../lib/organizer/subject-continuity.ts";
import { groundClaims, resolveClaimSubject } from "../lib/organizer/claim-grounding.ts";
import { resolveSubjectBounded } from "../lib/organizer/subject-resolver.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"], profileId: "profile-zhangnian" };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const MOTHER = senderDigestForDisplayName("阿静");
const FATHER = senderDigestForDisplayName("Ted");
const NANNY = senderDigestForDisplayName("hxx\\.");
const STRANGER = "0000000000000000000000000000000000000000000000000000000000000000";

const DAY = "2025-08-10";
const at = (hhmm) => `${DAY}T${hhmm}:00+08:00`;
let seq = 0;
const msg = (time, text, sender = MOTHER) => {
  seq += 1;
  const id = `src-${String(seq).padStart(3, "0")}`;
  return { id, profileId: "profile-zhangnian", sourceType: "wechat", contentTypes: ["family"], contributorId: "contributor-system", capturedAt: at(time), text, mediaIds: [], visibility: "family", metadata: { senderDigest: sender }, sourceLabel: "conv" };
};

// Nine care-topic messages after the antecedent, so the antecedent sits ten messages before the
// anchor window — past the frozen resolvers' ±5 neighbour bound but inside continuity's.
const filler = (start = 1) => [
  msg(`10:0${start}`, "他喝了180奶"), msg("10:02", "睡了四十分钟", NANNY), msg("10:03", "醒了在玩"), msg("10:04", "换了尿不湿", NANNY),
  msg("10:05", "好"), msg("10:06", "嗯嗯", FATHER), msg("10:07", "等会带他出去", NANNY), msg("10:08", "推车推出去"), msg("10:09", "行", FATHER),
];
const antecedent = () => msg("10:00", "张小年今天早上六点就醒了");
const anchorPair = () => [msg("11:00", "他现在好想站起来啊"), msg("11:02", "各种扶墙站，手一撑，然后就起来了", FATHER)];

function lastWindow(sources, { withContext = true } = {}) {
  const windows = buildEvidenceWindows("conv", "profile-zhangnian", sources, { dailyTraces: [], lifeEvents: [] });
  const prepared = withContext ? attachContinuityContext(windows) : windows;
  return prepared[prepared.length - 1];
}
const spanRef = (window, sourceId, span = 0) => `${window.items.find((i) => i.sourceId === sourceId).itemId}#span-${span}`;
function verdictOf(window, statements) {
  return {
    windowId: window.windowId, subjectRelevance: "primary", subjectIds: [], temporalStatus: "past",
    occurredAtProposal: { value: DAY, basis: "sent_at", evidenceRefs: [] },
    coreFacts: statements.map(([statement, sourceId]) => ({ statement, assertionKind: "raw_fact", evidenceRefs: [spanRef(window, sourceId)] })),
    quotableLines: [], worthinessDimensions: {}, duplicateCandidates: [],
    uncertainty: { time: "low", subject: "low", semantics: "low" }, sensitivityFlags: [], prohibitedInferences: [],
    proposedAction: "life_event_candidate", selectionReason: "t", confidence: 0.9,
  };
}
const claimSubject = (window, sourceId) => groundClaims(window, verdictOf(window, [["x", sourceId]]), SUBJECT, OPTS).claims[0].subject;
const anchorId = (window) => window.items.find((i) => i.text.includes("站起来")).sourceId;

test("attaching continuity context changes neither window ids nor fingerprints", () => {
  seq = 0;
  const sources = [antecedent(), ...filler(), ...anchorPair()];
  const plain = buildEvidenceWindows("conv", "profile-zhangnian", sources, { dailyTraces: [], lifeEvents: [] });
  const withContext = attachContinuityContext(plain);
  const versions = { policyVersion: "p", promptVersion: "q", modelVersion: "m" };
  withContext.forEach((window, index) => {
    assert.equal(window.windowId, plain[index].windowId);
    assert.equal(windowFingerprint(window, versions, new Map()), windowFingerprint(plain[index], versions, new Map()));
    assert.equal(window.continuity.version, SUBJECT_CONTINUITY_VERSION);
  });
  assert.equal(withContext[0].continuity.priorItems.length, 0);
  assert.equal(withContext[1].continuity.priorItems.length, 10, "prior context holds the whole earlier episode");
});

test("frozen path: without continuity context the claim stays unresolved exactly as before", () => {
  seq = 0;
  const w = lastWindow([antecedent(), ...filler(), ...anchorPair()], { withContext: false });
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_no_antecedent");
  assert.deepEqual(subject.blockers, ["no_explicit_antecedent"]);
  assert.equal(subject.continuity, undefined);
  const gate = resolveSubjectBounded(w, SUBJECT, OPTS);
  assert.equal(gate.level, "unresolved");
  assert.deepEqual(gate.blockers, ["no_explicit_antecedent"]);
  assert.equal(gate.continuity, undefined);
});

test("1. explicit 张年 → 他 continuation resolves with a full, auditable evidence record", () => {
  seq = 0;
  const w = lastWindow([antecedent(), ...filler(), ...anchorPair()]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, true);
  assert.equal(subject.basis, "conversation_continuity");
  assert.equal(subject.subjectId, "profile-zhangnian");
  assert.deepEqual(subject.supportingSourceIds, ["src-001"]);
  const e = subject.continuity;
  assert.equal(e.basis, "conversation_continuity");
  assert.deepEqual(e.antecedentSourceIds, ["src-001"]);
  assert.equal(e.antecedentSpan.sourceId, "src-001");
  assert.match(e.antecedentSpan.ref, /#span-0$/);
  assert.deepEqual(e.antecedentDistance, { messages: 10, minutes: 60 });
  assert.deepEqual(e.competingSubjectIds, []);
  assert.equal(e.continuityReason, "bounded_child_topic_chain");
  assert.ok(e.chainSpeakerIds.includes("person-sujing") && e.chainSpeakerIds.includes("person-xueyi"));

  const gate = resolveSubjectBounded(w, SUBJECT, OPTS);
  assert.equal(gate.level, "contextually_resolved");
  assert.ok(gate.signals.includes("conversation_continuity"));
  assert.deepEqual(gate.supportingSourceIds, ["src-001"]);
});

test("2. several consecutive pronoun claims share the same antecedent", () => {
  seq = 0;
  const w = lastWindow([antecedent(), ...filler(), ...anchorPair(), msg("11:03", "他扶着沙发站了好一会"), msg("11:04", "他还想往前走", NANNY)]);
  const verdict = verdictOf(w, [["a", w.items[0].sourceId], ["b", w.items[2].sourceId], ["c", w.items[3].sourceId]]);
  const { claims, traceEvidenceCount, promotableGroundedFactCount } = groundClaims(w, verdict, SUBJECT, OPTS);
  for (const claim of claims) {
    assert.equal(claim.subject.basis, "conversation_continuity");
    assert.deepEqual(claim.subject.continuity.antecedentSourceIds, ["src-001"]);
  }
  assert.equal(traceEvidenceCount, 3);
  assert.equal(promotableGroundedFactCount, 3);
});

test("3. a topic switch between the antecedent and the pronoun breaks the chain", () => {
  seq = 0;
  const logistics = ["晚上吃什么", "外卖吧", "那家川菜", "太辣了", "换一家", "行", "几点", "七点", "订好了"].map((text, i) => msg(`10:1${i}`, text, i % 2 ? FATHER : MOTHER));
  const w = lastWindow([antecedent(), ...logistics, msg("11:10", "他现在好想站起来啊"), msg("11:12", "各种扶墙站，手一撑，然后就起来了", FATHER)]);
  const subject = claimSubject(w, anchorId(w));
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_no_antecedent");
  assert.ok(subject.continuity.blockers.includes("topic_discontinuity"));
});

test("4. another child introduced in between makes the pronoun ambiguous", () => {
  seq = 0;
  const f = filler();
  f[1] = msg("10:02", "表妹也一起来了");
  const w = lastWindow([antecedent(), ...f, ...anchorPair()]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_competing_person");
  assert.deepEqual(subject.continuity.competingSubjectIds, ["child:unverified"]);
});

test("5. an adult mentioned in the third person in between is a competing referent", () => {
  seq = 0;
  const f = filler();
  f[1] = msg("10:02", "爸爸今晚要加班");
  const w = lastWindow([antecedent(), ...f, ...anchorPair()]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_competing_person");
  assert.deepEqual(subject.continuity.competingSubjectIds, ["person-ted"]);
});

test("5b. a speaker's own role noun is not a competitor (妈妈 written by the mother)", () => {
  seq = 0;
  const f = filler();
  f[1] = msg("10:02", "妈妈等会回来抱他");
  const w = lastWindow([antecedent(), ...f, ...anchorPair()]);
  assert.equal(claimSubject(w, w.items[0].sourceId).basis, "conversation_continuity");
});

test("6. caregiver discussion: 她 next to 雪姨 is about the caregiver, never the child", () => {
  seq = 0;
  const w = lastWindow([antecedent(), ...filler(), msg("11:00", "雪姨明天几点来，她坐地铁吗")]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_competing_person");
  assert.deepEqual(subject.continuity.competingSubjectIds, ["person-xueyi"]);
  assert.ok(subject.continuity.blockers.includes("competing_person_in_anchor"));
});

test("7. a stale antecedent beyond the time bound does not resolve", () => {
  seq = 0;
  const early = msg("07:30", "张小年今天早上六点就醒了");
  const bridge = ["他喝了180奶", "睡了一会", "醒了在玩", "换了尿不湿", "推车推出去"].map((text, i) => msg(`10:0${i + 5}`, text));
  const w = lastWindow([early, ...bridge, ...anchorPair()]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, false);
  assert.ok(subject.continuity.blockers.includes("antecedent_out_of_bounds"));
});

test("7b. a stale antecedent beyond the message bound does not resolve", () => {
  seq = 0;
  const many = Array.from({ length: 65 }, (_, i) => msg(`10:${String(10 + Math.floor(i / 5)).padStart(2, "0")}`, i % 2 ? "他还在玩" : "醒着呢", i % 3 ? MOTHER : NANNY));
  const w = lastWindow([antecedent(), ...many, ...anchorPair()]);
  const subject = claimSubject(w, anchorId(w));
  assert.equal(subject.resolved, false);
  assert.ok(subject.continuity.blockers.includes("antecedent_out_of_bounds"));
});

test("8. mixed speakers: an unverified anchor speaker or antecedent speaker fails closed", () => {
  seq = 0;
  const w1 = lastWindow([antecedent(), ...filler(), msg("11:00", "他现在好想站起来啊", STRANGER)]);
  assert.ok(claimSubject(w1, w1.items[0].sourceId).continuity.blockers.includes("anchor_speaker_unverified"));
  seq = 0;
  const w2 = lastWindow([msg("10:00", "张小年今天早上六点就醒了", STRANGER), ...filler(), ...anchorPair()]);
  assert.ok(claimSubject(w2, w2.items[0].sourceId).continuity.blockers.includes("antecedent_speaker_unverified"));
  // An unverified speaker merely inside the chain is a link, not a break.
  seq = 0;
  const f = filler();
  f[2] = msg("10:03", "醒了在玩", STRANGER);
  const w3 = lastWindow([antecedent(), ...f, ...anchorPair()]);
  assert.equal(claimSubject(w3, w3.items[0].sourceId).basis, "conversation_continuity");
});

test("9. an explicit subject in the claim's own span wins over any continuity verdict", () => {
  seq = 0;
  const f = filler();
  f[1] = msg("10:02", "表妹也一起来了");
  const w = lastWindow([antecedent(), ...f, msg("11:00", "小年现在好想站起来啊")]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.basis, "explicit_in_span");
  assert.equal(subject.continuity, undefined);
});

test("10. no antecedent anywhere in bounds stays unresolved", () => {
  seq = 0;
  const w = lastWindow([msg("10:00", "今天醒得早"), ...filler(), ...anchorPair()]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_no_antecedent");
  assert.ok(subject.continuity.blockers.includes("no_antecedent_in_bounds"));
});

test("10b. an antecedent without any child-care corroboration is not enough", () => {
  seq = 0;
  const w = lastWindow([msg("10:00", "张小年的快递到了"), msg("10:05", "好"), msg("10:06", "嗯", FATHER), msg("10:07", "收到"), msg("10:08", "行"), msg("10:09", "ok", FATHER), msg("10:10", "好的"), msg("11:00", "他到了没有")]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.resolved, false);
  assert.ok(subject.continuity.blockers.includes("antecedent_without_corroboration"));
});

// Found in the 2026-09-03 continuity shadow: an article title 「五个月半的宝宝从床上掉下去」 shared
// as a link was the nearest "naming" of the child above a pronoun. 宝宝 in a link title is somebody
// else's baby, and a quoted reply is not the family speaking either.
test("10c. a link title or a quoted reply that contains an alias is not an antecedent", () => {
  seq = 0;
  const link = lastWindow([msg("10:00", "\\[链接\\]五个月半的宝宝从床上掉下去"), ...filler(), ...anchorPair()]);
  const viaLink = claimSubject(link, anchorId(link));
  assert.equal(viaLink.resolved, false);
  assert.ok(viaLink.continuity.blockers.includes("no_antecedent_in_bounds"), viaLink.continuity.blockers.join(","));

  seq = 0;
  const quoted = lastWindow([msg("10:00", "> 阿静: 宝宝今天怎么样\n\n还行"), ...filler(), ...anchorPair()]);
  const viaQuote = claimSubject(quoted, anchorId(quoted));
  assert.equal(viaQuote.resolved, false);

  // The same alias in the family's own words still counts.
  seq = 0;
  const spoken = lastWindow([msg("10:00", "宝宝今天早上六点就醒了"), ...filler(), ...anchorPair()]);
  assert.equal(claimSubject(spoken, anchorId(spoken)).resolved, true);
});

test("11. a question about another child in between is a competing referent", () => {
  seq = 0;
  const f = filler();
  f[1] = msg("10:02", "你姐姐家的孩子会走了吗？", FATHER);
  const w = lastWindow([antecedent(), ...f, ...anchorPair()]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.basis, "unresolved_competing_person");
});

test("12. a reported quote containing the pronoun follows the same rule", () => {
  seq = 0;
  const w1 = lastWindow([antecedent(), ...filler(), msg("11:00", "楼下保安说“他好乖啊”")]);
  assert.equal(claimSubject(w1, w1.items[0].sourceId).basis, "conversation_continuity");
  seq = 0;
  const w2 = lastWindow([antecedent(), ...filler(), msg("11:00", "外婆说“她明天过来”")]);
  const subject = claimSubject(w2, w2.items[0].sourceId);
  assert.equal(subject.basis, "unresolved_competing_person");
  assert.deepEqual(subject.continuity.competingSubjectIds, ["adult:unregistered"]);
});

test("zero-anaphora is out of scope: a message with no pronoun is never resolved by continuity", () => {
  seq = 0;
  const w = lastWindow([antecedent(), ...filler(), msg("11:00", "各种扶墙站，手一撑，然后就起来了", FATHER)]);
  const subject = claimSubject(w, w.items[0].sourceId);
  assert.equal(subject.basis, "unresolved_no_reference");
  assert.equal(subject.continuity, undefined);
  assert.equal(firstPronounItem(w), undefined);
});

test("continuity never resolves forwards", () => {
  seq = 0;
  const w = lastWindow([...filler(), msg("11:00", "他现在好想站起来啊"), msg("11:01", "张小年真棒", FATHER)].map((s, i) => ({ ...s, capturedAt: i < 9 ? s.capturedAt : s.capturedAt })));
  // The name after the anchor is in the same window, so the frozen resolver takes it; continuity itself must not.
  const e = resolveByConversationContinuity(w, w.items[0], SUBJECT, OPTS);
  assert.equal(e.basis, "unresolved");
  assert.equal(resolveClaimSubject(w, [{ ...groundedSpanOf(w, 0), text: w.items[0].text }], SUBJECT, OPTS).basis, "antecedent_in_window");
});

function groundedSpanOf(window, index) {
  const item = window.items[index];
  return { ref: `${item.itemId}#span-0`, sourceId: item.sourceId, itemId: item.itemId, text: item.text, speechAct: "assertion", polarity: "affirmative", contentBearing: true, markers: [], speakerDigest: item.senderDigest, speaker: { known: true } };
}
