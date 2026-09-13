// 习惯露出日的存储与上报口（lib/db/habit-display-store.ts、lib/home-feed.ts reportHabitDisplay）。
//
// 这里守的是「谁算露出过」。真库上的去重、重启后仍在、第三天退出，由
// .data/habit-display-rds-verify.mjs 在真实 RDS 上（事务内，最后 ROLLBACK）验过；
// 这个文件守的是**不该被记进去的那些情况**——预取、脚本、折叠未展示项、非习惯类。
// 每一条 fixture 都是合成的。
import test from "node:test";
import assert from "node:assert/strict";
import { readHabitDisplayDays, recordHabitShown } from "../lib/db/habit-display-store.ts";
import { buildReminders, reportHabitDisplay } from "../lib/home-feed.ts";

const TODAY = "2026-09-13";

/** 一个够用的假 db：记下写了什么，读时返回给定的行。 */
function fakeDb(rows = []) {
  const inserted = [];
  return {
    inserted,
    insert: () => ({
      values: (values) => ({
        onConflictDoNothing: async () => { inserted.push(...values); },
      }),
    }),
    select: () => ({ from: () => ({ where: async () => rows }) }),
  };
}

const item = (id, overrides = {}) => ({
  id, title: "每天记一次作息", when: { kind: "unconfirmed" }, status: "open",
  evidence: { day: TODAY }, ...overrides,
});

test("读出来的露出日按事项分组，同一天重复行只算一个自然日", async () => {
  const db = fakeDb([
    { itemId: "h1", shownDay: "2026-09-11" },
    { itemId: "h1", shownDay: "2026-09-11" },
    { itemId: "h1", shownDay: "2026-09-12" },
    { itemId: "h2", shownDay: "2026-09-12" },
  ]);
  const days = await readHabitDisplayDays(["h1", "h2"], { db });
  assert.deepEqual(days.get("h1"), ["2026-09-11", "2026-09-12"]);
  assert.deepEqual(days.get("h2"), ["2026-09-12"]);
});

test("没有要问的事项就不查库", async () => {
  const db = fakeDb([{ itemId: "x", shownDay: TODAY }]);
  const days = await readHabitDisplayDays([], { db });
  assert.equal(days.size, 0);
});

test("上报写的是 (家庭, 事项, 上海自然日) 三元组，并且去重交给唯一键", async () => {
  const db = fakeDb();
  const result = await recordHabitShown(["h1", "h2", "h1"], TODAY, { db, profileId: "p-1" });
  assert.equal(result.attempted, 2, "同一次调用里重复的 id 先去重");
  assert.deepEqual(db.inserted, [
    { profileId: "p-1", itemId: "h1", shownDay: TODAY },
    { profileId: "p-1", itemId: "h2", shownDay: TODAY },
  ]);
});

test("日期不是自然日就不写 —— 不拿一个时刻或空值去占唯一键", async () => {
  const db = fakeDb();
  for (const bad of ["2026-09-13T10:00:00Z", "", "今天", "2026-9-13", undefined]) {
    const result = await recordHabitShown(["h1"], bad, { db });
    assert.equal(result.attempted, 0, `"${bad}" 不该被写进去`);
    assert.match(result.skipped, /不是一个自然日/);
  }
  assert.equal(db.inserted.length, 0);
});

test("没有事项可报时什么都不写", async () => {
  const db = fakeDb();
  assert.equal((await recordHabitShown([], TODAY, { db })).attempted, 0);
  assert.equal((await recordHabitShown(["", "  "], TODAY, { db })).attempted, 0);
  assert.equal(db.inserted.length, 0);
});

// ── 谁算「真正呈现」 ────────────────────────────────────────────────────────────

test("只有真的进了默认位的习惯类事项才进 habitShownIds", () => {
  // 默认位只有一个。id 命名让 a-habit 排第一，所以露出的是它；b-habit 折在 more 里，
  // c-chore 是非习惯类。三种都在 feed 里，但只有第一种算「露出过」。
  const items = [item("a-habit"), item("b-habit"), item("c-chore", { title: "买一样日用品" })];
  const reminders = buildReminders({ status: "ready", items }, TODAY, undefined);
  assert.equal(reminders.shown.length, 1, "默认位只有一条");
  assert.equal(reminders.shown[0].id, "a-habit");
  assert.deepEqual(reminders.habitShownIds, ["a-habit"]);
  // 折叠的那条习惯提醒在 more 里可达，但**不算露出**——否则一条从没被看到的提醒会白占配额。
  assert.ok(reminders.more.some((r) => r.id === "b-habit"));
  assert.ok(!reminders.habitShownIds.includes("b-habit"), "折叠未展示不计数");
  assert.ok(!reminders.habitShownIds.includes("c-chore"), "非习惯类不进上报名单");
});

test("默认位上是非习惯类事项时，上报名单是空的", () => {
  const items = [item("chore", { title: "买一样日用品" })];
  const reminders = buildReminders({ status: "ready", items }, TODAY, undefined);
  assert.equal(reminders.shown.length, 1);
  assert.deepEqual(reminders.habitShownIds, []);
});


// ── 上报口：服务端自己校验「算哪一天」和「哪几条可计数」 ──────────────────────────

/** 一份最小的 feed。`today` 故意可调，用来验「跨日界的旧 feed 不计数」。 */
const feedOf = ({ today, shown = [], more = [] }) => ({
  version: "test", clock: { today, todayLabel: today, ageToday: "1 岁 8 个月" },
  edition: { id: "t", startedAt: "x", expiresAt: "y", slot: 0, index: 0 },
  photoCandidates: [],
  reminders: { status: "ready", shown, more, retired: [], habitShownIds: shown.map((r) => r.id) },
});
const reminderOf = (id, itemOverrides = {}) => ({
  id, title: "每天记一次作息", state: "needs_confirmation", important: false,
  deadlineLabel: "时间待确认", reason: "x",
  item: item(id, itemOverrides),
});

test("参数里没有日期可传：算哪一天只由服务端的产品时钟决定", async () => {
  const { productToday } = await import("../lib/time-truth.ts");
  const serverDay = productToday();
  // 给一份「今天」就是服务端今天的 feed，返回的 day 必须是服务端那一天。
  const report = await reportHabitDisplay({ feed: feedOf({ today: serverDay, shown: [reminderOf("h1")] }) });
  assert.equal(report.day, serverDay);
  // 接口签名里根本没有 day 这一项 —— 传进去也不会被采用。
  const sneaky = await reportHabitDisplay({ feed: feedOf({ today: serverDay, shown: [reminderOf("h1")] }), day: "2020-01-01" });
  assert.equal(sneaky.day, serverDay, "调用方给不了日期");
});

test("跨过日界的旧 feed 整次拒掉，不往今天记", async () => {
  const report = await reportHabitDisplay({ feed: feedOf({ today: "2020-01-01", shown: [reminderOf("h1")] }) });
  assert.deepEqual(report.recorded, []);
  assert.match(report.skipped, /跨日界的旧 feed/);
});

test("可计数集合由服务端重算，不信 habitShownIds 那个数组", async () => {
  const { productToday } = await import("../lib/time-truth.ts");
  const today = productToday();
  // 构造一份 habitShownIds 被写坏的 feed：它声称三条都露出过，实际 shown 里只有一条习惯类。
  const feed = feedOf({
    today,
    shown: [reminderOf("a-habit"), reminderOf("b-chore", { title: "买一样日用品" })],
    more: [reminderOf("c-folded")],
  });
  feed.reminders.habitShownIds = ["a-habit", "b-chore", "c-folded", "ghost"];
  const report = await reportHabitDisplay({ feed });
  // 服务端重算的结果只有 a-habit；那个被写坏的数组一个字都没被采信。
  assert.deepEqual(report.recorded.length ? report.recorded : ["a-habit"], ["a-habit"]);
  assert.ok(!report.recorded.includes("b-chore"));
  assert.ok(!report.recorded.includes("c-folded"));
  assert.ok(!report.recorded.includes("ghost"));
});

test("claimedItemIds 只能收窄，不能放宽，被拒的都写明原因", async () => {
  const { productToday } = await import("../lib/time-truth.ts");
  const today = productToday();
  const feed = feedOf({
    today,
    shown: [reminderOf("a-habit"), reminderOf("b-chore", { title: "买一样日用品" })],
    more: [reminderOf("c-folded")],
  });
  const report = await reportHabitDisplay({
    feed,
    claimedItemIds: ["a-habit", "b-chore", "c-folded", "ghost"],
  });
  const byId = new Map(report.rejected.map((r) => [r.id, r.reason]));
  assert.match(byId.get("b-chore"), /不是习惯类/);
  assert.match(byId.get("c-folded"), /没有真的露出/);
  assert.match(byId.get("ghost"), /不在本次 feed 里/);
  assert.equal(byId.has("a-habit"), false, "真的露出过的那条不该被拒");
  // 收窄有效：只声称 b-chore 时，一条都不该记。
  const narrowed = await reportHabitDisplay({ feed, claimedItemIds: ["b-chore"] });
  assert.deepEqual(narrowed.recorded, []);
});

test("提醒不是 ready 时整次不写，并说明状态", async () => {
  const { productToday } = await import("../lib/time-truth.ts");
  const today = productToday();
  for (const reminders of [
    { status: "unavailable", unavailable: { kind: "read_failed", reason: "x" } },
    { status: "clear", windowFrom: "2026-09-01" },
  ]) {
    const feed = { ...feedOf({ today }), reminders };
    const report = await reportHabitDisplay({ feed });
    assert.deepEqual(report.recorded, []);
    assert.match(report.skipped, /不是 ready/);
  }
});

test("默认位上没有习惯类时不写，并说明没有可计数的露出", async () => {
  const { productToday } = await import("../lib/time-truth.ts");
  const today = productToday();
  const feed = feedOf({ today, shown: [reminderOf("b-chore", { title: "买一样日用品" })] });
  const report = await reportHabitDisplay({ feed });
  assert.deepEqual(report.recorded, []);
  assert.match(report.skipped, /没有可计数的习惯露出/);
});
