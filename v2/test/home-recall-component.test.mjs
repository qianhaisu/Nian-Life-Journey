// PAGE-0915-FULL-REMEDIATION-R1 D3：HomeRecall 只画 lib/home-recall.ts 算出来的那一条，没有就
// 什么都不画（不猜、不占位）。
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React ??= React;
const { HomeRecall } = await import("../components/home-recall.tsx");

test("没有 recall 时整块不画", () => {
  assert.equal(renderToStaticMarkup(React.createElement(HomeRecall, {})), "");
  assert.equal(renderToStaticMarkup(React.createElement(HomeRecall, { recall: undefined })), "");
});

test("有 recall 时画出 contextLabel、可点的标题链接、日期——标题里已经有「第一次」时不重复", () => {
  const html = renderToStaticMarkup(React.createElement(HomeRecall, {
    recall: { eventId: "e1", href: "/events/e1", title: "第一次主动翻绘本", day: "2026-07-28", dateLabel: "2026 年 7 月 28 日", relation: "first-time", contextLabel: "想起一段" },
  }));
  assert.match(html, /<p class="home-recall">/);
  assert.match(html, /<span class="home-recall-label">想起一段：<\/span>/);
  assert.match(html, /<a href="\/events\/e1">第一次主动翻绘本 <span aria-hidden="true">↗<\/span><\/a>/);
  assert.match(html, /<time dateTime="2026-07-28">2026 年 7 月 28 日<\/time>/);
  // "想起一段" 本身不含"第一次"，标题的"第一次"只出现一次，不是"第一次…第一次…"。
  assert.equal((html.match(/第一次/g) ?? []).length, 1);
});
