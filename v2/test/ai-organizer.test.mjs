import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { appendUpload, getStore } from "../lib/db/repository.ts";
import { AIMemoryOrganizer } from "../lib/organizer/ai.ts";
import { AI_ORGANIZER_EVALUATION_FIXTURES, evaluateAIOrganizer, selectEvaluationFixtures } from "../lib/organizer/evaluation.ts";
import { getConfiguredOrganizer } from "../lib/organizer/index.ts";
import { MockAIProvider } from "../lib/organizer/provider.ts";

const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }

test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

let sequence = 0;
async function source(input = {}) {
  sequence += 1;
  const id = `synthetic-source-${sequence}`;
  const value = { id, profileId: "profile-zhangnian", sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt: `2026-09-${String(sequence).padStart(2, "0")}T10:00:00.000Z`, importedAt: new Date().toISOString(), mediaIds: [], sourceLabel: "Synthetic source", visibility: "family", status: "uploaded", ...input };
  await appendUpload({ source: value, media: [], assets: [], locations: [] });
  return value;
}

test("synthetic evaluation covers the eight organizer cases with zero unsupported facts", async () => {
  const evaluation = await evaluateAIOrganizer();
  assert.ok(evaluation.results.every((result) => result.passed), JSON.stringify(evaluation.results));
  assert.equal(evaluation.metrics.unsupportedFactCount, 0);
  assert.equal(evaluation.metrics.duplicateCount, 0);
  assert.equal(evaluation.metrics.fallbackCount, 0);
});

test("selectEvaluationFixtures defaults to every fixture and narrows by id", () => {
  assert.deepEqual(selectEvaluationFixtures(), AI_ORGANIZER_EVALUATION_FIXTURES);
  assert.deepEqual(selectEvaluationFixtures(""), AI_ORGANIZER_EVALUATION_FIXTURES);
  const subset = selectEvaluationFixtures("ordinary-daycare,ordinary-volume");
  assert.deepEqual(subset.map((fixture) => fixture.id), ["ordinary-daycare", "ordinary-volume"]);
  assert.throws(() => selectEvaluationFixtures("ordinary-daycare,not-a-real-fixture"), /Unknown evaluation fixture id\(s\): not-a-real-fixture/);
});

test("evaluateAIOrganizer runs only the fixtures it is given", async () => {
  const evaluation = await evaluateAIOrganizer(new MockAIProvider(), selectEvaluationFixtures("ordinary-daycare,ordinary-volume"));
  assert.deepEqual(evaluation.results.map((result) => result.id), ["ordinary-daycare", "ordinary-volume"]);
});

test("AI create_memory keeps source text concise and records an organizer run", async () => {
  const item = await source({ sourceType: "parent_note", contentTypes: ["language", "family"], text: "今天开始一直说“车车”。" });
  const result = await new AIMemoryOrganizer(new MockAIProvider()).organize([item.id]);
  assert.equal(result.action, "create_memory");
  assert.ok(result.eventId);
  const store = await getStore();
  const event = store.events.find((candidate) => candidate.id === result.eventId);
  assert.equal(event?.story, item.text);
  assert.equal(event?.createdBy, "ai");
  assert.equal(event?.organizerRun?.promptVersion, "v1");
  assert.equal(store.organizerRuns.filter((run) => run.organizationFingerprint === result.organizationFingerprint).length, 1);
});

test("ordinary daycare material becomes one daily trace", async () => {
  const item = await source({ sourceType: "daycare_note", contentTypes: ["daycare", "daily"], text: "今天户外活动的时候喜欢追球。" });
  const result = await new AIMemoryOrganizer(new MockAIProvider()).organize([item.id]);
  assert.equal(result.action, "daily_trace");
  assert.ok(result.traceId);
  const store = await getStore();
  assert.equal(store.events.some((event) => event.sourceIds.includes(item.id)), false);
  assert.ok(store.dailyTraces.some((trace) => trace.id === result.traceId && trace.sourceIds.includes(item.id)));
});

test("a video with corroborating text attaches to the one matching existing memory instead of creating a duplicate", async () => {
  const first = await source({ sourceType: "parent_note", contentTypes: ["motor", "family"], text: "第一次主动追球。", capturedAt: "2026-09-20T10:00:00.000Z" });
  const organizer = new AIMemoryOrganizer(new MockAIProvider());
  const created = await organizer.organize([first.id]);
  const second = await source({ sourceType: "family_video", contentTypes: ["motor", "family"], text: "追球视频，和早上说的是同一次活动。", capturedAt: "2026-09-20T11:00:00.000Z" });
  const attached = await organizer.organize([second.id]);
  assert.equal(created.action, "create_memory");
  assert.equal(attached.action, "attach_existing");
  assert.equal(attached.eventId, created.eventId);
  const store = await getStore();
  assert.equal(store.events.filter((event) => event.id === created.eventId).length, 1);
});

test("a video with no text or media evidence does not auto-attach to a same-day, same-category memory", async () => {
  const first = await source({ sourceType: "parent_note", contentTypes: ["motor", "family"], text: "第一次主动追球。", capturedAt: "2026-09-29T10:00:00.000Z" });
  const organizer = new AIMemoryOrganizer(new MockAIProvider());
  const created = await organizer.organize([first.id]);
  const second = await source({ sourceType: "family_video", contentTypes: ["motor", "family"], capturedAt: "2026-09-29T11:00:00.000Z" });
  const result = await organizer.organize([second.id]);
  assert.equal(created.action, "create_memory");
  assert.notEqual(result.action, "attach_existing");
  const store = await getStore();
  assert.equal(store.events.filter((event) => event.id === created.eventId).length, 1);
});

test("attach_existing preserves the existing memory's title and story instead of overwriting them", async () => {
  const first = await source({ sourceType: "parent_note", contentTypes: ["motor", "family"], text: "第一次主动追球。", capturedAt: "2026-10-01T10:00:00.000Z" });
  const organizer = new AIMemoryOrganizer(new MockAIProvider());
  const created = await organizer.organize([first.id]);
  const beforeAttach = (await getStore()).events.find((event) => event.id === created.eventId);
  const second = await source({ sourceType: "family_video", contentTypes: ["motor", "family"], text: "追球视频，和早上说的是同一次活动。", capturedAt: "2026-10-01T11:00:00.000Z" });
  const attached = await organizer.organize([second.id]);
  assert.equal(attached.action, "attach_existing");
  const afterAttach = (await getStore()).events.find((event) => event.id === attached.eventId);
  assert.equal(afterAttach.title, beforeAttach.title);
  assert.equal(afterAttach.story, beforeAttach.story);
});

// §5.1 of the Organizer V2 task: a failed AI attempt must safely degrade the SAME decision to
// store_only (organizerType stays "ai", nothing is created), never hand the batch to
// RuleBasedMemoryOrganizer for a fresh decision — that used to let a rejected/invalid AI decision
// turn into a freshly created LifeEvent built from a raw-text slice() of the source.
test("invalid schema and provider timeout safely degrade to store_only, never to a rule-based re-decision", async () => {
  const invalid = await source({ capturedAt: "2026-09-21T10:00:00.000Z" });
  const invalidProvider = { name: "invalid", model: "synthetic", organize: async () => ({ decision: { action: "create_memory", sourceIds: ["missing-source"], occurredAt: "2026-09-21", contentTypes: ["family"], memoryWeight: "memory", confidence: 0.9, reason: "invalid" } }) };
  const invalidResult = await new AIMemoryOrganizer(invalidProvider).organize([invalid.id]);
  assert.equal(invalidResult.action, "store_only");
  assert.equal(invalidResult.run.organizerType, "ai");
  assert.ok(invalidResult.fallbackReason);

  const timedOut = await source({ capturedAt: "2026-09-22T10:00:00.000Z" });
  const timeoutProvider = { name: "timeout", organize: async () => { throw new Error("timeout"); } };
  const timeoutResult = await new AIMemoryOrganizer(timeoutProvider).organize([timedOut.id]);
  assert.equal(timeoutResult.action, "store_only");
  assert.equal(timeoutResult.run.organizerType, "ai");
  assert.match(timeoutResult.fallbackReason, /timeout/);

  const invalidTarget = await source({ capturedAt: "2026-09-26T10:00:00.000Z" });
  const targetProvider = { name: "invalid-target", organize: async () => ({ decision: { action: "attach_existing", sourceIds: [invalidTarget.id], existingLifeEventId: "missing-event", occurredAt: "2026-09-26", contentTypes: ["family"], memoryWeight: "memory", confidence: 0.9, reason: "invalid target" } }) };
  const targetResult = await new AIMemoryOrganizer(targetProvider).organize([invalidTarget.id]);
  assert.equal(targetResult.action, "store_only");
  assert.equal(targetResult.run.organizerType, "ai");

  const invalidDate = await source({ capturedAt: "2026-09-27T10:00:00.000Z" });
  const dateProvider = { name: "invalid-date", organize: async () => ({ decision: { action: "store_only", sourceIds: [invalidDate.id], occurredAt: "2026-02-31", contentTypes: ["family"], memoryWeight: "trace", confidence: 0.4, reason: "invalid date" } }) };
  const dateResult = await new AIMemoryOrganizer(dateProvider).organize([invalidDate.id]);
  assert.equal(dateResult.action, "store_only");
  assert.equal(dateResult.run.organizerType, "ai");
});

test("a first-time claim without source evidence safely degrades to store_only and creates nothing", async () => {
  const item = await source({ sourceType: "family_photo", contentTypes: ["daily", "family"], mediaIds: ["synthetic-photo-without-derivative"], capturedAt: "2026-09-28T10:00:00.000Z" });
  const provider = { name: "hallucinating", organize: async () => ({ decision: { action: "create_memory", sourceIds: [item.id], occurredAt: "2026-09-28", contentTypes: ["daily", "family"], memoryWeight: "highlight", title: "第一次参加活动", shortStory: "第一次参加活动，开心地在公园里奔跑。", confidence: 0.99, reason: "unsupported" } }) };
  const result = await new AIMemoryOrganizer(provider).organize([item.id]);
  assert.equal(result.action, "store_only");
  assert.equal(result.run.organizerType, "ai");
  const store = await getStore();
  assert.equal(store.events.some((event) => event.sourceIds.includes(item.id)), false);
});

test("medical inference is rejected and safely degrades to store_only, no care episode is created", async () => {
  const item = await source({ sourceType: "medical_document", contentTypes: ["health"], visibility: "private", capturedAt: "2026-09-23T10:00:00.000Z", metadata: { filename: "synthetic-checkup.pdf", type: "application/pdf" } });
  const provider = { name: "unsafe-test", organize: async () => ({ decision: { action: "create_memory", sourceIds: [item.id], occurredAt: "2026-09-23", contentTypes: ["health"], memoryWeight: "highlight", title: "诊断结果", shortStory: "建议用药。", confidence: 0.99, reason: "unsafe" } }) };
  const result = await new AIMemoryOrganizer(provider).organize([item.id]);
  assert.equal(result.action, "store_only");
  assert.equal(result.run.organizerType, "ai");
  const store = await getStore();
  assert.equal(store.events.some((event) => event.sourceIds.includes(item.id)), false);
  assert.equal(store.careEpisodes.some((episode) => episode.sourceIds.includes(item.id)), false);
});

test("same source batch is idempotent and unavailable AI safely degrades instead of failing capture organization", async () => {
  const item = await source({ capturedAt: "2026-09-24T10:00:00.000Z", text: "今天看到了车。" });
  let calls = 0;
  const provider = { name: "counting", organize: async (context) => { calls += 1; return new MockAIProvider().organize(context); } };
  const organizer = new AIMemoryOrganizer(provider);
  const first = await organizer.organize([item.id]);
  const second = await organizer.organize([item.id]);
  assert.equal(calls, 1);
  assert.equal(second.organizationFingerprint, first.organizationFingerprint);
  const unavailableItem = await source({ capturedAt: "2026-09-25T10:00:00.000Z", text: "今天看到了车。" });
  const fallback = getConfiguredOrganizer({ MEMORY_ORGANIZER: "ai", AI_ORGANIZER_ENABLED: "true", AI_PROVIDER: "openai" });
  const result = await fallback.organize([unavailableItem.id]);
  assert.equal(result.action, "store_only");
  assert.equal(result.run.organizerType, "ai");
  assert.ok(result.fallbackReason);
});
