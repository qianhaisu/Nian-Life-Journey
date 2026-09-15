// PAGE-0915-FULL-REMEDIATION-R1 A2：三处无效「+」——`.home-note > summary::after` 给每条提醒画一个
// "＋"，但 note/sources 都空时展开层其实没内容。没内容就不该是可展开的 <details>。
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React ??= React;
const { HomeReminders } = await import("../components/home-reminders.tsx");

const bare = (id, title) => ({ id, title, whenText: "时间待确认", sources: [] });

test("没有 note 也没有 sources 的提醒：画成普通一行，没有 <details>，没有可点的展开控件", () => {
  const html = renderToStaticMarkup(React.createElement(HomeReminders, { reminders: [bare("r1", "核对张年的接种记录")] }));
  assert.doesNotMatch(html, /<details/);
  assert.match(html, /<p class="home-note home-note-plain">核对张年的接种记录/);
});

test("有 note 或有 sources 的提醒：仍然是可展开的 <details>", () => {
  const withNote = { ...bare("r2", "给崽约体检"), note: "妈妈提到下周想约个体检。" };
  const html = renderToStaticMarkup(React.createElement(HomeReminders, { reminders: [withNote] }));
  assert.match(html, /<details class="home-note">/);
  assert.match(html, /<summary>给崽约体检/);
});

test("statusLabel 存在时两种壳都照样显示，不因为改了外壳就丢字", () => {
  const withStatus = { ...bare("r3", "带去打疫苗"), statusLabel: "待核实" };
  const html = renderToStaticMarkup(React.createElement(HomeReminders, { reminders: [withStatus] }));
  assert.match(html, /带去打疫苗/);
  assert.match(html, /home-note-status">.*待核实/);
});

test("「还记着的其他事」这个外层展开控件不受影响：仍然是真的能展开出更多标题的 <details>", () => {
  const html = renderToStaticMarkup(React.createElement(HomeReminders, { reminders: [bare("r1", "第一条")], more: [bare("r4", "第二条")] }));
  assert.match(html, /<details class="home-notes-more">/);
  assert.match(html, /还记着的其他事/);
  assert.match(html, /第二条/);
});
