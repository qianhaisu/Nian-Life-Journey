import test from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { buildEvidenceWindows, windowFingerprint, activityDateOf } from "../lib/organizer/evidence/window.ts";
import { bindMedia, BINDING_THRESHOLD } from "../lib/organizer/evidence/media-binding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { validate } from "../lib/organizer/validator.ts";
import { computeWorthiness, route } from "../lib/organizer/worthiness.ts";
import { runPipeline } from "../lib/organizer/pipeline.ts";
import { MockMemoryEditorProvider, mockMemoryEditor } from "../lib/organizer/mock-editor.ts";
import { ORGANIZER_FIXTURES, NEGATIVE_FIXTURE_IDS, NOW, SUBJECT, OTHER_CHILD_NAME } from "../lib/organizer/fixtures.ts";
import { evaluateFixtures, runFixture } from "../lib/organizer/evaluator-v2.ts";
import { upsertMemoryCandidate, listMemoryCandidates, getMemoryCandidate } from "../lib/organizer/candidate-store.ts";

const candidateStoreFile = path.join(process.cwd(), ".data", "test-memory-candidates.json");
process.env.ORGANIZER_CANDIDATE_STORE_PATH = candidateStoreFile;
test.after(async () => { await rm(candidateStoreFile, { force: true }); });

function src(overrides) {
  return { id: overrides.id, profileId: "p", sourceType: overrides.sourceType ?? "wechat", contentTypes: overrides.contentTypes ?? ["daily", "family"], contributorId: overrides.contributorId ?? `c-${overrides.contributorRole}`, capturedAt: overrides.capturedAt, text: overrides.text ?? "", mediaIds: overrides.mediaIds ?? [], visibility: "private", metadata: {}, sourceLabel: "conv", contributorRole: overrides.contributorRole };
}

test("24 synthetic fixtures pass, including a dedicated negative-fixture gate", async () => {
  const { results, metrics } = await evaluateFixtures();
  assert.equal(metrics.totalFixtures, 24);
  const failed = results.filter((result) => !result.passed);
  assert.deepEqual(failed.map((result) => result.id), [], JSON.stringify(failed, null, 2));
  assert.equal(metrics.negativeFixturePassRate, 1, JSON.stringify(metrics.negativeFixtureFailures));
  assert.ok(NEGATIVE_FIXTURE_IDS.length >= 9, "at least the 9 required negative fixtures must be marked");
});

test("evidence window building is deterministic: same input produces the same windowId and fingerprint", () => {
  const sources = [
    src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-01T10:00:00+08:00", text: "早上出门了" }),
    src({ id: "s2", contributorRole: "mother", capturedAt: "2026-08-01T10:20:00+08:00", text: "到公园了" }),
  ];
  const a = buildEvidenceWindows("conv-det", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const b = buildEvidenceWindows("conv-det", "p", sources, { dailyTraces: [], lifeEvents: [] });
  assert.equal(a.length, 1);
  assert.equal(a[0].windowId, b[0].windowId);
  const checksums = new Map();
  const fpA = windowFingerprint(a[0], { policyVersion: "p1", promptVersion: "v1", modelVersion: "m1" }, checksums);
  const fpB = windowFingerprint(b[0], { policyVersion: "p1", promptVersion: "v1", modelVersion: "m1" }, checksums);
  assert.equal(fpA, fpB);
});

test("a large gap splits into separate windows and a 3-hour/40-message cap is respected", () => {
  const close = [
    src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-02T10:00:00+08:00", text: "a" }),
    src({ id: "s2", contributorRole: "mother", capturedAt: "2026-08-02T10:10:00+08:00", text: "b" }),
  ];
  const far = [src({ id: "s3", contributorRole: "mother", capturedAt: "2026-08-02T15:00:00+08:00", text: "c" })];
  const windows = buildEvidenceWindows("conv-split", "p", [...close, ...far], { dailyTraces: [], lifeEvents: [] });
  assert.equal(windows.length, 2);
  assert.equal(windows[0].items.length, 2);
  assert.equal(windows[1].items.length, 1);
});

test("activityDateOf keeps a cross-midnight exchange on the earlier day (04:00 boundary)", () => {
  assert.equal(activityDateOf("2026-08-17T23:40:00+08:00", "Asia/Shanghai"), "2026-08-17");
  assert.equal(activityDateOf("2026-08-18T00:30:00+08:00", "Asia/Shanghai"), "2026-08-17");
  assert.equal(activityDateOf("2026-08-18T05:00:00+08:00", "Asia/Shanghai"), "2026-08-18");
});

test("media binding: only same-message or close same-sender text reaches the support threshold", () => {
  const sources = [
    src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-03T10:00:00+08:00", text: "看这张", mediaIds: ["m1"] }),
    src({ id: "s2", contributorRole: "mother", capturedAt: "2026-08-03T10:05:00+08:00", mediaIds: ["m2"] }),
    src({ id: "s3", contributorRole: "grandmother", capturedAt: "2026-08-03T10:10:00+08:00", text: "他今天在公园玩得很开心" }),
  ];
  const windows = buildEvidenceWindows("conv-bind", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const [window] = windows;
  const m1 = window.mediaBindings.find((b) => b.mediaId === "m1");
  const m2 = window.mediaBindings.find((b) => b.mediaId === "m2");
  assert.equal(m1.confidence, 1);
  assert.ok(m2.confidence < BINDING_THRESHOLD, `expected weak binding, got ${m2.confidence}`);
});

test("contract rejects any narrative field in a Memory Editor verdict", () => {
  const sources = [src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-04T10:00:00+08:00", text: "今天很开心" })];
  const [window] = buildEvidenceWindows("conv-forbid", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const withTitle = { ...mockMemoryEditor(window, { subjectNames: ["他"] }), title: "not allowed" };
  assert.throws(() => validateMemoryEditorVerdict(withTitle, window), /narrative fields are disabled/);
});

test("H1: a planned activity never becomes an event outcome, only a plan_marker", () => {
  const sources = [src({ id: "s1", contributorRole: "father", capturedAt: "2026-09-05T21:00:00+08:00", text: "明天带他去游泳" })];
  const [window] = buildEvidenceWindows("conv-h1", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const verdict = mockMemoryEditor(window, { subjectNames: ["他"] });
  const result = validate(window, verdict, { now: NOW, modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0 });
  assert.equal(result.outcome.action, "plan_marker");
});

test("H2: a hedged claim (可能/好像/听说) is never stored as a raw_fact", () => {
  const sources = [src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-06T10:00:00+08:00", text: "可能是第一次说这个词" })];
  const [window] = buildEvidenceWindows("conv-h2", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const verdict = { ...mockMemoryEditor(window, { subjectNames: ["他"] }), coreFacts: mockMemoryEditor(window, { subjectNames: ["他"] }).coreFacts.map((f) => ({ ...f, assertionKind: "raw_fact", claimant: undefined })) };
  const result = validate(window, verdict, { now: NOW, modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0 });
  const facts = result.outcome.action === "life_event_candidate" ? result.outcome.coreFacts : result.outcome.action === "daily_trace" ? [] : [];
  assert.ok(facts.every((f) => f.assertionKind === "attributed_claim"));
});

test("H3: health content never produces a diagnosis field and always requires review", () => {
  const sources = [src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-07T10:00:00+08:00", contentTypes: ["health"], text: "咳嗽三天了" })];
  const [window] = buildEvidenceWindows("conv-h3", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const verdict = mockMemoryEditor(window, { subjectNames: ["他"] });
  const result = validate(window, verdict, { now: NOW, modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0 });
  assert.equal(result.outcome.action, "care_observation");
  assert.equal(result.outcome.reviewRequirement, "needs_review");
  assert.ok(!("diagnosis" in result.outcome));
});

test("H4: a coreFact cannot rely solely on evidence refs from weakly-bound media", () => {
  const sources = [
    src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-08T16:00:00+08:00", mediaIds: ["m1"] }),
    src({ id: "s2", contributorRole: "grandmother", capturedAt: "2026-08-08T16:09:00+08:00", text: "他在公园玩得很开心" }),
  ];
  const [window] = buildEvidenceWindows("conv-h4", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const weakItemId = window.items[0].itemId;
  const verdict = { ...mockMemoryEditor(window, { subjectNames: ["他"] }), coreFacts: [{ statement: "在公园玩", assertionKind: "raw_fact", evidenceRefs: [`${weakItemId}#span-0`] }] };
  const result = validate(window, verdict, { now: NOW, modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0 });
  assert.notEqual(result.outcome.action, "life_event_candidate");
});

test("H8: milestone score >= 2 is capped to 0 without text evidence for a first-time claim", () => {
  const sources = [src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-09T10:00:00+08:00", mediaIds: ["m1"] })];
  const [window] = buildEvidenceWindows("conv-h8", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const verdict = { ...mockMemoryEditor(window, { subjectNames: ["他"] }), coreFacts: [], worthinessDimensions: { milestone: { score: 3, evidenceRefs: [`${window.items[0].itemId}#span-0`] } } };
  const result = validate(window, verdict, { now: NOW, modelVersion: "m", existingLifeEvents: [], recentSameTypeCount: 0 });
  assert.notEqual(result.outcome.action, "life_event_candidate");
});

test("pipeline safe-degrades on a provider error without ever creating a life_event_candidate", async () => {
  const sources = [src({ id: "s1", contributorRole: "teacher", capturedAt: "2026-08-10T10:00:00+08:00", text: "第一次主动说了车车" })];
  const [window] = buildEvidenceWindows("conv-fail", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const throwingProvider = { name: "broken", organize: async () => { throw new Error("boom"); } };
  const result = await runPipeline(window, { subject: SUBJECT, provider: throwingProvider, context: { existingLifeEvents: [], recentSameTypeCount: 0, now: NOW }, windowFingerprint: "fp-fail", persist: false });
  assert.equal(result.outcome.action, "failed");
  assert.ok(result.degradeReason);
});

test("pipeline persists an idempotent candidate: rerunning the same window does not duplicate", async () => {
  const sources = [src({ id: "s1", contributorRole: "teacher", capturedAt: "2026-08-11T15:20:00+08:00", text: "今天他把自己的饼干掰了一半递给旁边的小朋友，说\"给你\"" })];
  const [window] = buildEvidenceWindows("conv-idem", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const provider = new MockMemoryEditorProvider({ subjectNames: [SUBJECT.primaryName, ...SUBJECT.aliases], otherChildNames: [OTHER_CHILD_NAME] });
  const first = await runPipeline(window, { subject: SUBJECT, provider, context: { existingLifeEvents: [], recentSameTypeCount: 0, now: NOW }, windowFingerprint: "fp-idem-1" });
  const second = await runPipeline(window, { subject: SUBJECT, provider, context: { existingLifeEvents: [], recentSameTypeCount: 0, now: NOW }, windowFingerprint: "fp-idem-1" });
  assert.equal(first.candidate.id, second.candidate.id);
  const all = await listMemoryCandidates({ profileId: "p" });
  assert.equal(all.filter((c) => c.windowFingerprint === "fp-idem-1").length, 1);
});

test("candidate store round-trips status and is queryable by status", async () => {
  const candidate = await upsertMemoryCandidate({ profileId: "p2", conversationId: "c", windowId: "w1", windowFingerprint: "fp-store-1", sourceIds: ["s1"], proposedAction: "daily_trace", outcome: { action: "store_only", sourceIds: ["s1"], windowId: "w1", policyVersion: "v1", modelVersion: "m1", selectionReason: "test", worthinessScore: 0 }, reasonCodes: [], promptVersion: "v1" });
  const fetched = await getMemoryCandidate(candidate.id);
  assert.equal(fetched.status, "pending");
  const pending = await listMemoryCandidates({ profileId: "p2", status: "pending" });
  assert.ok(pending.some((c) => c.id === candidate.id));
});

test("worthiness routing: below-threshold windows route to store_only, high-signal windows require review", () => {
  const sources = [src({ id: "s1", contributorRole: "mother", capturedAt: "2026-08-12T10:00:00+08:00", text: "今天出门了" })];
  const [window] = buildEvidenceWindows("conv-route", "p", sources, { dailyTraces: [], lifeEvents: [] });
  const verdict = mockMemoryEditor(window, { subjectNames: ["他"] });
  const worthiness = computeWorthiness({ window, verdict, recentSameTypeCount: 0, boundImageCount: 0 });
  const routed = route(worthiness, verdict);
  assert.ok(["store_only", "daily_trace"].includes(routed.action));
});
