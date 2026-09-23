#!/usr/bin/env node
// 月页「故事并入日子」前后逐月对数（2026-09-23）。
//
// 合并前：部署前从线上抓的旧页面（.data/merge-before.json，由 .data/merge-before-scrape.mjs 生成）——
//   「这个月的日子」里的日条目、「这个月的故事」里的故事 id。
// 合并后：新线上的 /api/memory/<y>/<m>/timeline（stats + 逐周取回全部日条目）。
// 逐月核对：
//   1. 旧页日条目数 = 新 stats.contentDays，且旧页的每一天都在新时间线里；
//   2. 旧页故事 id 集合 = 新 stats.remainingStoryIds = 新 stats.mergedStoryIds（一个不少、一个不多）；
//   3. 新时间线逐周取回的日条目总数 = stats.timelineDays = contentDays + daysFromStoriesOnly，且无重复日期；
//   4. 每个故事所在的那一天都在新时间线里。
// 用法：node scripts/check-month-merge.mjs [--site https://nianlife.cn] [--before ../.data/merge-before.json] [--out ../.data/merge-count-check.json]
import { readFileSync, writeFileSync } from "node:fs";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const SITE = arg("--site", "https://nianlife.cn");
const before = JSON.parse(readFileSync(arg("--before", "../.data/merge-before.json"), "utf8"));
const OUT = arg("--out", "../.data/merge-count-check.json");
// month → { file, represented: { eventId: day } }, read from the live content files (read-only). A story the
// old page listed separately may since have been written into its day by the content file itself
// (scripts/editor/backfill-events.mjs); it is then represented by that day, not merged — still not lost.
const represented = JSON.parse(readFileSync(arg("--represented", "../.data/content-represented.json"), "utf8"));

const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} → ${r.status}`); return r.json(); };
const same = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

const rows = [];
for (const [ym, old] of Object.entries(before.months)) {
  const [y, m] = ym.split("/");
  const base = `${SITE}/api/memory/${y}/${m}/timeline`;
  const outline = await getJson(base);
  const got = [];
  for (const week of outline.weeks) got.push(...(await getJson(`${base}?week=${week.id}`)).entries);
  const days = got.map((e) => e.day);
  const s = outline.stats;
  const checks = {
    contentDaysMatch: old.dayEntries === s.contentDays,
    oldDaysAllPresent: old.days.every((d) => days.includes(d)),
    // Every story the old page listed is now in some day: merged into it, or written by the content file.
    storiesAllAccounted: old.storyIds.every((id) => s.mergedStoryIds.includes(id) || days.includes(represented[ym]?.represented?.[id])),
    storiesAllMerged: same(s.remainingStoryIds, s.mergedStoryIds),
    noStoryShownTwice: s.mergedStoryIds.every((id) => !represented[ym]?.represented?.[id]),
    storyDaysPresent: old.storyDays.every((d) => days.includes(d)),
    weeksSumToTimeline: got.length === s.timelineDays && s.timelineDays === s.contentDays + s.daysFromStoriesOnly,
    noDuplicateDays: new Set(days).size === days.length,
    orderedAsDeclared: days.join() === [...days].sort((a, b) => outline.order === "asc" ? a.localeCompare(b) : b.localeCompare(a)).join(),
  };
  const ok = Object.values(checks).every(Boolean);
  const nowInContent = old.storyIds.filter((id) => !s.mergedStoryIds.includes(id) && represented[ym]?.represented?.[id]);
  rows.push({
    month: ym, ok, order: outline.order, weeks: outline.weeks.length, contentFile: represented[ym]?.file,
    storiesNowWrittenByContent: nowInContent.map((id) => ({ id, day: represented[ym].represented[id] })),
    before: { dayEntries: old.dayEntries, stories: old.stories },
    after: { timelineDays: s.timelineDays, contentDays: s.contentDays, storiesMerged: s.mergedStoryIds.length, daysFromStoriesOnly: s.daysFromStoriesOnly },
    checks,
  });
  console.log(`${ym} ${ok ? "OK " : "BAD"} before days=${old.dayEntries} stories=${old.stories} | after days=${s.timelineDays} (content ${s.contentDays} + story-only ${s.daysFromStoriesOnly}) merged=${s.mergedStoryIds.length}${nowInContent.length ? ` now-in-content=${nowInContent.length}` : ""} order=${outline.order}${ok ? "" : " " + JSON.stringify(checks)}`);
}
const allOk = rows.every((r) => r.ok);
const totals = rows.reduce((t, r) => ({ beforeDays: t.beforeDays + r.before.dayEntries, beforeStories: t.beforeStories + r.before.stories, afterDays: t.afterDays + r.after.timelineDays, afterStoriesMerged: t.afterStoriesMerged + r.after.storiesMerged }), { beforeDays: 0, beforeStories: 0, afterDays: 0, afterStoriesMerged: 0 });
writeFileSync(OUT, JSON.stringify({ checkedAt: new Date().toISOString(), site: SITE, beforeCapturedAt: before.capturedAt, beforeSha: before.liveSha, allOk, totals, months: rows }, null, 1));
console.log(allOk ? "ALL MONTHS OK" : "MISMATCH", JSON.stringify(totals));
process.exit(allOk ? 0 : 1);
