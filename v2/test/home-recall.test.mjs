// PAGE-0915-FULL-REMEDIATION-R1 D3：首页「回忆浮现」只用现有数据能证明的关系，三档按顺序找，
// 一个都没有就不出现——测试钉住三档各自的判定与"没有就整块不显示"。
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

test("没有同日周年时，退到相同月龄那一档", () => {
  const cs = chapters([memory("e1", "2025-05-10", "会翻身了")]);
  // 出生日 2025-01-01：5-10 和 5-25 都落在「满 4 个月」的区间里（4 月 1 日满 4 个月的锚点之后），
  // 月龄相同、日子不同，不构成同日周年。
  const r = selectHomeRecall(cs, "2025-05-25", "2025-01-01", undefined);
  assert.equal(r?.eventId, "e1");
  assert.equal(r?.relation, "same-age");
  assert.match(r?.contextLabel ?? "", /那时他也是.*大/);
});

test("没有出生日期时相同月龄这档直接跳过，不报错", () => {
  const cs = chapters([memory("e1", "2025-05-01", "普通的一天")]);
  const r = selectHomeRecall(cs, "2025-09-01", undefined, undefined);
  assert.equal(r, undefined);
});

test("前两档都没有，退到「第一次」标题；同一天多条时用日期取模稳定挑一条", () => {
  const cs = chapters([
    memory("e1", "2025-03-01", "普通的一天"),
    memory("e2", "2025-04-01", "第一次爬"),
    memory("e3", "2025-05-01", "第一次站"),
  ]);
  const r = selectHomeRecall(cs, "2026-01-01", undefined, undefined);
  assert.equal(r?.relation, "first-time");
  assert.ok(["e2", "e3"].includes(r?.eventId ?? ""));
  // 标题本身已经写着"第一次"，contextLabel 不重复这两个字，避免"第一次…第一次…"读起来打结。
  assert.equal(r?.contextLabel, "想起一段");
  // 同一天再选一次，结果必须一样（纯函数，不是随机）。
  const again = selectHomeRecall(cs, "2026-01-01", undefined, undefined);
  assert.equal(again?.eventId, r?.eventId);
});

test("三档都没有命中就不显示，不编造", () => {
  const cs = chapters([memory("e1", "2025-03-01", "普通的一天")]);
  const r = selectHomeRecall(cs, "2026-01-01", undefined, undefined);
  assert.equal(r, undefined);
});

test("排除首页自己已经在用的那条 lead，不重复浮现同一条", () => {
  const cs = chapters([memory("e1", "2025-09-15", "第一次去公园")]);
  const r = selectHomeRecall(cs, "2026-09-15", undefined, "e1");
  assert.equal(r, undefined, "唯一命中的那条正是要排除的 lead，三档都不该再选到它");
});

test("同一天的记忆不算浮现（那就是首页正在讲的这一天，不是另一段关系）", () => {
  const cs = chapters([memory("e1", "2026-01-01", "今天这条")]);
  const r = selectHomeRecall(cs, "2026-01-01", undefined, undefined);
  assert.equal(r, undefined);
});
