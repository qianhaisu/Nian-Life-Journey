import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAcrossExports, isDuplicateMarked, NOT_DUPLICATE_MARKED_SQL } from "../lib/ingest/wechat-content-dedupe.ts";
import { readFileSync } from "node:fs";

// 2026-09-23 第四轮：同一条消息在 JSON 与 Markdown 两种导出里的写法（样例为合成改写）。
const same = (a, b) => assert.equal(normalizeAcrossExports(a), normalizeAcrossExports(b), `${a} ≠ ${b}`);

test("引用回复：JSON 的 [引用 …] 后缀与 MD 的 > 前缀都剥掉，只比回复本身", () => {
  same("可以先看个几百的？[引用 妈妈：你觉得要看这个医生吗]", "\n> 妈妈: 你觉得要看这个医生吗\n\n可以先看个几百的？\n");
  same("这个点一下眼睛[引用 爸爸：[图片]]", "\n> 爸爸: \[图片\]\n\n这个点一下眼睛\n");
});

test("链接标签、转义、首尾空白；小程序只认标签；纯媒体占位 = 空", () => {
  same("我命由我不由天", "\n\[链接\]我命由我不由天\n");
  same("大头儿子睡着了", "\n大头儿子睡着了\n");
  same("[小程序] 宝宝首次游泳体验", "\n\[小程序\]美团\n");
  same("", "\n\[视频\]\n");
});

test("说的话不同就不相等", () => {
  assert.notEqual(normalizeAcrossExports("今天去公园"), normalizeAcrossExports("今天去超市"));
  assert.notEqual(normalizeAcrossExports("好[引用 妈妈：去吗]"), normalizeAcrossExports("不好[引用 妈妈：去吗]"));
});

test("duplicateOf 标记：有值才算；SQL 条件与读取方一致", () => {
  assert.equal(isDuplicateMarked({ duplicateOf: "wechat-message:x" }), true);
  assert.equal(isDuplicateMarked({ duplicateOf: "" }), false);
  assert.equal(isDuplicateMarked(null), false);
  assert.match(NOT_DUPLICATE_MARKED_SQL, /duplicateOf/);
});

test("Organizer 与编辑的读取都跳过带 duplicateOf 标记的行", () => {
  for (const file of ["scripts/organizer-month-write.mjs", "scripts/editor/day-writer.mjs", "scripts/editor/nightly-editor.mjs"]) {
    const text = readFileSync(file, "utf8");
    assert.match(text, /NOT_DUPLICATE_MARKED_SQL|duplicateOf/, `${file} 没有跳过重复标记`);
  }
});
