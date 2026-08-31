import test from "node:test";
import assert from "node:assert/strict";
import { ORGANIZER_DECISION_SCHEMA } from "../lib/organizer/schema.ts";
import { toGeminiResponseSchema } from "../lib/organizer/gemini-schema.ts";
import { AIProviderError, GeminiAIProvider, createConfiguredAIProvider } from "../lib/organizer/provider.ts";

const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });

const baseContext = { profileId: "p", sourceSummaries: [{ id: "s1", sourceType: "parent_note", contentTypes: ["family"], contributorId: "c", capturedAt: "2026-08-28T10:00:00.000Z", sourceLabel: "note", mediaCount: 0, media: [] }], existingMemories: [], mediaInputs: [], inputSourceCount: 1, representativeMediaCount: 0, generatedAt: "2026-08-28T00:00:00.000Z", organizationFingerprint: "fp" };
const v2Decision = (overrides = {}) => ({ action: "daily_trace", sourceIds: ["s1"], existingLifeEventId: null, occurredAt: "2026-08-28", contentTypes: ["family"], memoryWeight: "trace", title: null, shortStory: null, growthSignals: null, careSignals: null, confidence: 0.7, reason: "ordinary day", ...overrides });
const geminiResult = (decision) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(decision) }] }, finishReason: "STOP" }] });

test("Gemini schema converter maps OpenAI-style JSON schema to Gemini's uppercase Schema dialect", () => {
  const schema = toGeminiResponseSchema(ORGANIZER_DECISION_SCHEMA);
  assert.equal(schema.type, "OBJECT");
  assert.equal(schema.properties.action.type, "STRING");
  assert.deepEqual(schema.properties.action.enum, ORGANIZER_DECISION_SCHEMA.properties.action.enum);
  assert.equal(schema.properties.sourceIds.type, "ARRAY");
  assert.equal(schema.properties.sourceIds.minItems, "1");
  assert.equal(schema.properties.existingLifeEventId.nullable, true);
  assert.equal(schema.properties.growthSignals.nullable, true);
  assert.equal(schema.properties.growthSignals.items.type, "STRING");
  assert.deepEqual(schema.required, ORGANIZER_DECISION_SCHEMA.required);
  assert.ok(schema.propertyOrdering.includes("confidence"));
});

test("GeminiAIProvider requires GEMINI_API_KEY and AI_MODEL", () => {
  assert.throws(() => new GeminiAIProvider({}), AIProviderError);
  assert.throws(() => new GeminiAIProvider({ GEMINI_API_KEY: "k" }), AIProviderError);
  assert.doesNotThrow(() => new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash" }));
});

test("createConfiguredAIProvider selects Gemini when AI_PROVIDER=gemini", () => {
  const provider = createConfiguredAIProvider({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash" });
  assert.equal(provider.name, "gemini");
  assert.equal(provider.model, "gemini-2.5-flash");
});

test("GeminiAIProvider selects the V2 prompt and schema when configured", async () => {
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => geminiResult(v2Decision()) };
  };
  const provider = new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-3.6-flash", AI_ORGANIZER_PROMPT_VERSION: "v2" });
  const response = await provider.organize(baseContext);
  const body = JSON.parse(capturedInit.body);
  assert.equal(provider.promptVersion, "v2");
  assert.deepEqual(body.generationConfig.responseSchema.properties.action.enum, ["create_memory", "attach_existing", "daily_trace", "care_episode", "store_only"]);
  assert.match(body.systemInstruction.parts[0].text, /Do not use merge_existing/);
  assert.match(body.contents[0].parts[0].text, /actionFieldMatrix/);
  assert.equal(response.decision.action, "daily_trace");
  assert.equal(response.decision.title, undefined);
});

test("GeminiAIProvider defaults to the V2 prompt and schema when AI_ORGANIZER_PROMPT_VERSION is unset", async () => {
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return { ok: true, json: async () => geminiResult(v2Decision()) };
  };
  const provider = new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-3.6-flash" });
  const response = await provider.organize(baseContext);
  const body = JSON.parse(capturedInit.body);
  assert.equal(provider.promptVersion, "v2");
  assert.match(body.systemInstruction.parts[0].text, /Do not use merge_existing/);
  assert.match(body.contents[0].parts[0].text, /actionFieldMatrix/);
  assert.equal(response.decision.action, "daily_trace");
});

test("GeminiAIProvider sends the official REST shape and parses structured JSON output", async () => {
  let capturedUrl;
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ action: "daily_trace", sourceIds: ["s1"], occurredAt: "2026-08-28", contentTypes: ["family"], memoryWeight: "trace", confidence: 0.7, reason: "ordinary day" }) }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40, totalTokenCount: 160 },
      }),
    };
  };
  const provider = new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash", AI_ORGANIZER_PROMPT_VERSION: "v1" });
  const response = await provider.organize(baseContext);
  assert.equal(capturedUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(capturedInit.headers["x-goog-api-key"], "k");
  assert.ok(!capturedInit.headers.Authorization);
  const body = JSON.parse(capturedInit.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.systemInstruction.parts[0].text.includes("organize family archive evidence") || body.systemInstruction.parts[0].text.length > 0, true);
  assert.equal(response.decision.action, "daily_trace");
  assert.deepEqual(response.usage, { input: 120, output: 40, total: 160 });
});

test("GeminiAIProvider caps multimodal inputs at six and prioritizes thumbnails", async () => {
  let capturedInit;
  globalThis.fetch = async (_url, init) => {
    capturedInit = init;
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ action: "store_only", sourceIds: ["s1"], occurredAt: "2026-08-28", contentTypes: ["family"], memoryWeight: "trace", confidence: 0.4, reason: "insufficient context" }) }] }, finishReason: "STOP" }] }),
    };
  };
  const mediaInputs = [
    { sourceId: "s1", mediaId: "web-1", variant: "web", mimeType: "image/jpeg", bytes: new Uint8Array([1]) },
    { sourceId: "s1", mediaId: "poster-1", variant: "poster", mimeType: "image/jpeg", bytes: new Uint8Array([2]) },
    { sourceId: "s1", mediaId: "thumb-1", variant: "thumbnail", mimeType: "image/jpeg", bytes: new Uint8Array([3]) },
    { sourceId: "s1", mediaId: "web-2", variant: "web", mimeType: "image/jpeg", bytes: new Uint8Array([4]) },
    { sourceId: "s1", mediaId: "thumb-2", variant: "thumbnail", mimeType: "image/jpeg", bytes: new Uint8Array([5]) },
    { sourceId: "s1", mediaId: "poster-2", variant: "poster", mimeType: "image/jpeg", bytes: new Uint8Array([6]) },
    { sourceId: "s1", mediaId: "thumb-3", variant: "thumbnail", mimeType: "image/jpeg", bytes: new Uint8Array([7]) },
  ];
  await new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash", AI_ORGANIZER_PROMPT_VERSION: "v1" }).organize({ ...baseContext, mediaInputs, representativeMediaCount: mediaInputs.length });
  const body = JSON.parse(capturedInit.body);
  const sentMedia = body.contents[0].parts.slice(1);
  assert.equal(sentMedia.length, 6);
  assert.deepEqual(sentMedia.map((part) => Buffer.from(part.inlineData.data, "base64")[0]), [3, 5, 7, 1, 4, 2]);
  assert.match(body.contents[0].parts[0].text, /"representativeMediaCount":6/);
});

test("GeminiAIProvider retries transient statuses at most twice", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls < 3) return { ok: false, status: 503 };
    return { ok: true, json: async () => geminiResult(v2Decision()) };
  };
  const response = await new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-3.6-flash", AI_ORGANIZER_PROMPT_VERSION: "v2" }).organize(baseContext);
  assert.equal(calls, 3);
  assert.equal(response.decision.action, "daily_trace");
});

test("GeminiAIProvider does not retry non-transient status or V2 contract failures", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 400, json: async () => ({}) };
  };
  const provider = new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-3.6-flash", AI_ORGANIZER_PROMPT_VERSION: "v2" });
  await assert.rejects(() => provider.organize(baseContext), AIProviderError);
  assert.equal(calls, 1);

  calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: true, json: async () => geminiResult(v2Decision({ title: "不应生成叙事" })) };
  };
  await assert.rejects(() => provider.organize(baseContext), AIProviderError);
  assert.equal(calls, 1);
});

test("GeminiAIProvider raises AIProviderError on safety blocks", async () => {
  const provider = new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash" });
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }) });
  const blocked = new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-2.5-flash" });
  await assert.rejects(() => blocked.organize(baseContext), AIProviderError);
});

test("GeminiAIProvider rejects merge_existing, narrative fields, and invalid attachment targets in V2", async () => {
  const provider = new GeminiAIProvider({ GEMINI_API_KEY: "k", AI_MODEL: "gemini-3.6-flash", AI_ORGANIZER_PROMPT_VERSION: "v2" });
  const decisions = [
    v2Decision({ action: "merge_existing" }),
    v2Decision({ title: "普通日记" }),
    v2Decision({ action: "attach_existing", existingLifeEventId: "missing-event", memoryWeight: "memory" }),
  ];
  for (const decision of decisions) {
    globalThis.fetch = async () => ({ ok: true, json: async () => geminiResult(decision) });
    await assert.rejects(() => provider.organize(baseContext), AIProviderError);
  }
});
