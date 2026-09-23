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

test("a day's moment never prints a per-day photo count footnote (T20-A2)", () => {
  // T16 V2 added a "还有 N 张照片在月末的档案里" footnote gated on whether a photo had already
  // been shown — but once T11 Part C started binding a hero to nearly every day, that condition
  // was true almost everywhere, so the count-of-photos sentence printed on nearly every day
  // anyway: exactly the "计数式描述" 原则三 rules out of ordinary reading pages. T20-A2 removes
  // the line entirely; the month-end archive section states this once, not per day.
  const withHero = { kind: "photo_led", day: "2025-10-03", dateLabel: "2025 年 10 月 3 日", ageLabel: "9 个月", text: [], hero: { id: "media-1", type: "photo", src: "/a.jpg", width: 1200, height: 900, alt: "" }, supporting: [], morePhotoCount: 4 };
  const withoutHero = { ...withHero, hero: undefined };
  for (const moment of [withHero, withoutHero]) {
    const html = render(MonthMoment, { moment, year: "2025" });
    assert.ok(!html.includes("chapter-meta"), "no per-day archive footnote, with or without a shown photo");
  }
});

test("DayHead is honest about a day with no known age", () => {
  const html = render(DayHead, { day: "2025-06-20", dateLabel: "2025 年 6 月 20 日", year: "2025" });
  assert.ok(!html.includes("<span>"), "no age is invented when the archive has none");
  assert.match(html, /<time datetime="2025-06-20">6 月 20 日<\/time>/i);
});

// 图文衔接 (2026-09-13): inside a month a story reads its words first, then every photograph a person
// approved for it; a story without one is words only. The day-album entry ships as a button and
// nothing else — no photograph of the album is in the page until the reader asks.
const { EditorialMemory } = await import("../components/editorial-memory.tsx");
const { DayAlbumLink } = await import("../components/day-album.tsx");
const ref = (id, width, height) => ({ id, src: `/api/media/${id}?variant=web`, thumbnailSrc: `/api/media/${id}?variant=thumbnail`, width, height, type: "photo", alt: "那天的照片" });
const storyMemory = (storyPhotos) => ({ id: "event-s", title: "他会说 cold", excerpt: "一段话。", weight: "memory", signature: { day: "2026-09-07", dateLabel: "2026 年 9 月 7 日", ageLabel: "1 岁 8 个月" }, lead: storyPhotos[0], storyPhotos, noPhoto: false, photoCount: storyPhotos.length, videoCount: 0 });

test("a month story reads its words, then all of its approved photographs, sized by shape", () => {
  const two = render(EditorialMemory, { memory: storyMemory([ref("a", 1280, 1707), ref("b", 3120, 4160)]), showSignature: false, photos: "story" });
  assert.ok(two.indexOf("memory-copy") < two.indexOf("memory-story-photos"), "words come before the photographs");
  assert.equal((two.match(/<img /g) ?? []).length, 2, "both approved photographs are read");
  assert.match(two, /memory-photo-set/);
  const portrait = render(EditorialMemory, { memory: storyMemory([ref("a", 1280, 1707)]), showSignature: false, photos: "story" });
  assert.match(portrait, /memory-photo-portrait/);
  assert.match(portrait, /memory-story-photo/);
  const none = render(EditorialMemory, { memory: storyMemory([]), showSignature: false, photos: "story" });
  assert.equal((none.match(/<img /g) ?? []).length, 0, "no approved photograph, no picture — nothing is borrowed");
  assert.doesNotMatch(none, /memory-story-photos/);
});

test("the month moment asks the story for its story photographs", () => {
  const html = render(MonthMoment, { moment: { kind: "memory_led", day: "2026-09-07", dateLabel: "2026 年 9 月 7 日", ageLabel: "1 岁 8 个月", memory: storyMemory([ref("a", 1708, 1280)]), text: [], supporting: [], morePhotoCount: 0 }, year: "2026" });
  assert.match(html, /memory-story memory-photo-landscape/);
});

test("the day-album entry ships as one button and no photograph", () => {
  const html = render(DayAlbumLink, { year: "2026", month: "08", day: "2026-08-19", dateLabel: "2026 年 8 月 19 日", ageLabel: "1 岁 7 个月" });
  assert.match(html, /<button[^>]*class="day-album-open"[^>]*>翻开这一天的相册<\/button>/);
  assert.doesNotMatch(html, /<img |<figure/);
  const after = render(DayAlbumLink, { year: "2026", month: "08", day: "2026-08-19", dateLabel: "2026 年 8 月 19 日", afterDayPhotos: true });
  assert.match(after, /这一天相册里的其他照片/);
  assert.doesNotMatch(html + after, /配图/, "the album is never called a story's picture");
});

// 原则三 (2026-09-13 acceptance): the month's own controls say what they do, never how big the archive
// is. 「还有 28 天、521 张照片——点此展开全部」 and 「这一天还有 12 张——点此展开」 were the archive
// describing itself to the family.
const { ArchiveExpander } = await import("../components/archive-expander.tsx");
const { DayPhotos } = await import("../components/day-photos.tsx");

test("expand controls carry no counts", () => {
  const day = (d, n) => ({ day: d, dateLabel: `2026 年 8 月 ${Number(d.slice(8))} 日`, photos: Array.from({ length: n }, (_, i) => ref(`${d}-${i}`, 1600, 1200)) });
  const album = render(ArchiveExpander, { year: "2026", month: "08", foldedDayCount: 28, foldedPhotoCount: 521, visibleDays: [day("2026-08-30", 3)] });
  const button = album.match(/<button[^>]*>(.*?)<\/button>/s)?.[1] ?? "";
  assert.equal(button, "展开这个月其余的照片");
  assert.doesNotMatch(button, /\d/);
});

// 2026-09-23 (Teddy: 「图片排版要整齐」): a day's pictures are one grid from the first screen — at most
// six cells, the sixth carrying 「+N」, tapping it lays out the rest. 「+N」 is the one number the
// family asked for; there is no separate expand button (and so no count in any button's words).
test("a day's pictures open as a six-cell grid with +N", () => {
  const photos = Array.from({ length: 12 }, (_, i) => ref(`2026-08-19-${i}`, 1600, 1200));
  const group = render(DayPhotos, { photos, dateLabel: "2026 年 8 月 19 日" });
  assert.equal((group.match(/class="pg-cell"/g) ?? []).length, 6);
  assert.match(group, /<span class="pg-overlay">\+6<\/span>/);
  assert.match(group, /aria-label="还有 6 张，展开全部"/);
  assert.doesNotMatch(group, /photo-strip/);
  assert.doesNotMatch(group, /<button/);
  const few = render(DayPhotos, { photos: photos.slice(0, 6), dateLabel: "2026 年 8 月 19 日" });
  assert.equal((few.match(/class="pg-cell"/g) ?? []).length, 6);
  assert.doesNotMatch(few, /pg-overlay/);
});
