// 旅行模块的纯函数（lib/travel/model.ts）。钉的是产品承诺：
//   · 每条旅程都说得出凭什么（evidence 不能空），地点都在地名册里，日期在范围内；
//   · 杭州（家）不算去过的城市；景点不冒充城市数；
//   · Teddy 2026-09-25 的决定：合肥没去过（只是提议），温州那三个月是「住过」不是旅程；
//   · 时间同时读得出「什么时候」和「当时几岁」（原则二）。
import test from "node:test";
import assert from "node:assert/strict";
import { PLACES, TRIPS, validateTrips, travelStats, unitOf, formatRange, daysOf, leadLine, tripAge, placeNames } from "../lib/travel/model.ts";

test("旅程文件整体有效，且新的在前", () => {
  assert.ok(TRIPS.length > 0);
  for (let i = 1; i < TRIPS.length; i++) assert.ok(TRIPS[i - 1].from >= TRIPS[i].from);
});

test("缺证据、未知地点、日期倒置、封面日不在旅程内，都整份拒绝", () => {
  const ok = { id: "x", title: "x", kind: "daytrip", from: "2026-01-01", to: "2026-01-01", placeIds: ["cn-sh-shanghai"], summary: "s", evidence: ["e"] };
  assert.doesNotThrow(() => validateTrips({ trips: [ok] }, PLACES));
  assert.throws(() => validateTrips({ trips: [{ ...ok, evidence: [] }] }, PLACES), /evidence/);
  assert.throws(() => validateTrips({ trips: [{ ...ok, placeIds: ["cn-nowhere"] }] }, PLACES), /地名册/);
  assert.throws(() => validateTrips({ trips: [{ ...ok, from: "2026-01-02" }] }, PLACES), /from\/to/);
  assert.throws(() => validateTrips({ trips: [{ ...ok, coverDay: "2026-02-01" }] }, PLACES), /coverDay/);
  assert.throws(() => validateTrips({ trips: [ok, ok] }, PLACES), /重复/);
});

test("Teddy 的决定：没有合肥，没有温州三个月的长旅程", () => {
  assert.ok(!TRIPS.some((t) => t.placeIds.includes("cn-ah-hefei")));
  assert.ok(!TRIPS.some((t) => t.from <= "2025-04-15" && t.to >= "2025-04-15"), "2025-03-15 → 06-14 在温州是住过，不是旅程");
  const us = TRIPS.find((t) => t.kind === "birthplace");
  assert.ok(us && us.placeIds.includes("us-ca-losangeles"));
});

test("统计：城市按地级市算；家那一格不算；景点落进所在城市", () => {
  const stats = travelStats(TRIPS);
  assert.deepEqual(stats.countries.map((c) => c.id).sort(), ["cn", "us"]);
  const names = stats.cities.map((c) => c.name);
  assert.ok(!names.includes("杭州"), "杭州是家，千岛湖、桐庐在杭州市域里也不算");
  assert.ok(names.includes("湖州"), "德清、安吉、莫干山都算湖州一处");
  assert.ok(!names.includes("德清") && !names.includes("莫干山"));
  assert.ok(names.includes("阿坝"), "川西（景点）落进阿坝");
  assert.ok(!names.includes("弗雷泽帕克"), "美国的景点自己不是城市");
  assert.ok(stats.provinces.includes("610000"));
  assert.equal(unitOf("cn-sh-shanghai").key, "cn:310000", "直辖市整个算一个");
  assert.equal(unitOf("cn-zj-qiandaohu").home, true);
});

test("日期区间：同月、跨月、跨年、单日", () => {
  assert.equal(formatRange("2026-05-02", "2026-05-05"), "2026 年 5 月 2 日 – 5 日");
  assert.equal(formatRange("2025-09-28", "2025-10-06"), "2025 年 9 月 28 日 – 10 月 6 日");
  assert.equal(formatRange("2025-12-26", "2026-01-01"), "2025 年 12 月 26 日 – 2026 年 1 月 1 日");
  assert.equal(formatRange("2026-04-12", "2026-04-12"), "2026 年 4 月 12 日");
  assert.deepEqual(daysOf({ from: "2025-12-30", to: "2026-01-01" }), ["2025-12-30", "2025-12-31", "2026-01-01"]);
});

test("第一句：年龄、国家和城市、最近一次", () => {
  const line = leadLine(TRIPS, "2025-01-03", "2026-09-25");
  assert.match(line, /^张年 1 岁 8 个月，去过 2 个国家、13 个城市。/, "城市数跟着足迹印章走（Teddy 2026-09-25）");
  assert.match(line, /最近一次是 8 月的宁波。$/);
  assert.equal(tripAge({ from: "2025-12-26" }, "2025-01-03"), "11 个月");
  assert.equal(placeNames({ placeIds: ["cn-sc-chengdu", "cn-sc-west"] }), "成都、川西");
});

test("封面：只收合格、张年是主体、脸清楚的照片；户外加分", async () => {
  const { coverScore, whenAge } = await import("../lib/travel/model.ts");
  const good = { qualified: true, childMain: true, faceClear: true, clarity: 80, expression: 80, matches: { outdoor: 0 } };
  assert.equal(coverScore(undefined, false), undefined);
  assert.equal(coverScore({ ...good, qualified: false }, false), undefined);
  assert.equal(coverScore({ ...good, childMain: false }, false), undefined, "一朵花的特写不能当封面");
  assert.equal(coverScore({ ...good, faceClear: false }, false), undefined, "半个额头不能当封面");
  assert.equal(coverScore({ ...good, sleeping: true }, false), undefined);
  assert.ok(coverScore({ ...good, matches: { outdoor: 90 } }, false) > coverScore(good, false));
  assert.equal(whenAge("出生的那天"), " · 出生那天");
  assert.equal(whenAge("11 个月"), " · 当时 11 个月");
  assert.equal(whenAge(undefined), "");
});

test("足迹印章按去处合并：美国几处 → 洛杉矶，阿坝 → 成都；其余不动", async () => {
  const { stampKeyOf } = await import("../lib/travel/model.ts");
  for (const id of ["us-ca-losangeles", "us-ca-monterey", "us-ca-sanfrancisco", "us-ca-frazier"]) assert.equal(stampKeyOf(unitOf(id).key), "us:us-ca-losangeles");
  assert.equal(stampKeyOf(unitOf("cn-sc-west").key), unitOf("cn-sc-chengdu").key);
  assert.equal(stampKeyOf(unitOf("cn-zj-ningbo").key), unitOf("cn-zj-ningbo").key);
});
