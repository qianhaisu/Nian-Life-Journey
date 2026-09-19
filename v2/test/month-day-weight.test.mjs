import test from "node:test";
import assert from "node:assert/strict";
import { pickLeadDays, groupIntoWeeks, dayRichness, LEAD_DAYS_MAX } from "../lib/month-day-weight.ts";

// 2026-09-19 全站验收，原则五：出生那个月和平常的六月同一个模板、同一个字号。
// 内容文件里没有「里程碑」标记（全部 21 个月都是编辑过的内容，kind 在有的月里 31/31 全是 story），
// 所以领头日靠「写了多少、拍了多少」这个代理信号，手写 emphasis 可以覆盖。这一组锁住它的边界。

const text = (n) => ["字".repeat(n)];
const day = (d, over = {}) => ({ day: `2026-06-${String(d).padStart(2, "0")}`, paragraphs: text(40), photoCount: 2, ...over });
const month = (n, over = () => ({})) => Array.from({ length: n }, (_, i) => day(i + 1, over(i + 1)));

test("拍得多、写得多的日子领头，且不超过名额上限", () => {
  const days = month(29, (d) => (d === 5 ? { photoCount: 12, paragraphs: text(400) } : d === 19 ? { photoCount: 9, paragraphs: text(300) } : {}));
  const lead = pickLeadDays(days);
  assert.ok(lead.has("2026-06-05") && lead.has("2026-06-19"));
  assert.ok(lead.size <= LEAD_DAYS_MAX, `最多 ${LEAD_DAYS_MAX} 天，实得 ${lead.size}`);
});

test("名额随天数走：只有几天的月份不能一半都是重点，但至少有一天", () => {
  assert.equal(pickLeadDays(month(4)).size, 1, "4 天的月份只抬 1 天");
  assert.equal(pickLeadDays(month(17)).size, 2, "17 天的月份抬 2 天");
  assert.equal(pickLeadDays(month(29)).size, 4, "29 天的月份封顶 4 天");
});

test("没有照片的日子不会被代理信号抬——没有大图可以领", () => {
  const days = month(20, (d) => (d === 3 ? { photoCount: 0, paragraphs: text(2000) } : {}));
  assert.ok(!pickLeadDays(days).has("2026-06-03"), "写得再长，没有照片也不领头");
});

test("手写 emphasis 压过代理信号：lead 一定抬，quiet 一定不抬", () => {
  const days = month(29, (d) => {
    if (d === 8) return { photoCount: 1, paragraphs: text(5), emphasis: "lead" }; // 平平无奇但被标成里程碑
    if (d === 5) return { photoCount: 12, paragraphs: text(400), emphasis: "quiet" }; // 分最高但被标成安静
    return {};
  });
  const lead = pickLeadDays(days);
  assert.ok(lead.has("2026-06-08"), "手写 lead 必须领头，哪怕代理分很低");
  assert.ok(!lead.has("2026-06-05"), "手写 quiet 必须不领头，哪怕代理分最高");
});

test("手写 lead 的天没有照片时不抬——没图可领，宁可不抬", () => {
  const days = month(10, (d) => (d === 2 ? { photoCount: 0, emphasis: "lead" } : {}));
  assert.ok(!pickLeadDays(days).has("2026-06-02"));
});

test("手写 lead 超过名额时全部保留，不被名额挤掉", () => {
  const days = month(29, (d) => ([1, 2, 3, 4, 5, 6].includes(d) ? { emphasis: "lead" } : {}));
  const lead = pickLeadDays(days);
  for (const d of [1, 2, 3, 4, 5, 6]) assert.ok(lead.has(`2026-06-0${d}`), `第 ${d} 天手写了 lead`);
  assert.equal(lead.size, 6, "手写的全留，也不再往里补代理信号的天");
});

test("emphasis 写成别的值按没写处理，不影响结果", () => {
  const days = month(29, (d) => (d === 8 ? { emphasis: "important" } : {}));
  const withStray = pickLeadDays(days);
  const without = pickLeadDays(month(29));
  assert.deepEqual([...withStray].sort(), [...without].sort());
});

test("同分按日期先后，结果是确定的", () => {
  const a = pickLeadDays(month(29));
  const b = pickLeadDays(month(29));
  assert.deepEqual([...a].sort(), [...b].sort());
  assert.deepEqual([...a].sort(), ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04"], "全部同分时取最早的几天");
});

test("代理分：照片、字数各有封顶，绑定过故事的加分", () => {
  const base = { day: "2026-06-01", paragraphs: text(0), photoCount: 0 };
  assert.equal(dayRichness({ ...base, photoCount: 50 }), 12, "照片封顶 12");
  assert.equal(dayRichness({ ...base, paragraphs: text(100000) }), 10, "字数封顶 10");
  assert.equal(dayRichness({ ...base, storyBound: true }), 3);
});

// ── 按周分块 ──────────────────────────────────────────────────────────────────

const entries = (...doms) => doms.map((d) => ({ day: `2026-06-${String(d).padStart(2, "0")}` }));

test("按 1–7 / 8–14 / 15–21 / 22–月底 分块，边界日落在正确的一块", () => {
  const groups = groupIntoWeeks(entries(1, 7, 8, 14, 15, 21, 22, 30));
  assert.deepEqual(groups.map((g) => [g.id, g.label, g.entries.length]), [
    ["week-1", "1 – 7 日", 2],
    ["week-2", "8 – 14 日", 2],
    ["week-3", "15 – 21 日", 2],
    ["week-4", "22 – 30 日", 2],
  ]);
});

test("最后一块的范围写到这个月真正的最后一天：31 天、30 天、平年二月、闰年二月", () => {
  const last = (year, mm) => groupIntoWeeks([{ day: `${year}-${mm}-25` }])[0].label;
  assert.equal(last(2026, "01"), "22 – 31 日");
  assert.equal(last(2026, "06"), "22 – 30 日");
  assert.equal(last(2025, "02"), "22 – 28 日", "2025 平年二月");
  assert.equal(last(2028, "02"), "22 – 29 日", "2028 闰年二月");
});

test("没有日子的那一块不出现，日子不重不漏", () => {
  const groups = groupIntoWeeks(entries(3, 4, 25));
  assert.deepEqual(groups.map((g) => g.id), ["week-1", "week-4"]);
  assert.equal(groups.flatMap((g) => g.entries).length, 3);
  assert.deepEqual(groupIntoWeeks([]), []);
});
