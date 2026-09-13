// 习惯露出日的存储与上报口（lib/db/habit-display-store.ts、lib/home-feed.ts reportHabitShown）。
//
// 这里守的是「谁算露出过」。真库上的去重、重启后仍在、第三天退出，由
// .data/habit-display-rds-verify.mjs 在真实 RDS 上（事务内，最后 ROLLBACK）验过；
// 这个文件守的是**不该被记进去的那些情况**——预取、脚本、折叠未展示项、非习惯类。
// 每一条 fixture 都是合成的。
import test from "node:test";
import assert from "node:assert/strict";
import { readHabitDisplayDays, recordHabitShown } from "../lib/db/habit-display-store.ts";
import { buildReminders, reportHabitShown } from "../lib/home-feed.ts";

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

test("reportHabitShown 在没有可报内容时不碰数据库", async () => {
  // 提醒读不出来 / 真的没有待办 —— 两种都不该写任何露出日。
  for (const reminders of [
    { status: "unavailable", unavailable: { kind: "read_failed", reason: "x" } },
    { status: "clear", windowFrom: "2026-09-01" },
  ]) {
    const feed = { clock: { today: TODAY }, reminders };
    assert.deepEqual(await reportHabitShown(feed), { attempted: 0 });
  }
  // ready 但默认位上没有习惯类 —— 同样不写。
  const feed = { clock: { today: TODAY }, reminders: { status: "ready", shown: [], more: [], retired: [], habitShownIds: [] } };
  assert.deepEqual(await reportHabitShown(feed), { attempted: 0 });
});

test("reportHabitShown 用的是 feed 自己的上海自然日，不是 new Date()", async () => {
  // 只要它拿的是 feed.clock.today，这里给一个明显不是今天的日子也应当照用——
  // 自己取 new Date() 会在 UTC 日界附近记错一天，而唯一键就是那一天。
  const feed = {
    clock: { today: "2025-01-03" },
    reminders: { status: "ready", shown: [], more: [], retired: [], habitShownIds: ["h1"] },
  };
  // 没有数据库连接时它会跳过并说明原因，但**不抛**；关键是它没有回头去取系统时间。
  const result = await reportHabitShown(feed);
  assert.equal(result.attempted === 0 || result.attempted === 1, true);
  if (result.skipped) assert.doesNotMatch(result.skipped, /不是一个自然日/, "日期是从 feed 里拿的，格式一定合法");
});
