import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React ??= React;
Module.createRequire(import.meta.url).extensions[".css"] = () => {};

const {
  PLACES, TRIPS, validateTrips, isHomeTrip, isStayRecord, tripTag, pickFeaturedTrip, tripNeighbors,
} = await import("../lib/travel/model.ts");
const { syncTrips } = await import("../lib/travel/sync.ts");
const { tripEssay, validateEssays } = await import("../lib/travel/essay.ts");
const { resolveEssayPhotos } = await import("../lib/travel/reading.ts");
const { TripReading } = await import("../components/trip-reading.tsx");

const mk = (id, kind, from, to, extra = {}) => ({
  id, title: id, kind, from, to, placeIds: ["cn-sh-shanghai"], summary: `${id} 摘要`, evidence: ["证据"], ...extra,
});
const photo = (id, extra = {}) => ({ id, type: "photo", src: `/api/media/${id}?variant=web`, thumbnailSrc: `/api/media/${id}?variant=thumbnail`, alt: `照片 ${id}`, width: 1280, height: 960, ...extra });

test("6.1 回老家与旅行分组：hometown、常住记录、回老家连程的返程一站都进「回老家」组，真旅行不进", () => {
  const all = syncTrips([]);
  const stay = all.find((t) => isStayRecord(t));
  assert.equal(stay?.id, "stay-2025-03-15-cn-zj-wenzhou", "《住在温州的日子》由居住段生成");
  assert.equal(isHomeTrip(stay, all), true, "常住温州三个月不是旅行，归入回老家/常住组");
  assert.equal(tripTag(stay), "常住");
  for (const t of all.filter((x) => x.kind === "hometown")) assert.equal(isHomeTrip(t, all), true, t.id);
  const sichuan = all.find((t) => t.id === "2025-12-sichuan");
  assert.equal(isHomeTrip(sichuan, all), false);
  assert.equal(isHomeTrip(all.find((t) => t.kind === "birthplace"), all), false, "出生地回家是人生大事，不算回老家");
  assert.equal(tripTag(sichuan), undefined);

  // 2026-10：飞回温州（hometown）+ 回杭州路上义乌住一晚（travel，与前者共用 10-04）→ 义乌是回老家的返程一站
  const wenzhou = mk("codex-2026-10-wenzhou", "hometown", "2026-10-03", "2026-10-04");
  const yiwu = mk("codex-2026-10-yiwu", "travel", "2026-10-04", "2026-10-05");
  const later = mk("later-trip", "travel", "2026-10-20", "2026-10-21");
  assert.equal(isHomeTrip(yiwu, [wenzhou, yiwu, later]), true);
  assert.equal(isHomeTrip(later, [wenzhou, yiwu, later]), false, "不相邻的旅行不被连带");
});

test("6.2 首屏精选：featured 人工指定优先；否则最近一次有照片、非回老家、非出发记录的行程；没有候选就不出空卡", () => {
  const trips = [
    mk("home-latest", "hometown", "2026-10-03", "2026-10-04"),
    mk("record-latest", "travel", "2026-09-30", "2026-09-30", { recordOnly: true }),
    mk("nophoto", "travel", "2026-08-20", "2026-08-21"),
    mk("ningbo", "travel", "2026-08-15", "2026-08-16"),
    mk("sichuan", "travel", "2025-12-26", "2026-01-01"),
  ];
  const photos = new Set(["home-latest", "record-latest", "ningbo", "sichuan"]);
  const hasCover = (t) => photos.has(t.id);
  assert.equal(pickFeaturedTrip(trips, hasCover)?.id, "ningbo", "回老家、出发记录、无图行程都跳过，取最近有图的真旅行");
  const manual = trips.map((t) => (t.id === "sichuan" ? { ...t, featured: true } : t));
  assert.equal(pickFeaturedTrip(manual, hasCover)?.id, "sichuan", "featured 人工指定优先于「最近」");
  const manualNoPhoto = trips.map((t) => (t.id === "nophoto" ? { ...t, featured: true } : t));
  assert.equal(pickFeaturedTrip(manualNoPhoto, hasCover)?.id, "ningbo", "人工指定的行程没有封面照片时不做空卡，回退到最近有图的旅行");
  assert.equal(pickFeaturedTrip(trips, () => false), undefined);

  const real = TRIPS.filter((t) => t.featured);
  assert.deepEqual(real.map((t) => t.id), ["2025-12-sichuan"], "trips.json 当前只人工指定四川跨年");
});

test("6.2 trips.json 的 featured 字段校验：只能是布尔；校验后原样保留", () => {
  const ok = { ...mk("t1", "travel", "2026-01-01", "2026-01-02"), featured: true };
  const [out] = validateTrips({ trips: [ok] }, PLACES);
  assert.equal(out.featured, true);
  assert.equal(validateTrips({ trips: [{ ...ok, featured: undefined }] }, PLACES)[0].featured, undefined);
  assert.throws(() => validateTrips({ trips: [{ ...ok, featured: "yes" }] }, PLACES), /featured/);
});

test("6.3 上一段 / 下一段：按出发日期排，首尾缺一侧", () => {
  const list = [mk("c", "travel", "2026-03-01", "2026-03-02"), mk("a", "travel", "2026-01-01", "2026-01-02"), mk("b", "travel", "2026-02-01", "2026-02-01")];
  assert.deepEqual([tripNeighbors({ id: "b" }, list).prev?.id, tripNeighbors({ id: "b" }, list).next?.id], ["a", "c"]);
  assert.equal(tripNeighbors({ id: "a" }, list).prev, undefined);
  assert.equal(tripNeighbors({ id: "c" }, list).next, undefined);
  assert.deepEqual(tripNeighbors({ id: "missing" }, list), {});
});

test("6.3 essays.json 可选 schema：paragraphMedia / photoCaptions 兼容旧稿，非法组合整份拒绝", () => {
  const base = { tripId: "t", from: "2026-01-01", to: "2026-01-02", basis: "已确认事实", title: "散文", paragraphs: ["第一段", "第二段"] };
  const validate = (extra) => validateEssays({ schema: "nianlife.travel-essays/1", essays: [{ ...base, ...extra }] });
  assert.doesNotThrow(() => validate({}), "旧稿（无锚定）照常通过");
  assert.doesNotThrow(() => validate({ paragraphMedia: [["m1", "m2"], ["m3"]], photoCaptions: { m1: "在雪山下" } }));
  assert.doesNotThrow(() => validate({ paragraphMedia: [["m1"]] }), "可以只给前几段配图");
  assert.throws(() => validate({ paragraphMedia: [[], [], ["m1"]] }), /段数/);
  assert.throws(() => validate({ paragraphMedia: [["m1", "m2", "m3", "m4"]] }), /0～3/);
  assert.throws(() => validate({ paragraphMedia: [["m1"], ["m1"]] }), /重复/);
  assert.throws(() => validate({ paragraphMedia: [[""]] }), /空 id/);
  assert.throws(() => validate({ photoCaptions: { m1: "" } }), /空图注/);
  assert.throws(() => validate({ photoCaptions: ["x"] }), /对象/);

  const trip = { id: "t", from: "2026-01-01", to: "2026-01-02", title: "T", summary: "已确认事实", kind: "travel", placeIds: [], evidence: [] };
  const records = validateEssays({ schema: "nianlife.travel-essays/1", essays: [{ ...base, paragraphMedia: [["m1"], ["m2"]], photoCaptions: { m1: "图注" } }] });
  const essay = tripEssay(trip, records);
  assert.equal(essay.authored, true);
  assert.deepEqual(essay.paragraphMedia, [["m1"], ["m2"]]);
  assert.deepEqual(essay.photoCaptions, { m1: "图注" });
  assert.equal("paragraphMedia" in tripEssay(trip, validateEssays({ schema: "nianlife.travel-essays/1", essays: [base] })), false, "没有锚定就不带这个字段");
});

test("6.3 resolveEssayPhotos：过不了发布门的 id 被跳过、视频不进正文、同一张只出现一次，图注按 id 取", () => {
  const known = new Map([["a", photo("a")], ["b", photo("b")], ["v", photo("v", { type: "video" })]]);
  const resolve = (ids) => ids.flatMap((id) => (known.has(id) ? [known.get(id)] : []));
  const groups = resolveEssayPhotos({ paragraphMedia: [["a", "gone"], ["a", "v", "b"]], photoCaptions: { a: "第一张", b: "第二张" } }, resolve);
  assert.deepEqual(groups.map((g) => g.map((p) => p.media.id)), [["a"], ["b"]]);
  assert.equal(groups[0][0].caption, "第一张");
  assert.equal(groups[1][0].caption, "第二张");
  assert.equal(resolveEssayPhotos({}, resolve), undefined);
  assert.equal(resolveEssayPhotos({ paragraphMedia: [["gone"]] }, resolve), undefined, "全部失效时回退成不穿插，而不是空图框");
});

const baseReading = (extra = {}) => {
  const trip = mk("2025-12-sichuan", "travel", "2025-12-26", "2026-01-01", { title: "四川跨年", placeIds: ["cn-sc-chengdu"] });
  return {
    trip, ageLabel: "11 个月", memory: undefined, home: false,
    essay: { title: "雪山下的跨年", paragraphs: ["第一段", "第二段", "第三段"], authored: true },
    days: [
      { day: "2025-12-27", href: "/memory/2025/12/27", dateLabel: "12 月 27 日", ageLabel: "11 个月", title: "看熊猫", photos: [photo("d1"), photo("d1b")] },
      { day: "2025-12-28", href: "/memory/2025/12/28", dateLabel: "12 月 28 日", ageLabel: "11 个月", title: "雪山脚下", photos: [] },
      { day: "2025-12-29", dateLabel: "12 月 29 日", photos: [photo("scenic")] },
    ],
    neighbors: {
      prev: { trip: mk("2025-11-suzhou", "travel", "2025-11-21", "2025-11-23", { title: "苏州" }), cover: photo("n1"), ageLabel: "10 个月" },
      next: { trip: mk("2026-01-shanghai-bund", "daytrip", "2026-01-10", "2026-01-10", { title: "上海北外滩" }) },
    },
    ...extra,
  };
};

test("6.3 详情页：每天一张首屏缩略图（无图日走纯文字卡）、上下段导航、没有日页的风景日不进列表", () => {
  const html = renderToStaticMarkup(React.createElement(TripReading, { reading: baseReading() }));
  assert.match(html, /这段旅程留下的日子/);
  assert.match(html, /href="\/memory\/2025\/12\/27"/);
  assert.match(html, /href="\/memory\/2025\/12\/28"/);
  assert.doesNotMatch(html, /2025\/12\/29/, "没有日页的沿途风景日不出现在「留下的日子」");
  assert.equal((html.match(/travel-day-card--text/g) ?? []).length, 1, "只有无照片的 12-28 是纯文字卡");
  assert.match(html, /api\/media\/d1\?variant=thumbnail/, "日卡片用缩略图而不是大图");
  assert.doesNotMatch(html, /api\/media\/d1b/, "每天只放首屏第一张");
  assert.match(html, /上一段旅程/);
  assert.match(html, /下一段旅程/);
  assert.match(html, /href="\/travel\/2025-11-suzhou"/);
  assert.match(html, /href="\/travel\/2026-01-shanghai-bund"/);
  assert.doesNotMatch(html, /travel-essay-media/, "essay 没有锚定时不穿插图片，沿用上方相册");
});

test("6.3 详情页：essay 有 paragraphMedia 时按段穿插（1 张通栏、2 张并排）并显示图注；没有图注就不写", () => {
  const essayMedia = [
    [{ media: photo("e1"), caption: "雪山下的湖边" }],
    [{ media: photo("e2"), caption: "抱着熊猫逛街" }, { media: photo("e3") }],
  ];
  const html = renderToStaticMarkup(React.createElement(TripReading, { reading: baseReading({ essayMedia }) }));
  const iFirst = html.indexOf("第一段");
  const iE1 = html.indexOf("api/media/e1");
  const iSecond = html.indexOf("第二段");
  const iE2 = html.indexOf("api/media/e2");
  const iThird = html.indexOf("第三段");
  assert.ok(iFirst < iE1 && iE1 < iSecond && iSecond < iE2 && iE2 < iThird, "照片紧跟在各自的段落之后");
  assert.match(html, /travel-essay-media--1/);
  assert.match(html, /travel-essay-media--2/);
  assert.match(html, /<figcaption>雪山下的湖边<\/figcaption>/);
  assert.equal((html.match(/<figcaption>/g) ?? []).length, 2, "e3 没有图注就不写 figcaption");
  assert.equal((html.match(/api\/media\/e1/g) ?? []).length, 1, "同一张照片不重复出现");
});

test("6.3 详情页：首尾行程只出一侧导航；常住/回老家行程标签正确", () => {
  const only = baseReading({ neighbors: { next: baseReading().neighbors.next } });
  const html = renderToStaticMarkup(React.createElement(TripReading, { reading: only }));
  assert.doesNotMatch(html, /上一段旅程/);
  assert.match(html, /下一段旅程/);
  const stay = syncTrips([]).find((t) => isStayRecord(t));
  const stayHtml = renderToStaticMarkup(React.createElement(TripReading, { reading: baseReading({ trip: stay, home: true, neighbors: {} }) }));
  assert.match(stayHtml, /常住/);
  assert.doesNotMatch(stayHtml, /上一段旅程|下一段旅程/, "没有相邻行程就不渲染空导航");
});

test("6.4 合入 5 篇新游记：essays.json 校验通过且 5 个行程均命中成文与图文穿插", async () => {
  const fs = await import("node:fs");
  const raw = JSON.parse(fs.readFileSync(new URL("../lib/travel/essays.json", import.meta.url), "utf8"));
  const essays = validateEssays(raw);
  assert.equal(essays.length, 37, "essays.json 应包含原有 32 篇 + 新增 5 篇");

  const fiveIds = [
    "codex-2026-10-yiwu",
    "codex-2026-10-wenzhou",
    "codex-2026-09-xian",
    "codex-2026-09-wenzhou",
    "record-2024-11-30-us-ca-losangeles",
  ];
  const reviewed = {
    reviewStatus: "approved",
    reviewedBy: "codex",
    visibility: "public",
    childPresent: true,
    reviewedAt: "2026-10-15T00:00:00Z",
    sourceFingerprints: [{ id: "wechat-message:1", sha256: "a".repeat(64) }],
    evidence: ["证据"],
  };
  const syntheticMonths = [
    {
      month: "2024-11",
      title: "2024 年 11 月",
      days: [
        { day: "2024-11-30", title: "抵达洛杉矶，顺利到酒店", paragraphs: ["落地的第一晚。"] },
      ],
    },
    {
      month: "2026-09",
      title: "2026 年 9 月",
      days: [],
      travelRecords: [
        { ...reviewed, id: "codex-2026-09-wenzhou", title: "回温州过中秋", kind: "hometown", from: "2026-09-24", to: "2026-09-28", placeIds: ["cn-zj-wenzhou"], summary: "9 月 24 日晚出发回温州，过了午夜到达。28 日，一家人又坐上飞机，离开温州。" },
        { ...reviewed, id: "codex-2026-09-xian", title: "回西安看爷爷奶奶", kind: "hometown", from: "2026-09-28", to: "2026-10-03", placeIds: ["cn-sn-xian"], summary: "9 月 28 日到了西安，在爷爷奶奶家住了几天。10 月 3 日，一家人离开西安，飞回温州。" },
      ],
    },
    {
      month: "2026-10",
      title: "2026 年 10 月",
      days: [],
      travelRecords: [
        { ...reviewed, id: "codex-2026-10-wenzhou", title: "飞回温州", kind: "hometown", from: "2026-10-03", to: "2026-10-04", placeIds: ["cn-zj-wenzhou"], summary: "10 月 3 日，一家人坐飞机回温州。小年在路上睡着，下午落地。第二天又踏上回杭州的路。" },
        { ...reviewed, id: "codex-2026-10-yiwu", title: "回杭州路上在义乌住一晚", kind: "travel", from: "2026-10-04", to: "2026-10-05", placeIds: ["cn-zj-yiwu"], summary: "回杭州的路上，在义乌住了一晚。10 月 5 日下午从义乌出发，傍晚回到杭州的家。" },
      ],
    },
  ];
  const mergedTrips = syncTrips(syntheticMonths);
  const la = mergedTrips.find((t) => t.id === "record-2024-11-30-us-ca-losangeles");
  assert.ok(la, "2024-11-30 应生成洛杉矶行程");

  for (const id of fiveIds) {
    const trip = mergedTrips.find((t) => t.id === id);
    assert.ok(trip, `应能解析行程 ${id}`);
    const essay = tripEssay(trip);
    assert.equal(essay.authored, true, `${id} 必须命中 authored 游记而非 1 句 summary`);
    assert.ok(essay.paragraphs.length >= 2, `${id} 游记至少 2 段`);
    const resolved = resolveEssayPhotos(essay, (ids) => ids.map((mid) => photo(mid)));
    if (id === "codex-2026-10-yiwu") {
      assert.equal(resolved, undefined, "义乌无专属照片，不附带 paragraphMedia");
    } else {
      assert.ok(resolved && resolved.some((slot) => slot.length > 0), `${id} 应解析出段落穿插照片`);
      assert.ok(resolved.flat().some((item) => Boolean(item.caption)), `${id} 应解析出 photoCaptions`);
    }
  }
});

test("足迹印章标志物：PLACES 所有 stampKeyOf 均有专属非兜底标志物且兜底纹样可用", async () => {
  const { unitOf, stampKeyOf } = await import("../lib/travel/model.ts");
  const { TravelStampMotif, hasCityStampMotif } = await import("../components/travel-stamp-motif.tsx");
  const allKeys = new Set();
  for (const p of PLACES) {
    const u = unitOf(p.id);
    if (u) allKeys.add(stampKeyOf(u.key));
  }
  assert.ok(allKeys.size >= 17, `应覆盖 PLACES 全部城市印章 key（实际 ${allKeys.size}）`);
  for (const key of allKeys) {
    assert.equal(hasCityStampMotif(key), true, `城市印章 ${key} 缺少专属标志物 SVG`);
    const svg = renderToStaticMarkup(React.createElement(TravelStampMotif, { stampKey: key }));
    assert.match(svg, /class="travel-stamp-motif"/);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /<(?:path|circle)\b/);
  }
  assert.equal(hasCityStampMotif("cn:999900"), false);
  const fallbackSvg = renderToStaticMarkup(React.createElement(TravelStampMotif, { stampKey: "cn:999900" }));
  assert.match(fallbackSvg, /class="travel-stamp-motif"/);
  assert.match(fallbackSvg, /<path\b/);
});
