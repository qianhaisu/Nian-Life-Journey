// PAGE-0915-FULL-REMEDIATION-R1 A2：首页不重复印状态机词。needs_confirmation/tentative 已经在
// whenText 里说了「时间待确认」，不该再在后面加一个「待核实/待定」的状态徽标。
//
// app/page.tsx 顶部 `import "./home.css"`，直接从测试 import 它会把 CSS 当 JS 解析报错——所以
// 这条规则单独放在 lib/home-reminder-display.ts 里，测试只对着那个纯逻辑文件，不碰 app/page.tsx。
import test from "node:test";
import assert from "node:assert/strict";
import { HOME_QUIET_STATES } from "../lib/home-reminder-display.ts";
import { HOME_REMINDER_LABEL } from "../lib/home-feed.ts";

// app/page.tsx 里 toReminderView 的那一行，原样复述在测试里钉住行为——两边任何一处漏改都会露出来。
const statusLabelFor = (state) => (HOME_QUIET_STATES.has(state) ? undefined : HOME_REMINDER_LABEL[state]);

test("active/needs_confirmation/tentative 三档在首页都不显示 statusLabel", () => {
  for (const state of ["active", "needs_confirmation", "tentative"]) assert.equal(statusLabelFor(state), undefined, state);
});

test("其余状态（expired/done/cancelled/superseded）仍然显示 HOME_REMINDER_LABEL 给的文案，不是首页发明的", () => {
  for (const state of ["expired", "done", "cancelled", "superseded"]) assert.equal(statusLabelFor(state), HOME_REMINDER_LABEL[state], state);
});

test("HOME_QUIET_STATES 恰好是这三档，不多不少", () => {
  assert.deepEqual([...HOME_QUIET_STATES].sort(), ["active", "needs_confirmation", "tentative"]);
});
