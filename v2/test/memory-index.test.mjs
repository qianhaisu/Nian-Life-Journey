// P1-A: the memory information architecture must stay bounded and time-ordered as the archive
// grows. The fixture below is built in memory at the scale the site is meant to survive (tens of
// thousands of sources feeding thousands of traces and hundreds of memories) and never written to
// any store.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters } from "../lib/memory-chapters.ts";
import { buildMemoryIndex, buildYearView, curateMemories, foldTraces } from "../lib/memory-index.ts";
import { buildMonthComposition } from "../lib/publication-moments.ts";
import { DEFAULT_MEMORY_IA_POLICY } from "../lib/memory-ia-policy.ts";
import { BIRTH, buildFixture, event, photo, trace } from "./fixtures/editorial-archive.mjs";

// 36 months (2025-01 → 2027-12): ~12 memories a month, a trace every day with 8 entries, one photo
// per second memory; a 2023 backfill month; ~20k raw sources are not part of chapters at all.
function buildLargeFixture() {
  const media = [];
  const events = [];
  const traces = [];
  let n = 0;
  for (let y = 2025; y <= 2027; y += 1) for (let m = 1; m <= 12; m += 1) {
    const month = `${y}-${String(m).padStart(2, "0")}`;
    for (let i = 0; i < 12; i += 1) {
      const day = String(1 + ((i * 7) % 28)).padStart(2, "0");
      const id = `${month}-${i}`;
      const withPhoto = i % 2 === 0;
      if (withPhoto) media.push(photo(`${id}-p`, { width: 1600, height: 1200 }));
      events.push(event(id, `${month}-${day} 00:00:00+00`, withPhoto ? [`${id}-p`] : [], { memoryWeight: i === 0 ? "highlight" : i === 5 ? "chapter" : "memory", createdAt: `2027-12-31T00:00:00.000Z` }));
      n += 1;
    }
    for (let d = 1; d <= 28; d += 1) traces.push(trace(`${month}-t${d}`, `${month}-${String(d).padStart(2, "0")} 00:00:00`, Array.from({ length: 8 }, (_, k) => `第 ${k + 1} 条痕迹`)));
  }
  events.push(event("2023-06-backfill", "2023-06-15 00:00:00+00", [], { createdAt: "2027-12-31T00:00:00.000Z" }));
  return { media, events, traces, memoryCount: n + 1 };
}

const large = buildLargeFixture();
const started = performance.now();
const chapters = buildChapters({ events: large.events, traces: large.traces, media: large.media, birthDay: BIRTH });
const buildMs = performance.now() - started;

test("the large fixture is at the scale the site must survive and builds in bounded time", () => {
  assert.ok(large.events.length >= 400, `events=${large.events.length}`);
  assert.ok(large.traces.length >= 1000, `traces=${large.traces.length}`);
  assert.ok(buildMs < 3000, `buildChapters took ${buildMs.toFixed(0)}ms`);
  assert.deepEqual(chapters.map((year) => year.year), ["2027", "2026", "2025", "2023"]);
  assert.equal(chapters[0].months[0].month, "2027-12");
  // Late-created rows sort by life time: the backfill sits in 2023 and nothing in 2027 moved.
  assert.equal(chapters.at(-1).months[0].memories[0].id, "2023-06-backfill");
});

test("/memory renders a bounded number of memories and trace lines however large the archive is", () => {
  const policy = DEFAULT_MEMORY_IA_POLICY;
  const index = buildMemoryIndex(chapters, policy);
  const open = index.years.flatMap((year) => year.months).filter((month) => month.mode === "open");
  const shown = open.reduce((sum, month) => sum + month.featured.length, 0);
  assert.ok(shown >= policy.openMemoriesTarget && shown < policy.openMemoriesTarget + policy.curatedPerMonth, `shown=${shown}`);
  assert.ok(open.every((month) => month.featured.length <= policy.curatedPerMonth));
  assert.ok(open.every((month) => month.hiddenMemoryCount === month.memoryCount - month.featured.length));
  const traceLines = index.years.flatMap((year) => year.months).reduce((sum, month) => sum + month.traces.days.reduce((s, day) => s + day.entries.length, 0), 0);
  assert.ok(traceLines <= index.years.flatMap((year) => year.months).length * policy.traceDaysInline * policy.traceEntriesPerDay);
  // Every month is still present as at least an index row, newest first.
  const months = index.years.flatMap((year) => year.months.map((month) => month.chapter.month));
  assert.equal(months.length, 37);
  assert.deepEqual(months, [...months].sort().reverse());
  assert.equal(index.nav.length, 4);
  assert.equal(index.nav[0].year, "2027");
  assert.ok(index.nav[1].ageSpan.includes("到"), "the nav carries the age handle");
});

test("curation keeps the reader's order while preferring weight, then photos, then recency", () => {
  const month = chapters[0].months[0];
  const featured = curateMemories(month.memories, 3);
  assert.equal(featured.length, 3);
  assert.deepEqual([...featured.map((memory) => memory.weight)].sort(), ["chapter", "highlight", "memory"], "the chapter and highlight memories always make the cut");
  // Still newest-first as in the chapter.
  const days = featured.map((memory) => memory.signature.day);
  assert.deepEqual(days, [...days].sort().reverse());
  assert.ok(featured.find((memory) => memory.weight === "memory").lead, "among plain memories the one with a photo wins");
  // Deterministic: same input twice, and a shuffled copy of the same chapter, give the same picks.
  assert.deepEqual(curateMemories(month.memories, 3).map((m) => m.id), featured.map((m) => m.id));
  assert.deepEqual(curateMemories(month.memories, 99).map((m) => m.id), month.memories.map((m) => m.id));
});

test("traces fold to a bounded preview; the month page keeps every day but caps entries", () => {
  const month = chapters[0].months[0];
  const fold = foldTraces(month.traceDays);
  assert.equal(fold.dayCount, 28);
  assert.equal(fold.days.length, DEFAULT_MEMORY_IA_POLICY.traceDaysInline);
  assert.equal(fold.hiddenDayCount, 28 - DEFAULT_MEMORY_IA_POLICY.traceDaysInline);
  assert.equal(fold.days[0].entries.length, DEFAULT_MEMORY_IA_POLICY.traceEntriesPerDay);
  assert.equal(fold.days[0].hiddenEntryCount, 8 - DEFAULT_MEMORY_IA_POLICY.traceEntriesPerDay);
  assert.equal(fold.days[0].day, "2027-12-28", "newest day first");
  const composition = buildMonthComposition(month);
  assert.equal(composition.chapter.filter((moment) => moment.kind === "memory_led").length, 12, "the month chapter reads every memory");
  assert.equal(composition.chapter.filter((moment) => moment.kind === "text_led").length, 28, "every day with real words is readable");
});

test("the annual chapter lists a few titles per month and counts the rest", () => {
  const view = buildYearView(chapters[0]);
  assert.equal(view.months.length, 12);
  assert.ok(view.months.every((month) => month.titles.length <= DEFAULT_MEMORY_IA_POLICY.yearTitlesPerMonth));
  assert.equal(view.months[0].hiddenMemoryCount, 12 - DEFAULT_MEMORY_IA_POLICY.yearTitlesPerMonth);
  assert.equal(view.memoryCount, 144);
  assert.equal(view.traceDayCount, 12 * 28);
});

test("policy is the only knob: a different policy changes what opens, not the order", () => {
  const tight = { ...DEFAULT_MEMORY_IA_POLICY, openMemoriesTarget: 4, curatedPerMonth: 1, traceDaysInline: 2, traceEntriesPerDay: 1 };
  const index = buildMemoryIndex(chapters, tight);
  const open = index.years.flatMap((year) => year.months).filter((month) => month.mode === "open");
  assert.equal(open.length, 4);
  assert.ok(open.every((month) => month.featured.length === 1 && month.traces.days.length === 2 && month.traces.days[0].entries.length === 1));
  assert.equal(open[0].chapter.month, "2027-12");
});

test("the sparse fixture (today's shape) still opens the way it did: trace-only months count as open inside the window", () => {
  const sparse = buildChapters({ ...buildFixture(), birthDay: BIRTH });
  const index = buildMemoryIndex(sparse);
  const sept = index.years[0].months.find((month) => month.chapter.month === "2026-09");
  assert.equal(sept.mode, "open");
  assert.equal(sept.featured.length, 0);
  assert.equal(sept.traces.dayCount, 28);
  const dec = index.years[0].months.find((month) => month.chapter.month === "2026-12");
  assert.equal(dec.mode, "open");
  assert.equal(dec.hiddenMemoryCount, 0, "a month with fewer memories than the cap shows them all");
  assert.ok(index.years.some((year) => year.months.some((month) => month.mode === "index")));
});
