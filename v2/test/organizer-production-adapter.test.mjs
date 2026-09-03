import test from "node:test";
import assert from "node:assert/strict";
import { planArtifacts, assertPolicy, AdapterContractError, ADAPTER_REVIEW_DECISION, PRODUCTION_ADAPTER_VERSION } from "../lib/organizer/production-adapter.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { buildMediaIndex } from "../lib/organizer/evidence/media-index.ts";

// The V2 production adapter. Its whole contract is: persist the decision, never make one.
//
// Every case below is a PURE plan — no database — which is exactly why the safety rules are worth
// pinning here: media tiers, provenance subsets, review independence and artifact identity are all
// decided before a single row is written, and a dry run shows the same object these tests assert on.

const POLICY = {
  organizerVersion: PRODUCTION_ADAPTER_VERSION,
  judgmentPolicyId: "judgment-v6-frozen",
  writerVersion: "writer-v2",
  promptVersion: "memory-editor-v4",
  policyVersion: "contract-v2",
  provider: "deepseek",
  model: "deepseek-v4-pro",
  allowedMediaTiers: ["confirmed"],
};

let seq = 0;
const source = (opts = {}) => {
  seq += 1;
  return {
    id: opts.id ?? `wechat-message:src-${seq}`, profileId: "profile-zhangnian", sourceType: "wechat",
    contentTypes: ["family"], contributorId: "contributor-system",
    capturedAt: opts.capturedAt ?? `2026-03-01T10:0${seq % 10}:00.000Z`,
    text: opts.text ?? "小年今天自己站起来了。", mediaIds: opts.mediaIds ?? [],
    sourceLabel: "conversation:test", visibility: "family",
    metadata: { senderDigest: opts.senderDigest ?? "digest-a", recordOrdinal: seq },
  };
};
const windowOf = (sources, mediaIndex) =>
  buildEvidenceWindows("conversation:test", "profile-zhangnian", sources, { dailyTraces: [], lifeEvents: [] }, mediaIndex ? { mediaIndex } : {})[0];

const photoIndex = (mediaId) => buildMediaIndex(
  [{ mediaId, mediaAssetId: `asset-${mediaId}`, mediaType: "photo", provider: "wechat", checksum: "a".repeat(64) }],
  [{ mediaAssetId: `asset-${mediaId}`, provider: "hot", variant: "web", status: "ready" }],
);
const videoIndex = (mediaId) => buildMediaIndex(
  [{ mediaId, mediaAssetId: `asset-${mediaId}`, mediaType: "video", mimeType: "video/mp4", provider: "wechat", checksum: "b".repeat(64) }],
  [{ mediaAssetId: `asset-${mediaId}`, provider: "wechat", variant: "original", status: "ready" }],
);

let idSeq = 0;
const newId = (prefix) => `${prefix}-fixed-${++idSeq}`;
const NOW = "2026-03-02T00:00:00.000Z";

const memoryOutcome = (window, extra = {}) => ({
  action: "life_event_candidate", sourceIds: window.items.map((i) => i.sourceId), windowId: window.windowId,
  policyVersion: "contract-v2", modelVersion: "deepseek-v4-pro", occurredAt: "2026-03-01",
  eventType: "moment", contentTypes: ["family"], coreFacts: [], quotableLines: [],
  worthinessDimensions: {}, uncertainty: { time: "low", subject: "low", semantics: "low" },
  sensitivityFlags: [], prohibitedInferences: [], reviewRequirement: "needs_review",
  confidence: 0.9, selectionReason: "t", worthinessScore: 61, ...extra,
});
const traceOutcome = (window, extra = {}) => ({
  action: "daily_trace", sourceIds: window.items.map((i) => i.sourceId), windowId: window.windowId,
  policyVersion: "contract-v2", modelVersion: "deepseek-v4-pro", occurredAt: "2026-03-01",
  scopes: ["family"], contentTypes: ["family"],
  traceLines: [{ text: "小年今天自己站起来了", evidenceRefs: ["r"] }],
  selectionReason: "ordinary_day", worthinessScore: 14, ...extra,
});
const storyOf = (usedMediaIds) => ({ title: "他自己站起来了", story: "傍晚，小年扶着沙发自己站了起来。", usedMediaIds });
const plan = (input) => planArtifacts({ policy: POLICY, now: NOW, newId, ...input });

// ---------------------------------------------------------------- 1-4: memory routes

test("1. create_memory text-only: no media, no hero, complete Memory", () => {
  const window = windowOf([source()]);
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-1", story: storyOf([]) });
  assert.equal(result.action, "life_event_candidate");
  assert.equal(result.lifeEvent.event.mediaIds.length, 0);
  assert.equal(result.lifeEvent.event.heroMediaId, undefined, "no media means no hero, never a borrowed one");
  assert.equal(result.lifeEvent.event.title, "他自己站起来了");
  assert.equal(result.lifeEvent.event.organizationFingerprint, "fp-1");
  assert.equal(result.lifeEvent.links.length, 1);
  assert.equal(result.lifeEvent.links[0].role, "primary");
});

test("2. create_memory + confirmed photo links it and makes it the hero", () => {
  const window = windowOf([source({ mediaIds: ["m-photo"] })], photoIndex("m-photo"));
  assert.equal(window.mediaBindings[0].tier, "confirmed");
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-2", story: storyOf(["m-photo"]) });
  assert.deepEqual(result.lifeEvent.event.mediaIds, ["m-photo"]);
  assert.equal(result.lifeEvent.event.heroMediaId, "m-photo");
  assert.equal(result.mediaDecisions[0].linked, true);
});

test("3. create_memory + confirmed VIDEO links even with no renderable derivative", () => {
  // The 120 backfilled videos are original-only. "Cannot play it yet" must not mean "not evidence".
  const window = windowOf([source({ mediaIds: ["m-video"] })], videoIndex("m-video"));
  assert.equal(window.items[0].mediaRefs[0].mediaType, "video");
  assert.equal(window.items[0].mediaRefs[0].derivative, "unavailable");
  assert.equal(window.items[0].mediaRefs[0].original, "available");
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-3", story: storyOf(["m-video"]) });
  assert.deepEqual(result.lifeEvent.event.mediaIds, ["m-video"]);
});

test("4. strong_contextual is refused unless the policy opts in, and then it links", () => {
  const items = [source({ text: "", mediaIds: ["m-adj"], capturedAt: "2026-03-01T10:00:00.000Z" }), source({ text: "刚睡醒的样子", capturedAt: "2026-03-01T10:00:30.000Z" })];
  const window = windowOf(items, photoIndex("m-adj"));
  assert.equal(window.mediaBindings[0].tier, "strong_contextual");

  const strict = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-4a", story: storyOf(["m-adj"]) });
  assert.equal(strict.lifeEvent.event.mediaIds.length, 0, "confirmed-only policy refuses it");
  assert.match(strict.notes.join(" "), /not attachable/);

  const permissive = planArtifacts({ policy: { ...POLICY, allowedMediaTiers: ["confirmed", "strong_contextual"] }, now: NOW, newId, window, outcome: memoryOutcome(window), windowFingerprint: "fp-4b", story: storyOf(["m-adj"]) });
  assert.deepEqual(permissive.lifeEvent.event.mediaIds, ["m-adj"]);
});

// ---------------------------------------------------------------- 5: the hard media boundary

test("5. day_level / month_level / unbound can never be linked, at any policy", () => {
  for (const tier of ["day_level", "month_level", "unbound"]) {
    assert.throws(
      () => assertPolicy({ ...POLICY, allowedMediaTiers: [tier] }),
      AdapterContractError,
      `${tier} must be refused by the policy check itself`,
    );
  }
});

test("5b. an unbound photo in the window is refused even though the Writer asked for it", () => {
  const window = windowOf([source({ text: "", mediaIds: ["m-lonely"] })], photoIndex("m-lonely"));
  assert.equal(window.mediaBindings[0].tier, "unbound");
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-5", story: storyOf(["m-lonely"]) });
  assert.equal(result.lifeEvent.event.mediaIds.length, 0);
  assert.equal(result.mediaDecisions[0].linked, false);
});

test("5c. a Writer cannot introduce media the window does not contain", () => {
  const window = windowOf([source()]);
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-5c", story: storyOf(["quark-photo-same-day"]) });
  assert.equal(result.lifeEvent.event.mediaIds.length, 0);
  assert.match(result.mediaDecisions[0].reason, /not present in this window/);
});

// ---------------------------------------------------------------- 6-8: other routes

test("6. daily_trace persists a trace with evidence lines and NO media links", () => {
  const window = windowOf([source({ mediaIds: ["m-photo"] })], photoIndex("m-photo"));
  const result = plan({ window, outcome: traceOutcome(window), windowFingerprint: "fp-6" });
  assert.equal(result.dailyTrace.organizationFingerprint, "fp-6");
  assert.deepEqual(result.dailyTrace.entries, ["小年今天自己站起来了"]);
  assert.equal(result.lifeEvent, undefined);
  assert.equal(result.review, undefined, "a trace is provenance, not published prose");
  assert.equal(result.run.targetId, result.dailyTrace.id);
});

test("7. store_only creates no artifact at all", () => {
  const window = windowOf([source()]);
  const outcome = { action: "store_only", sourceIds: window.items.map((i) => i.sourceId), windowId: window.windowId, policyVersion: "contract-v2", modelVersion: "m", selectionReason: "below threshold", worthinessScore: 0 };
  const result = plan({ window, outcome, windowFingerprint: "fp-7" });
  assert.equal(result.lifeEvent, undefined);
  assert.equal(result.dailyTrace, undefined, "a route that did not say trace must never produce one");
  assert.equal(result.review, undefined);
  assert.equal(result.run.action, "store_only");
});

test("8. a plan marker never becomes an occurred artifact", () => {
  const window = windowOf([source({ text: "明天准备带他去打疫苗" })]);
  const outcome = { action: "plan_marker", sourceIds: window.items.map((i) => i.sourceId), windowId: window.windowId, policyVersion: "contract-v2", modelVersion: "m", plannedFor: "2026-03-05", activityKeywords: [], expiresAt: "2026-03-08", selectionReason: "planned", worthinessScore: 0 };
  const result = plan({ window, outcome, windowFingerprint: "fp-8" });
  assert.equal(result.lifeEvent, undefined);
  assert.equal(result.dailyTrace, undefined);
  assert.equal(result.run.action, "plan_marker");
});

// ---------------------------------------------------------------- 9-10: writer / validator refusal

test("9. a Memory route with no Writer output is refused, never invented", () => {
  const window = windowOf([source()]);
  assert.throws(
    () => plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-9" }),
    AdapterContractError,
    "the adapter must never write a title or story of its own",
  );
});

test("10. a rejected narrative simply never reaches the adapter as a Memory route", () => {
  // The Narrative Validator's refusal is expressed by the pipeline degrading the route. The adapter
  // must honour that degraded route and write no Memory — it does not get a second opinion.
  const window = windowOf([source()]);
  const outcome = { action: "store_only", sourceIds: window.items.map((i) => i.sourceId), windowId: window.windowId, policyVersion: "contract-v2", modelVersion: "m", selectionReason: "narrative_rejected", worthinessScore: 0 };
  const result = plan({ window, outcome, windowFingerprint: "fp-10", story: storyOf([]) });
  assert.equal(result.lifeEvent, undefined, "a story present on a store_only route must not resurrect a Memory");
});

// ---------------------------------------------------------------- 11: identity and replay

test("11. identity is the window fingerprint — not a timestamp, not prose", () => {
  const window = windowOf([source()]);
  const a = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-same", story: storyOf([]) });
  const b = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-same", story: { title: "完全不同的标题", story: "完全不同的正文。", usedMediaIds: [] }, now: "2027-01-01T00:00:00.000Z" });
  assert.equal(a.organizationFingerprint, b.organizationFingerprint, "different prose and clock, same identity");
  assert.equal(a.run.organizationFingerprint, b.run.organizationFingerprint);
  assert.equal(a.lifeEvent.event.organizationFingerprint, b.lifeEvent.event.organizationFingerprint);
});

test("11b. the review row is keyed to its own artifact and always needs review", () => {
  const window = windowOf([source()]);
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-11b", story: storyOf([]), judgment: { reasonCodes: ["x"], gateA: "explicit", subjectRelevance: "primary" } });
  assert.equal(result.review.targetKind, "life_event");
  assert.equal(result.review.targetId, result.lifeEvent.event.id, "the review belongs to THIS artifact");
  // One canonical vocabulary: the ledger decision is a QualityDecision, not the Memory Editor's
  // own `reviewRequirement`. Fail-closed either way — only "approved" publishes.
  assert.equal(result.review.decision, ADAPTER_REVIEW_DECISION);
  assert.equal(result.review.decision, "needs_human_review", "AI prose is never auto-published");
  assert.equal(result.review.reviewFingerprint, "fp-11b:life_event");
  assert.deepEqual(result.review.reasonCodes, ["x"]);
  assert.equal(result.review.gateA, "explicit");
});

// ---------------------------------------------------------------- provenance

test("provenance: an outcome may not cite a source outside its evidence window", () => {
  const window = windowOf([source()]);
  const outcome = memoryOutcome(window, { sourceIds: [...window.items.map((i) => i.sourceId), "wechat-message:not-in-window"] });
  assert.throws(() => plan({ window, outcome, windowFingerprint: "fp-p" }), AdapterContractError);
});

test("provenance: links cover exactly the outcome's sources, in order", () => {
  const window = windowOf([source({ id: "src-a" }), source({ id: "src-b" })]);
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-p2", story: storyOf([]) });
  assert.deepEqual(result.lifeEvent.links.map((l) => l.rawSourceId), result.sourceIds);
  assert.deepEqual(result.lifeEvent.event.sourceIds, result.sourceIds);
  assert.equal(result.lifeEvent.links.filter((l) => l.role === "primary").length, 1);
});

// ---------------------------------------------------------------- policy is explicit

test("policy: every version field is required — no silent defaults", () => {
  for (const field of ["organizerVersion", "judgmentPolicyId", "writerVersion", "promptVersion", "policyVersion", "provider"]) {
    assert.throws(() => assertPolicy({ ...POLICY, [field]: "" }), AdapterContractError, `${field} must be required`);
  }
});

test("policy: the run records who decided, with what, at which version", () => {
  const window = windowOf([source()]);
  const result = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-v", story: storyOf([]) });
  assert.equal(result.run.organizerType, "ai");
  assert.equal(result.run.organizerVersion, PRODUCTION_ADAPTER_VERSION);
  assert.equal(result.run.provider, "deepseek");
  assert.equal(result.run.promptVersion, "memory-editor-v4");
  assert.equal(result.run.sourceCount, result.sourceIds.length);
});

// ---------------------------------------------------------------- 12-14: applier, replay, review
//
// A narrow in-memory double of the five repository calls the adapter makes. Deliberately not the
// JSON or Postgres backend: what is under test is the adapter's ordering and idempotency, and a
// double makes a concurrent second writer trivial to stage.

function fakeRepository() {
  const state = { events: [], traces: [], runs: [], reviews: [], organizedSources: [], calls: [] };
  const repo = {
    async findOrganizerRun(fp) { state.calls.push("findOrganizerRun"); return state.runs.find((r) => r.organizationFingerprint === fp) ?? null; },
    async persistOrganization(sourceIds, event) { state.calls.push("persistOrganization"); state.events.push(event); return event; },
    async persistDailyTrace(trace) {
      state.calls.push("persistDailyTrace");
      // Mirrors the production unique index on organization_fingerprint.
      const existing = state.traces.find((t) => t.organizationFingerprint === trace.organizationFingerprint);
      if (existing) return existing;
      state.traces.push(trace);
      return trace;
    },
    async persistOrganizerRun(run) { state.calls.push("persistOrganizerRun"); state.runs.push(run); return run; },
    async markSourcesOrganized(ids) { state.calls.push("markSourcesOrganized"); state.organizedSources.push(...ids); },
    async persistQualityReview(review) { state.calls.push("persistQualityReview"); state.reviews.push(review); },
  };
  return { repo, state };
}
const applyOpts = { newId, now: NOW };

test("12. replay writes nothing the second time", async () => {
  const { applyPlan } = await import("../lib/organizer/production-adapter.ts");
  const { repo, state } = fakeRepository();
  const window = windowOf([source({ mediaIds: ["m-photo"] })], photoIndex("m-photo"));
  const built = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-replay", story: storyOf(["m-photo"]) });

  const first = await applyPlan(built, repo, applyOpts);
  assert.equal(first.applied, true);
  assert.equal(state.events.length, 1);
  assert.equal(state.reviews.length, 1);
  assert.equal(state.runs.length, 1);

  const second = await applyPlan(built, repo, applyOpts);
  assert.equal(second.applied, false);
  assert.match(second.reason, /already organized/);
  assert.equal(state.events.length, 1, "0 duplicate LifeEvent");
  assert.equal(state.reviews.length, 1, "0 duplicate review row");
  assert.equal(state.runs.length, 1, "0 duplicate organizer run");
});

test("13. concurrent DailyTrace writers converge on one artifact", async () => {
  const { applyPlan } = await import("../lib/organizer/production-adapter.ts");
  const { repo, state } = fakeRepository();
  const window = windowOf([source()]);
  const built = plan({ window, outcome: traceOutcome(window), windowFingerprint: "fp-concurrent" });

  // Both read "no prior run" before either writes — the race the unique index exists to survive.
  await Promise.all([applyPlan(built, repo, applyOpts), applyPlan(built, repo, applyOpts)]);
  assert.equal(state.traces.length, 1, "the fingerprint unique index collapses the race to one trace");
});

test("14. the review row is written BEFORE the run that marks the batch done", async () => {
  const { applyPlan } = await import("../lib/organizer/production-adapter.ts");
  const { repo, state } = fakeRepository();
  const window = windowOf([source()]);
  const built = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-order", story: storyOf([]) });
  await applyPlan(built, repo, applyOpts);
  const order = state.calls.filter((c) => c !== "findOrganizerRun");
  assert.deepEqual(order, ["persistOrganization", "persistQualityReview", "persistOrganizerRun"],
    "a crash must never leave an artifact whose ledger row was never written");
});

test("14b. a partial failure leaves no organizer run, so the batch stays retryable", async () => {
  const { applyPlan } = await import("../lib/organizer/production-adapter.ts");
  const { repo, state } = fakeRepository();
  repo.persistQualityReview = async () => { throw new Error("ledger unavailable"); };
  const window = windowOf([source()]);
  const built = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-partial", story: storyOf([]) });
  await assert.rejects(() => applyPlan(built, repo, applyOpts), /ledger unavailable/);
  assert.equal(state.runs.length, 0, "no run recorded, so the fingerprint is not marked done");

  // Once the ledger is back, the same fingerprint is picked up again and completes.
  repo.persistQualityReview = async (review) => { state.calls.push("persistQualityReview"); state.reviews.push(review); };
  const retry = await applyPlan(built, repo, applyOpts);
  assert.equal(retry.applied, true, "the batch is retryable");
  assert.equal(state.runs.length, 1);
  assert.equal(state.reviews.length, 1);
});

test("review independence: an AI artifact publishes only on an explicit ledger decision", async () => {
  const { indexReviews, isEventPublishable, requiresQualityReview } = await import("../lib/organizer/quality-review.ts");
  const window = windowOf([source()]);
  const built = plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-indep", story: storyOf([]) });
  const event = built.lifeEvent.event;

  assert.equal(requiresQualityReview(event), true, "an adapter-written Memory is AI-derived and fail-closed");
  assert.equal(isEventPublishable(event, indexReviews([])), false, "no row: not published");
  // A sibling artifact's approval must not leak across ids.
  const siblingApproved = indexReviews([{ targetKind: "life_event", targetId: "some-other-event", decision: "approved" }]);
  assert.equal(isEventPublishable(event, siblingApproved), false, "another artifact's approval is not this one's");
  assert.equal(isEventPublishable(event, indexReviews([{ targetKind: "life_event", targetId: event.id, decision: "approved" }])), true);
});

test("15. artifact ids are derived from the fingerprint, so a partial-failure retry repairs rather than duplicates", async () => {
  const { applyPlan, artifactIdFor } = await import("../lib/organizer/production-adapter.ts");
  const { repo, state } = fakeRepository();
  // Production upserts on the primary key; the double mirrors that so a repeated id is not a new row.
  repo.persistOrganization = async (sourceIds, event) => {
    state.calls.push("persistOrganization");
    const existing = state.events.findIndex((e) => e.id === event.id);
    if (existing >= 0) state.events[existing] = event; else state.events.push(event);
    return event;
  };
  repo.persistQualityReview = async () => { throw new Error("ledger unavailable"); };

  const window = windowOf([source()]);
  // Each attempt plans FRESH, exactly as a real retry would.
  const attempt = () => plan({ window, outcome: memoryOutcome(window), windowFingerprint: "fp-derived", story: storyOf([]) });

  await assert.rejects(() => applyPlan(attempt(), repo, applyOpts), /ledger unavailable/);
  assert.equal(state.events.length, 1);

  repo.persistQualityReview = async (review) => { state.calls.push("persistQualityReview"); state.reviews.push(review); };
  const retry = await applyPlan(attempt(), repo, applyOpts);
  assert.equal(retry.applied, true);
  assert.equal(state.events.length, 1, "0 duplicate LifeEvent across a partial-failure retry");
  assert.equal(state.events[0].id, artifactIdFor("event", "fp-derived"));
  assert.equal(state.reviews[0].targetId, state.events[0].id, "the review row points at the same artifact");
});

test("15b. the same evidence always yields the same artifact id; different evidence does not", async () => {
  const { artifactIdFor } = await import("../lib/organizer/production-adapter.ts");
  assert.equal(artifactIdFor("event", "fp-a"), artifactIdFor("event", "fp-a"));
  assert.notEqual(artifactIdFor("event", "fp-a"), artifactIdFor("event", "fp-b"));
  assert.notEqual(artifactIdFor("event", "fp-a"), artifactIdFor("trace", "fp-a"), "an event and a trace are different artifacts");
});
