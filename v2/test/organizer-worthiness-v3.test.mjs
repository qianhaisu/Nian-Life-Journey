import test from "node:test";
import assert from "node:assert/strict";
import { computeWorthinessV3, routeV3, toV1WorthinessDimensionsV3 } from "../lib/organizer/worthiness-v3.ts";
import { validate } from "../lib/organizer/validator.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { mockMemoryEditor } from "../lib/organizer/mock-editor.ts";

const dim = (score) => ({ score, evidenceRefs: score > 0 ? ["it1#span-0"] : [] });
const axis = (o = {}) => ({
  developmentalTransition: o.transition ?? { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: dim(o.capability ?? 0),
  distinctiveFamilyMoment: dim(o.distinctive ?? 0),
  relationshipSignificance: dim(o.relationship ?? 0),
  futureRecallValue: dim(o.futureRecall ?? 0),
  noDistinctiveMemorySignal: o.nothing ?? false,
});
const evidence = (o = {}) => ({
  subjectConfidence: o.subjectConfidence ?? "high", evidenceConfidence: o.evidenceConfidence ?? "high",
  attributionConfidence: "high", firsthandOrReported: "firsthand", corroboratingSpeakers: o.speakers ?? 3,
});
const routing = (o = {}) => routeV3({
  worthiness: axis(o), evidence: evidence(o),
  subjectRelevance: o.subjectRelevance ?? "primary", temporalStatus: o.temporalStatus ?? "past",
  rawFactCount: o.rawFactCount ?? 2,
});

// --- Defect 1: routineness is no longer a punishment -------------------------------------------
test("routineness never subtracts from the score", () => {
  const a = axis({ capability: 2, nothing: false });
  const b = axis({ capability: 2, nothing: true });
  assert.equal(computeWorthinessV3(a).score, computeWorthinessV3(b).score);
});

test("an ordinary day with a real capability gain is still Memory-eligible", () => {
  const ordinaryButReal = routing({ capability: 2, nothing: true });
  assert.equal(ordinaryButReal.action, "life_event_candidate");
  assert.ok(ordinaryButReal.strongSignals.includes("capability_or_independence"));
});

test("noDistinctiveMemorySignal is consulted only when nothing positive fired", () => {
  assert.equal(routing({ nothing: true }).action, "daily_trace");
  assert.equal(routing({ nothing: false }).action, "store_only");
  // With a medium signal present it is irrelevant either way.
  assert.equal(routing({ relationship: 2, nothing: true }).action, "daily_trace");
  assert.equal(routing({ relationship: 2, futureRecall: 2, nothing: true }).action, "life_event_candidate");
});

// --- Defect 2: capability without a novelty word ------------------------------------------------
test("capability alone is a strong signal and claims no transition", () => {
  const capabilityOnly = routing({ capability: 3 });
  assert.equal(capabilityOnly.action, "life_event_candidate");
  assert.deepEqual(capabilityOnly.strongSignals, ["capability_or_independence"]);
  // The transition stays 0, so nothing downstream can render a "first time".
  assert.equal(toV1WorthinessDimensionsV3(axis({ capability: 3 })).milestone.score, 0);
});

test("an unknown-basis transition is still capped and cannot promote on its own", () => {
  const unknownBasis = routing({ transition: { score: 3, basis: "unknown", evidenceRefs: [] } });
  assert.equal(unknownBasis.action, "daily_trace", "capped to 1 = a medium signal at most");
  assert.equal(toV1WorthinessDimensionsV3(axis({ transition: { score: 3, basis: "unknown", evidenceRefs: [] } })).milestone.score, 1);
});

// --- Defect 4: H8 reconciliation ----------------------------------------------------------------
const src = (o) => ({ id: o.id, profileId: "p", sourceType: "wechat", contentTypes: ["family"], contributorId: "c", capturedAt: o.capturedAt, text: o.text, mediaIds: [], visibility: "family", metadata: {}, sourceLabel: "conv", contributorRole: "mother" });
function transitionWindow() {
  return buildEvidenceWindows("conv-h8", "p", [src({ id: "s1", capturedAt: "2025-10-10T10:00:00+08:00", text: "他现在会自己扶着站起来了" })], { dailyTraces: [], lifeEvents: [] })[0];
}
function verdictWithSupport(window, support) {
  const base = mockMemoryEditor(window, { subjectNames: ["他"] });
  const ref = `${window.items[0].itemId}#${window.items[0].spans[0].id}`;
  return {
    ...base,
    coreFacts: [{ statement: "他现在会自己扶着站起来了", assertionKind: "raw_fact", evidenceRefs: [ref] }],
    worthinessDimensions: { ...base.worthinessDimensions, milestone: { score: 3, evidenceRefs: [ref] } },
    transitionSupport: support ? { ...support, currentEvidenceRefs: [ref] } : undefined,
  };
}
const ctx = (supplied) => ({ now: "2025-11-01T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0, supportedPriorSourceIds: supplied });

test("H8 accepts a transition backed by a baseline the pipeline actually supplied", () => {
  const window = transitionWindow();
  const verdict = verdictWithSupport(window, { basis: "supported_by_prior_context", priorEvidence: [{ sourceId: "prior-1", observedAt: "2025-09-20", statement: "还站不起来" }] });
  const result = validate(window, verdict, ctx(["prior-1"]));
  assert.equal(result.outcome.action, "life_event_candidate");
  assert.equal(result.reasonCodes.includes("media_binding_too_weak"), false);
});

test("H8 rejects a baseline the model was never shown, without weakening into trust", () => {
  const window = transitionWindow();
  const verdict = verdictWithSupport(window, { basis: "supported_by_prior_context", priorEvidence: [{ sourceId: "invented-999", observedAt: "2025-09-20", statement: "编造的基线" }] });
  const result = validate(window, verdict, ctx(["prior-1"]));
  assert.ok(result.reasonCodes.includes("unverified_prior_baseline"));
  assert.ok(result.reasonCodes.includes("media_binding_too_weak"), "the milestone must still be capped");
});

test("H8 still caps a bare milestone claim with no novelty text and no baseline", () => {
  const window = transitionWindow();
  const verdict = verdictWithSupport(window, { basis: "unknown", priorEvidence: [] });
  const result = validate(window, verdict, ctx([]));
  assert.ok(result.reasonCodes.includes("media_binding_too_weak"));
});

test("H8 path A is unchanged: explicit novelty text alone still supports a milestone", () => {
  const window = buildEvidenceWindows("conv-h8a", "p", [src({ id: "s1", capturedAt: "2025-10-10T10:00:00+08:00", text: "他第一次自己站起来了" })], { dailyTraces: [], lifeEvents: [] })[0];
  const ref = `${window.items[0].itemId}#${window.items[0].spans[0].id}`;
  const base = mockMemoryEditor(window, { subjectNames: ["他"] });
  const verdict = { ...base, coreFacts: [{ statement: "他第一次自己站起来了", assertionKind: "raw_fact", evidenceRefs: [ref] }], worthinessDimensions: { ...base.worthinessDimensions, milestone: { score: 3, evidenceRefs: [ref] } } };
  const result = validate(window, verdict, ctx([]));
  assert.equal(result.outcome.action, "life_event_candidate");
});
