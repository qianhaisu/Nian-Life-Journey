import test from "node:test";
import assert from "node:assert/strict";
import { workerRunOutcome } from "../scripts/lib/worker-run-outcome.mjs";

test("partial import reports failure and retains the retry window while saving conversation progress", () => {
  const previous = { lastRunAt: "2026-09-25T00:00:00Z", lastRunId: "old" };
  const conversations = { done: { status: "ok" }, pending: { status: "failed" } };
  const result = workerRunOutcome({ previous, startedAt: "2026-10-10T00:00:00Z", runId: "new", conversations, failed: 1 });
  assert.equal(result.exitCode, 1);
  assert.equal(result.advanced, false);
  assert.equal(result.state.lastRunAt, previous.lastRunAt);
  assert.deepEqual(result.state.conversations, conversations);
  assert.equal(result.state.lastRunId, "old");
});
test("only a complete run advances the successful watermark", () => {
  const result = workerRunOutcome({ previous: {}, startedAt: "2026-10-10T00:00:00Z", runId: "new", conversations: {}, failed: 0 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.state.lastRunAt, "2026-10-10T00:00:00Z");
});
