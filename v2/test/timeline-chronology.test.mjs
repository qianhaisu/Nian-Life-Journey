// Chronology regression tests.
//
// The bug these lock down: every LifeEvent in the archive occurred in 2025, but /memory rendered
// them under a hardcoded "2026 / 八月" divider, /memory/2025 returned 404 because the year route
// was a literal app/memory/2026 directory, and a seeded 2026-08 MonthlySnapshot acted as the month
// container. Dates in the database were correct throughout.
import test from "node:test";
import assert from "node:assert/strict";
import { availableMonths, availableYears, calendarDayOf, calendarMonthOf, calendarYearOf, dayOfMonth, inMonth, inYear, monthLabel } from "../lib/timeline-dates.ts";
import { isSnapshotPublishable } from "../lib/organizer/quality-review.ts";

// Shapes taken from the three real column types in the archive.
const EVENT_2025_08 = { id: "e-2025-08", occurredAt: "2025-08-11 00:00:00+00" };   // timestamptz
const EVENT_2025_07 = { id: "e-2025-07", occurredAt: "2025-07-21 00:00:00+00" };
const EVENT_2026_08 = { id: "e-2026-08", occurredAt: "2026-08-11 00:00:00+00" };
const TRACE_2026_08 = { id: "t-2026-08", occurredAt: "2026-08-28 00:00:00" };      // timestamp, local
const TRACE_2025_08 = { id: "t-2025-08", occurredAt: "2025-08-12 00:00:00" };

test("2025 and 2026 data split into two distinct years", () => {
  const events = [EVENT_2025_08, EVENT_2025_07, EVENT_2026_08];
  const traces = [TRACE_2026_08, TRACE_2025_08];
  assert.deepEqual(availableYears([events, traces]), ["2026", "2025"]);
  assert.deepEqual(inYear(events, "2025").map((e) => e.id), ["e-2025-08", "e-2025-07"]);
  assert.deepEqual(inYear(events, "2026").map((e) => e.id), ["e-2026-08"]);
});

test("a 2025 event never lands in a 2026 month bucket", () => {
  const events = [EVENT_2025_08, EVENT_2026_08];
  assert.deepEqual(inMonth(events, "2026-08").map((e) => e.id), ["e-2026-08"]);
  assert.deepEqual(inMonth(events, "2025-08").map((e) => e.id), ["e-2025-08"]);
});

test("year and month counts only ever count the same real year-month", () => {
  const events = [EVENT_2025_08, EVENT_2025_07, EVENT_2026_08];
  const traces = [TRACE_2026_08, TRACE_2025_08];
  assert.deepEqual(availableMonths([events, traces], "2025"), ["2025-08", "2025-07"]);
  assert.deepEqual(availableMonths([events, traces], "2026"), ["2026-08"]);
  assert.equal(inMonth(events, "2025-08").length + inMonth(traces, "2025-08").length, 2);
  assert.equal(inMonth(events, "2026-08").length + inMonth(traces, "2026-08").length, 2);
});

test("createdAt in 2026 never overrides an occurredAt in 2025", () => {
  const event = { id: "e", occurredAt: "2025-08-11 00:00:00+00", createdAt: "2026-09-01T09:16:01.169Z" };
  assert.equal(calendarYearOf(event.occurredAt), "2025");
  assert.deepEqual(inYear([event], "2025").map((e) => e.id), ["e"]);
  assert.deepEqual(inYear([event], "2026"), []);
});

test("instants convert to Asia/Shanghai, local wall-clock values are read as written", () => {
  // 2025-08-11T20:00Z is already 2025-08-12 in Shanghai (UTC+8).
  assert.equal(calendarDayOf("2025-08-11T20:00:00Z"), "2025-08-12");
  assert.equal(calendarDayOf("2025-08-11T15:59:00Z"), "2025-08-11");
  assert.equal(calendarDayOf("2025-08-11T16:00:00Z"), "2025-08-12");
  // No offset: a local day that must not be shifted by a second conversion.
  assert.equal(calendarDayOf("2026-08-28 00:00:00"), "2026-08-28");
  // A calendar date pinned at UTC midnight stays on its own date.
  assert.equal(calendarDayOf("2025-08-11 00:00:00+00"), "2025-08-11");
});

test("undated content is undated, never guessed into a year", () => {
  for (const value of [undefined, null, "", "not-a-date"]) {
    assert.equal(calendarDayOf(value), undefined);
    assert.equal(calendarYearOf(value), undefined);
    assert.equal(calendarMonthOf(value), undefined);
  }
  assert.deepEqual(availableYears([[{ occurredAt: undefined }]]), []);
  assert.deepEqual(inYear([{ occurredAt: undefined }], "2026"), []);
});

test("a seeded snapshot cannot contain a month with no published memories", () => {
  // The real situation: snapshot-2026-08 exists, but every approved LifeEvent is from 2025.
  const publishedMonths = new Set(["2025-08", "2025-07", "2025-06", "2025-05"]);
  assert.equal(isSnapshotPublishable("2026-08", publishedMonths), false);
  assert.equal(isSnapshotPublishable("2025-08", publishedMonths), true);
  assert.equal(isSnapshotPublishable(undefined, publishedMonths), false);
});

test("the homepage month label matches the occurredAt of the memory on screen", () => {
  const lead = calendarMonthOf(EVENT_2025_08.occurredAt);
  assert.equal(lead, "2025-08");
  assert.equal(`${lead.slice(0, 4)} 年 ${Number(lead.slice(5, 7))} 月`, "2025 年 8 月");
});

test("day-of-month and month labels come from the real date", () => {
  assert.equal(dayOfMonth("2025-08-11 00:00:00+00"), "11");
  assert.equal(dayOfMonth("2026-08-28 00:00:00"), "28");
  assert.equal(monthLabel("2025-08"), "八月");
  assert.equal(monthLabel("2025-11"), "十一月");
});

test("grouping is idempotent: the same input always yields the same buckets", () => {
  const events = [EVENT_2025_08, EVENT_2025_07, EVENT_2026_08];
  const traces = [TRACE_2026_08, TRACE_2025_08];
  const first = { years: availableYears([events, traces]), months: availableMonths([events, traces], "2025") };
  const second = { years: availableYears([events, traces]), months: availableMonths([events, traces], "2025") };
  assert.deepEqual(first, second);
});
