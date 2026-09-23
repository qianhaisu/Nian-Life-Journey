// 部署前从线上 nianlife.cn 抓每个月的「日条目」与「这个月的故事」，作为合并前基线。
import { writeFileSync } from "node:fs";
const months = [];
for (let y = 2025, m = 1; y < 2026 || (y === 2026 && m <= 9); m === 12 ? (y++, m = 1) : m++) months.push(`${y}/${String(m).padStart(2, "0")}`);
const out = {};
for (const ym of months) {
  const html = await (await fetch(`https://nianlife.cn/memory/${ym}`)).text();
  const sha = null;
  const daysSec = (html.split('id="days-title"')[1] ?? "").split('id="more-memories-title"')[0].split("<footer")[0];
  const days = [...daysSec.matchAll(/<li class="month-day"><article[^>]*><p class="month-day-date"><time dateTime="(\d{4}-\d{2}-\d{2})"/g)].map((x) => x[1]);
  const storySec = (html.split('id="more-memories-title"')[1] ?? "").split("<footer")[0].split('class="monthly-focus')[0];
  const stories = [...storySec.matchAll(/href="\/events\/([^"]+)"/g)].map((x) => x[1]);
  const storyDays = [...storySec.matchAll(/<time dateTime="(\d{4}-\d{2}-\d{2})"/g)].map((x) => x[1]);
  out[ym] = { dayEntries: days.length, days, stories: [...new Set(stories)].length, storyIds: [...new Set(stories)], storyDays };
  console.log(ym, "days", days.length, "stories", out[ym].stories);
}
writeFileSync(".data/merge-before.json", JSON.stringify({ capturedAt: new Date().toISOString(), liveSha: "ce08236", months: out }, null, 1));
