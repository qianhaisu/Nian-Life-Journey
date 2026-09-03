// What the NEW-INPUT V2 cutover is allowed to do, pinned end to end.
//
// The RC-12 canary proved the Memory write path once, by hand, with the ledger written through a
// raw SQL statement the canary carried privately. These cases pin the same behaviour where it now
// lives — the Repository, the adapter, the selector and the organizer the queue worker runs — so it
// is production's behaviour rather than a script's.
//
// The JSON repository is used as a REAL backend here (same convention as repository-contract's json
// suite): every row these tests assert on was written by the same code paths PostgreSQL runs.
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createJsonRepository } from "../lib/db/json-repository.ts";
import { indexReviews, isEventPublishable, isTracePublishable, normalizeQualityDecision, requiresQualityReview } from "../lib/organizer/quality-review.ts";
import { ADAPTER_REVIEW_DECISION, applyPlan, planArtifacts } from "../lib/organizer/production-adapter.ts";
import { OrganizerSelectionError, describeSelection, jobUsesV2, selectProductionOrganizer } from "../lib/organizer/production-selector.ts";
import { EvidenceOrganizerV2 } from "../lib/organizer/v2-organizer.ts";
import { getOrganizerForJob } from "../lib/organizer/index.ts";
import { FROZEN_V6_JUDGMENT } from "../lib/organizer/judgment-policy.ts";

const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

const uid = (prefix) => `${prefix}-${randomUUID()}`;

// ---------------------------------------------------------------- configuration fixtures

const V2_ENV = {
  ORGANIZER_V2_ENABLED: "true",
  ORGANIZER_V2_JUDGMENT_POLICY: FROZEN_V6_JUDGMENT.id,
  ORGANIZER_V2_WRITER_VERSION: "writer-v2",
  ORGANIZER_V2_PROMPT_VERSION: "memory-editor-v4",
  ORGANIZER_V2_MODEL: "deepseek-v4-pro",
};
const newInputEnv = (after, extra = {}) => ({ ...V2_ENV, ORGANIZER_V2_NEW_INPUT_AFTER: after, ...extra });
const allowlistEnv = (ids) => ({ ...V2_ENV, ORGANIZER_V2_SOURCE_ALLOWLIST: ids.join(",") });

const CUTOVER = "2026-09-04T00:00:00.000Z";
const AFTER = "2026-09-04T09:00:00.000Z";
const BEFORE = "2026-08-31T07:01:49.656Z"; // the newest job production actually has

// ---------------------------------------------------------------- Phase 3: one typed decision

test("the adapter's ledger decision is a QualityDecision, and it is the fail-closed one", () => {
  assert.equal(ADAPTER_REVIEW_DECISION, "needs_human_review");
  assert.equal(normalizeQualityDecision(ADAPTER_REVIEW_DECISION), ADAPTER_REVIEW_DECISION);
});

test("decision text outside the union is read as needs_human_review, never as approved", () => {
  // The RC-12 canary row says "needs_review" — a string the union never named. It stays exactly as
  // written in the ledger (nothing rewrites production rows) and is interpreted fail-closed.
  assert.equal(normalizeQualityDecision("needs_review"), "needs_human_review");
  assert.equal(normalizeQualityDecision("anything at all"), "needs_human_review");
  assert.equal(normalizeQualityDecision(undefined), "needs_human_review");
  assert.equal(normalizeQualityDecision("approved"), "approved");
  const event = { id: "event-v2-legacy-label", createdBy: "ai", organizerVersion: "organizer-v2-adapter-v1" };
  const reviews = indexReviews([{ targetKind: "life_event", targetId: event.id, decision: "needs_review" }]);
  assert.equal(isEventPublishable(event, reviews), false);
});

// ---------------------------------------------------------------- Phase 6: the cutover boundary

test("new-input scope routes work created after activation, and nothing else", () => {
  const selection = selectProductionOrganizer(newInputEnv(CUTOVER));
  assert.equal(selection.useV2, true);
  assert.equal(selection.scope, "new_input");
  assert.equal(selection.newInputAfter, CUTOVER);
  const sources = [uid("source")];
  assert.equal(jobUsesV2(selection, sources, { createdAt: AFTER }), true, "a job created after the cutover");
  assert.equal(jobUsesV2(selection, sources, { createdAt: BEFORE }), false, "every existing job predates it");
  assert.equal(jobUsesV2(selection, sources, {}), false, "a job with no creation time is not assumed new");
  assert.equal(jobUsesV2(selection, sources, { createdAt: CUTOVER }), false, "strictly after, so activation cannot re-route the instant's own work");
  assert.equal(jobUsesV2(selection, [], { createdAt: AFTER }), false);
});

test("a forced re-organization never takes the new-input path", () => {
  // force:true means re-cutting evidence that has already been organized — historical reprocessing
  // by definition, whatever the job's creation time says.
  const selection = selectProductionOrganizer(newInputEnv(CUTOVER));
  assert.equal(jobUsesV2(selection, [uid("source")], { createdAt: AFTER, force: true }), false);
});

test("the allowlist canary scope is unchanged by the new-input scope existing", () => {
  const ids = [uid("source"), uid("source")];
  const selection = selectProductionOrganizer(allowlistEnv(ids));
  assert.equal(selection.scope, "allowlist");
  assert.equal(jobUsesV2(selection, ids, { createdAt: BEFORE }), true, "an allowlist canary is not time-bounded");
  assert.equal(jobUsesV2(selection, [...ids, uid("source")], { createdAt: AFTER }), false, "a job that straddles the list runs on legacy");
});

test("V2 without a boundary, with two boundaries, or with an unparseable instant fails loudly", () => {
  assert.throws(() => selectProductionOrganizer({ ...V2_ENV }), OrganizerSelectionError);
  assert.throws(() => selectProductionOrganizer({ ...newInputEnv(CUTOVER), ORGANIZER_V2_SOURCE_ALLOWLIST: uid("source") }), /ONE boundary/);
  assert.throws(() => selectProductionOrganizer(newInputEnv("last tuesday")), /parseable timestamp/);
});

test("the run log names implementation, judgment, writer, prompt, policy and boundary", () => {
  const line = describeSelection(selectProductionOrganizer(newInputEnv(CUTOVER)));
  for (const fragment of ["organizer-v2-adapter-v1", "judgment=judgment-v6-frozen", "writer=writer-v2", "prompt=memory-editor-v4", "policy=", "scope=new_input", `after=${CUTOVER}`]) {
    assert.ok(line.includes(fragment), `missing ${fragment} in: ${line}`);
  }
  assert.match(describeSelection(selectProductionOrganizer({})), /v2=off/);
});

test("the worker routes each job itself, and legacy is what an out-of-boundary job gets", () => {
  const env = newInputEnv(CUTOVER);
  const nowJob = getOrganizerForJob({ sourceIds: [uid("source")], createdAt: AFTER }, env);
  assert.equal(nowJob.useV2, true);
  assert.ok(nowJob.organizer instanceof EvidenceOrganizerV2);
  assert.match(nowJob.description, /job=v2/);
  const oldJob = getOrganizerForJob({ sourceIds: [uid("source")], createdAt: BEFORE }, env);
  assert.equal(oldJob.useV2, false);
  assert.equal(oldJob.organizer.constructor.name, "RuleBasedMemoryOrganizer");
  const unconfigured = getOrganizerForJob({ sourceIds: [uid("source")], createdAt: AFTER }, {});
  assert.equal(unconfigured.useV2, false, "an unset configuration is the legacy organizer, as before");
});

// ---------------------------------------------------------------- Phase 2/4: writes go through the Repository

const PLAN_POLICY = {
  organizerVersion: "organizer-v2-adapter-v1",
  judgmentPolicyId: FROZEN_V6_JUDGMENT.id,
  writerVersion: "writer-v2",
  promptVersion: "memory-editor-v4",
  policyVersion: "evidence-contract-v1",
  provider: "deepseek",
  model: "deepseek-v4-pro",
  allowedMediaTiers: ["confirmed"],
};

function fakeWindow(profileId, fingerprint) {
  const sourceId = `source-${fingerprint}`;
  return {
    windowId: `window:${fingerprint}`,
    conversationId: "test conversation",
    profileId,
    activityDate: "2026-09-04",
    timeRange: { from: "2026-09-04T10:00:00.000Z", to: "2026-09-04T10:05:00.000Z" },
    items: [{ itemId: `item:${fingerprint}`, sourceId, sentAt: "2026-09-04T10:00:00.000Z", senderRole: "mother", senderDigest: "digest", text: "他自己走到门口", contentTypes: ["daily"], mediaRefs: [], locator: { document: "d", recordOrdinal: 0 }, spans: [{ id: "span-0", start: 0, end: 7 }], tier: "firsthand" }],
    mediaBindings: [],
    neighbors: { before: [], after: [] },
    priorContext: { dailyTraces: [], lifeEvents: [] },
    stats: { messageCount: 1, imageCount: 0, senderCount: 1, droppedCount: 0 },
  };
}
const memoryOutcome = (window) => ({ action: "life_event_candidate", sourceIds: window.items.map((item) => item.sourceId), windowId: window.windowId, policyVersion: "evidence-contract-v1", modelVersion: "deepseek-v4-pro", selectionReason: "test", worthinessScore: 42, occurredAt: "2026-09-04", eventType: "moment", contentTypes: ["daily"], coreFacts: [], quotableLines: [], worthinessDimensions: {}, uncertainty: {}, sensitivityFlags: [], prohibitedInferences: [], reviewRequirement: "needs_review", confidence: 0.8 });

const planFor = (window, overrides = {}) => planArtifacts({
  window,
  outcome: memoryOutcome(window),
  windowFingerprint: window.windowId.replace("window:", ""),
  policy: PLAN_POLICY,
  story: { title: "他自己走到门口", story: "妈妈说他自己走到了门口。", usedMediaIds: [] },
  judgment: { reasonCodes: [], gateA: "explicit", subjectRelevance: "primary" },
  now: "2026-09-04T10:10:00.000Z",
  newId: (prefix) => `${prefix}-${randomUUID()}`,
  ...overrides,
});

test("applyPlan writes the review through the Repository, and a replay adds nothing", async () => {
  const repo = createJsonRepository();
  const profileId = (await repo.getStore()).profile.id;
  const window = fakeWindow(profileId, randomUUID().replace(/-/g, "").slice(0, 32));
  const plan = planFor(window);
  const options = { newId: (prefix) => `${prefix}-${randomUUID()}`, now: "2026-09-04T10:10:00.000Z" };
  const first = await applyPlan(plan, repo, options);
  assert.equal(first.applied, true);
  const review = await repo.findQualityReview("life_event", plan.lifeEvent.event.id, PLAN_POLICY.promptVersion);
  assert.equal(review.decision, ADAPTER_REVIEW_DECISION);
  assert.equal(review.reviewFingerprint, `${plan.organizationFingerprint}:life_event`);

  const second = await applyPlan(plan, repo, options);
  assert.equal(second.applied, false, "the run guard refuses a replay");
  assert.equal(second.eventId, plan.lifeEvent.event.id, "a replayed Memory still reports its artifact");
  const store = await repo.getStore();
  assert.equal(store.events.filter((event) => event.id === plan.lifeEvent.event.id).length, 1);
  assert.equal(store.qualityReviews.filter((row) => row.targetId === plan.lifeEvent.event.id).length, 1);
  assert.equal(store.organizerRuns.filter((run) => run.organizationFingerprint === plan.organizationFingerprint).length, 1);
});

test("two independent artifacts get two independent reviews", async () => {
  const repo = createJsonRepository();
  const profileId = (await repo.getStore()).profile.id;
  const options = { newId: (prefix) => `${prefix}-${randomUUID()}`, now: "2026-09-04T10:10:00.000Z" };
  const plans = [planFor(fakeWindow(profileId, randomUUID().replace(/-/g, "").slice(0, 32))), planFor(fakeWindow(profileId, randomUUID().replace(/-/g, "").slice(0, 32)))];
  for (const plan of plans) await applyPlan(plan, repo, options);
  const store = await repo.getStore();
  const rows = plans.map((plan) => store.qualityReviews.find((row) => row.targetId === plan.lifeEvent.event.id));
  assert.ok(rows.every(Boolean));
  assert.notEqual(rows[0].id, rows[1].id);
  assert.notEqual(rows[0].reviewFingerprint, rows[1].reviewFingerprint);
});

test("an AI Memory whose review row fails to write stays unpublished", async () => {
  // The failure this exists to stop: a generated page reaching the family because the ledger write
  // failed. requiresQualityReview() fails closed for AI content, so a missing row hides it — the
  // error itself must also propagate, so the job is retried rather than reported as done.
  const repo = createJsonRepository();
  const profileId = (await repo.getStore()).profile.id;
  const window = fakeWindow(profileId, randomUUID().replace(/-/g, "").slice(0, 32));
  const plan = planFor(window);
  const failing = { ...repo, persistQualityReview: async () => { throw new Error("ledger unavailable"); } };
  await assert.rejects(applyPlan(plan, failing, { newId: (p) => `${p}-${randomUUID()}`, now: "2026-09-04T10:10:00.000Z" }), /ledger unavailable/);
  const store = await repo.getStore();
  const written = store.events.find((event) => event.id === plan.lifeEvent.event.id);
  assert.ok(written, "the artifact may exist — the write order puts it first on purpose");
  assert.equal(requiresQualityReview(written), true);
  assert.equal(isEventPublishable(written, indexReviews(store.qualityReviews)), false);
  assert.equal(store.organizerRuns.filter((run) => run.organizationFingerprint === plan.organizationFingerprint).length, 0, "the batch is not marked done, so it is retried");
});

// ---------------------------------------------------------------- Phase 7: the organizer the worker runs

function stubPipeline({ route = "memory", story = { wrote: true, title: "他自己走到门口", story: "妈妈说他自己走到了门口。", usedMediaIds: [], promptVersion: "family-writer-v2-calibrated-r2.1", validatorVersion: "narrative-validator-v2.3", latencyMs: 5 } } = {}) {
  const calls = { judge: 0, write: 0 };
  return {
    calls,
    judge: async (window) => {
      calls.judge += 1;
      const base = { sourceIds: window.items.map((item) => item.sourceId), windowId: window.windowId, policyVersion: "evidence-contract-v1", modelVersion: "deepseek-v4-pro", selectionReason: "stub", worthinessScore: 42 };
      const outcome = route === "memory"
        ? { ...base, action: "life_event_candidate", occurredAt: "2026-09-04", eventType: "moment", contentTypes: ["daily"], coreFacts: [], quotableLines: [], worthinessDimensions: {}, uncertainty: {}, sensitivityFlags: [], prohibitedInferences: [], reviewRequirement: "needs_review", confidence: 0.8 }
        : route === "trace"
          ? { ...base, action: "daily_trace", occurredAt: "2026-09-04", scopes: ["family"], contentTypes: ["daily"], traceLines: [{ text: "他自己走到门口", evidenceRefs: [] }], evidenceStrength: 1 }
          : { ...base, action: "store_only" };
      return { outcome, reasonCodes: [], verdict: { subjectRelevance: "primary", quotableLines: [] }, grounding: { claims: [] }, subjectLevel: "explicit", routingPolicyId: "worthiness-v6-grounded", latencyMs: 10 };
    },
    write: async () => { calls.write += 1; return story; },
  };
}

async function organizerOver(repo, pipeline, envAfter = CUTOVER) {
  const selection = selectProductionOrganizer(newInputEnv(envAfter));
  return new EvidenceOrganizerV2({ selection, pipeline, repository: repo });
}

async function seedSource(repo, overrides = {}) {
  const profileId = (await repo.getStore()).profile.id;
  const source = { id: uid("source"), profileId, sourceType: "parent_note", contentTypes: ["daily"], contributorId: "contributor-mom", capturedAt: "2026-09-04T10:00:00.000Z", importedAt: "2026-09-04T10:00:00.000Z", text: "他自己走到门口", mediaIds: [], sourceLabel: "家庭记录", visibility: "family", status: "uploaded", ...overrides };
  await repo.appendUpload({ source, media: [] });
  return source;
}

test("a new-input job runs the V2 pipeline and writes exactly one Memory, review and run", async () => {
  const repo = createJsonRepository();
  const pipeline = stubPipeline();
  const organizer = await organizerOver(repo, pipeline);
  const source = await seedSource(repo);
  const before = await repo.getStore();

  const result = await organizer.organize([source.id]);
  assert.equal(result.action, "create_memory");
  assert.ok(result.eventId.startsWith("event-v2-"), "the id is derived from the evidence, not minted");
  const after = await repo.getStore();
  assert.equal(after.events.length - before.events.length, 1);
  assert.equal(after.dailyTraces.length - before.dailyTraces.length, 0);
  assert.equal(after.qualityReviews.length - before.qualityReviews.length, 1);
  assert.equal(after.organizerRuns.length - before.organizerRuns.length, 1);
  const event = after.events.find((item) => item.id === result.eventId);
  assert.equal(event.createdBy, "ai");
  assert.equal(event.organizerVersion, "organizer-v2-adapter-v1");
  assert.deepEqual(event.sourceIds, [source.id]);
  assert.equal(isEventPublishable(event, indexReviews(after.qualityReviews)), false, "a generated page is never published by writing it");
  assert.ok(after.links.some((link) => link.rawSourceId === source.id && link.lifeEventId === event.id));
  assert.equal(after.rawSources.find((item) => item.id === source.id).status, "organized");
  const run = after.organizerRuns.find((item) => item.organizationFingerprint === result.organizationFingerprint);
  assert.equal(run.organizerType, "ai");
  assert.equal(run.action, "life_event_candidate");
  assert.equal(run.targetId, event.id);
});

test("a replay is refused before the model is called", async () => {
  const repo = createJsonRepository();
  const pipeline = stubPipeline();
  const organizer = await organizerOver(repo, pipeline);
  const source = await seedSource(repo);
  const first = await organizer.organize([source.id]);
  const second = await organizer.organize([source.id]);
  assert.equal(pipeline.calls.judge, 1, "the fingerprint guard runs before Judgment, so a replay is free");
  assert.equal(pipeline.calls.write, 1);
  assert.equal(second.eventId, first.eventId);
  assert.equal(second.organizationFingerprint, first.organizationFingerprint);
  const store = await repo.getStore();
  assert.equal(store.events.filter((event) => event.id === first.eventId).length, 1);
});

test("a dry run decides and writes nothing", async () => {
  const repo = createJsonRepository();
  const pipeline = stubPipeline();
  const organizer = await organizerOver(repo, pipeline);
  const source = await seedSource(repo);
  const before = await repo.getStore();
  const result = await organizer.organize([source.id], { dryRun: true });
  assert.equal(result.action, "create_memory");
  assert.ok(result.eventId.startsWith("event-v2-"));
  const after = await repo.getStore();
  assert.equal(after.events.length, before.events.length);
  assert.equal(after.qualityReviews.length, before.qualityReviews.length);
  assert.equal(after.organizerRuns.length, before.organizerRuns.length);
});

test("a Memory the Writer declines becomes a run with a reason — never a trace, never a page", async () => {
  const repo = createJsonRepository();
  const pipeline = stubPipeline({ story: { wrote: false, reason: "narrative_rejected:unsupported_claim", promptVersion: "p", validatorVersion: "v", latencyMs: 3 } });
  const organizer = await organizerOver(repo, pipeline);
  const source = await seedSource(repo);
  const before = await repo.getStore();
  const result = await organizer.organize([source.id]);
  assert.equal(result.action, "store_only");
  assert.equal(result.fallbackReason, "narrative_rejected:unsupported_claim");
  const after = await repo.getStore();
  assert.equal(after.events.length, before.events.length, "no page");
  assert.equal(after.dailyTraces.length, before.dailyTraces.length, "and no trace invented in its place");
  assert.equal(after.qualityReviews.length, before.qualityReviews.length);
  const run = after.organizerRuns.find((item) => item.organizationFingerprint === result.organizationFingerprint);
  assert.equal(run.action, "store_only");
  assert.equal(run.fallbackReason, "narrative_rejected:unsupported_claim");
});

// ---------------------------------------------------------------- Phase 5: DailyTrace semantics at cutover

test("a V2 trace on a day that already has a legacy trace is a SECOND artifact", async () => {
  const repo = createJsonRepository();
  const profileId = (await repo.getStore()).profile.id;
  const legacy = { id: uid("trace"), profileId, occurredAt: "2026-09-04", entries: ["legacy entry"], sourceIds: [], scopes: ["family"], visibility: "family", organizationFingerprint: uid("fp-rule"), organizerRun: { organizerType: "rule", organizerVersion: "rule-v2", provider: "rule", processedAt: "2026-09-04T00:00:00.000Z", organizationFingerprint: "fp-rule", sourceCount: 0, mediaInputCount: 0 } };
  await repo.persistDailyTrace(legacy);
  await repo.persistQualityReview({ id: uid("quality-review"), profileId, targetKind: "daily_trace", targetId: legacy.id, decision: "approved", reasonCodes: [], provider: "human", promptVersion: "legacy-review", policyVersion: "quality-review-v1", reviewFingerprint: uid("fp"), reviewedAt: "2026-09-04T00:00:00.000Z" });

  const organizer = await organizerOver(repo, stubPipeline({ route: "trace" }));
  const source = await seedSource(repo);
  const result = await organizer.organize([source.id]);
  assert.equal(result.action, "daily_trace");

  const store = await repo.getStore();
  const sameDay = store.dailyTraces.filter((trace) => trace.occurredAt.startsWith("2026-09-04"));
  assert.equal(sameDay.length, 2, "a calendar day groups artifacts for display; it is not their identity");
  const written = store.dailyTraces.find((trace) => trace.id === result.traceId);
  const reread = store.dailyTraces.find((trace) => trace.id === legacy.id);
  assert.deepEqual(reread.entries, ["legacy entry"], "the legacy trace's entries are untouched");
  assert.equal(reread.organizerRun.organizerType, "rule", "and its provenance is not overwritten");
  const reviews = indexReviews(store.qualityReviews);
  assert.equal(isTracePublishable(reread, reviews), true, "the legacy approval still applies to the legacy artifact");
  assert.equal(isTracePublishable(written, reviews), false, "and the new artifact inherits none of it");
  assert.notEqual(written.organizationFingerprint, legacy.organizationFingerprint);
});
