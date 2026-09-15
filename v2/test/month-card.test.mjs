// PAGE-0915-FULL-REMEDIATION-R1 D1（白卡）+ B1（现在/当时）。
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
globalThis.React ??= React;
const { MonthCard } = await import("../components/month-card.tsx");

const photo = { id: "m1", src: "/api/media/m1?variant=web", thumbnailSrc: "/api/media/m1?variant=thumbnail", alt: "一张照片", width: 1280, height: 960, type: "image" };
const entryOf = (month, ageLabel, withPhoto) => ({
  chapter: { month, label: `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`, shortLabel: `${Number(month.slice(5, 7))} 月`, ageLabel },
  href: `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}`,
  preview: withPhoto ? [photo] : [],
  featured: [],
});

test("有封面照片的月卡：正常样子，没有 compact 类", () => {
  const html = renderToStaticMarkup(React.createElement(MonthCard, { entry: entryOf("2025-08", "1 岁 7 个月", true) }));
  assert.match(html, /class="month-card scroll-reveal"/);
  assert.doesNotMatch(html, /month-card--compact/);
  assert.match(html, /class="month-card-photo"/);
});

// B1：不写死日期，直接问系统"这个月是哪个月"，不管测试哪天跑都成立。
const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

test("历史月份（去年同月，肯定不是当前月）的卡读「当时」", () => {
  const lastYear = `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const html = renderToStaticMarkup(React.createElement(MonthCard, { entry: entryOf(lastYear, "1 岁 7 个月", true) }));
  assert.match(html, /当时 1 岁 7 个月/);
});

test("当前月的卡读「现在」，不是写死的「当时」", () => {
  const html = renderToStaticMarkup(React.createElement(MonthCard, { entry: entryOf(thisMonth, "1 岁 8 个月", false) }));
  assert.match(html, /现在 1 岁 8 个月/);
  assert.doesNotMatch(html, /当时 1 岁 8 个月/);
});

// D1：没有封面照片的月卡（通常是内容还很少的当前月）加 compact 类，配合 globals.css 的
// `align-items: start`，不再被同一行有照片的卡拉伸出一整块空白背景。
test("没有封面照片的月卡：加 month-card--compact，不画 .month-card-photo 那个区块", () => {
  const html = renderToStaticMarkup(React.createElement(MonthCard, { entry: entryOf("2026-09", "1 岁 8 个月", false) }));
  assert.match(html, /class="month-card scroll-reveal month-card--compact"/);
  assert.doesNotMatch(html, /month-card-photo/);
});

test("globals.css：.memory-month-grid 用 align-items: start，不再默认拉伸把没照片的卡撑出空白", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.memory-month-grid \{[^}]*align-items: start/);
  assert.match(css, /\.month-card--compact \.month-card-body \{/);
});
