// 近期待办 (lib/upcoming.ts, 2026-09-13). The page's half of the boundary: extraction, merging and
// completion evidence belong to the data track (lib/upcoming-contract.ts, lib/db/upcoming-store.ts,
// commit 7886f14), but four of Teddy's rules are promises a page keeps on its own and these are the
// cases that hold it to them —
//   · a strikethrough is a claim, so `done` without evidence renders as still-to-do;
//   · 「时间不清楚就标注待确认，不猜具体日期」;
//   · 未确定的计划 is its own state, not an open commitment;
//   · every no-row state is 未接入 to this page, NEVER 「没有待办」.
// The items below are FIXTURES shaped after real material in the archive (the daycare group's
// 「小年明天带尿不湿哈」, 「我想给崽约个体检了」, 「国庆去大湾区旅游」 discussed but not booked). The
// data track's own extraction found 22 real items on 2026-09-12 but migration 0013 is not applied,
// so no row exists in any running database and nothing here claims otherwise.
import test from "node:test";
import assert from "node:assert/strict";
import { feedFromResult, groupUpcoming, normalizeUpcoming, readHomeUpcoming, sortUpcoming, splitUpcomingGroups, UPCOMING_VISIBLE } from "../lib/upcoming.ts";
import { readUpcomingFeedForFamily } from "../lib/db/upcoming-store.ts";

// A coverage block shaped like the data track's (lib/upcoming-contract.ts): only "ready" and
// "no_items" carry one, and this page renders neither as a claim about a clear week.
const coverage = { windowFrom: "2026-08-01", windowToMessageAt: "2026-09-11T16:22:17+08:00", batchId: "b1", ranAt: "2026-09-13T00:00:00.000Z", conversations: [], unitsTotal: 114, unitsCovered: 114, unitsFailed: 0, partial: false, olderThanWindowNotScanned: true };

const evidence = { eventId: "event-sep-01" };

// 总指挥, 2026-09-13: 家庭首页只能显示人工 approved 的事项. These four cases are that decision and
// the three ways of having no rows that must not be dressed up as a clear week.
test("the family page reads through the store's approved-only gate, not the default one", async () => {
  // The rule lives in the store: readUpcomingFeedForFamily fixes decisions to approved and refuses
  // to call an unreviewed queue an empty week. What is asserted here is that this page goes through
  // THAT function, so the two cannot drift apart, and that its answers pass the page's own gate.
  const missingTable = Object.assign(new Error('relation "upcoming_extraction_runs" does not exist'), { code: "42P01" });
  const feed = await readUpcomingFeedForFamily({ db: { select: () => { throw missingTable; } } });
  assert.equal(feed.state, "not_extracted", "a missing table is 未接入, never an empty week");
  assert.equal((await readHomeUpcoming(async () => feed)).status, "unavailable");
});

test("1 · only unreviewed rows: the block is hidden", async () => {
  // With 21 rows all needs_human_review, the family read answers not_extracted and says why.
  const feed = await readHomeUpcoming(async () => ({ state: "not_extracted", reason: "21 upcoming rows exist but none has been reviewed" }));
  assert.equal(feed.status, "unavailable");
  assert.match(feed.reason, /none has been reviewed/);
  // Defence in depth: handed a no_items with a pending queue anyway, this page still draws nothing.
  const backlog = feedFromResult({ state: "no_items", coverage }, { pendingReview: 21 });
  assert.equal(backlog.status, "unavailable");
  assert.match(backlog.reason, /waiting on a reviewer/);
});

test("2 · approved rows display, and only those rows", async () => {
  const feed = await readHomeUpcoming(async () => ({ state: "ready", coverage, unreviewed: 0, items: [{ id: "ok", title: "带尿不湿", when: { kind: "day", day: "2026-09-14" }, status: "open", evidence }] }));
  assert.equal(feed.status, "ready");
  assert.deepEqual(feed.items.map((item) => item.id), ["ok"]);
});

test("3 · not_extracted and read_failed never pose as 没有待办", async () => {
  for (const result of [
    { state: "not_extracted", reason: "the upcoming tables do not exist in this database yet" },
    { state: "read_failed", reason: "could not read the upcoming items", error: "boom" },
  ]) {
    const feed = await readHomeUpcoming(async () => result);
    assert.equal(feed.status, "unavailable", `${result.state} must render nothing`);
  }
  // A read that throws outright is not an empty week either.
  assert.equal((await readHomeUpcoming(async () => { throw new Error("no database connection is configured"); })).status, "unavailable");
  assert.equal(feedFromResult(undefined).status, "unavailable");
});

test("4 · no_items may say 没有事项 only when the run covered its whole window", () => {
  // Complete: every unit read, nothing failed, a real last message, nothing pending review.
  const clear = feedFromResult({ state: "no_items", coverage }, { pendingReview: 0 });
  assert.equal(clear.status, "clear");
  assert.equal(clear.windowFrom, "2026-08-01");
  assert.equal(clear.readToDay, "2026-09-11", "the page prints the period it actually read");
  // Every way of being incomplete renders nothing instead.
  const partial = { ...coverage, partial: true };
  const failed = { ...coverage, unitsFailed: 3 };
  const short = { ...coverage, unitsCovered: 100 };
  const noEnd = { ...coverage, windowToMessageAt: null };
  const nothingRun = { ...coverage, unitsTotal: 0, unitsCovered: 0 };
  for (const [name, cov] of Object.entries({ partial, failed, short, noEnd, nothingRun })) {
    const feed = feedFromResult({ state: "no_items", coverage: cov }, { pendingReview: 0 });
    assert.equal(feed.status, "unavailable", `${name} coverage must not claim a clear week`);
  }
});

test("three of the feed's four no-row states render nothing, and so does the fourth", () => {
  // not_extracted is tonight's real state: migration 0013 is not applied to any running database.
  assert.equal(feedFromResult({ state: "not_extracted", reason: "the upcoming tables do not exist in this database yet" }).status, "unavailable");
  assert.equal(feedFromResult({ state: "read_failed", reason: "could not read the upcoming items", error: "boom" }).status, "unavailable");
  assert.equal(feedFromResult(undefined).status, "unavailable", "a read that threw is not an empty week either");
  // no_items with a half-read window says nothing; the complete-coverage case is the test above.
  const none = feedFromResult({ state: "no_items", coverage: { ...coverage, partial: true } });
  assert.equal(none.status, "unavailable");
  // Ready, but every row fails the page-side gate: still nothing asserted.
  assert.equal(feedFromResult({ state: "ready", coverage, unreviewed: 0, items: [{ id: "x", title: "带尿不湿", when: { kind: "unconfirmed" }, status: "open" }] }).status, "unavailable", "a row with no checkable source is dropped, and dropping everything is 未接入");
});

test("done is a claim: without evidence of the completion the item is still open, with no line through it", () => {
  const claimed = normalizeUpcoming({ id: "u1", title: "带尿不湿", when: { kind: "day", day: "2026-09-13" }, status: "done", evidence, statusNote: "应该带了吧" });
  assert.equal(claimed.status, "open", "a passed date, a silent thread or a photo from that day is not evidence");
  assert.equal(claimed.statusNote, undefined, "and the note that asserted it goes with it");
  const proven = normalizeUpcoming({ id: "u2", title: "带尿不湿", when: { kind: "day", day: "2026-09-13" }, status: "done", evidence, statusNote: "老师说已经带到了", statusEvidence: { day: "2026-09-14" } });
  assert.equal(proven.status, "done");
  assert.equal(proven.statusNote, "老师说已经带到了");
  assert.deepEqual(proven.statusEvidence, { eventId: undefined, day: "2026-09-14" });
});

test("cancelled and rescheduled are their own states, kept apart from done", () => {
  const cancelled = normalizeUpcoming({ id: "u3", title: "国庆去大湾区", when: { kind: "day", day: "2026-10-01" }, status: "cancelled", evidence, statusNote: "妈妈说不去了", statusEvidence: { eventId: "event-x" } });
  assert.equal(cancelled.status, "cancelled");
  const moved = normalizeUpcoming({ id: "u4", title: "体检", when: { kind: "day", day: "2026-09-20" }, status: "rescheduled", evidence, statusNote: "改到 9 月 27 日", statusEvidence: { eventId: "event-y" } });
  assert.equal(moved.status, "rescheduled");
  assert.equal(moved.statusNote, "改到 9 月 27 日");
  // Same fail-closed rule as done.
  assert.equal(normalizeUpcoming({ id: "u5", title: "体检", when: { kind: "unconfirmed" }, status: "cancelled", evidence }).status, "open");
});

test("a time nobody could pin is 待确认, never a guessed day", () => {
  for (const when of [undefined, { kind: "day" }, { kind: "day", day: "明天" }, { kind: "day", day: "2026-9-3" }, { kind: "window", fromDay: "2026-10-01" }]) {
    assert.deepEqual(normalizeUpcoming({ id: "u", title: "出游", when, status: "open", evidence }).when, { kind: "unconfirmed" }, `${JSON.stringify(when)} must not become a date`);
  }
  assert.deepEqual(normalizeUpcoming({ id: "u", title: "出游", when: { kind: "day", day: "2026-10-01" }, status: "open", evidence }).when, { kind: "day", day: "2026-10-01" });
  // A window that arrived with its ends the wrong way round is still two real days.
  assert.deepEqual(normalizeUpcoming({ id: "u", title: "出游", when: { kind: "window", fromDay: "2026-10-07", toDay: "2026-10-01" }, status: "open", evidence }).when, { kind: "window", fromDay: "2026-10-01", toDay: "2026-10-07" });
});

test("待定 stays 待定: a discussed plan is not an open commitment and is not dropped either", () => {
  const item = normalizeUpcoming({ id: "u6", title: "国庆去大湾区", note: "还在商量", when: { kind: "unconfirmed" }, status: "tentative", evidence });
  assert.equal(item.status, "tentative");
  assert.equal(item.note, "还在商量");
});

test("an item nobody can check never reaches the page (原则八)", () => {
  assert.equal(normalizeUpcoming({ id: "u7", title: "带尿不湿", when: { kind: "day", day: "2026-09-13" }, status: "open" }), undefined);
  assert.equal(normalizeUpcoming({ id: "u8", title: "带尿不湿", when: { kind: "day", day: "2026-09-13" }, status: "open", evidence: { day: "not-a-day" } }), undefined);
});

test("still-to-do first, soonest first, undated after dated, settled at the end", () => {
  const rows = [
    { id: "done", title: "打疫苗", when: { kind: "day", day: "2026-09-05" }, status: "done", evidence, statusEvidence: { eventId: "e" } },
    { id: "later", title: "体检", when: { kind: "day", day: "2026-09-20" }, status: "open", evidence },
    { id: "soon", title: "带尿不湿", when: { kind: "day", day: "2026-09-13" }, status: "open", evidence },
    { id: "undated", title: "出游", when: { kind: "unconfirmed" }, status: "open", evidence },
    { id: "maybe", title: "国庆去大湾区", when: { kind: "window", fromDay: "2026-10-01", toDay: "2026-10-07" }, status: "tentative", evidence },
    { id: "moved", title: "复查", when: { kind: "day", day: "2026-09-27" }, status: "rescheduled", evidence, statusEvidence: { eventId: "e" } },
  ];
  const feed = feedFromResult({ state: "ready", coverage, unreviewed: 0, items: rows });
  assert.equal(feed.status, "ready");
  assert.deepEqual(feed.items.map((item) => item.id), ["soon", "later", "undated", "moved", "maybe", "done"]);
  // Overflow is a display split, not a drop: everything the feed holds is on the page, four of it
  // above 展开全部 and the rest inside it.
  assert.equal(feed.items.length, rows.length);
  assert.equal(UPCOMING_VISIBLE, 4);
  assert.equal(feed.items.slice(0, UPCOMING_VISIBLE).length + feed.items.slice(UPCOMING_VISIBLE).length, rows.length);
});

test("sortUpcoming is stable across row order", () => {
  const items = ["b", "a"].map((id) => normalizeUpcoming({ id, title: id, when: { kind: "day", day: "2026-09-13" }, status: "open", evidence }));
  assert.deepEqual(sortUpcoming(items).map((item) => item.id), ["a", "b"]);
  assert.deepEqual(sortUpcoming([...items].reverse()).map((item) => item.id), ["a", "b"]);
});

test("repeat reminders arrive folded into one item, and the page keeps the record of that", () => {
  const item = normalizeUpcoming({ id: "u9", title: "带尿不湿", when: { kind: "day", day: "2026-09-13" }, status: "open", evidence, supersedes: ["msg-1", "msg-2"] });
  assert.deepEqual(item.supersedes, ["msg-1", "msg-2"], "one commitment is one line however many times it was asked for");
  assert.equal(normalizeUpcoming({ id: "u10", title: "带尿不湿", when: { kind: "unconfirmed" }, status: "open", evidence, supersedes: [] }).supersedes, undefined);
});

// ── 分组与排序 (总指挥, 2026-09-13) ──────────────────────────────────────────
// 下面用的是 2026-09-13 线上真实的那 17 条 approved（9 open / 5 tentative / 3 done）的形状：
// 日期、状态、时间形态都照抄，只把标题缩短。今天固定为 2026-09-13。
const TODAY = "2026-09-13";
const ev = { day: "2026-08-01" };
const item = (id, status, when, extra = {}) => ({ id, title: id, status, when, evidence: ev, ...extra });
const day = (d) => ({ kind: "day", day: d });
const win = (from, to) => ({ kind: "window", fromDay: from, toDay: to });
const unset = { kind: "unconfirmed" };
const proven = { statusEvidence: { day: "2026-09-10" } };

const LIVE = [
  item("done-0805", "done", day("2026-08-05"), proven),
  item("done-0808", "done", day("2026-08-08"), proven),
  item("done-0909", "done", day("2026-09-09"), proven),
  item("open-0811", "open", day("2026-08-11")),
  item("open-0812", "open", day("2026-08-12")),
  item("open-0816", "open", day("2026-08-16")),
  item("open-0819", "open", day("2026-08-19")),
  item("open-0821", "open", day("2026-08-21")),
  item("open-0909a", "open", day("2026-09-09")),
  item("open-0909b", "open", day("2026-09-09")),
  item("open-unset-a", "open", unset),
  item("open-unset-b", "open", unset),
  item("tent-0822", "tentative", win("2026-08-22", "2026-08-23")),
  item("tent-0907", "tentative", win("2026-09-07", "2026-09-13")),
  item("tent-unset-a", "tentative", unset),
  item("tent-unset-b", "tentative", unset),
  item("tent-unset-c", "tentative", unset),
];

test("分组：五组的次序、组内排序，以及区间按结束日判断过期", () => {
  const groups = groupUpcoming(LIVE, TODAY);
  assert.deepEqual(groups.map((g) => g.key), ["undated", "tentative", "overdue", "done"], "线上这 17 条里没有今天及之后的明确待办，空组不渲染");
  assert.deepEqual(groups.find((g) => g.key === "undated").items.map((i) => i.id), ["open-unset-a", "open-unset-b"]);
  // 待定：有日子的按日子排在前，没日子的随后。09-07 → 09-13 那条**盖着今天**，仍在待定组里。
  assert.deepEqual(groups.find((g) => g.key === "tentative").items.map((i) => i.id), ["tent-0822", "tent-0907", "tent-unset-a", "tent-unset-b", "tent-unset-c"]);
  // 过期组：离今天越近越前。
  assert.deepEqual(groups.find((g) => g.key === "overdue").items.map((i) => i.id), ["open-0909a", "open-0909b", "open-0821", "open-0819", "open-0816", "open-0812", "open-0811"]);
  assert.deepEqual(groups.find((g) => g.key === "done").items.map((i) => i.id), ["done-0909", "done-0808", "done-0805"]);
  // 一条都不能丢，也不能被算两次。
  assert.equal(groups.reduce((n, g) => n + g.items.length, 0), LIVE.length);
  assert.equal(new Set(groups.flatMap((g) => g.items.map((i) => i.id))).size, LIVE.length);
});

test("区间只看结束日：今天还在区间里就不算过期，昨天结束的才算", () => {
  const covering = groupUpcoming([item("covers-today", "open", win("2026-09-07", "2026-09-13"))], TODAY);
  assert.equal(covering[0].key, "upcoming", "9 月 7 日开始、13 日结束，今天是 13 日 —— 还盖着今天");
  const ended = groupUpcoming([item("ended", "open", win("2026-09-05", "2026-09-12"))], TODAY);
  assert.equal(ended[0].key, "overdue");
  const todayOnly = groupUpcoming([item("today", "open", day(TODAY))], TODAY);
  assert.equal(todayOnly[0].key, "upcoming", "今天当天不是过期");
});

test("改期按现在的时间归组并保留标记；取消永远不和完成混在一起", () => {
  const moved = item("moved", "rescheduled", day("2026-09-20"), { statusNote: "改到 9 月 20 日", statusEvidence: { day: "2026-09-11" } });
  const movedPast = item("moved-past", "rescheduled", day("2026-09-01"), { statusNote: "改到 9 月 1 日", statusEvidence: { day: "2026-08-30" } });
  const cancelled = item("cancelled", "cancelled", day("2026-09-07"), { statusEvidence: { day: "2026-09-06" } });
  const groups = groupUpcoming([moved, movedPast, cancelled, LIVE[0]], TODAY);
  assert.equal(groups.find((g) => g.key === "upcoming").items[0].id, "moved", "改到将来的，按将来的日子归组");
  assert.equal(groups.find((g) => g.key === "overdue").items[0].id, "moved-past", "改到已经过去的，归到过期组，不是完成");
  assert.equal(groups.find((g) => g.key === "cancelled").items[0].id, "cancelled");
  assert.ok(!groups.find((g) => g.key === "done").items.some((i) => i.id === "cancelled"), "取消不能进已完成");
  // 组序里取消永远排在完成之后，两个组名不同。
  assert.deepEqual(groups.map((g) => g.key).slice(-2), ["done", "cancelled"]);
});

test("默认四条按组序取，其余都在展开里，两边都带组名", () => {
  const groups = groupUpcoming(LIVE, TODAY);
  const { head, rest } = splitUpcomingGroups(groups, UPCOMING_VISIBLE);
  assert.equal(head.reduce((n, g) => n + g.items.length, 0), 4);
  assert.deepEqual(head.map((g) => [g.label, g.items.map((i) => i.id)]), [
    ["时间待确认", ["open-unset-a", "open-unset-b"]],
    ["待定的计划", ["tent-0822", "tent-0907"]],
  ], "第一组为空，就从第二组开始取");
  // 被折叠线切开的那一组，两边都写出组名。
  assert.ok(rest.some((g) => g.label === "待定的计划"));
  const all = [...head, ...rest].flatMap((g) => g.items.map((i) => i.id));
  assert.equal(all.length, LIVE.length, "十七条一条不少");
  assert.equal(new Set(all).size, LIVE.length, "也没有一条被显示两次");
});
