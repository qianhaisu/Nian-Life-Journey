// 近期待办 — the rules, tested (lib/upcoming-merge.ts, lib/upcoming-contract.ts).
//
// EVERY FIXTURE HERE IS SYNTHETIC. Real family chat and health detail do not go into Git, so the
// verification against the real August–September window lives outside the repository, in
// NianlifeOps/timeline-2026-09-12/upcoming/05-validation.json — 19 checks against the live database
// inside a transaction that was then rolled back.
//
// WHICH CASES THE REAL WINDOW ACTUALLY CONTAINED, so nothing here is mistaken for real evidence:
//   confirmed todo      yes — 18 of 23
//   tentative plan      yes — 5 of 23
//   explicit completion yes — 5 changes, each with the message that proves it
//   restatement         yes — 5
//   RESCHEDULE          NO — never occurred in 2026-08-01 → 2026-09-11
//   CANCELLATION        NO — never occurred in that window either
// The reschedule and cancellation tests below are therefore synthetic by necessity, and are marked
// so. They are not evidence that the extractor finds those cases in real material.
import test from "node:test";
import assert from "node:assert/strict";
import {
  familyFeedFrom,
  mergeKeyOf,
  resolveUpcomingStatus,
  sortUpcoming,
  upcomingFeedFrom,
  upcomingItemId,
} from "../lib/upcoming-merge.ts";
import { isOverdue, isStillOpen, statusNeedsEvidence, toUpcomingItem } from "../lib/upcoming-contract.ts";

const PROFILE = "profile-zhangnian";
const msg = (n) => `src-${n}`;

function candidate(overrides = {}) {
  return {
    title: "带一双干净鞋子",
    kind: "commitment",
    when: { kind: "day", day: "2026-08-05" },
    whenCertainty: "resolved_from_message_time",
    anchorSourceId: msg(1),
    sourceIds: [msg(1)],
    firstSeenDay: "2026-08-04",
    changes: [],
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    id: "upcoming-a", title: "带一双干净鞋子", when: { kind: "day", day: "2026-08-05" }, status: "open",
    evidence: { day: "2026-08-04" }, supersedes: [],
    profileId: PROFILE, kind: "commitment", whenCertainty: "resolved_from_message_time",
    anchorSourceId: msg(1), sourceIds: [msg(1)], changes: [], extractionBatchId: "batch-1",
    firstSeenAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z",
    reviewDecision: "needs_human_review", visibility: "family",
    ...overrides,
  };
}

const run = (overrides = {}) => ({
  id: "batch-1", windowFrom: "2026-08-01", windowToMessageAt: "2026-09-11T16:22:17+08:00",
  startedAt: "2026-09-12T17:00:00.000Z", status: "completed", conversations: [],
  unitsTotal: 114, unitsCovered: 114, unitsFailed: 0, ...overrides,
});

// ---------------------------------------------------------------------------------------------
// 完成必须有明确证据
// ---------------------------------------------------------------------------------------------
test("a completion with no message behind it is refused, and the item stays open", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [{ day: "2026-08-06", change: "done", note: "带过去了", sourceIds: [] }],
  }));
  assert.equal(resolved.status, "open");
  assert.equal(resolved.statusEvidenceDay, undefined);
  assert.equal(resolved.changes.length, 0);
  assert.match(resolved.refusals[0].reason, /had no source message/);
});

test("a completion WITH the message that proves it is accepted, and carries its evidence day", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [{ day: "2026-08-06", change: "done", note: "爸爸说拿了", sourceIds: [msg(9)] }],
  }));
  assert.equal(resolved.status, "done");
  assert.equal(resolved.statusEvidenceDay, "2026-08-06");
  assert.equal(resolved.statusNote, "爸爸说拿了");
  assert.equal(resolved.changes.at(-1).sourceIds[0], msg(9));
});

test("the date passing closes nothing — resolveUpcomingStatus never sees today at all", () => {
  const longPast = resolveUpcomingStatus(candidate({ when: { kind: "day", day: "2020-01-01" } }));
  assert.equal(longPast.status, "open");
  assert.ok(isStillOpen(longPast));
  // Overdue is a fact about presentation, and changes nothing about the row.
  assert.equal(isOverdue({ when: { kind: "day", day: "2020-01-01" }, status: "open" }, "2026-09-12"), true);
  assert.equal(isOverdue({ when: { kind: "day", day: "2020-01-01" }, status: "done" }, "2026-09-12"), false);
});

test("statusNeedsEvidence names exactly the three statuses that assert a change", () => {
  assert.deepEqual(
    ["open", "tentative", "done", "rescheduled", "cancelled"].filter(statusNeedsEvidence),
    ["done", "rescheduled", "cancelled"],
  );
});

// ---------------------------------------------------------------------------------------------
// 改期 / 取消 — SYNTHETIC: neither occurred in the real 2026-08-01 → 2026-09-11 window.
// ---------------------------------------------------------------------------------------------
test("[synthetic] a reschedule keeps both dates: the row moves, the change remembers where from", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [{ day: "2026-08-04", change: "rescheduled", newWhen: { kind: "day", day: "2026-08-20" }, note: "改到 8 月 20 日", sourceIds: [msg(4)] }],
  }));
  assert.equal(resolved.status, "rescheduled");
  assert.deepEqual(resolved.when, { kind: "day", day: "2026-08-20" });
  const change = resolved.changes.at(-1);
  assert.deepEqual(change.fromWhen, { kind: "day", day: "2026-08-05" });
  assert.deepEqual(change.toWhen, { kind: "day", day: "2026-08-20" });
});

test("[synthetic] a reschedule that names no new date is kept as a restatement, not a move", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [{ day: "2026-08-04", change: "rescheduled", note: "改天吧", sourceIds: [msg(4)] }],
  }));
  assert.equal(resolved.status, "open");
  assert.deepEqual(resolved.when, { kind: "day", day: "2026-08-05" });
  assert.equal(resolved.changes.at(-1).change, "restated");
  assert.match(resolved.refusals[0].reason, /gave no new date/);
});

test("[synthetic] a cancellation and a completion are different endings", () => {
  const cancelled = resolveUpcomingStatus(candidate({
    changes: [{ day: "2026-08-04", change: "cancelled", note: "不去了", sourceIds: [msg(5)] }],
  }));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(isStillOpen(cancelled), false);
  const done = resolveUpcomingStatus(candidate({
    changes: [{ day: "2026-08-04", change: "done", sourceIds: [msg(5)] }],
  }));
  assert.equal(done.status, "done");
  assert.notEqual(cancelled.status, done.status);
});

test("a later reminder never walks a finished commitment back to open", () => {
  // Real shape, 2026-08: the daycare asked for nappies for the 5th, the father confirmed he had
  // brought them on the 5th, and the teacher asked again on the 18th. The third message is the
  // 19th's commitment; it must not reopen the finished one.
  const resolved = resolveUpcomingStatus(candidate({
    changes: [
      { day: "2026-08-04", change: "restated", sourceIds: [msg(2)] },
      { day: "2026-08-05", change: "done", note: "拿了", sourceIds: [msg(3)] },
      { day: "2026-08-18", change: "restated", sourceIds: [msg(4)] },
    ],
  }));
  assert.equal(resolved.status, "done");
  assert.equal(resolved.statusEvidenceDay, "2026-08-05");
  assert.deepEqual(resolved.changes.map((c) => c.day), ["2026-08-04", "2026-08-05"]);
  assert.match(resolved.refusals[0].reason, /after this item was settled/);
});

test("a cancellation is equally final — a later restatement does not revive it", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [
      { day: "2026-08-05", change: "cancelled", note: "不去了", sourceIds: [msg(3)] },
      { day: "2026-08-09", change: "restated", sourceIds: [msg(4)] },
    ],
  }));
  assert.equal(resolved.status, "cancelled");
  assert.equal(resolved.changes.length, 1);
});

test("a change on the settlement day itself is still applied — only later ones are refused", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [
      { day: "2026-08-05", change: "done", note: "拿了", sourceIds: [msg(3)] },
      { day: "2026-08-05", change: "restated", sourceIds: [msg(4)] },
    ],
  }));
  assert.equal(resolved.changes.length, 2);
});

test("a restatement is proof the thing is still live, not a change of state", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [
      { day: "2026-08-05", change: "restated", sourceIds: [msg(2)] },
      { day: "2026-08-06", change: "restated", sourceIds: [msg(3)] },
    ],
  }));
  assert.equal(resolved.status, "open");
  assert.equal(resolved.statusEvidenceDay, undefined);
  assert.equal(resolved.changes.length, 2);
});

test("a restated plan stays tentative rather than being promoted to a commitment", () => {
  const resolved = resolveUpcomingStatus(candidate({
    kind: "plan", when: { kind: "unconfirmed" }, whenCertainty: "unconfirmed",
    changes: [{ day: "2026-08-26", change: "restated", sourceIds: [msg(7)] }],
  }));
  assert.equal(resolved.status, "tentative");
});

test("changes apply in day order however they arrive", () => {
  const resolved = resolveUpcomingStatus(candidate({
    changes: [
      { day: "2026-08-09", change: "done", note: "去了", sourceIds: [msg(8)] },
      { day: "2026-08-06", change: "restated", sourceIds: [msg(6)] },
    ],
  }));
  assert.deepEqual(resolved.changes.map((c) => c.day), ["2026-08-06", "2026-08-09"]);
  assert.equal(resolved.status, "done");
});

// ---------------------------------------------------------------------------------------------
// 同一事项关联 — merging, and refusing to merge
// ---------------------------------------------------------------------------------------------
test("two sightings of one commitment on one date share a merge key", () => {
  const a = mergeKeyOf(PROFILE, "带尿不湿", { kind: "day", day: "2026-09-09" });
  const b = mergeKeyOf(PROFILE, " 带尿不湿 ", { kind: "day", day: "2026-09-09" });
  assert.equal(a, b);
});

test("the same subject on different days is NOT one thing", () => {
  const august = mergeKeyOf(PROFILE, "复查", { kind: "day", day: "2026-08-20" });
  const september = mergeKeyOf(PROFILE, "复查", { kind: "day", day: "2026-09-20" });
  assert.notEqual(august, september);
});

test("two undated items never merge — a shared title is not evidence they are one thing", () => {
  assert.equal(mergeKeyOf(PROFILE, "出游", { kind: "unconfirmed" }), null);
});

test("a window merges only with the identical window", () => {
  const a = mergeKeyOf(PROFILE, "出游", { kind: "window", fromDay: "2026-10-01", toDay: "2026-10-07" });
  const b = mergeKeyOf(PROFILE, "出游", { kind: "window", fromDay: "2026-10-01", toDay: "2026-10-07" });
  const c = mergeKeyOf(PROFILE, "出游", { kind: "window", fromDay: "2026-10-02", toDay: "2026-10-07" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("the item id is derived from the source, so a re-run reproduces it exactly", () => {
  const first = upcomingItemId(PROFILE, msg(1), "带尿不湿");
  const again = upcomingItemId(PROFILE, msg(1), "带尿不湿");
  assert.equal(first, again);
  assert.notEqual(first, upcomingItemId(PROFILE, msg(1), "带水杯"));
  assert.notEqual(first, upcomingItemId(PROFILE, msg(2), "带尿不湿"));
});

// ---------------------------------------------------------------------------------------------
// 读取语义：四种答案，不能塌成两种
// ---------------------------------------------------------------------------------------------
test("nothing has ever run: not_extracted, never 'no todos'", () => {
  const feed = upcomingFeedFrom({ runs: [], records: [] });
  assert.equal(feed.state, "not_extracted");
  assert.ok(feed.reason);
});

test("a run happened and found nothing: no_items, and it says over which window", () => {
  const feed = upcomingFeedFrom({ runs: [run()], records: [] });
  assert.equal(feed.state, "no_items");
  assert.equal(feed.coverage.windowFrom, "2026-08-01");
  assert.equal(feed.coverage.windowToMessageAt, "2026-09-11T16:22:17+08:00");
  assert.equal(feed.coverage.partial, false);
  assert.equal(feed.coverage.olderThanWindowNotScanned, true);
});

test("a run that half failed is partial, so a page cannot call the week clear", () => {
  const failed = upcomingFeedFrom({ runs: [run({ status: "completed_with_failures", unitsFailed: 9, unitsCovered: 105 })], records: [] });
  assert.equal(failed.state, "no_items");
  assert.equal(failed.coverage.partial, true);
  assert.equal(failed.coverage.unitsFailed, 9);
});

test("one completed run plus one earlier failed run is still partial", () => {
  const feed = upcomingFeedFrom({
    runs: [run({ id: "batch-0", status: "failed", startedAt: "2026-09-11T00:00:00.000Z" }), run()],
    records: [],
  });
  assert.equal(feed.coverage.batchId, "batch-1");
  assert.equal(feed.coverage.partial, true);
});

test("items present: ready, with coverage and an unreviewed count rather than a silent filter", () => {
  const feed = upcomingFeedFrom({ runs: [run()], records: [record(), record({ id: "upcoming-b", reviewDecision: "approved" })] });
  assert.equal(feed.state, "ready");
  assert.equal(feed.items.length, 2);
  assert.equal(feed.unreviewed, 1);
  assert.equal(feed.coverage.batchId, "batch-1");
});

test("the newest run is the one whose coverage is reported", () => {
  const feed = upcomingFeedFrom({
    runs: [run({ id: "old", startedAt: "2026-09-01T00:00:00.000Z", windowFrom: "2026-07-01" }), run()],
    records: [record()],
  });
  assert.equal(feed.coverage.windowFrom, "2026-08-01");
});

test("a private row does not reach the page unless asked for", () => {
  const input = { runs: [run()], records: [record({ visibility: "private" })] };
  assert.equal(upcomingFeedFrom(input).state, "no_items");
  assert.equal(upcomingFeedFrom({ ...input, includePrivate: true }).state, "ready");
});

// ---------------------------------------------------------------------------------------------
// 家庭正文不越界 + 排序
// ---------------------------------------------------------------------------------------------
test("the page projection drops every server-side field, raw message ids included", () => {
  const item = toUpcomingItem(record({ sourceIds: ["wechat-message:canonical:deadbeef"], whoAsked: "老师", whenBasis: "说「明天」" }));
  const serialised = JSON.stringify(item);
  assert.equal(serialised.includes("wechat-message:"), false);
  assert.equal(serialised.includes("老师"), false);
  assert.equal(item.sourceIds, undefined);
  assert.equal(item.reviewDecision, undefined);
  assert.deepEqual(item.evidence, { day: "2026-08-04" });
});

test("still-to-do first, soonest first, undated after the dated, settled at the end", () => {
  const sorted = sortUpcoming([
    { id: "e", title: "已取消", when: { kind: "day", day: "2026-08-02" }, status: "cancelled" },
    { id: "d", title: "已完成", when: { kind: "day", day: "2026-08-01" }, status: "done" },
    { id: "c", title: "待定", when: { kind: "unconfirmed" }, status: "tentative" },
    { id: "b", title: "晚一点", when: { kind: "day", day: "2026-08-20" }, status: "open" },
    { id: "a", title: "最近", when: { kind: "day", day: "2026-08-05" }, status: "open" },
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ["a", "b", "c", "d", "e"]);
});

test("an undated open item sorts after every dated open one, not at the top", () => {
  const sorted = sortUpcoming([
    { id: "undated", title: "待确认", when: { kind: "unconfirmed" }, status: "open" },
    { id: "dated", title: "有日期", when: { kind: "day", day: "2026-12-31" }, status: "open" },
  ]);
  assert.deepEqual(sorted.map((i) => i.id), ["dated", "undated"]);
});

// ---------------------------------------------------------------------------------------------
// 首页只读 approved，而且 approved 为空时必须隐藏，不能说「已检查但没有待办」
// ---------------------------------------------------------------------------------------------
test("approved is empty but rows are waiting: hide the block, never claim the week is clear", () => {
  const approvedEmpty = upcomingFeedFrom({ runs: [run()], records: [] });
  assert.equal(approvedEmpty.state, "no_items");
  const family = familyFeedFrom(approvedEmpty, 21);
  assert.equal(family.state, "not_extracted");
  assert.match(family.reason, /none has been approved/);
});

test("nothing waiting either: no_items stands, and it still carries the window it covered", () => {
  const family = familyFeedFrom(upcomingFeedFrom({ runs: [run()], records: [] }), 0);
  assert.equal(family.state, "no_items");
  assert.equal(family.coverage.windowFrom, "2026-08-01");
});

test("approved rows exist: the family feed passes them through untouched", () => {
  const ready = upcomingFeedFrom({ runs: [run()], records: [record({ reviewDecision: "approved" })] });
  const family = familyFeedFrom(ready, 0);
  assert.equal(family.state, "ready");
  assert.equal(family.items.length, 1);
});

test("a read failure is never converted into a statement about the week", () => {
  const failed = { state: "read_failed", reason: "x", error: "y" };
  assert.deepEqual(familyFeedFrom(failed, 21), failed);
});
