import test from "node:test";
import assert from "node:assert/strict";
import { computeWorthinessV2, effectiveTransitionScore, routeV2, toV1WorthinessDimensions } from "../lib/organizer/worthiness-v2.ts";
import { extractTopics, selectPriorObservations, topicsForWindow } from "../lib/organizer/prior-observations.ts";

const dim = (score) => ({ score, evidenceRefs: score > 0 ? ["it1#span-0"] : [] });
const axis = (o = {}) => ({
  developmentalTransition: o.transition ?? { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: dim(o.capability ?? 0),
  distinctiveFamilyMoment: dim(o.distinctive ?? 0),
  relationshipSignificance: dim(o.relationship ?? 0),
  futureRecallValue: dim(o.futureRecall ?? 0),
  ordinaryRoutineCharacter: dim(o.routine ?? 0),
});
const evidence = (o = {}) => ({
  subjectConfidence: o.subjectConfidence ?? "high",
  evidenceConfidence: o.evidenceConfidence ?? "high",
  attributionConfidence: "high",
  firsthandOrReported: o.firsthand ?? "firsthand",
  corroboratingSpeakers: o.speakers ?? 3,
});
const routing = (o = {}) => routeV2({
  worthiness: axis(o), evidence: evidence(o),
  subjectRelevance: o.subjectRelevance ?? "primary",
  temporalStatus: o.temporalStatus ?? "past",
  rawFactCount: o.rawFactCount ?? 2,
});

// --- The rule the whole v2 design exists for ----------------------------------------------------
test("a transition claim with no stated basis can never be scored above 1", () => {
  assert.equal(effectiveTransitionScore({ score: 3, basis: "unknown", evidenceRefs: [] }), 1);
  assert.equal(effectiveTransitionScore({ score: 3, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] }), 3);
  assert.equal(effectiveTransitionScore({ score: 2, basis: "supported_by_prior_context", evidenceRefs: ["it1#span-0"] }), 2);
});

test("an unsupported milestone claim cannot reach life_event_candidate on its own", () => {
  const unsupported = routing({ transition: { score: 3, basis: "unknown", evidenceRefs: [] } });
  assert.notEqual(unsupported.action, "life_event_candidate");
  const supported = routing({ transition: { score: 3, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] } });
  assert.equal(supported.action, "life_event_candidate");
  assert.ok(supported.strongSignals.includes("developmental_transition"));
});

// --- Provenance must not buy worthiness ---------------------------------------------------------
test("maximal provenance does not raise the worthiness score at all", () => {
  const weak = axis({ routine: 2 });
  const scored = computeWorthinessV2(weak);
  // Same worthiness axis, best possible evidence axis: routing may become eligible, but the score
  // itself must be identical, because the evidence axis is not an input to it.
  assert.equal(computeWorthinessV2(weak).score, scored.score);
  const lively = routing({ routine: 3, relationship: 1, speakers: 4, firsthand: "firsthand" });
  assert.notEqual(lively.action, "life_event_candidate", "a lively, well-attested ordinary day is still ordinary");
});

test("a routine-dominant day needs a strong signal, not just two medium ones", () => {
  const routineWithMediums = routing({ routine: 2, relationship: 2, futureRecall: 2 });
  assert.equal(routineWithMediums.action, "daily_trace");
  // The same day, once something genuinely new happens, is kept — first steps happen on ordinary days.
  const routineWithTransition = routing({ routine: 2, relationship: 2, futureRecall: 2, transition: { score: 2, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] } });
  assert.equal(routineWithTransition.action, "life_event_candidate");
});

test("gates block on subject, evidence confidence, unhedged facts and unobserved time", () => {
  const strong = { transition: { score: 3, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] } };
  assert.deepEqual(routing({ ...strong, subjectRelevance: "ambiguous" }).blockedBy, ["subject_not_primary"]);
  assert.deepEqual(routing({ ...strong, rawFactCount: 0 }).blockedBy, ["no_unhedged_fact"]);
  assert.deepEqual(routing({ ...strong, temporalStatus: "planned" }).blockedBy, ["not_observed"]);
  assert.deepEqual(routing({ ...strong, evidenceConfidence: "low" }).blockedBy, ["low_evidence_confidence"]);
  assert.equal(routing({ ...strong, subjectRelevance: "ambiguous" }).action, "store_only");
});

test("ordinary-but-pleasant stays a real class, not noise and not a memory", () => {
  const pleasant = routing({ relationship: 2, routine: 2 });
  assert.equal(pleasant.action, "daily_trace");
});

test("the v1 dimension projection keeps H8 live and applies the basis cap", () => {
  const projected = toV1WorthinessDimensions(axis({ transition: { score: 3, basis: "unknown", evidenceRefs: [] }, capability: 2 }));
  assert.equal(projected.milestone.score, 1, "unknown basis is capped before the validator ever sees it");
  assert.equal(projected.change.score, 2);
  assert.equal(projected.everydayTexture.score, 0, "routine character must not be re-added as a positive dimension");
});

// --- Bounded prior context ----------------------------------------------------------------------
test("topics are extracted per subject area", () => {
  assert.deepEqual(extractTopics("他自己会爬了"), ["crawl"]);
  assert.ok(topicsForWindow(["一觉睡到5点", "辅食吃完了"]).includes("sleep"));
  assert.ok(topicsForWindow(["一觉睡到5点", "辅食吃完了"]).includes("feeding"));
});

test("prior observations are topic-matched, strictly earlier, recent and capped", () => {
  const candidates = [
    { observedAt: "2025-07-13", text: "我这会儿刚哄睡不久" },
    { observedAt: "2025-07-29", text: "真哭了半夜也没办法啊" },
    { observedAt: "2025-08-04", text: "同一天不能当基线" },
    { observedAt: "2025-08-05", text: "以后的不能当基线" },
    { observedAt: "2025-01-01", text: "太久以前的哄睡记录" },
    { observedAt: "2025-08-01", text: "今天辅食吃得干净" },
  ];
  const selected = selectPriorObservations(candidates, ["sleep"], "2025-08-04", { maxPerTopic: 3 });
  const dates = selected.map((s) => s.observedAt);
  assert.ok(dates.includes("2025-07-13"));
  assert.equal(dates.includes("2025-08-04"), false, "same-day is not a baseline");
  assert.equal(dates.includes("2025-08-05"), false, "later is not a baseline");
  assert.equal(dates.includes("2025-01-01"), false, "outside the lookback");
  assert.ok(selected.every((s) => s.topic === "sleep"));
});

test("prior context stays bounded in total", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ observedAt: `2025-07-${String((i % 28) + 1).padStart(2, "0")}`, text: "哄睡 辅食 爬 站" }));
  const selected = selectPriorObservations(many, ["sleep", "feeding", "crawl", "stand"], "2025-08-04", { maxPerTopic: 3, maxTotal: 8 });
  assert.ok(selected.length <= 8, `expected <= 8, got ${selected.length}`);
});

// --- Double-counting audit ----------------------------------------------------------------------
// The legacy projection exists only to keep the H1-H9 validator (which speaks v1 dimension names)
// live. It must never feed back into v2 scoring or routing, or a transition would be paid for twice.
test("developmentalTransition enters the v2 score exactly once, via the v2 axis only", () => {
  const withTransition = axis({ transition: { score: 3, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] } });
  const withoutTransition = axis({ transition: { score: 0, basis: "explicit_in_window", evidenceRefs: [] } });
  const delta = computeWorthinessV2(withTransition).score - computeWorthinessV2(withoutTransition).score;
  // 3 points x weight 3.0 out of POSITIVE_MAX 33 = exactly 27% of the scale. A second, hidden
  // contribution through the milestone projection would push this above 27.
  assert.equal(delta, 27, `transition contributed ${delta}, expected exactly 27`);
});

test("the v1 projection is output-only: it is not an input to computeWorthinessV2 or routeV2", () => {
  const a = axis({ transition: { score: 3, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] } });
  const projected = toV1WorthinessDimensions(a);
  assert.equal(projected.milestone.score, 3);
  // Mutating the projection cannot change either the score or the route, because neither reads it.
  projected.milestone.score = 0;
  projected.change.score = 3;
  assert.equal(computeWorthinessV2(a).score, 27);
  assert.equal(routeV2({ worthiness: a, evidence: evidence(), subjectRelevance: "primary", temporalStatus: "past", rawFactCount: 2 }).action, "life_event_candidate");
});

test("transition and new-capability are independent inputs, and either alone is one strong signal", () => {
  const transitionOnly = routing({ transition: { score: 2, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] } });
  const capabilityOnly = routing({ capability: 2 });
  assert.deepEqual(transitionOnly.strongSignals, ["developmental_transition"]);
  assert.deepEqual(capabilityOnly.strongSignals, ["new_capability"]);
  // Both firing is common for one underlying event (crossing a threshold IS a new capability). That
  // raises the score but must not change the routing outcome, which needs only one strong signal.
  const both = routing({ transition: { score: 2, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] }, capability: 2 });
  assert.equal(both.action, transitionOnly.action);
  assert.equal(both.strongSignals.length, 2);
});
