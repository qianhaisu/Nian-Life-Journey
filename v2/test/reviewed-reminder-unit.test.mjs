import { test } from "node:test";
import assert from "node:assert/strict";
import { reminderUnitFingerprint, reviewedReminderUnit } from "../scripts/lib/reviewed-reminder-unit.mjs";
const unit = { shortId: "family", day: "2026-10-10", messages: [{ id: "source-1", t: "10:00", who: "妈妈", text: "已提交请假", media: 0 }] };
const review = { reviewer: "codex", decision: "no-new-public-reminder", reason: "source proves the action is complete", reviewedAt: "2026-10-10T11:00:00Z", fingerprint: reminderUnitFingerprint(unit) };
test("an exact direct source review returns no new public reminder", () => assert.deepEqual(reviewedReminderUnit(unit, { "family|2026-10-10": review }), { items: [], statusUpdates: [] }));
test("new messages cannot inherit an older exclusion", () => assert.equal(reviewedReminderUnit({ ...unit, messages: [...unit.messages, { ...unit.messages[0], id: "source-2", text: "明天带鞋" }] }, { "family|2026-10-10": review }), null));
test("missing provenance or a different review decision does not suppress extraction", () => {
  for (const entry of [{ ...review, reviewer: "model" }, { ...review, decision: "pending" }, { ...review, reason: "" }]) assert.equal(reviewedReminderUnit(unit, { "family|2026-10-10": entry }), null);
});
