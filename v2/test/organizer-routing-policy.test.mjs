import test from "node:test";
import assert from "node:assert/strict";
import { validate, V1_ROUTING_POLICY } from "../lib/organizer/validator.ts";
import { createV4RoutingPolicy, V4_ROUTING_POLICY_ID } from "../lib/organizer/routing-policies.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { mockMemoryEditor } from "../lib/organizer/mock-editor.ts";
import { runPipeline } from "../lib/organizer/pipeline.ts";
import { buildRequestManifest } from "../lib/organizer/deepseek-editor.ts";

const src = (o) => ({ id: o.id, profileId: "p", sourceType: "wechat", contentTypes: ["family"], contributorId: "c", capturedAt: o.at, text: o.text, mediaIds: [], visibility: "family", metadata: {}, sourceLabel: "conv", contributorRole: "mother" });
const window1 = () => buildEvidenceWindows("conv-rp", "p", [src({ id: "s1", at: "2025-10-10T10:00:00+08:00", text: "张小年今天自己扶着站起来了" })], { dailyTraces: [], lifeEvents: [] })[0];
const baseCtx = { now: "2025-11-01T00:00:00Z", modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0 };

// --- Correction 1: routing is an injected policy, and v4 cannot silently become v1 -------------
test("the default routing policy is the production v1 router", () => {
  const w = window1();
  const verdict = mockMemoryEditor(w, { subjectNames: ["张小年"] });
  const result = validate(w, verdict, baseCtx);
  assert.ok(result.outcome.action, "routes without an explicit policy");
  assert.equal(V1_ROUTING_POLICY.id, "worthiness-v1");
});

test("an evaluation expecting v4 THROWS rather than routing with v1", () => {
  const w = window1();
  const verdict = mockMemoryEditor(w, { subjectNames: ["张小年"] });
  // The exact failure this refactor exists to prevent: expecting v4 while no policy is injected.
  assert.throws(
    () => validate(w, verdict, { ...baseCtx, expectedRoutingPolicyId: V4_ROUTING_POLICY_ID }),
    /Routing policy mismatch.*worthiness-v4.*worthiness-v1/s,
  );
  // And equally when some other policy is injected by mistake.
  assert.throws(
    () => validate(w, verdict, { ...baseCtx, routingPolicy: V1_ROUTING_POLICY, expectedRoutingPolicyId: V4_ROUTING_POLICY_ID }),
    /Routing policy mismatch/,
  );
});

test("an injected v4 policy actually decides the validator's outcome", () => {
  const w = window1();
  const verdict = mockMemoryEditor(w, { subjectNames: ["张小年"] });
  const axis = {
    developmentalTransition: { score: 0, basis: "unknown", evidenceRefs: [] },
    newCapabilityOrIndependence: { score: 3, kind: "developmental_ability", evidenceRefs: [] },
    distinctiveFamilyMoment: { score: 0, evidenceRefs: [] },
    relationshipSignificance: { score: 0, evidenceRefs: [] },
    futureRecallValue: { score: 0, evidenceRefs: [] },
    noDistinctiveMemorySignal: false,
  };
  const policy = createV4RoutingPolicy(() => ({
    worthiness: axis,
    evidence: { subjectConfidence: "high", evidenceConfidence: "high", attributionConfidence: "high", firsthandOrReported: "firsthand", corroboratingSpeakers: 2 },
    subjectResolution: "explicit",
  }));
  const v4 = validate(w, verdict, { ...baseCtx, routingPolicy: policy, expectedRoutingPolicyId: V4_ROUTING_POLICY_ID });
  const v1 = validate(w, verdict, baseCtx);
  assert.equal(v4.outcome.action, "life_event_candidate", "v4 keeps a strong capability signal");
  assert.notEqual(v1.outcome.action, v4.outcome.action, "and v1 would have decided differently");
});

test("a v4 policy with no axis for the window throws instead of degrading to v1", () => {
  const w = window1();
  const verdict = mockMemoryEditor(w, { subjectNames: ["张小年"] });
  const policy = createV4RoutingPolicy(() => undefined);
  assert.throws(() => validate(w, verdict, { ...baseCtx, routingPolicy: policy }), /Refusing to route rather than falling back to v1/);
});

// --- Correction 2: the pipeline must forward the whole validator context -----------------------
test("runPipeline forwards supportedPriorSourceIds instead of whitelisting fields", async () => {
  const w = window1();
  let seen;
  const provider = {
    name: "probe",
    async organize() {
      const verdict = mockMemoryEditor(w, { subjectNames: ["张小年"] });
      return { verdict };
    },
  };
  const probePolicy = {
    id: "probe-policy",
    decide: ({ worthiness }) => { seen = true; return { action: "store_only", reviewRequirement: "n/a", toGlimmerPool: false }; },
  };
  const result = await runPipeline(w, {
    subject: { primaryName: "张小年", aliases: [] },
    provider,
    windowFingerprint: "fp-ctx",
    persist: false,
    context: { existingLifeEvents: [], recentSameTypeCount: 0, supportedPriorSourceIds: ["prior-1"], routingPolicy: probePolicy, expectedRoutingPolicyId: "probe-policy" },
  });
  // If the context were whitelisted, expectedRoutingPolicyId would be dropped and the injected
  // policy ignored — the pipeline would silently route with v1 and never reach the probe.
  assert.ok(seen, "the injected routing policy must reach the validator through runPipeline");
  assert.equal(result.outcome.action, "store_only");
});

// --- Correction 2: provenance subset invariant --------------------------------------------------
test("the request manifest proves returned ids are a subset of serialized ids", () => {
  const realId = "wechat-message:canonical:" + "a".repeat(64);
  const otherId = "wechat-message:canonical:" + "b".repeat(64);
  const body = JSON.stringify({ messages: [{ content: `sourceId=${realId} ref=item:${"c".repeat(24)}#span-0` }] });
  const ok = buildRequestManifest({
    windowId: "w1", requestBody: body, windowSourceIds: [realId], neighbourSourceIds: [], priorObservationSourceIds: [realId], existingMemoryIds: [],
    returnedSourceIds: [realId], returnedEvidenceRefs: [`item:${"c".repeat(24)}#span-0`],
  });
  assert.equal(ok.subsetHolds, true);
  assert.deepEqual(ok.unexplainedSourceIds, []);

  const violation = buildRequestManifest({
    windowId: "w1", requestBody: body, windowSourceIds: [realId], neighbourSourceIds: [], priorObservationSourceIds: [], existingMemoryIds: [],
    returnedSourceIds: [realId, otherId], returnedEvidenceRefs: [],
  });
  assert.equal(violation.subsetHolds, false);
  assert.deepEqual(violation.unexplainedSourceIds, [otherId], "an id never serialized must be flagged, not explained away");
});
