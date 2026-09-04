// How a month chapter is SET on the page (components/month-moment.tsx), as opposed to what it
// contains (lib/publication-moments.ts, covered by publication-moments.test.mjs).
//
// The change these tests guard: a month page used to print every trace entry at title size, so a
// day with three plain observations arrived as three headlines and a month read as a register. The
// fix is typographic only — reading size, one running head per day, entries set as consecutive
// paragraphs of prose. The risk of any such fix is that layout starts editing the archive: joining
// two entries into one sentence to make a tidier paragraph, trimming one to balance a column,
// rewriting them into a single voice. The words are evidence. These tests assert the markup carries
// them through byte for byte, and that the reading order still matches what composition decided.
//
// The trace entries below are real published rows for 张年 (2025-06 / 2025-07 / 2025-08), read out
// of production Postgres, not invented copy — they are the exact shape the fix had to serve: 10–40
// characters, two or three to a day, many of them opening with 「家人说」.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// tsconfig sets jsx:"preserve" for Next, so tsx compiles these components with the classic runtime
// and their bodies call the global `React`. Next supplies it; a bare node --test run must.
globalThis.React ??= React;
const { DayHead, MonthMoment, dayLabel } = await import("../components/month-moment.tsx");

// Real 2025-07-01 and 2025-08-06 rows.
const JULY_1 = [
  "家人自制了一个床中床，说听说能让宝宝有安全感，想给张小年试试",
  "家人说张小年睡在床中床里目前很好，没动一下",
  "家人带张小年下去扔垃圾，顺便透透气",
];
const AUGUST_6 = [
  "张小年现在经常会做吓唬人的表情",
  "张小年的玩具多到有点放不下，家人把餐椅挪下来后发现没有走路的地方了",
  "张小年只能看看某个东西，不能玩，家人感觉他挺想玩",
];

function textMoment(day, dateLabel, text, ageLabel = "6 个月") {
  return { kind: "text_led", day, dateLabel, ageLabel, text, hero: undefined, supporting: [], morePhotoCount: 0 };
}
function memoryMoment(day, dateLabel, title, ageLabel = "6 个月") {
  return {
    kind: "memory_led", day, dateLabel, ageLabel,
    memory: { id: "event-1", title, excerpt: "这两天没有爬行训练的视频了，家人说「崽都不健身了」。", weight: "memory", signature: { day, dateLabel, ageLabel }, photoCount: 0, videoCount: 0 },
    text: [], hero: undefined, supporting: [], morePhotoCount: 0,
  };
}
// The test glob is *.test.mjs, which tsx does not transform for JSX, so components are called
// through createElement — same render, no build step.
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
// Text nodes reach the markup HTML-escaped; compare against the same escaping, so the assertion is
// about the words and not about entities.
// HTML attribute names are case-insensitive, and this standalone render emits `dateTime` where a
// browser reads `datetime`; the /i flag keeps the assertion about the value, not the casing.
const escaped = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const paragraphsOf = (html) => [...html.matchAll(/<div class="moment-text serif">(.*?)<\/div>/gs)]
  .flatMap((block) => [...block[1].matchAll(/<p>(.*?)<\/p>/gs)].map((p) => p[1]));

test("a day's words reach the page verbatim: every entry, in order, none merged, none trimmed", () => {
  const html = render(MonthMoment, { moment: textMoment("2025-07-01", "2025 年 7 月 1 日", JULY_1), year: "2025" });
  assert.deepEqual(paragraphsOf(html), JULY_1.map(escaped), "the family's own sentences, unchanged and in composition order");
  // One paragraph per entry: the day reads continuously because of how the paragraphs are set,
  // never because two records were joined into one sentence.
  assert.equal(paragraphsOf(html).length, JULY_1.length);
  for (const entry of JULY_1) assert.ok(html.includes(escaped(entry)), `entry survives whole: ${entry}`);
});

test("no separator, connective or ellipsis is injected between two entries of the same day", () => {
  const html = render(MonthMoment, { moment: textMoment("2025-08-06", "2025 年 8 月 6 日", AUGUST_6, "7 个月"), year: "2025" });
  const between = html.slice(html.indexOf(escaped(AUGUST_6[0])) + escaped(AUGUST_6[0]).length, html.indexOf(escaped(AUGUST_6[1])));
  assert.equal(between, "</p><p>", "entries are adjacent paragraphs and nothing is written between them");
});

test("a day states its head once: date and age, with the year the masthead already carries removed", () => {
  const html = render(MonthMoment, { moment: textMoment("2025-07-01", "2025 年 7 月 1 日", JULY_1), year: "2025" });
  assert.match(html, /<time datetime="2025-07-01">7 月 1 日<\/time>/i, "the full ISO day stays machine-readable");
  assert.ok(!html.includes("2025 年 7 月 1 日"), "the year is not repeated on every day of its own month");
  assert.ok(html.includes("<span>6 个月</span>"), "the life clock rides with the calendar clock (原则二)");
  assert.equal(html.match(/month-day-date/g).length, 1);
});

test("dayLabel only removes this page's own year, and leaves any other label alone", () => {
  assert.equal(dayLabel("2025 年 7 月 1 日", "2025"), "7 月 1 日");
  assert.equal(dayLabel("2025 年 7 月 1 日", "2026"), "2025 年 7 月 1 日", "a foreign year is never stripped");
  assert.equal(dayLabel("7 月 1 日", "2025"), "7 月 1 日");
});

test("a continued moment of the same day drops the repeated head and keeps its words", () => {
  // Real 2025-08-05: a published memory and that same day's other words, in that order.
  const memory = memoryMoment("2025-08-05", "2025 年 8 月 5 日", "张小年吃西红柿鸡蛋面", "7 个月");
  const words = ["张小年玩一个带按钮的玩具，只关注在飞的兔子和火车，不看按钮"];
  const first = render(MonthMoment, { moment: memory, year: "2025" });
  const second = render(MonthMoment, { moment: textMoment("2025-08-05", "2025 年 8 月 5 日", words, "7 个月"), year: "2025", continued: true });
  assert.ok(first.includes("month-day-date"), "the day announces itself once");
  assert.ok(!second.includes("month-day-date"), "and the block continuing that same day does not repeat it");
  assert.match(second, /moment-continued/);
  assert.deepEqual(paragraphsOf(second), words.map(escaped), "suppressing the head never suppresses words");
});

test("a memory keeps its title and its link; layout does not demote it to an ordinary day", () => {
  const html = render(MonthMoment, { moment: memoryMoment("2025-07-18", "2025 年 7 月 18 日", "放在床上自己会爬，没录下来"), year: "2025" });
  assert.match(html, /<h3 class="serif"><a href="\/events\/event-1">放在床上自己会爬，没录下来<\/a><\/h3>/);
  assert.match(html, /class="month-moment moment-memory_led"/);
});

test("a photographed day carries no words of its own, and its head still reads", () => {
  const moment = { kind: "photo_led", day: "2025-10-03", dateLabel: "2025 年 10 月 3 日", ageLabel: "9 个月", text: [], hero: undefined, supporting: [], morePhotoCount: 4 };
  const html = render(MonthMoment, { moment: moment, year: "2025" });
  assert.ok(!html.includes("moment-text"), "no text block is fabricated for a day that only has pictures");
  assert.match(html, /<time datetime="2025-10-03">10 月 3 日<\/time>/i);
  assert.match(html, /这一天还有 4 张照片在月末的档案里/);
});

test("DayHead is honest about a day with no known age", () => {
  const html = render(DayHead, { day: "2025-06-20", dateLabel: "2025 年 6 月 20 日", year: "2025" });
  assert.ok(!html.includes("<span>"), "no age is invented when the archive has none");
  assert.match(html, /<time datetime="2025-06-20">6 月 20 日<\/time>/i);
});
