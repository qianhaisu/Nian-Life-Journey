import test from "node:test";
import assert from "node:assert/strict";
import { routeV4 } from "../lib/organizer/worthiness-v4.ts";
import { routeV5 } from "../lib/organizer/worthiness-v5.ts";
import { createV5RoutingPolicy, V5_ROUTING_POLICY_ID } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { mockMemoryEditor } from "../lib/organizer/mock-editor.ts";

const dim = (score) => ({ score, evidenceRefs: score > 0 ? ["it1#span-0"] : [] });
const axis = (o = {}) => ({
  developmentalTransition: o.transition ?? { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: { score: o.capability ?? 0, kind: o.kind ?? "none", evidenceRefs: (o.capability ?? 0) > 0 ? ["it1#span-0"] : [] },
  distinctiveFamilyMoment: dim(o.distinctive ?? 0),
  relationshipSignificance: dim(o.relationship ?? 0),
  futureRecallValue: dim(o.futureRecall ?? 0),
  noDistinctiveMemorySignal: o.nothing ?? false,
});
const input = (o = {}) => ({
  worthiness: axis(o),
  evidence: { subjectConfidence: "high", evidenceConfidence: "high", attributionConfidence: "high", firsthandOrReported: "firsthand", corroboratingSpeakers: 3 },
  subjectRelevance: o.subjectRelevance ?? "primary",
  subjectResolution: o.subjectResolution ?? "explicit",
  temporalStatus: "past",
  rawFactCount: 2,
});

// The exact case this change exists for: B1 tomato-noodles was promoted on two mediums while its
// capability was correctly scored ordinary_action.
test("two medium signals alone no longer create a Memory", () => {
  const mediumOnly = input({ distinctive: 2, futureRecall: 2, capability: 1, kind: "ordinary_action" });
  assert.equal(routeV4(mediumOnly).action, "life_event_candidate", "v4 promoted this");
  const v5 = routeV5(mediumOnly);
  assert.equal(v5.action, "daily_trace");
  assert.equal(v5.demotedFromMediumOnlyPromotion, true);
  assert.equal(v5.traceRichness, "rich", "mediums still mark it as a richer trace than noise");
});

test("a strong signal still promotes — capability, transition or a highly distinctive moment", () => {
  for (const strong of [
    { capability: 2, kind: "developmental_ability" },
    { capability: 2, kind: "meaningful_independence" },
    { transition: { score: 2, basis: "explicit_in_window", evidenceRefs: ["it1#span-0"] } },
    { distinctive: 3 },
  ]) {
    const decision = routeV5(input(strong));
    assert.equal(decision.action, "life_event_candidate", JSON.stringify(strong));
    assert.equal(decision.demotedFromMediumOnlyPromotion, undefined);
    assert.ok(decision.strongSignals.length >= 1);
  }
});

// B3/B8 shape: meaningful_independence plus mediums must survive on the strong signal.
test("meaningful_independence with mediums alongside is retained, not demoted", () => {
  const decision = routeV5(input({ capability: 2, kind: "meaningful_independence", relationship: 2, futureRecall: 2 }));
  assert.equal(decision.action, "life_event_candidate");
  assert.deepEqual(decision.strongSignals, ["capability:meaningful_independence"]);
});

test("v5 changes nothing except the medium-only promotion path", () => {
  const cases = [
    { nothing: true }, { relationship: 2 }, { capability: 3, kind: "ordinary_action" },
    { capability: 2, kind: "developmental_ability", subjectResolution: "unresolved" },
    { transition: { score: 3, basis: "unknown", evidenceRefs: [] } },
  ];
  for (const c of cases) {
    const v4 = routeV4(input(c));
    const v5 = routeV5(input(c));
    assert.equal(v5.action, v4.action, `v5 must match v4 for ${JSON.stringify(c)}`);
  }
});

test("the v5 policy decides the validator's outcome end to end", () => {
  const src = { id: "s1", profileId: "p", sourceType: "wechat", contentTypes: ["family"], contributorId: "c", capturedAt: "2025-10-10T10:00:00+08:00", text: "张小年今天自己扶着站起来了", mediaIds: [], visibility: "family", metadata: {}, sourceLabel: "conv", contributorRole: "mother" };
  const w = buildEvidenceWindows("conv-v5", "p", [src], { dailyTraces: [], lifeEvents: [] })[0];
  const verdict = mockMemoryEditor(w, { subjectNames: ["张小年"] });
  const mediumOnlyAxis = axis({ distinctive: 2, futureRecall: 2, capability: 1, kind: "ordinary_action" });
  const policy = createV5RoutingPolicy(() => ({
    worthiness: mediumOnlyAxis,
    evidence: { subjectConfidence: "high", evidenceConfidence: "high", attributionConfidence: "high", firsthandOrReported: "firsthand", corroboratingSpeakers: 2 },
    subjectResolution: "explicit",
  }));
  const result = validate(w, verdict, { now: "2025-11-01T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0, routingPolicy: policy, expectedRoutingPolicyId: V5_ROUTING_POLICY_ID });
  assert.equal(result.outcome.action, "daily_trace", "medium-only must not reach the archive as a Memory");
});
