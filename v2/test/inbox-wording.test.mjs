// PAGE-0915-FULL-REMEDIATION-R1 已批准的产品决策 3、验收 C2：/inbox 是内部整理工作台，不进入普通
// 家人导航，去掉面向实现的词（Organizer、memory_candidates、流水线、本阶段……）。字段名本身
// （proposedAction 等）留着给内部读者对代码，去掉的是包在它们外面的系统黑话。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../app/inbox/page.tsx", import.meta.url), "utf8");
// 只查可见文案（字符串字面量），不查注释（注释里为了说清楚"去掉了哪些词"反而会引用它们）、
// 不查 import 路径或代码里本来就要出现的 API 名字（listMemoryCandidates 不是页面上会念出来的句子）。
const withoutComments = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const visibleText = [...withoutComments.matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((m) => m[2]).join("\n");

test("可见文案里不出现面向实现的词", () => {
  for (const word of ["Organizer", "流水线", "本阶段", "memory_candidates"]) {
    assert.doesNotMatch(visibleText, new RegExp(word), `"${word}" 不该出现在可见文案里`);
  }
});

test("仍然只读、不接家庭导航：metadata 保持 noindex/nofollow", () => {
  assert.match(src, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/);
});
