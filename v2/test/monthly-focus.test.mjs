import test from "node:test";
import assert from "node:assert/strict";
import { monthlyFocusGoals, monthlySnapshot } from "../lib/mock-data.ts";
import { focusGoalsForSnapshot, targetMonthForSnapshot } from "../lib/monthly-focus.ts";

test("focus goals are tied to the displayed snapshot month, not today's date", () => {
  assert.equal(targetMonthForSnapshot("2026-08"), "2026-09");
  assert.equal(targetMonthForSnapshot("2026-12"), "2027-01");
  assert.deepEqual(focusGoalsForSnapshot(monthlyFocusGoals, monthlySnapshot.month).map((goal) => goal.category), ["sleep", "language", "reading", "health"]);
});

test("initial focus goals preserve the four V1 directions as gentle observations", () => {
  assert.equal(monthlyFocusGoals.every((goal) => goal.status === "watching"), true);
  assert.equal(monthlyFocusGoals.every((goal) => goal.snapshotMonth === monthlySnapshot.month && goal.targetMonth === "2026-09"), true);
  assert.equal(monthlyFocusGoals.every((goal) => goal.title.length > 0 && goal.description.length > 0), true);
});
