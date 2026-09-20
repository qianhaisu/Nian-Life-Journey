import test from "node:test";
import assert from "node:assert/strict";
import { appendDay, birthAge } from "../scripts/editor/append-day.mjs";
import { validateMonthContent } from "../lib/month-content.ts";

// 2026-09-20：按天追加。核心承诺：已有的每一天、每个称呼映射，一个字节都不动。
const BIRTH = "2025-01-03";
const existingDay = (d, title) => ({
  day: d, ageLabel: "1岁8个月", kind: "story", title, paragraphs: [`${title}的正文`],
  firstScreenMediaIds: ["m1"], expandedMediaIds: ["m1", "m2"], storyBoundMediaIds: [], eventId: null, eventIds: [],
  sourceIds: ["src-a"], mergedEventCount: 0, pendingCount: 0, mediaNote: null,
});
const base = () => ({
  schema: "nianlife.month-content/1", month: "2026-09", generatedAt: "2026-09-18T00:00:00.000Z", dataCutoff: "2026-09-17",
  cardLine: "月卡", intro: "介绍", speakerBySourceId: { "src-a": "妈妈" },
  days: [existingDay("2026-09-16", "十六号"), existingDay("2026-09-17", "十七号")],
});
const entry = (over = {}) => ({ day: "2026-09-18", kind: "story", title: "新的一天", paragraphs: ["第一段"], sourceIds: ["src-b"], ...over });
const OPTS = { birthDay: BIRTH, speakerBySourceId: { "src-b": "爸爸" }, dataCutoff: "2026-09-18", now: "2026-09-20T00:00:00.000Z" };

test("追加一天：已有的每一天逐字节不变，新的一天排在正确位置", () => {
  const before = base();
  const snapshot = JSON.stringify(before);
  const { content, replaced, days } = appendDay(before, entry(), OPTS);
  assert.equal(JSON.stringify(before), snapshot, "入参不能被改动");
  assert.equal(replaced, false);
  assert.equal(days, 3);
  assert.deepEqual(content.days.slice(0, 2), base().days, "已有两天原样保留");
  assert.equal(content.days[2].day, "2026-09-18");
});

test("同一天再来就是替换，不会出现两条同日", () => {
  const once = appendDay(base(), entry({ title: "第一版" }), OPTS).content;
  const twice = appendDay(once, entry({ title: "第二版" }), OPTS);
  assert.equal(twice.replaced, true);
  assert.equal(twice.content.days.filter((d) => d.day === "2026-09-18").length, 1);
  assert.equal(twice.content.days.find((d) => d.day === "2026-09-18").title, "第二版");
});

test("称呼映射只加不改：已有的键不被覆盖", () => {
  const { content } = appendDay(base(), entry(), { ...OPTS, speakerBySourceId: { "src-a": "别人", "src-b": "爸爸" } });
  assert.equal(content.speakerBySourceId["src-a"], "妈妈", "已有映射不能被改");
  assert.equal(content.speakerBySourceId["src-b"], "爸爸");
});

test("年龄按出生日算：跨月纪念日前后差一个月", () => {
  assert.equal(birthAge(BIRTH, "2026-09-18"), "1岁8个月");
  assert.equal(birthAge(BIRTH, "2026-09-02"), "1岁7个月", "9 月 3 日之前还没满 8 个月");
  assert.equal(birthAge(BIRTH, "2026-09-03"), "1岁8个月");
  assert.equal(birthAge(BIRTH, "2024-12-01"), undefined, "出生前没有年龄");
});

test("形状错了在这里就拒绝：整月因一天格式错而消失的代价太大", () => {
  assert.throws(() => appendDay(base(), entry({ day: "2026-10-01" }), OPTS), /不属于/);
  assert.throws(() => appendDay(base(), entry({ day: "9/18" }), OPTS), /日期格式/);
  assert.throws(() => appendDay(base(), entry({ kind: "essay" }), OPTS), /kind/);
  assert.throws(() => appendDay(base(), entry({ title: "  " }), OPTS), /title/);
  assert.throws(() => appendDay(base(), entry({ paragraphs: ["ok", ""] }), OPTS), /paragraphs/);
  assert.throws(() => appendDay(base(), entry({ firstScreenMediaIds: ["x"], expandedMediaIds: ["y"] }), OPTS), /开头子集/);
  assert.throws(() => appendDay(base(), entry({ title: null, paragraphs: [] }), OPTS), /既没有文字也没有照片/);
});

test("追加之后的整个月，仍然能通过应用自己的校验（lib/month-content.ts）", () => {
  const { content } = appendDay(base(), entry(), OPTS);
  assert.ok(validateMonthContent(content, "2026-09"), "应用的 validateMonthContent 必须接受");
});

test("dataCutoff 与 generatedAt 更新，其余顶层字段不动", () => {
  const { content } = appendDay(base(), entry(), OPTS);
  assert.equal(content.dataCutoff, "2026-09-18");
  assert.equal(content.generatedAt, "2026-09-20T00:00:00.000Z");
  assert.equal(content.intro, "介绍");
  assert.equal(content.cardLine, "月卡");
});
