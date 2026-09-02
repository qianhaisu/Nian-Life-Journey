import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, splitOpenMonths, latestMemory, findMonth, excerptOf, memoryTitle, editorialMemory } from "../lib/memory-chapters.ts";
import { sequenceFor, presentableAlt, orientationOf, aspectRatioOf } from "../lib/media/presentation.ts";
import { BIRTH, buildFixture, photo, event } from "./fixtures/editorial-archive.mjs";

const fixture = buildFixture();
const chapters = buildChapters({ ...fixture, birthDay: BIRTH });

test("fixture is at the scale the site must survive", () => {
  assert.ok(fixture.traces.length > 300, `traces=${fixture.traces.length}`);
  assert.ok(fixture.media.length > 50);
});

test("chapters are newest first, grouped year → month, with age anchors", () => {
  assert.deepEqual(chapters.map((year) => year.year), ["2026", "2025"]);
  const y2026 = chapters[0];
  assert.equal(y2026.months[0].month, "2026-12");
  assert.equal(y2026.months[y2026.months.length - 1].month, "2026-01");
  assert.equal(y2026.months.length, 11, "June is empty and must not appear");
  // A year shows the range its months cover; a month, the age reached in it (no false day precision).
  assert.equal(y2026.ageSpan, "1 岁 到 1 岁 11 个月");
  assert.equal(findMonth(chapters, "2026-08").label, "2026 年 8 月");
  assert.equal(findMonth(chapters, "2026-08").ageLabel, "1 岁 7 个月");
});

test("ordinary days fold to one entry per day, memories stay first", () => {
  const sept = findMonth(chapters, "2026-09");
  assert.equal(sept.memories.length, 0);
  assert.equal(sept.traceDays.length, 28, "two rows on the 10th collapse into one day");
  assert.equal(sept.traceDays.find((day) => day.day === "2026-09-10").entries.length, 2);
  assert.equal(sept.photos.length, 0, "a trace-only month has no photos to show");
  const aug = findMonth(chapters, "2026-08");
  assert.deepEqual(aug.memories.map((memory) => memory.id), ["2026-08-a", "2026-08-b"]);
  assert.equal(aug.memories[0].signature.dateLabel, "2026 年 8 月 14 日");
  assert.equal(aug.memories[0].signature.ageLabel, "1 岁 7 个月");
});

test("every memory resolves a single lead photo on the server and never a sticker", () => {
  const old = findMonth(chapters, "2025-08").memories[0];
  assert.equal(old.lead.id, "2025-08-r", "heroMediaId pointing at a 90x120 sticker is ignored");
  assert.equal(old.lead.alt, "在外婆家的院子里");
  assert.equal(old.photoCount, 2);
  const text = findMonth(chapters, "2026-12").memories.find((memory) => memory.id === "2026-12-c");
  assert.equal(text.lead, undefined);
  assert.equal(text.title, "2026 年 12 月 20 日的一天");
  assert.equal(text.excerpt, undefined);
});

test("month photos come from its memories, highlight first, capped, hero-eligible only", () => {
  const apr = findMonth(chapters, "2026-04");
  assert.equal(apr.photos.length, 5);
  const aug = findMonth(chapters, "2026-08");
  assert.equal(aug.photos[0].id, "2026-08-b-0", "highlight lead outranks a plain memory");
  assert.ok(aug.photos.every((item) => item.alt.startsWith("记忆 ")), "placeholder alt replaced with memory title");
});

test("default open window covers ~16 memories, the rest is an index", () => {
  const { open, index } = splitOpenMonths(chapters);
  const openCount = open.flatMap((year) => year.months).reduce((sum, month) => sum + month.memories.length, 0);
  assert.ok(openCount >= 16 && openCount < 20, `open=${openCount}`);
  assert.equal(open[0].months[0].month, "2026-12");
  assert.ok(index.some((year) => year.year === "2025"));
  assert.equal(latestMemory(chapters).id, "2026-12-c");
});

test("excerpt trims to 80 characters at a clean edge and titles fall back to the day", () => {
  assert.equal(excerptOf({ story: "短故事。" }), "短故事。");
  const long = excerptOf({ story: "第一段。".repeat(40) });
  assert.ok([...long].length <= 82);
  assert.ok(long.endsWith("……"));
  assert.equal(excerptOf({ story: "首段\n\n次段" }), "首段");
  assert.equal(memoryTitle({ title: "  ", occurredAt: "2025-08-11 00:00:00+00" }), "2025 年 8 月 11 日的一天");
});

test("editorialMemory drops undated events instead of guessing", () => {
  assert.equal(editorialMemory(event("x", "", []), new Map(), BIRTH), undefined);
});

test("media presentation: alt fallback, orientation, and the 1/3/8/20 sequence rule", () => {
  assert.equal(presentableAlt({ alt: "WeChat image", type: "photo" }), "一张照片");
  assert.equal(presentableAlt({ alt: "WeChat image", type: "photo" }, "去动物园"), "去动物园 · 一张照片");
  assert.equal(presentableAlt({ alt: "", type: "video" }), "一段视频");
  assert.equal(presentableAlt({ alt: "第一次站起来", type: "photo" }), "第一次站起来");
  assert.equal(orientationOf({ width: 1080, height: 1920 }), "portrait");
  assert.equal(orientationOf({ width: 1000, height: 1000 }), "square");
  assert.equal(aspectRatioOf({ width: 1080, height: 1920 }), "1080 / 1920");

  const many = Array.from({ length: 14 }, (_, i) => photo(`m${i}`));
  const seq = sequenceFor(many);
  assert.equal(seq.layout, "contact");
  assert.equal(seq.shown.length, 14);
  assert.equal(seq.remaining, 0);
  const thirty = sequenceFor(Array.from({ length: 30 }, (_, i) => photo(`n${i}`)));
  assert.equal(thirty.shown.length, 20);
  assert.equal(thirty.remaining, 10);
  assert.equal(sequenceFor(many.slice(0, 3)).layout, "triptych");
  assert.equal(sequenceFor(many.slice(0, 6)).layout, "spread");
  assert.equal(sequenceFor(many.slice(0, 1)).layout, "single");
  // a preferred hero moves to the front; stickers are filtered out
  const withSticker = [photo("s", { width: 90, height: 120 }), photo("a"), photo("b")];
  const preferred = sequenceFor(withSticker, "b");
  assert.deepEqual(preferred.shown.map((item) => item.id), ["b", "a"]);
});
