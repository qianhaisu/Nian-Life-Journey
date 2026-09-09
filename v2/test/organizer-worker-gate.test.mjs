import assert from "node:assert/strict";
import test from "node:test";

const { organizerWorkerEnabled } = await import("../lib/organizer/worker-gate.ts");

test("Organizer worker automation is off unless explicitly enabled", () => {
  assert.equal(organizerWorkerEnabled(undefined), false);
  assert.equal(organizerWorkerEnabled("false"), false);
  assert.equal(organizerWorkerEnabled("TRUE"), false);
  assert.equal(organizerWorkerEnabled("true"), true);
});
