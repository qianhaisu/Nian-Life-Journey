// 待办保鲜 (lib/upcoming-freshness.ts).
//
// **这里每一条 fixture 都是合成的。** 真实的家庭聊天、标题与健康细节不进 Git
// （test/upcoming-feed.test.mjs 立的同一条规矩），针对生产那 18 条真实待办的核验在仓库外：
// NianlifeOps/home-2026-09-13/data/home-feed-verification.json 的「逐条保鲜判定」，
// 以及同目录的 live-upcoming.json（采自线上私有站首页 DOM）。
//
// 合成 fixture 照抄的是生产那 18 条的**形状**，不是它们的内容——每个 test 名字里写的是形状：
// 28 天前提出的无期限采购、23 天前提出的无期限小事、今天提出的关键健康事项、窗口盖住今天的待定
// 计划、窗口已过的待定计划、无日期的待定计划、日子已过的一次性琐事。这七种在生产里都真的存在。
import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFreshness, freshnessOf, FRESHNESS_HOURS, HABIT_MAX_DATES, isImportantItem,
  capHabitByShownDays, habitDisplayLogFrom, pinnedRaisedOn, raisedOnOf,
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

test("形状一：28 天前提出的无期限采购，按 48 小时退场，但库里仍然是 open", () => {
  const eggs = item({ id: "errand-1", title: "买一样日用品", evidence: { day: "2026-08-16" } });
  const verdict = freshnessOf(eggs, TODAY);
  assert.equal(verdict.klass, "errand");
  assert.equal(verdict.freshThrough, "2026-08-18", "提出日 + 48 小时");
  assert.equal(verdict.stale, true);
  assert.match(verdict.reason, /临时事项/);
  const state = reminderStateOf(eggs, TODAY, new Set());
  assert.equal(state.state, "expired");
  assert.equal(eggs.status, "open", "退场不等于完成：库里那一行一个字都没动");
  // 还在新鲜期内的同一条事项不退场 —— 规则是时钟，不是「采购一律不要」。
  assert.equal(freshnessOf({ ...eggs, evidence: { day: "2026-09-12" } }, TODAY).stale, false);
});

test("形状二：23 天前提出的无期限小事（不是采购）也按临时事项退场", () => {
  const cream = item({ id: "errand-2", title: "回家做一件当天的小事", evidence: { day: "2026-08-21" } });
  assert.equal(classifyFreshness(cream), "errand", "一次性、没有期限的临时事项，不只是采购才算");
  assert.equal(freshnessOf(cream, TODAY).stale, true);
});

test("形状三：关键健康事项（接种类）永不按时钟过期，也不生成医疗期限", () => {
  // 词表命中即为关键事项。具体是哪一次核对、核对什么，属于健康记录，不进仓库。
  const vax = item({ id: "health-1", title: "去门诊核对一次接种记录", evidence: { day: "2026-09-13" } });
  assert.ok(isImportantItem(vax));
  assert.equal(classifyFreshness(vax), "important");
  const verdict = freshnessOf(vax, TODAY);
  assert.equal(verdict.stale, false);
  assert.equal(verdict.freshThrough, undefined, "不生成一个医疗期限");
  // 即使它是三个月前提出来的，也不退场。
  assert.equal(freshnessOf({ ...vax, evidence: { day: "2026-06-01" } }, TODAY).stale, false);
  assert.equal(reminderStateOf(vax, TODAY, new Set()).state, "needs_confirmation");
});

test("形状三之二：有日子的关键事项过期也不默默丢失", () => {
  const checkup = item({ id: "health-2", title: "去门诊复查一次", when: { kind: "day", day: "2026-09-01" }, evidence: { day: "2026-08-28" } });
  const reminders = buildReminders({ status: "ready", items: [checkup] }, TODAY, undefined);
  assert.equal(reminders.retired.length, 1, "它从默认位退下来");
  assert.equal(reminders.retired[0].status, "open", "没有被写成完成");
  // 2026-09-16 改版：首页只承载「这一周仍需办理」的事，所以过期的关键事项**连折叠层也不进**
  // （进了就是旧账从另一个门回到首页）。它没有被丢掉，也没有被写成完成——
  // retired 里逐条记着原因，完整清单仍在 components/upcoming-tasks.tsx。
  assert.equal(reminders.more.length, 0, "过期的不从折叠层回到首页");
  assert.equal(reminders.retired[0].kind, "expired", "退场理由照实记成过期，不含糊成别的");
  assert.equal(isImportantItem(checkup), true, "它仍然是关键事项——退场与是否关键是两件事");
});

test("形状四：窗口还盖着今天的待定计划，既不过期、也不显示成「要做的」", () => {
  const trip = item({
    id: "plan-1", title: "下周出门一次", status: "tentative",
    when: { kind: "window", fromDay: "2026-09-07", toDay: "2026-09-13" }, evidence: { day: "2026-08-31" },
  });
  assert.equal(freshnessOf(trip, TODAY).stale, false, "结束日就是今天，还盖着今天");
  const state = reminderStateOf(trip, TODAY, new Set());
  assert.equal(state.state, "tentative", "写了日子的待定计划仍然是待定，不能读成一件已定的事");
  assert.match(state.reason, /还没定下来/);
});

test("形状五：窗口已过的待定计划，退场时说的是「没有后续消息」", () => {
  const old = item({
    id: "plan-2", title: "上个周末出门一次", status: "tentative",
    when: { kind: "window", fromDay: "2026-08-22", toDay: "2026-08-23" }, evidence: { day: "2026-08-17" },
  });
  const verdict = freshnessOf(old, TODAY);
  assert.equal(verdict.stale, true);
  assert.match(verdict.reason, /没有后续消息/, "它从没定下来，谈不上「没有完成记录」");
  assert.equal(reminderStateOf(old, TODAY, new Set()).state, "expired");
});

test("形状六：没有日期的待定计划不按时钟过期（一件还没到的未来的事不是旧账）", () => {
  const holiday = item({ id: "plan-3", title: "下个假期出去玩一次", status: "tentative", evidence: { day: "2026-08-25" } });
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
  const errand = freshnessOf(item({ title: "买一件消耗品", evidence: { day: raised } }), TODAY);
  assert.equal(errand.klass, "errand");
  assert.equal(errand.freshThrough, "2026-09-11");
  const stock = freshnessOf(item({ title: "有件东西快没了", evidence: { day: raised } }), TODAY);
  assert.equal(stock.klass, "stock_forecast");
  assert.equal(stock.freshThrough, "2026-09-12");
  const habit = freshnessOf(item({ title: "每天记一次作息", evidence: { day: raised } }), TODAY);
  assert.equal(habit.klass, "habit");
  assert.equal(habit.freshThrough, "2026-09-16");
  assert.equal(habit.stale, false, "7 天周期还没走完");
});

test("新鲜期最后一天当天不算过期，第二天才算（边界含当天）", () => {
  const at = (day) => freshnessOf(item({ title: "买一样日用品", evidence: { day } }), TODAY).stale;
  assert.equal(at("2026-09-11"), false, "9-11 + 2 天 = 9-13，就是今天，还新鲜");
  assert.equal(at("2026-09-10"), true, "9-10 + 2 天 = 9-12，昨天就过了");
});

test("起算点跨月跨年按日历算，不是按 30 天", () => {
  assert.equal(freshnessOf(item({ title: "买一样日用品", evidence: { day: "2026-08-30" } }), "2026-09-01").stale, false);
  assert.equal(freshnessOf(item({ title: "买一样日用品", evidence: { day: "2025-12-31" } }), "2026-01-02").stale, false);
  assert.equal(freshnessOf(item({ title: "买一样日用品", evidence: { day: "2025-12-30" } }), "2026-01-02").stale, true);
});

test("历史消息今天导入，仍然是过期的（起算点是消息日，不是导入日）", () => {
  // 这一条是整个文件存在的理由：五万条微信记录是 2026 年导进来的，消息本身是 2025 年说的。
  const oldMessage = item({ title: "买一样日用品", evidence: { day: "2025-07-04" } });
  const verdict = freshnessOf(oldMessage, TODAY);
  assert.equal(verdict.stale, true);
  assert.equal(verdict.raisedOn, "2025-07-04", "起算点是 2025 年那天，不是今天导入的这一刻");
  assert.equal(verdict.freshThrough, "2025-07-06");
});

test("同一条事项重复判定是幂等的：同样输入逐字同样输出", () => {
  const one = freshnessOf(item({ title: "买一样日用品" }), TODAY);
  const two = freshnessOf(item({ title: "买一样日用品" }), TODAY);
  assert.deepEqual(one, two);
});

// ── 习惯提醒最多两个日期 ─────────────────────────────────────────────────────

// ── 每次读取都过滤 ───────────────────────────────────────────────────────────

test("每次首页读取都重跑有效性过滤：后台没动过库，过期琐事也不会再爬回默认位", () => {
  const items = [
    item({ id: "eggs", title: "买一样日用品", evidence: { day: "2026-08-16" } }),
    item({ id: "cream", title: "回家做一件当天的小事", evidence: { day: "2026-08-21" } }),
    item({ id: "shoes", title: "取回一件落在外面的东西", when: { kind: "day", day: "2026-08-11" }, evidence: { day: "2026-08-10" } }),
    item({ id: "vax", title: "去门诊核对一次接种记录", evidence: { day: TODAY } }),
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
    // 2026-09-16 改版：首页只承载「这一周仍需办理」的事，过期的连折叠层也不进
    // （进了就是旧账从另一个门爬回首页——正是这条用例要防的事）。
    // 所以「一条都没丢」的账要算上 retired：露出的 + 折叠的 + 退场的 = 全部。
    assert.equal(
      reminders.shown.length + reminders.more.length + reminders.retired.length,
      items.length,
      "露出的 + 折叠的 + 退场的 = 全部",
    );
  }
});

test("往后推一天，昨天刚好新鲜的那条自己退场，不需要任何后台任务", () => {
  const fresh = item({ id: "milk", title: "买一样吃的", evidence: { day: "2026-09-11" } });
  assert.equal(buildReminders({ status: "ready", items: [fresh] }, "2026-09-13").retired.length, 0);
  assert.equal(buildReminders({ status: "ready", items: [fresh] }, "2026-09-14").retired.length, 1);
});

// ── 重放不续期（lib/db/upcoming-store.ts 合并分支调的那条规则） ──────────────────

test("同一件事被更晚的消息再说一次，提出日不会被推后（来源重放不续期）", () => {
  // 8 月 16 日提出的一件无期限小事，9 月 10 日又被提了一次。如果提出日跟着走到 9 月 10 日，
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

// ── 习惯上限：按**实际展示过的自然日**计数（不能用 raisedOn 代替） ──────────────────

// 习惯提醒默认「今天被观察到」：7 天新鲜期（§6.3 的另一条规则）因此不干扰这里要测的日期上限。
// 两条规则是独立的，混在一个 fixture 里就会分不清是谁把它拦下的。
const habitOf = (id, overrides = {}) => item({ id, title: "每天记一次作息", evidence: { day: TODAY }, ...overrides });
const logOf = (pairs) => habitDisplayLogFrom(new Map(pairs));

test("同一天内反复刷新只占一个自然日，不会把自己数出去", () => {
  // 今天已经露过 → 放行。刷十次还是放行：占的是「日」，不是「次」。
  const log = logOf([["h", ["2026-09-11", TODAY]]]);
  for (let refresh = 0; refresh < 10; refresh += 1) {
    const { kept, dropped } = capHabitByShownDays([{ id: "h", title: "每天记一次作息", klass: "habit" }], TODAY, log);
    assert.equal(dropped.length, 0, `第 ${refresh + 1} 次刷新不该把它拦下`);
    assert.equal(kept.length, 1);
  }
  // 走完整条链也一样：同一天多次 buildReminders，退场清单始终为空。
  for (let refresh = 0; refresh < 3; refresh += 1) {
    const reminders = buildReminders({ status: "ready", items: [habitOf("h")] }, TODAY, undefined, log);
    assert.equal(reminders.retired.filter((r) => r.kind === "habit_capped").length, 0);
    assert.equal(reminders.shown.length, 1);
  }
});

test("露出过两个不同日期后，第三个自然日退出默认位", () => {
  const log = logOf([["h", ["2026-09-11", "2026-09-12"]]]);
  // 第三天（今天没露过，已经用掉两个日子）→ 拦下。
  const reminders = buildReminders({ status: "ready", items: [habitOf("h")] }, TODAY, undefined, log);
  const capped = reminders.retired.filter((r) => r.kind === "habit_capped");
  assert.equal(capped.length, 1);
  assert.equal(capped[0].id, "h");
  assert.match(capped[0].reason, /2 个不同的日子/);
  assert.equal(reminders.shown.length, 0, "第三天它不再占默认位");
  // 2026-09-16 改版：被日期上限拦下的habit **也不进折叠层**——折叠层只装「本周仍需办理、
  // 只是没排进默认位」的那几条。它没有丢：上面那三条断言已经证明 retired 里逐条记着原因和状态，
  // 完整清单仍在 components/upcoming-tasks.tsx。
  assert.equal(reminders.more.length, 0, "上限拦下的不从折叠层回到首页");
  // 同一天里它只用掉一个日子：如果今天也算露过，它应当放行。
  const alsoToday = logOf([["h", ["2026-09-11", "2026-09-12", TODAY]]]);
  assert.equal(buildReminders({ status: "ready", items: [habitOf("h")] }, TODAY, undefined, alsoToday).shown.length, 1);
});

test("从没露出过就一天都不算：空日志下习惯提醒照常露出", () => {
  const reminders = buildReminders({ status: "ready", items: [habitOf("h")] }, TODAY, undefined);
  assert.equal(reminders.retired.filter((r) => r.kind === "habit_capped").length, 0);
  assert.equal(reminders.shown.length, 1, "没记过露出 → 没用掉任何日期 → 放行");
  // 只记了别的事项也不算到它头上。
  const otherLog = logOf([["someone-else", ["2026-09-01", "2026-09-02", "2026-09-03"]]]);
  assert.equal(buildReminders({ status: "ready", items: [habitOf("h")] }, TODAY, undefined, otherLog).shown.length, 1);
});

test("raisedOn 不参与计数 —— 数的是露出过的日子，不是被说起的那天", () => {
  // 上一版用 raisedOn 计数。这里两条事项的 7 天新鲜期都还在（所以不是新鲜度把谁拦下的），
  // 唯一的差别是露出日志：结论必须只跟日志走。
  const raisedToday = habitOf("h", { evidence: { day: TODAY } });
  const raisedThreeDaysAgo = habitOf("h", { evidence: { day: "2026-09-10" } });
  // 都没露出过 → 都放行，尽管 raisedOn 差了三天。
  assert.equal(buildReminders({ status: "ready", items: [raisedToday] }, TODAY, undefined).shown.length, 1);
  assert.equal(buildReminders({ status: "ready", items: [raisedThreeDaysAgo] }, TODAY, undefined).shown.length, 1);
  // 都露出过两个别的日子 → 都拦下，同样与 raisedOn 无关。
  const log = logOf([["h", ["2026-09-11", "2026-09-12"]]]);
  assert.equal(buildReminders({ status: "ready", items: [raisedToday] }, TODAY, undefined, log).shown.length, 0);
  assert.equal(buildReminders({ status: "ready", items: [raisedThreeDaysAgo] }, TODAY, undefined, log).shown.length, 0);
});

test("被上限拦下时照抄库里的真实状态，不写成 open", () => {
  const log = logOf([["h", ["2026-09-11", "2026-09-12"]]]);
  const reminders = buildReminders({ status: "ready", items: [habitOf("h", { status: "tentative" })] }, TODAY, undefined, log);
  const capped = reminders.retired.find((r) => r.kind === "habit_capped");
  assert.equal(capped.status, "tentative", "库里是 tentative，退场记录就得写 tentative");
});

test("上限只管习惯类，别的事项的露出日一天都不数", () => {
  const log = logOf([["e1", ["2026-09-01", "2026-09-02", "2026-09-03", TODAY]]]);
  const items = [item({ id: "e1", title: "买一样日用品", evidence: { day: TODAY } })];
  const reminders = buildReminders({ status: "ready", items }, TODAY, undefined, log);
  assert.equal(reminders.retired.length, 0);
  assert.equal(reminders.shown.length, 1);
});
