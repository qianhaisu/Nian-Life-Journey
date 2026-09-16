// PAGE-0915-FULL-REMEDIATION-R1 D3：首页「回忆浮现」只用现有数据能证明的关系，两档按顺序找，
// 一个都没有就不出现——测试钉住两档各自的判定与"没有就整块不显示"。
//
// PAGE-0915-FULL-REMEDIATION-R2：原来还有第三档「第一次」，多条候选时按日期取模挑一条；Codex
// 审核指出这个取模和"今天"之间没有真实关系，是包着确定性外衣的任意轮换，删掉了整档——只标题写
// "第一次"、跟"今天"没有一年前同日或相同月龄这类客观关系时，不再兜底显示它。
import test from "node:test";
import assert from "node:assert/strict";
const { selectHomeRecall } = await import("../lib/home-recall.ts");

const memory = (id, day, title, ageLabel) => ({ id, title, excerpt: undefined, weight: "memory", signature: { day, dateLabel: day, ageLabel }, lead: undefined });
const chapters = (memories) => [{ year: "mixed", ageSpan: undefined, months: [{ month: "mixed", label: "", shortLabel: "", ageLabel: undefined, memories, traceDays: [], photos: [], photoCount: 0, videoCount: 0, photoDays: [], withheldMediaCount: 0 }] }];

test("一年前同一天：年份差最小的那条，标「一年前的今天」", () => {
  const cs = chapters([
    memory("e1", "2025-09-15", "去公园"),
    memory("e2", "2024-09-15", "也去了公园"),
  ]);
  const r = selectHomeRecall(cs, "2026-09-15", undefined, undefined);
  assert.equal(r?.eventId, "e1");
  assert.equal(r?.relation, "anniversary");
  assert.equal(r?.contextLabel, "一年前的今天");
});

test("三年前同一天：写「3 年前的今天」，不是「一年前」", () => {
  const cs = chapters([memory("e1", "2023-09-15", "第一次去公园")]);
  const r = selectHomeRecall(cs, "2026-09-15", undefined, undefined);
  assert.equal(r?.contextLabel, "3 年前的今天");
});

test("没有同日周年时，退到「去年的这个月」", () => {
  const cs = chapters([memory("e1", "2025-09-04", "会翻身了")]);
  const r = selectHomeRecall(cs, "2026-09-16", undefined, undefined);
  assert.equal(r?.eventId, "e1");
  assert.equal(r?.relation, "same-month");
  assert.equal(r?.contextLabel, "去年的这个月");
});

test("更早的年份写「N 年前的这个月」；最近的一年优先", () => {
  const cs = chapters([
    memory("e1", "2024-09-20", "更早那年的九月"),
    memory("e2", "2025-09-28", "去年的九月"),
  ]);
  assert.equal(selectHomeRecall(cs, "2026-09-16", undefined, undefined)?.eventId, "e2");
  const onlyOlder = chapters([memory("e1", "2024-09-20", "更早那年的九月")]);
  assert.equal(selectHomeRecall(onlyOlder, "2026-09-16", undefined, undefined)?.contextLabel, "2 年前的这个月");
});

test("同一年的这个月里，取日子离今天最近的那条", () => {
  const cs = chapters([
    memory("e1", "2025-09-01", "月初"),
    memory("e2", "2025-09-18", "接近今天这一天"),
  ]);
  assert.equal(selectHomeRecall(cs, "2026-09-16", undefined, undefined)?.eventId, "e2");
});

// 2026-09-16 视觉验收抓到的那条：线上浮现的是 12 天前的事，因为原来的第二档是「相同月龄」——
// 而「和今天月龄相同的日子」按定义就只能落在最近一个月内。这条钉住它不会再回来。
test("同月龄但只隔十几天的记忆不再浮现：那不是关系，是同义反复", () => {
  const cs = chapters([memory("e1", "2026-09-04", "到了时间，他会自己爬上床")]);
  const r = selectHomeRecall(cs, "2026-09-16", "2025-01-03", undefined);
  assert.equal(r, undefined, "同一个月里的前几天不构成回看距离，整块应该消失而不是凑一条");
});

test("这一档不需要出生日期：只看日历，没有生日也能命中", () => {
  const cs = chapters([memory("e1", "2025-09-02", "普通的一天")]);
  assert.equal(selectHomeRecall(cs, "2026-09-01", undefined, undefined)?.relation, "same-month");
});

// R2：标题写着"第一次"不再是独立一档——没有一年前同日、也没有相同月龄时，即使有一屋子"第一次"
// 故事，也不显示，不用取模或任何别的规则去凑一个"看起来有理由"的选择。
test("只有「第一次」标题、没有同日周年也没有相同月龄时：不显示，不为了凑内容新造一套挑选规则", () => {
  const cs = chapters([
    memory("e1", "2025-03-01", "普通的一天"),
    memory("e2", "2025-04-01", "第一次爬"),
    memory("e3", "2025-05-01", "第一次站"),
  ]);
  const r = selectHomeRecall(cs, "2026-01-01", undefined, undefined);
  assert.equal(r, undefined);
});

test("两档都没有命中就不显示，不编造", () => {
  const cs = chapters([memory("e1", "2025-03-01", "普通的一天")]);
  const r = selectHomeRecall(cs, "2026-01-01", undefined, undefined);
  assert.equal(r, undefined);
});

test("排除首页自己已经在用的那条 lead，不重复浮现同一条", () => {
  const cs = chapters([memory("e1", "2025-09-15", "去公园")]);
  const r = selectHomeRecall(cs, "2026-09-15", undefined, "e1");
  assert.equal(r, undefined, "唯一命中的那条正是要排除的 lead，两档都不该再选到它");
});

test("同一天的记忆不算浮现（那就是首页正在讲的这一天，不是另一段关系）", () => {
  const cs = chapters([memory("e1", "2026-01-01", "今天这条")]);
  const r = selectHomeRecall(cs, "2026-01-01", undefined, undefined);
  assert.equal(r, undefined);
});
