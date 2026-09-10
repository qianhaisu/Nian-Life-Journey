// The front page's thirty-day draw (lib/home-recent-pick.ts). The cases that matter are the ones
// where a date is easy to get wrong: the edge of the window, the day the calendar turns over in
// Shanghai, a day that has not happened yet, and a story that was never published.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters } from "../lib/memory-chapters.ts";
import { productToday } from "../lib/time-truth.ts";
import {
  LAST_SHOWN_DAY_COOKIE, RECENT_WINDOW_DAYS, latestStory, pickRecentStory, recentStoryDays, recentWindowStart,
} from "../lib/home-recent-pick.ts";

const BIRTH = "2025-01-03";
const event = (id, day, extra = {}) => ({
  id, profileId: "p", title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt: `${day} 00:00:00+00`,
  people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [],
  careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"],
  visibility: "family", keptInYearbook: false, ...extra,
});
const chaptersOf = (events) => buildChapters({ events, traces: [], media: [], birthDay: BIRTH });
// A generator that walks the pool instead of being random, so a test can say which day it lands on.
const at = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

test("the window is thirty calendar days ending today, inclusive at both ends", () => {
  assert.equal(recentWindowStart("2026-09-10"), "2026-08-12");
  assert.equal(recentWindowStart("2026-03-02"), "2026-02-01", "it crosses a month boundary by calendar, not by 30/31");
  assert.equal(recentWindowStart("2026-01-05"), "2025-12-07", "…and a year boundary");
  const days = recentStoryDays(chaptersOf([
    event("edge-in", "2026-08-12"),
    event("edge-out", "2026-08-11"),
    event("today", "2026-09-10"),
  ]), "2026-09-10");
  assert.deepEqual(days.map((d) => d.day), ["2026-08-12", "2026-09-10"], "the 30th day back is in; the 31st is out");
});

test("today is Shanghai's calendar day, so the window turns over there and not in UTC", () => {
  // 2026-09-10 16:30 UTC is already 2026-09-11 in Shanghai. A window computed in UTC would still
  // be offering 8 月 12 日 and refusing 9 月 11 日 for another seven and a half hours.
  const justBeforeMidnightUtc = new Date("2026-09-10T16:30:00.000Z");
  assert.equal(productToday(justBeforeMidnightUtc), "2026-09-11");
  assert.equal(recentWindowStart(productToday(justBeforeMidnightUtc)), "2026-08-13");
  const chapters = chaptersOf([event("new-day", "2026-09-11"), event("falls-out", "2026-08-12")]);
  const days = recentStoryDays(chapters, productToday(justBeforeMidnightUtc));
  assert.deepEqual(days.map((d) => d.day), ["2026-09-11"], "the new Shanghai day is eligible and the day that aged out is gone");
});

test("a day that has not happened yet is never drawn", () => {
  const days = recentStoryDays(chaptersOf([event("future", "2026-09-20"), event("real", "2026-09-01")]), "2026-09-10");
  assert.deepEqual(days.map((d) => d.day), ["2026-09-01"]);
});

test("only published stories are candidates — an unpublished one is not in the archive to pick", () => {
  // The publication gate runs before this (lib/family-archive.ts hands buildChapters the
  // publishable set), so a needs_review row simply never reaches a chapter. Asserted from the
  // chapter side, which is the input this module actually reads.
  const published = chaptersOf([event("published", "2026-09-05")]);
  assert.deepEqual(recentStoryDays(published, "2026-09-10").map((d) => d.day), ["2026-09-05"]);
  assert.deepEqual(recentStoryDays(chaptersOf([]), "2026-09-10"), [], "nothing published, nothing to draw");
});

test("the draw is over days, not over stories: a busy day does not outweigh a quiet one", () => {
  const chapters = chaptersOf([
    event("busy-1", "2026-09-01"), event("busy-2", "2026-09-01"), event("busy-3", "2026-09-01"),
    event("quiet", "2026-09-02"),
  ]);
  const days = recentStoryDays(chapters, "2026-09-10");
  assert.deepEqual(days.map((d) => [d.day, d.memories.length]), [["2026-09-01", 3], ["2026-09-02", 1]]);
  assert.equal(pickRecentStory(days, at(0.0)).day, "2026-09-01");
  assert.equal(pickRecentStory(days, at(0.99)).day, "2026-09-02", "two days, half the draw each, whatever they hold");
});

test("a second visit does not repeat the day the browser was just shown", () => {
  const days = recentStoryDays(chaptersOf([
    event("a", "2026-09-01"), event("b", "2026-09-02"), event("c", "2026-09-03"),
  ]), "2026-09-10");
  // Whatever the random number, the excluded day cannot come back while others are available.
  for (const r of [0, 0.2, 0.5, 0.7, 0.99]) {
    assert.notEqual(pickRecentStory(days, at(r), "2026-09-02").day, "2026-09-02");
  }
  // Every remaining day is still reachable — the exclusion narrows the pool, it does not fix it.
  const landed = new Set([0, 0.99].map((r) => pickRecentStory(days, at(r), "2026-09-02").day));
  assert.deepEqual([...landed].sort(), ["2026-09-01", "2026-09-03"]);
});

test("one candidate day repeats rather than showing nothing", () => {
  const days = recentStoryDays(chaptersOf([event("only", "2026-09-04")]), "2026-09-10");
  const again = pickRecentStory(days, at(0.5), "2026-09-04");
  assert.equal(again.day, "2026-09-04");
  assert.equal(again.candidateDayCount, 1, "…and the page can tell that this is why");
});

test("no story in the window: the draw returns nothing and the archive's newest is still reachable", () => {
  const chapters = chaptersOf([event("old", "2026-05-20"), event("older", "2025-11-02")]);
  assert.deepEqual(recentStoryDays(chapters, "2026-09-10"), []);
  assert.equal(pickRecentStory(recentStoryDays(chapters, "2026-09-10"), at(0.5)), undefined);
  assert.equal(latestStory(chapters).day, "2026-05-20", "the fallback link points at the real newest, not a widened window");
  assert.equal(latestStory(chaptersOf([])), undefined, "and an empty archive offers nothing at all");
});

test("the picked story is returned whole, with its own date and month, and no photo requirement", () => {
  const days = recentStoryDays(chaptersOf([event("text-only", "2026-09-06")]), "2026-09-10");
  const pick = pickRecentStory(days, at(0));
  assert.equal(pick.day, "2026-09-06");
  assert.equal(pick.memory.lead, undefined, "a story with no photo is a candidate like any other");
  assert.equal(pick.memory.signature.dateLabel, "2026 年 9 月 6 日");
  assert.match(pick.memory.signature.ageLabel, /岁/, "the page can print the age it was then");
  assert.equal(pick.month.month, "2026-09");
  assert.equal(RECENT_WINDOW_DAYS, 30);
  assert.equal(LAST_SHOWN_DAY_COOKIE, "nl-home-day");
});
