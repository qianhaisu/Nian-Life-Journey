import test from "node:test";
import assert from "node:assert/strict";
import { selectHomeAnswer, splitAnswerParts } from "../lib/home-answer.ts";

// 2026-09-19 全站验收，原则一：首页标题问「最近怎么样，张年」，首屏此前只有一张照片和一段
// 日期区间，一个字都没答。这一组锁住那句答案的取法——它必须是档案里真有的句子，不是拼的。
const BIRTH = "2025-01-03";

test("优先当前日历月，并把月份和当时年龄写成出处", () => {
  const answer = selectHomeAnswer([
    { month: "2026-08", summary: "八月他开始自己爬上沙发。" },
    { month: "2026-09", summary: "九月他会说的词一个接一个多起来。" },
  ], "2026-09-19", BIRTH);
  assert.equal(answer.line, "九月他会说的词一个接一个多起来。");
  assert.equal(answer.sourceLabel, "2026 年 9 月 · 现在 1 岁 8 个月");
  assert.equal(answer.href, "/memory/2026/09");
});

test("当前月还没有快照时退到最新的一个月，措辞跟着改成「当时」", () => {
  const answer = selectHomeAnswer([
    { month: "2026-07", summary: "七月第一次自己走到门口。" },
    { month: "2026-08", summary: "八月他开始自己爬上沙发。" },
  ], "2026-09-19", BIRTH);
  assert.equal(answer.line, "八月他开始自己爬上沙发。");
  // 不是当前月，所以是「当时」——与 monthAgeQualifier 同一条口径，不另立新词。
  assert.equal(answer.sourceLabel, "2026 年 8 月 · 当时 1 岁 7 个月");
  assert.equal(answer.href, "/memory/2026/08");
});

test("取第一行可读行，剥掉 Markdown 列表符号，不把空行当答案", () => {
  const answer = selectHomeAnswer([
    { month: "2026-09", summary: "\n\n- 九月他会说的词一个接一个多起来。\n- 还学会了自己穿鞋。" },
  ], "2026-09-19", BIRTH);
  assert.equal(answer.line, "九月他会说的词一个接一个多起来。");
});

test("没有任何带 summary 的快照时不出这一段——不写「暂无」，也不拿别的东西顶替", () => {
  assert.equal(selectHomeAnswer([], "2026-09-19", BIRTH), undefined);
  assert.equal(selectHomeAnswer([{ month: "2026-09", summary: "   " }], "2026-09-19", BIRTH), undefined);
  assert.equal(selectHomeAnswer([{ month: "2026-09", summary: null }], "2026-09-19", BIRTH), undefined);
});

test("没有出生日期时只留月份，不猜年龄", () => {
  const answer = selectHomeAnswer([{ month: "2026-09", summary: "九月他会说的词多起来。" }], "2026-09-19");
  assert.equal(answer.sourceLabel, "2026 年 9 月");
});

test("出生当月不写「当时 出生的那个月」——那句话读不通", () => {
  const answer = selectHomeAnswer([{ month: "2025-01", summary: "他出生了。" }], "2025-01-20", BIRTH);
  assert.equal(answer.line, "他出生了。");
  assert.equal(answer.sourceLabel, "2025 年 1 月");
});

// ── 核心词上色（2026-09-19 Teddy 桌面验收：「核心词汇要上色」） ────────────────────
// 判定是确定性规则：「」框起来的词 + 外语词。不是 AI 抽关键词，句子里没有这两种标记就不上色。

const LINE = "小年开始要说话了，会喊「粥粥，粥粥」，还会说 cold、hot、「倒」和「打开」。";

test("「」里的词和外语词是核心词，其余是普通片段", () => {
  const cores = splitAnswerParts(LINE).filter((part) => part.core).map((part) => part.text);
  assert.deepEqual(cores, ["「粥粥，粥粥」", "cold", "hot", "「倒」", "「打开」"]);
});

test("拆分是无损的：拼回去逐字等于原句，标点和空格一个都不丢", () => {
  for (const line of [LINE, "他出生了。", "第一次喊 mama，还会说「再来一个」！", "  前后有空格  ", ""]) {
    assert.equal(splitAnswerParts(line).map((part) => part.text).join(""), line);
  }
});

test("句子里没有任何标记时整句都是普通片段——宁可不上色，也不替作者挑重点", () => {
  const parts = splitAnswerParts("九月他会说的词一个接一个多起来。");
  assert.equal(parts.length, 1);
  assert.equal(parts[0].core, false);
});

test("selectHomeAnswer 带出 parts，且与 line 一致", () => {
  const answer = selectHomeAnswer([{ month: "2026-09", summary: `- ${LINE}` }], "2026-09-19", BIRTH);
  assert.equal(answer.parts.map((part) => part.text).join(""), answer.line);
  assert.equal(answer.parts.filter((part) => part.core).length, 5);
});
