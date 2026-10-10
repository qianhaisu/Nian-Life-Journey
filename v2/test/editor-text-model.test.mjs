import { test } from "node:test";
import assert from "node:assert/strict";
import { callTextModel } from "../scripts/editor/text-model.mjs";

const env = { AI_PROVIDER: "zhipu", ZHIPU_API_KEY: "private-test-key" };
test("editor uses a tool-free provider request and reports model provenance", async () => {
  const result = await callTextModel("source material", { env, request: async (url, options) => {
    assert.match(url, /\/chat\/completions$/);
    const body = JSON.parse(options.body);
    assert.equal(body.tools, undefined);
    assert.equal(body.model, "glm-5.3-flash");
    return { ok: true, json: async () => ({ model: body.model, choices: [{ finish_reason: "stop", message: { content: '{"decision":"skip"}' } }] }) };
  } });
  assert.equal(result.ok, true);
  assert.equal(result.model, "glm-5.3-flash");
});
test("missing provider credentials make no network request", async () => {
  assert.equal((await callTextModel("source", { env: {}, request: () => assert.fail("unexpected request") })).ok, false);
});
test("truncation, missing text and wrong model cannot be published", async () => {
  for (const body of [
    { model: "glm-5.3-flash", choices: [{ finish_reason: "length", message: { content: "partial" } }] },
    { model: "glm-5.3-flash", choices: [{ finish_reason: "stop", message: {} }] },
    { model: "wrong", choices: [{ finish_reason: "stop", message: { content: "text" } }] },
  ]) assert.equal((await callTextModel("source", { env, request: async () => ({ ok: true, json: async () => body }) })).ok, false);
});
test("provider errors never disclose private response bodies", async () => {
  const result = await callTextModel("source", { env, request: async () => ({ ok: false, status: 403, text: () => assert.fail("private body should not be read") }) });
  assert.equal(result.error, "编辑模型 HTTP 403");
});
