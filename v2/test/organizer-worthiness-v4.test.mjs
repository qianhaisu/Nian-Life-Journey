import test from "node:test";
import assert from "node:assert/strict";
import { computeWorthinessV4, effectiveCapabilityScore, isQualifyingCapability, routeV4, toV1WorthinessDimensionsV4 } from "../lib/organizer/worthiness-v4.ts";

const dim = (score) => ({ score, evidenceRefs: score > 0 ? ["it1#span-0"] : [] });
const axis = (o = {}) => ({
  developmentalTransition: o.transition ?? { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: { score: o.capability ?? 0, kind: o.kind ?? "none", evidenceRefs: (o.capability ?? 0) > 0 ? ["it1#span-0"] : [] },
  distinctiveFamilyMoment: dim(o.distinctive ?? 0),
  relationshipSignificance: dim(o.relationship ?? 0),
  futureRecallValue: dim(o.futureRecall ?? 0),
  noDistinctiveMemorySignal: o.nothing ?? false,
});
const evidence = () => ({ subjectConfidence: "high", evidenceConfidence: "high", attributionConfidence: "high", firsthandOrReported: "firsthand", corroboratingSpeakers: 3 });
const routing = (o = {}) => routeV4({
  worthiness: axis(o), evidence: evidence(),
  subjectRelevance: o.subjectRelevance ?? "primary",
  subjectResolution: o.subjectResolution ?? "explicit",
  temporalStatus: o.temporalStatus ?? "past", rawFactCount: o.rawFactCount ?? 2,
});

// The v3 regression this version exists to fix: crawling and a messy meal were the same signal.
test("an ordinary action is not capability at any score", () => {
  assert.equal(isQualifyingCapability("ordinary_action"), false);
  assert.equal(effectiveCapabilityScore({ score: 3, kind: "ordinary_action", evidenceRefs: [] }), 0);
  const noodles = routing({ capability: 3, kind: "ordinary_action" });
  assert.equal(noodles.action, "daily_trace", "he ate noodles: pleasant, not a capability");
  assert.deepEqual(noodles.strongSignals, []);
});

test("a developmental ability and meaningful independence both count", () => {
  const crawling = routing({ capability: 2, kind: "developmental_ability" });
  assert.equal(crawling.action, "life_event_candidate");
  assert.deepEqual(crawling.strongSignals, ["capability:developmental_ability"]);
  const selfFeeding = routing({ capability: 2, kind: "meaningful_independence" });
  assert.equal(selfFeeding.action, "life_event_candidate");
});

test("an ordinary action contributes nothing to the score either", () => {
  const ordinary = computeWorthinessV4(axis({ capability: 3, kind: "ordinary_action" }));
  const nothing = computeWorthinessV4(axis({ capability: 0, kind: "none" }));
  assert.equal(ordinary.score, nothing.score);
  assert.equal(ordinary.effectiveCapability, 0);
  assert.equal(toV1WorthinessDimensionsV4(axis({ capability: 3, kind: "ordinary_action" })).change.score, 0);
});

test("an ordinary day can still be kept for a genuinely distinctive moment", () => {
  assert.equal(routing({ capability: 3, kind: "ordinary_action", distinctive: 3 }).action, "life_event_candidate");
});

// Gate A now defers to the bounded resolver.
test("an unresolved subject blocks regardless of what the model claimed", () => {
  const blocked = routing({ capability: 3, kind: "developmental_ability", subjectResolution: "unresolved" });
  assert.equal(blocked.action, "store_only");
  assert.ok(blocked.blockedBy.includes("subject_unresolved"));
});

test("a contextually resolved subject is allowed through", () => {
  const resolved = routing({ capability: 2, kind: "developmental_ability", subjectResolution: "contextually_resolved" });
  assert.equal(resolved.action, "life_event_candidate");
  assert.deepEqual(resolved.blockedBy, []);
});

test("transition remains basis-gated and independent of capability kind", () => {
  const unknownBasis = routing({ transition: { score: 3, basis: "unknown", evidenceRefs: [] }, kind: "ordinary_action" });
  assert.equal(unknownBasis.action, "daily_trace");
  const supported = routing({ transition: { score: 2, basis: "supported_by_prior_context", evidenceRefs: ["it1#span-0"] } });
  assert.ok(supported.strongSignals.includes("developmental_transition"));
});
