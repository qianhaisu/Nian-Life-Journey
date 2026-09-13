// 待办保鲜 (lib/upcoming-freshness.ts). 这里的用例大半是**生产上真实存在的那几条**——
// 2026-09-13 线上首页最上面就是 8 月 16 日的「买鸡蛋」。断言写的是那些标题本身，所以哪天规则
// 改坏了，失败信息直接说出是哪一条会重新爬回首页。
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFreshness, freshnessOf, FRESHNESS_HOURS, HABIT_MAX_DATES, isImportantItem,
  limitHabitDates, pinnedRaisedOn, raisedOnOf,
} from "../lib/upcoming-freshness.ts";
import { buildReminders, reminderStateOf } from "../lib/home-feed.ts";

const TODAY = "2026-09-13";

const item = (overrides = {}) => ({
  id: "i", title: "事项", when: { kind: "unconfirmed" }, status: "open",
  evidence: { day: "2026-08-16" }, ...overrides,
});

// ── 起算点 ───────────────────────────────────────────────────────────────────

test("起算点是消息日（evidence.day），不是入库时刻，也不是今天", () => {
  assert.equal(raisedOnOf(item({ evidence: { day: "2026-08-16" } })), "2026-08-16");
  // 没有可用日期时返回 undefined —— 绝不拿今天顶替，否则每次打开页面它都会重新变新鲜。
  assert.equal(raisedOnOf(item({ evidence: undefined })), undefined);
  assert.equal(raisedOnOf(item({ evidence: { day: "去年夏天" } })), undefined, "不是 YYYY-MM-DD 就是没有");
  const verdict = freshnessOf(item({ evidence: undefined }), TODAY);
  assert.equal(verdict.stale, false);
  assert.match(verdict.reason, /不拿今天顶替/);
});

// ── 生产上真实的那几条 ───────────────────────────────────────────────────────

test("生产真实案例：8 月 16 日的「买鸡蛋」按 48 小时退场，但库里仍然是 open", () => {
  const eggs = item({ id: "eggs", title: "买鸡蛋", note: "妈妈说先给他买鸡蛋。", evidence: { day: "2026-08-16" } });
  const verdict = freshnessOf(eggs, TODAY);
  assert.equal(verdict.klass, "errand");
  assert.equal(verdict.freshThrough, "2026-08-18", "8 月 16 日 + 48 小时");
  assert.equal(verdict.stale, true);
  assert.match(verdict.reason, /临时事项/);
  const state = reminderStateOf(eggs, TODAY, new Set());
  assert.equal(state.state, "expired");
  assert.equal(eggs.status, "open", "退场不等于完成：库里那一行一个字都没动");
  // 还在新鲜期内的同一条事项不退场 —— 规则是时钟，不是「采购一律不要」。
  assert.equal(freshnessOf({ ...eggs, evidence: { day: "2026-09-12" } }, TODAY).stale, false);
});

test("生产真实案例：8 月 21 日老师说的「给宝贝涂药膏」也按临时事项退场", () => {
  const cream = item({ id: "cream", title: "给宝贝涂药膏", note: "老师说他小腿被蚊子叮了一口，请回家涂药膏。", evidence: { day: "2026-08-21" } });
  assert.equal(classifyFreshness(cream), "errand", "一次性、没有期限的临时事项，不只是采购才算");
  assert.equal(freshnessOf(cream, TODAY).stale, true);
});

test("生产真实案例：接种记录核对是关键事项，永不按时钟过期，也不生成医疗期限", () => {
  const vax = item({
    id: "vax", title: "核对张年的接种记录，确认是否需要补种",
    note: "核对国内接种证及美国接种记录；重点核实麻腮风延期后的接种情况",
    evidence: { day: "2026-09-13" },
  });
  assert.ok(isImportantItem(vax));
  assert.equal(classifyFreshness(vax), "important");
  const verdict = freshnessOf(vax, TODAY);
  assert.equal(verdict.stale, false);
  assert.equal(verdict.freshThrough, undefined, "不生成一个医疗期限");
  // 即使它是三个月前提出来的，也不退场。
  assert.equal(freshnessOf({ ...vax, evidence: { day: "2026-06-01" } }, TODAY).stale, false);
  assert.equal(reminderStateOf(vax, TODAY, new Set()).state, "needs_confirmation");
});

test("生产真实案例：已预约/有日子的关键事项过期也不默默丢失", () => {
  const checkup = item({ id: "checkup", title: "带他去门诊复查", when: { kind: "day", day: "2026-09-01" }, evidence: { day: "2026-08-28" } });
  const reminders = buildReminders({ status: "ready", items: [checkup] }, TODAY, undefined);
  assert.equal(reminders.retired.length, 1, "它从默认位退下来");
  assert.equal(reminders.retired[0].status, "open", "没有被写成完成");
  assert.equal(reminders.more.length, 1, "但它仍然在展开里，没有丢");
  assert.equal(reminders.more[0].important, true, "而且标着关键事项");
});

test("生产真实案例：「下周出游」的窗口还盖着今天，所以既不过期、也不显示成「要做的」", () => {
  const trip = item({
    id: "trip", title: "下周出游（莫干山或四明山）", status: "tentative",
    when: { kind: "window", fromDay: "2026-09-07", toDay: "2026-09-13" }, evidence: { day: "2026-08-31" },
  });
  assert.equal(freshnessOf(trip, TODAY).stale, false, "结束日就是今天，还盖着今天");
  const state = reminderStateOf(trip, TODAY, new Set());
  assert.equal(state.state, "tentative", "写了日子的待定计划仍然是待定，不能读成一件已定的事");
  assert.match(state.reason, /还没定下来/);
});

test("生产真实案例：8 月 22–23 日那次「周末出游」窗口已过，退场时说的是「没有后续消息」", () => {
  const old = item({
    id: "trip-old", title: "周末安排一次宁波或舟山出游", status: "tentative",
    when: { kind: "window", fromDay: "2026-08-22", toDay: "2026-08-23" }, evidence: { day: "2026-08-17" },
  });
  const verdict = freshnessOf(old, TODAY);
  assert.equal(verdict.stale, true);
  assert.match(verdict.reason, /没有后续消息/, "它从没定下来，谈不上「没有完成记录」");
  assert.equal(reminderStateOf(old, TODAY, new Set()).state, "expired");
});

test("生产真实案例：没有日期的待定计划不按时钟过期（10 月的国庆打算不是 8 月的旧账）", () => {
  const holiday = item({ id: "holiday", title: "国庆去大湾区旅游", status: "tentative", evidence: { day: "2026-08-25" } });
  assert.equal(classifyFreshness(holiday), "undecided_plan");
  const verdict = freshnessOf(holiday, TODAY);
  assert.equal(verdict.stale, false);
  assert.equal(verdict.freshThrough, undefined, "规格没给这一类数字，就不臆造一个");
  assert.equal(reminderStateOf(holiday, TODAY, new Set()).state, "tentative");
});

// ── 三类时钟 ─────────────────────────────────────────────────────────────────

test("临时事项 48 小时 / 库存预测 72 小时 / 习惯提醒 7 天", () => {
  assert.deepEqual(FRESHNESS_HOURS, { errand: 48, stock_forecast: 72, habit: 7 * 24 });
  const raised = "2026-09-09";
  const errand = freshnessOf(item({ title: "买尿不湿", evidence: { day: raised } }), TODAY);
  assert.equal(errand.klass, "errand");
  assert.equal(errand.freshThrough, "2026-09-11");
  const stock = freshnessOf(item({ title: "尿不湿快没了", evidence: { day: raised } }), TODAY);
  assert.equal(stock.klass, "stock_forecast");
  assert.equal(stock.freshThrough, "2026-09-12");
  const habit = freshnessOf(item({ title: "每天记一次作息", evidence: { day: raised } }), TODAY);
  assert.equal(habit.klass, "habit");
  assert.equal(habit.freshThrough, "2026-09-16");
  assert.equal(habit.stale, false, "7 天周期还没走完");
});

test("新鲜期最后一天当天不算过期，第二天才算（边界含当天）", () => {
  const at = (day) => freshnessOf(item({ title: "买鸡蛋", evidence: { day } }), TODAY).stale;
  assert.equal(at("2026-09-11"), false, "9-11 + 2 天 = 9-13，就是今天，还新鲜");
  assert.equal(at("2026-09-10"), true, "9-10 + 2 天 = 9-12，昨天就过了");
});

test("起算点跨月跨年按日历算，不是按 30 天", () => {
  assert.equal(freshnessOf(item({ title: "买鸡蛋", evidence: { day: "2026-08-30" } }), "2026-09-01").stale, false);
  assert.equal(freshnessOf(item({ title: "买鸡蛋", evidence: { day: "2025-12-31" } }), "2026-01-02").stale, false);
  assert.equal(freshnessOf(item({ title: "买鸡蛋", evidence: { day: "2025-12-30" } }), "2026-01-02").stale, true);
});

test("历史消息今天导入，仍然是过期的（起算点是消息日，不是导入日）", () => {
  // 这一条是整个文件存在的理由：五万条微信记录是 2026 年导进来的，消息本身是 2025 年说的。
  const oldMessage = item({ title: "买鸡蛋", evidence: { day: "2025-07-04" } });
  const verdict = freshnessOf(oldMessage, TODAY);
  assert.equal(verdict.stale, true);
  assert.equal(verdict.raisedOn, "2025-07-04", "起算点是 2025 年那天，不是今天导入的这一刻");
  assert.equal(verdict.freshThrough, "2025-07-06");
});

test("同一条事项重复判定是幂等的：同样输入逐字同样输出", () => {
  const one = freshnessOf(item({ title: "买鸡蛋" }), TODAY);
  const two = freshnessOf(item({ title: "买鸡蛋" }), TODAY);
  assert.deepEqual(one, two);
});

// ── 习惯提醒最多两个日期 ─────────────────────────────────────────────────────

test("同一条习惯提醒最多露出两个不同日期，更早的收起来但不丢", () => {
  const entries = [
    { id: "h1", title: "每天量体温", raisedOn: "2026-09-12", klass: "habit" },
    { id: "h2", title: "每天量体温", raisedOn: "2026-09-10", klass: "habit" },
    { id: "h3", title: "每天量体温", raisedOn: "2026-09-08", klass: "habit" },
    { id: "e1", title: "买鸡蛋", raisedOn: "2026-09-01", klass: "errand" },
  ];
  const { kept, dropped } = limitHabitDates(entries);
  assert.equal(dropped.length, 1);
  assert.equal(dropped[0].entry.id, "h3", "留下的是最近两个日期");
  assert.match(dropped[0].reason, new RegExp(`${HABIT_MAX_DATES} 个不同日期`));
  assert.ok(kept.some((entry) => entry.id === "e1"), "非习惯类一条都不受影响");
  assert.equal(kept.length + dropped.length, entries.length);
});

test("同一天的两条习惯提醒只算一个日期", () => {
  const entries = [
    { id: "a", title: "每天量体温", raisedOn: "2026-09-12", klass: "habit" },
    { id: "b", title: "每天量体温", raisedOn: "2026-09-12", klass: "habit" },
    { id: "c", title: "每天量体温", raisedOn: "2026-09-10", klass: "habit" },
  ];
  const { dropped } = limitHabitDates(entries);
  assert.equal(dropped.length, 0, "两个不同日期都还没用完");
});

// ── 每次读取都过滤 ───────────────────────────────────────────────────────────

test("每次首页读取都重跑有效性过滤：后台没动过库，过期琐事也不会再爬回默认位", () => {
  const items = [
    item({ id: "eggs", title: "买鸡蛋", evidence: { day: "2026-08-16" } }),
    item({ id: "cream", title: "给宝贝涂药膏", evidence: { day: "2026-08-21" } }),
    item({ id: "shoes", title: "取回落在学校的鞋子", when: { kind: "day", day: "2026-08-11" }, evidence: { day: "2026-08-10" } }),
    item({ id: "vax", title: "核对张年的接种记录，确认是否需要补种", evidence: { day: TODAY } }),
  ];
  // 连读三次，每次都是同一个答案，而且每次都真的重算过（没有缓存，没有后台任务参与）。
  for (let round = 0; round < 3; round += 1) {
    const reminders = buildReminders({ status: "ready", items }, TODAY, undefined);
    assert.deepEqual(reminders.shown.map((reminder) => reminder.id), ["vax"], "默认位上只有还有效的那条");
    assert.deepEqual(
      reminders.retired.map((reminder) => reminder.id).sort(),
      ["cream", "eggs", "shoes"],
      "三条陈旧的都退场了",
    );
    assert.ok(reminders.retired.every((reminder) => reminder.status === "open"), "而且一条都没有被写成完成");
    assert.equal(reminders.shown.length + reminders.more.length, items.length, "露出的加折叠的等于全部");
  }
});

test("往后推一天，昨天刚好新鲜的那条自己退场，不需要任何后台任务", () => {
  const fresh = item({ id: "milk", title: "买牛奶", evidence: { day: "2026-09-11" } });
  assert.equal(buildReminders({ status: "ready", items: [fresh] }, "2026-09-13").retired.length, 0);
  assert.equal(buildReminders({ status: "ready", items: [fresh] }, "2026-09-14").retired.length, 1);
});

// ── 重放不续期（lib/db/upcoming-store.ts 合并分支调的那条规则） ──────────────────

test("同一件事被更晚的消息再说一次，提出日不会被推后（来源重放不续期）", () => {
  // 8 月 16 日提出的「买鸡蛋」，9 月 10 日又被提了一次。如果提出日跟着走到 9 月 10 日，
  // 48 小时新鲜期就重新开始，一条一个月前的旧账会凭一次重放爬回首页。
  assert.equal(pinnedRaisedOn("2026-08-16", "2026-09-10"), "2026-08-16");
  assert.equal(pinnedRaisedOn("2026-09-10", "2026-08-16"), "2026-08-16", "哪一边更早都取更早的");
  assert.equal(pinnedRaisedOn(undefined, "2026-08-16"), "2026-08-16", "第一次写入就是候选那天");
  assert.equal(pinnedRaisedOn("2026-08-16", undefined), "2026-08-16");
  assert.equal(pinnedRaisedOn(null, null), undefined);
  assert.equal(pinnedRaisedOn("去年夏天", "2026-08-16"), "2026-08-16", "不是 YYYY-MM-DD 的一律当没有");
  // 幂等：同一来源重放任意多次，结果不动。
  let day = "2026-08-16";
  for (let i = 0; i < 5; i += 1) day = pinnedRaisedOn(day, "2026-09-10");
  assert.equal(day, "2026-08-16");
});
