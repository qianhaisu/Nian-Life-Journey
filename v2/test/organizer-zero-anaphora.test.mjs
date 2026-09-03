// V7 — zero-anaphora claim subject resolution.
//
// Frozen V6 refuses any claim whose evidence span carries neither a name nor a pronoun, and it
// refuses it from a guard that sits BEFORE the competing-person check and before the bounded
// antecedent walk. So 「已经学会欢迎欢迎」 is unresolvable while 「他已经学会欢迎欢迎」 in the
// identical window resolves. V7 removes that asymmetry, opt-in, behind every guard the pronoun path
// already passes plus a first-person guard of its own.
//
// The first suite below is the one that matters most: frozen V6 must be byte-for-byte unchanged
// whenever the option is absent.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveClaimSubject, groundClaims, CLAIM_GROUNDING_VERSION, CLAIM_GROUNDING_V7_VERSION } from "../lib/organizer/claim-grounding.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const V6 = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const V7 = { ...V6, zeroAnaphoraAntecedent: true };

let seq = 0;
function item(text, opts = {}) {
  seq += 1;
  return {
    itemId: `item:${String(seq).padStart(24, "0")}`, sourceId: opts.sourceId ?? `src-${seq}`,
    sentAt: `2026-03-01T10:${String(seq % 60).padStart(2, "0")}:00.000Z`,
    senderRole: "speaker-a", senderDigest: opts.senderDigest ?? "digest-a", text,
    contentTypes: ["daily"], mediaRefs: [], locator: { document: "d", recordOrdinal: seq },
    spans: [{ id: "span-0", start: 0, end: text.length }], tier: "firsthand_observation",
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
// resolveClaimSubject takes GroundedSpans; only `text` and `itemId` matter to it here.
const spanOf = (it) => ({
  ref: `${it.itemId}#span-0`, sourceId: it.sourceId, itemId: it.itemId, text: it.text,
  speechAct: "assertion", polarity: "affirmative", contentBearing: true, markers: [],
  speakerDigest: it.senderDigest, speaker: { known: true },
});

// ---------------------------------------------------------------- frozen V6 invariance
test("V6 is unchanged: a subjectless span stays unresolved when the option is absent", () => {
  const named = item("张小年今天特别开心");
  const bare = item("已经学会欢迎欢迎");
  const window = windowOf([named, bare]);
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V6);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_no_reference");
  assert.deepEqual(subject.blockers, ["no_subject_reference"]);
});

test("V6 is unchanged: the pronoun path still resolves through an in-window antecedent", () => {
  const named = item("张小年今天特别开心");
  const pronoun = item("他已经学会欢迎欢迎");
  const window = windowOf([named, pronoun]);
  for (const options of [V6, V7]) {
    const subject = resolveClaimSubject(window, [spanOf(pronoun)], SUBJECT, options);
    assert.equal(subject.resolved, true);
    assert.equal(subject.basis, "antecedent_in_window", "a pronoun claim keeps its own basis under both policies");
  }
});

test("the grounding result records which policy produced it", () => {
  const named = item("张小年今天特别开心");
  const window = windowOf([named]);
  const verdict = {
    windowId: "window:test", subjectRelevance: "primary", subjectIds: [], temporalStatus: "past",
    occurredAtProposal: { value: "2026-03-01", basis: "sent_at", evidenceRefs: [] },
    coreFacts: [], quotableLines: [], worthinessDimensions: {}, duplicateCandidates: [],
    uncertainty: { time: "low", subject: "low", semantics: "low" }, sensitivityFlags: [],
    prohibitedInferences: [], proposedAction: "daily_trace", selectionReason: "t", confidence: 0.9,
    worthinessAxis: {
      developmentalTransition: { score: 0, basis: "unknown", evidenceRefs: [] },
      newCapabilityOrIndependence: { score: 0, kind: "none", evidenceRefs: [] },
      distinctiveFamilyMoment: { score: 0, evidenceRefs: [] },
      relationshipSignificance: { score: 0, evidenceRefs: [] },
      futureRecallValue: { score: 0, evidenceRefs: [] }, noDistinctiveMemorySignal: false,
    },
  };
  assert.equal(groundClaims(window, verdict, SUBJECT, V6).version, CLAIM_GROUNDING_VERSION);
  assert.equal(groundClaims(window, verdict, SUBJECT, V7).version, CLAIM_GROUNDING_V7_VERSION);
});

// ---------------------------------------------------------------- what V7 recovers
test("V7 resolves a subjectless span through an explicit naming in the same window", () => {
  // The shape that cost RC-09: the family names him, then drops the subject in the very next
  // message, which is the one carrying the capability.
  const named = item("张小年还没学会拜拜");
  const bare = item("已经学会欢迎欢迎");
  const window = windowOf([named, bare]);
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7);
  assert.equal(subject.resolved, true);
  assert.equal(subject.basis, "antecedent_in_window_zero_anaphora", "and it is labelled as the weaker inference it is");
  assert.deepEqual(subject.supportingSourceIds, [named.sourceId]);
});

test("V7 resolves a subjectless span whose sentence names only other people", () => {
  // RC-05: 「外婆抱得时候哭了，外公抱着笑开怀」 names two adults; the one crying is the child, and
  // the span carries no reference to him at all.
  const named = item("过分了张小年");
  const bare = item("外婆抱得时候哭了，外公抱着笑开怀");
  const window = windowOf([bare, named]);
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7);
  assert.equal(subject.resolved, true);
  assert.equal(subject.basis, "antecedent_in_window_zero_anaphora");
});

// ---------------------------------------------------------------- what V7 must still refuse
test("V7 refuses a first-person span: the dropped subject is the speaker", () => {
  const named = item("张小年今天特别开心");
  const bare = item("我今天累死了，等下就去买菜");
  const window = windowOf([named, bare]);
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_no_reference");
  assert.ok(subject.blockers.includes("first_person_span"));
});

test("V7 refuses when another child is anywhere in the window or its neighbours", () => {
  const named = item("张小年今天特别开心");
  const bare = item("已经学会走路了");
  const other = item("邻居家的小朋友也来了");
  const window = windowOf([named, bare, other]);
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_competing_person");
});

test("V7 refuses when a competing child appears only in a NEIGHBOUR message", () => {
  const named = item("张小年今天特别开心");
  const bare = item("已经学会走路了");
  const window = windowOf([named, bare], { before: [item("表弟这周也在")], after: [] });
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_competing_person");
});

test("V7 refuses when nothing in the window names the child", () => {
  const bare = item("已经学会走路了");
  const other = item("今天天气不错");
  const window = windowOf([bare, other]);
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_no_reference");
  assert.ok(subject.blockers.includes("no_antecedent_in_window"));
});

test("V7 does NOT reach across into a neighbour message for a subjectless span", () => {
  // A pronoun claim may resolve through a neighbour; a zero-anaphora claim may not. Without even a
  // pronoun there is nothing tying the span to a third person across an episode boundary.
  const bare = item("已经学会走路了");
  const window = windowOf([bare, item("今天天气不错")], { before: [item("张小年昨天睡得好")], after: [] });
  assert.equal(resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7).resolved, false);
  // …whereas the same window with a pronoun still resolves through the neighbour, under both policies.
  const pronoun = item("他已经学会走路了");
  const pronounWindow = windowOf([pronoun, item("今天天气不错")], { before: [item("张小年昨天睡得好")], after: [] });
  for (const options of [V6, V7]) {
    const subject = resolveClaimSubject(pronounWindow, [spanOf(pronoun)], SUBJECT, options);
    assert.equal(subject.basis, "antecedent_in_neighbour");
  }
});

test("V7 refuses a comparative referent, same as the pronoun path", () => {
  const named = item("张小年今天特别开心");
  const bare = item("已经学会走路了");
  const window = windowOf([named, bare, item("比张小年大40多天")]);
  const subject = resolveClaimSubject(window, [spanOf(bare)], SUBJECT, V7);
  assert.equal(subject.resolved, false);
  assert.equal(subject.basis, "unresolved_competing_person");
});

test("an explicit naming inside the span still wins, and is never downgraded to the V7 basis", () => {
  const explicit = item("张小年已经学会走路了");
  const window = windowOf([explicit]);
  for (const options of [V6, V7]) {
    assert.equal(resolveClaimSubject(window, [spanOf(explicit)], SUBJECT, options).basis, "explicit_in_span");
  }
});
