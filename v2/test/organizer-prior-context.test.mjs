import test from "node:test";
import assert from "node:assert/strict";
import { selectPriorContext } from "../lib/organizer/prior-context.ts";

const evt = (id, occurredAt, contentTypes = ["family"], visibility = "family") => ({ id, occurredAt, contentTypes, visibility, title: id });

test("nearby non-private events become attach targets, nearest day first", () => {
  const result = selectPriorContext({
    activityDate: "2026-08-20",
    contentTypes: ["family"],
    lifeEvents: [evt("far", "2026-08-01"), evt("next-day", "2026-08-21"), evt("same-day", "2026-08-20")],
    dailyTraces: [],
  });
  assert.deepEqual(result.priorContext.lifeEvents.map((e) => e.id), ["same-day", "next-day"]);
  assert.deepEqual(result.existingLifeEvents.map((e) => e.id), ["same-day", "next-day"]);
});

test("private events are never offered as attach targets", () => {
  const result = selectPriorContext({
    activityDate: "2026-08-20",
    contentTypes: ["family"],
    lifeEvents: [evt("private-one", "2026-08-20", ["family"], "private"), evt("shared", "2026-08-20")],
    dailyTraces: [],
  });
  assert.deepEqual(result.priorContext.lifeEvents.map((e) => e.id), ["shared"]);
});

test("recentSameTypeCount counts only earlier events of an overlapping content type inside the window", () => {
  const result = selectPriorContext({
    activityDate: "2026-08-20",
    contentTypes: ["sleep"],
    lifeEvents: [
      evt("earlier-same-type", "2026-08-18", ["sleep"]),
      evt("earlier-other-type", "2026-08-18", ["travel"]),
      evt("too-old", "2026-07-01", ["sleep"]),
      evt("later", "2026-08-25", ["sleep"]),
      evt("same-day", "2026-08-20", ["sleep"]),
    ],
    dailyTraces: [],
  });
  assert.equal(result.recentSameTypeCount, 1);
});

test("only same-day traces are carried into prior context", () => {
  const result = selectPriorContext({
    activityDate: "2026-08-20",
    contentTypes: ["family"],
    lifeEvents: [],
    dailyTraces: [{ id: "t-same", occurredAt: "2026-08-20T10:00:00Z" }, { id: "t-other", occurredAt: "2026-08-19T10:00:00Z" }],
  });
  assert.deepEqual(result.priorContext.dailyTraces.map((t) => t.id), ["t-same"]);
});

test("attach window and redundancy window are configurable", () => {
  const input = { activityDate: "2026-08-20", contentTypes: ["family"], lifeEvents: [evt("a", "2026-08-10")], dailyTraces: [] };
  assert.equal(selectPriorContext(input).priorContext.lifeEvents.length, 0);
  assert.equal(selectPriorContext(input, { attachWindowDays: 30 }).priorContext.lifeEvents.length, 1);
  assert.equal(selectPriorContext(input, { redundancyWindowDays: 2 }).recentSameTypeCount, 0);
  assert.equal(selectPriorContext(input, { redundancyWindowDays: 30 }).recentSameTypeCount, 1);
});
