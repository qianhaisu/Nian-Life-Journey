// PAGE-0915-FULL-REMEDIATION-R1 B2：/capture 的 `private` 改成「仅自己可见」等自然中文；顺带把
// 一句面向家人的成功提示里出现的「Organizer」也换成大家都懂的话——它同属"去技术化"这条产品决策，
// 改动小、风险低。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const src = fs.readFileSync(new URL("../components/memory-inbox.tsx", import.meta.url), "utf8");
const withoutComments = src.replace(/\/\/.*$/gm, "");

test("可见范围的中文选项不再是裸英文 private，读作「仅自己可见」", () => {
  assert.match(withoutComments, /<option value="private">仅自己可见<\/option>/);
});

test("提示句子里不出现裸英文 private（value=\"private\" 这个表单值本身不算，那不是给人念的句子）", () => {
  const prose = withoutComments.match(/<p className="capture-privacy">([^<]*)<\/p>/)?.[1] ?? "";
  assert.doesNotMatch(prose, /private/i);
  assert.match(prose, /仅自己可见/);
});

test("成功提示不再提系统内部组件名 Organizer", () => {
  assert.doesNotMatch(withoutComments, /Organizer/);
});
