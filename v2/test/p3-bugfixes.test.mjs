import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

globalThis.React ??= React;
Module.createRequire(import.meta.url).extensions[".css"] = () => {};

const {
  parseDateQuery,
  wordMatchTier,
  highlightSegments,
  searchArchive,
  searchArchiveAll,
} = await import("../lib/life-reading.ts");
const { resolveTripDayPhotos, pickTripCover, connectedTripFallbackDays } = await import("../lib/travel/reading.ts");
const { buildTripMemory } = await import("../lib/travel/memory.ts");
const { resolveSlideReading } = await import("../lib/home-memory-reading.ts");
const {
  selectHomeMemories,
  topicTextRelevanceBonus,
} = await import("../lib/home-memory.ts");
const { CAROUSEL_THEMES } = await import("../lib/home-memory-topics.ts");
const { validateMonthContent } = await import("../lib/month-content.ts");
const { HomeMemory, MemoryPlayer } = await import("../components/home-memory.tsx");
const { PhotoGrid } = await import("../components/photo-grid.tsx");
const { default: XueyiFilmPage } = await import("../app/films/xueyi/page.tsx");

const mkPhoto = (id, takenAt = "2026-07-18 10:00:00", extra = {}) => ({
  id,
  type: "photo",
  src: `/api/media/${id}?variant=web`,
  thumbnailSrc: `/api/media/${id}?variant=thumbnail`,
  alt: `照片 ${id}`,
  width: 1280,
  height: 960,
  takenAt,
  ...extra,
});

const mkDay = (day, text, extra = {}) => ({
  day,
  title: extra.title ?? `${day} 的标题`,
  href: `/memory/${day.replaceAll("-", "/")}`,
  ageLabel: extra.ageLabel ?? "1 岁 2 个月",
  paragraphs: Array.isArray(text) ? text : [text],
  photos: extra.photos ?? [],
  milestone: null,
  lead: false,
});

// ── 3.5 搜索增强单元测试（海 / 2024 / 2025年3月 / 外婆 / 月度综述 / 缩略图与高亮） ─────────────

test("3.5 单字查询「海」：独立成词排在最前，剔除「海鲜」「上海」「刘海」「海洋球」等复合词误召回", () => {
  const entries = [
    mkDay("2026-10-08", "中午在餐厅吃了海鲜面。"),
    mkDay("2026-10-07", "爸爸今天去上海出差。"),
    mkDay("2026-10-06", "妈妈帮他剪齐了额前的刘海。"),
    mkDay("2026-10-05", "他在游乐场的海洋球池里打滚。"),
    mkDay("2026-05-01", "一家人在海边散步吹风。"),
    mkDay("2026-02-15", "他站在岸上，指着远处的海。"),
  ];

  assert.equal(wordMatchTier("中午吃了海鲜面", "海"), 0);
  assert.equal(wordMatchTier("爸爸去上海出差", "海"), 0);
  assert.equal(wordMatchTier("剪了刘海", "海"), 0);
  assert.equal(wordMatchTier("玩海洋球", "海"), 0);
  assert.ok(wordMatchTier("指着远处的海", "海") > wordMatchTier("在海边散步", "海"));

  const hits = searchArchive(entries, "海");
  assert.deepEqual(
    hits.map((h) => h.entry.day),
    ["2026-02-15", "2026-05-01"],
    "独立成词的「海」应排在「海边」之前，且海鲜/上海/刘海/海洋球均不被误召回",
  );

  // 同一句同时含「海鲜」与「看海」时，只高亮真正命中的「海」
  const segs = highlightSegments("中午吃海鲜，下午去看海。", ["海"]);
  const marked = segs.filter((s) => s.hit).map((s) => s.text);
  assert.deepEqual(marked, ["海"]);
  assert.equal(segs.map((s) => (s.hit ? `<mark>${s.text}</mark>` : s.text)).join(""), "中午吃海鲜，下午去看<mark>海</mark>。");
});

test("3.5 年份查询「2024」：完整召回 2024 出生前孕期月份段落与出生前日页", () => {
  assert.deepEqual(parseDateQuery("2024"), { kind: "year", year: "2024" });
  assert.deepEqual(parseDateQuery("2024年"), { kind: "year", year: "2024" });

  const months = [
    {
      month: "2024-06",
      href: "/memory/2024/06",
      label: "2024 年 6 月",
      ageLabel: "出生前 7 个月",
      preBirth: true,
      cardLine: "第一次在屏幕上看见小小的芽",
      intro: "六月建档，一切刚刚开始。",
    },
    {
      month: "2024-12",
      href: "/memory/2024/12",
      label: "2024 年 12 月",
      ageLabel: "出生前 1 个月",
      preBirth: true,
      cardLine: "待产包收拾好了，等见面",
      intro: "十二月每次产检都在倒计时。",
      cover: mkPhoto("m-2024-12"),
    },
    {
      month: "2025-01",
      href: "/memory/2025/01",
      label: "2025 年 1 月",
      ageLabel: "出生的那个月",
      preBirth: false,
      cardLine: "他出生了",
    },
  ];
  const entries = [
    mkDay("2024-06-18", "第一次做产检，听见胎心。", { ageLabel: "出生前" }),
    mkDay("2024-12-24", "把小衣服洗好晒在阳台上。", { ageLabel: "出生前", photos: [mkPhoto("d-2024-12-24")] }),
    mkDay("2025-01-03", "他出生了。", { ageLabel: "出生的那天" }),
  ];

  const { items, dateQuery } = searchArchiveAll({ entries, months, query: "2024" });
  assert.deepEqual(dateQuery, { kind: "year", year: "2024" });
  const monthHits = items.filter((item) => item.kind === "month");
  const dayHits = items.filter((item) => item.kind === "day");
  assert.deepEqual(monthHits.map((m) => m.month.month), ["2024-06", "2024-12"]);
  assert.ok(monthHits.every((m) => m.month.preBirth === true));
  assert.deepEqual(dayHits.map((d) => d.entry.day), ["2024-06-18", "2024-12-24"]);
  assert.equal(dayHits[1].leadPhoto?.id, "d-2024-12-24");
});

test("3.5 年月查询：支持 2025年3月 / 2025-03 / 2025.3 / 2025/03 全部等价解析并返回对应月页与日页", () => {
  for (const raw of ["2025年3月", "2025 年 03 月", "2025-03", "2025-3", "2025.3", "2025/03"]) {
    assert.deepEqual(parseDateQuery(raw), { kind: "month", year: "2025", month: "03", ym: "2025-03" }, `解析失败: ${raw}`);
  }

  const months = [
    { month: "2025-02", href: "/memory/2025/02", label: "2025 年 2 月", cardLine: "二月" },
    { month: "2025-03", href: "/memory/2025/03", label: "2025 年 3 月", ageLabel: "2 个月", cardLine: "开始练习抬头和翻身", intro: "三月的阳光暖起来了。" },
  ];
  const entries = [
    mkDay("2025-02-28", "二月最后一天。"),
    mkDay("2025-03-05", "趴在垫子上抬头看了好久。", { photos: [mkPhoto("mar-05")] }),
    mkDay("2025-03-30", "换上了大号睡衣。"),
  ];

  const res = searchArchiveAll({ entries, months, query: "2025年3月" });
  assert.equal(res.items[0].kind, "month");
  assert.equal(res.items[0].month.month, "2025-03");
  assert.deepEqual(
    res.items.filter((i) => i.kind === "day").map((i) => i.entry.day),
    ["2025-03-05", "2025-03-30"],
  );
});

test("3.5 关键词查询「外婆」：同时召回月度综述（intro/cardLine）与日页记录，携带首图缩略图与关键词高亮", () => {
  const months = [
    {
      month: "2025-09",
      href: "/memory/2025/09",
      label: "2025 年 9 月",
      ageLabel: "8 个月",
      cardLine: "外婆来杭州陪他度过初秋",
      intro: "这一整月外婆每天推着小车带他在院子里转悠。",
      cover: mkPhoto("m-09"),
    },
  ];
  const entries = [
    mkDay("2025-09-12", "外婆抱着他在窗边看树叶。", { photos: [mkPhoto("day-0912")] }),
    mkDay("2025-09-15", "今天一个人在垫子上搭积木。"),
  ];

  const { items, highlightTerms } = searchArchiveAll({ entries, months, query: "外婆" });
  assert.ok(highlightTerms.includes("外婆"));
  assert.equal(items.length, 2);
  const mHit = items.find((i) => i.kind === "month");
  const dHit = items.find((i) => i.kind === "day");
  assert.ok(mHit && mHit.month.month === "2025-09");
  assert.ok(dHit && dHit.entry.day === "2025-09-12");
  assert.equal(dHit.leadPhoto?.id, "day-0912");

  const segs = highlightSegments(dHit.excerpt, highlightTerms);
  assert.ok(segs.some((s) => s.hit && s.text === "外婆"));
});

// ── 3.2 旅行义乌无图空卡回退测试 ──────────────────────────────────────────────────────────

test("3.2 旅行回退：当行程日为 text-only（firstScreen/expanded 均空）时自动回退当日已审核照片做封面与相册", () => {
  const trip = {
    id: "codex-2026-10-yiwu",
    title: "去义乌",
    kind: "outing",
    from: "2026-10-04",
    to: "2026-10-05",
    placeIds: ["yiwu"],
  };
  const approvedOct5 = [
    mkPhoto("yiwu-approved-1", "2026-10-05 14:36:25"),
    mkPhoto("yiwu-approved-2", "2026-10-05 14:49:10"),
  ];

  const oct4Photos = resolveTripDayPhotos({ firstScreen: [], expanded: [], published: [], approvedDay: [] });
  const oct5Photos = resolveTripDayPhotos({ firstScreen: [], expanded: [], published: [], approvedDay: approvedOct5 });
  assert.equal(oct4Photos.length, 0);
  assert.deepEqual(oct5Photos.map((p) => p.id), ["yiwu-approved-1", "yiwu-approved-2"]);

  const scores = new Map([
    ["yiwu-approved-1", { qualified: true, childMain: true, faceClear: true, clarity: 85, expression: 80 }],
    ["yiwu-approved-2", { qualified: true, childMain: true, faceClear: true, clarity: 92, expression: 88 }],
  ]);
  const pools = [
    { day: "2026-10-04", photos: oct4Photos },
    { day: "2026-10-05", photos: oct5Photos },
  ];
  const cover = pickTripCover(trip, pools, scores);
  assert.equal(cover?.id, "yiwu-approved-2", "有视觉评分时自动选出关联日已审核照片中评分最高的一张作为封面");
  const unscoredCover = pickTripCover(trip, pools, new Map());
  assert.equal(unscoredCover?.id, "yiwu-approved-1", "尚未离线打分的新照片也能自动回退首张已审核照片做封面");

  const memory = buildTripMemory(
    trip,
    [
      { day: "2026-10-04", href: "/memory/2026/10/04", dateLabel: "10 月 4 日", photos: oct4Photos },
      { day: "2026-10-05", href: "/memory/2026/10/05", dateLabel: "10 月 5 日", photos: oct5Photos },
    ],
    scores,
    cover,
  );
  assert.ok(memory, "回退照片应生成非空的旅行回忆舞台");
  assert.equal(memory.slides.length, 2);

  // 当本段两天（10-04..10-05）没有任何合格尺寸的可投递照片时，自动从共享出行日的相连行程（飞回温州 10-03..10-04）回退，并保留照片原始日期
  const wenzhouTrip = {
    id: "codex-2026-10-wenzhou",
    title: "飞回温州",
    kind: "hometown",
    from: "2026-10-03",
    to: "2026-10-04",
    placeIds: ["cn-zj-wenzhou"],
  };
  const fallbackDays = connectedTripFallbackDays(trip, [wenzhouTrip, trip]);
  assert.deepEqual(fallbackDays, ["2026-10-03"]);
  const connectedMemory = buildTripMemory(
    trip,
    [
      { day: "2026-10-04", href: "/memory/2026/10/04", dateLabel: "10 月 4 日", photos: [] },
      { day: "2026-10-05", href: "/memory/2026/10/05", dateLabel: "10 月 5 日", photos: [] },
      {
        day: "2026-10-03",
        href: "/memory/2026/10/03",
        dateLabel: "10 月 3 日",
        photos: [mkPhoto("wenzhou-oct3-1", "2026-10-03 10:45:21")],
      },
    ],
    new Map(),
  );
  assert.equal(connectedMemory?.slides.length, 1);
  assert.equal(connectedMemory?.slides[0].dateLabel, "10 月 3 日", "相连行程回退照片保留真实拍摄日期，不伪造日期");
  assert.equal(connectedMemory?.slides[0].href, "/memory/2026/10/03");
});

test("3.2 相连行程封面避撞：回退行程传入 excludeIds 时优先选用未被相邻行程占用的合格照片，相册首帧同步避撞", () => {
  const wenzhouTrip = {
    id: "codex-2026-10-wenzhou",
    title: "飞回温州",
    kind: "hometown",
    from: "2026-10-03",
    to: "2026-10-04",
    placeIds: ["cn-zj-wenzhou"],
  };
  const yiwuTrip = {
    id: "codex-2026-10-yiwu",
    title: "回杭州路上在义乌住一晚",
    kind: "outing",
    from: "2026-10-04",
    to: "2026-10-05",
    placeIds: ["cn-zj-jinhua-yiwu"],
  };
  const oct3Photos = [
    mkPhoto("wechat-media:ecd9f6c94f6ab59583a63d96e88664616ddb4449baf0029779bb83bf4367d5fc", "2026-10-03 10:45:21"),
    mkPhoto("wechat-media:bb7e31063fedc192812782d28cd26dba810946106875c18d76a7e8ceee633752", "2026-10-03 18:12:00"),
  ];
  const scores = new Map([
    [oct3Photos[0].id, { qualified: true, childMain: true, faceClear: true, clarity: 92, expression: 88 }],
    [oct3Photos[1].id, { qualified: true, childMain: true, faceClear: true, clarity: 85, expression: 82 }],
  ]);
  const sharedPool = [{ day: "2026-10-03", photos: oct3Photos }];

  const wenzhouCover = pickTripCover(wenzhouTrip, sharedPool, scores);
  assert.equal(wenzhouCover?.id, oct3Photos[0].id);

  const usedCoverIds = new Set([wenzhouCover.id]);
  const yiwuCover = pickTripCover(yiwuTrip, sharedPool, scores, usedCoverIds);
  assert.equal(yiwuCover?.id, oct3Photos[1].id, "义乌回退卡片应避开已被温州卡片选中的首张图，选用池中第 2 张合格图");
  assert.notEqual(yiwuCover?.id, wenzhouCover?.id);

  const yiwuMemory = buildTripMemory(
    yiwuTrip,
    [
      { day: "2026-10-04", href: "/memory/2026/10/04", dateLabel: "10 月 4 日", photos: [] },
      { day: "2026-10-05", href: "/memory/2026/10/05", dateLabel: "10 月 5 日", photos: [] },
      { day: "2026-10-03", href: "/memory/2026/10/03", dateLabel: "10 月 3 日", photos: oct3Photos },
    ],
    scores,
    yiwuCover,
  );
  assert.ok(yiwuMemory);
  assert.equal(yiwuMemory.slides[yiwuMemory.coverIndex]?.media.id, oct3Photos[1].id, "详情页相册首帧 coverIndex 与避撞封面保持一致");

  // 极端边界：若回退池总共只有 1 张照片且已被占用，仍须兜底返回该图而不出现空封面
  const singlePool = [{ day: "2026-10-03", photos: [oct3Photos[0]] }];
  assert.equal(pickTripCover(yiwuTrip, singlePool, scores, usedCoverIds)?.id, oct3Photos[0].id);
});

// ── 3.3 首页大图卡与放映器字幕逻辑 + 主题选片相关性优化测试 ──────────────────────────────────

test("3.3 MonthContent 校验兼容可选 photoCaptions 字段", () => {
  const valid = validateMonthContent(
    {
      schema: "nianlife.month-content/1",
      month: "2026-10",
      days: [
        {
          day: "2026-10-01",
          kind: "story",
          title: "十月第一天",
          paragraphs: ["自己握着勺子吃完了半碗面。"],
          firstScreenMediaIds: ["m1"],
          expandedMediaIds: ["m1"],
          photoCaptions: { m1: "握着小勺吃面条" },
        },
      ],
    },
    "2026-10",
  );
  assert.equal(valid?.days[0].photoCaptions?.m1, "握着小勺吃面条");
});

test("3.3 字幕防错位：有 photoCaptions 显示专属图注；无 photoCaptions 时绝不拿日页标题冒充字幕，仅显示日期·年龄与读这一天", () => {
  const slide = {
    key: "topic:eat|m-no-caption",
    media: mkPhoto("m-no-caption", "2025-03-30 12:00:00"),
  };

  // 无 photoCaptions：caption 必须为 undefined（不能冒用当天标题「更爱吃手了，换上大号睡衣」）
  const withoutCaption = resolveSlideReading({
    kind: "topic",
    slide,
    birthDay: "2025-01-03",
    hasDayPage: true,
    dayHref: "/memory/2025/03/30",
    monthHref: "/memory/2025/03",
    photoCaptions: undefined,
  });
  assert.equal(withoutCaption.caption, undefined);
  assert.equal(withoutCaption.dateLabel, "2025 年 3 月 30 日");
  assert.equal(withoutCaption.ageLabel, "2 个月");
  assert.equal(withoutCaption.linkLabel, "读这一天");

  const htmlWithoutCaption = renderToStaticMarkup(
    React.createElement(HomeMemory, {
      memories: [
        {
          kind: "topic",
          key: "topic:eat",
          title: "吃饭这件事",
          subtitle: "2025 年 3 月 — 2026 年 7 月 · 当时 2 个月 — 1 岁 6 个月",
          slides: [withoutCaption],
          coverIndex: 0,
          durationSeconds: 5,
          mood: "warm",
          moodReason: "test",
          reason: "test",
        },
      ],
    }),
  );
  assert.doesNotMatch(htmlWithoutCaption, /memory-slide-note/, "无图注时不渲染 .memory-slide-note");
  assert.match(htmlWithoutCaption, /2025 年 3 月 30 日/);
  assert.match(htmlWithoutCaption, /当时 2 个月/);
  assert.doesNotMatch(htmlWithoutCaption, /读这一天/, "首页不再渲染「读这一天」胶囊");

  // 有 photoCaptions：优先展示当前照片自己的图注
  const withCaption = resolveSlideReading({
    kind: "topic",
    slide,
    birthDay: "2025-01-03",
    hasDayPage: true,
    dayHref: "/memory/2025/03/30",
    monthHref: "/memory/2025/03",
    photoCaptions: { "m-no-caption": "坐在餐椅里抓着西兰花啃" },
  });
  assert.equal(withCaption.caption, "坐在餐椅里抓着西兰花啃");

  const htmlWithCaption = renderToStaticMarkup(
    React.createElement(HomeMemory, {
      memories: [
        {
          kind: "topic",
          key: "topic:eat",
          title: "吃饭这件事",
          subtitle: "2025 年 3 月 — 2026 年 7 月 · 当时 2 个月 — 1 岁 6 个月",
          slides: [withCaption],
          coverIndex: 0,
          durationSeconds: 5,
          mood: "warm",
          moodReason: "test",
          reason: "test",
        },
      ],
    }),
  );
  assert.match(htmlWithCaption, /坐在餐椅里抓着西兰花啃/);

  const playerHtml = renderToStaticMarkup(
    React.createElement(MemoryPlayer, {
      memory: {
        kind: "topic",
        key: "topic:eat",
        title: "吃饭这件事",
        subtitle: "2025 年 3 月 — 2026 年 7 月 · 当时 2 个月 — 1 岁 6 个月",
        slides: [withCaption],
        coverIndex: 0,
        durationSeconds: 5,
        mood: "warm",
        moodReason: "test",
        reason: "test",
      },
      onClose: () => {},
      returnFocusTo: { current: null },
      closeLabel: "关闭播放回忆",
    }),
  );
  assert.match(playerHtml, /坐在餐椅里抓着西兰花啃/);
  assert.match(playerHtml, /2025 年 3 月 30 日/);
  assert.match(playerHtml, /当时 2 个月/);
  assert.doesNotMatch(playerHtml, /读这一天/, "MemoryPlayer 放映器不再输出「读这一天」链接");
});

test("3.3 主题选片相关性优化：「吃饭这件事」优先选择图注或当日正文与吃饭相关的照片，降权无关活动图注", () => {
  assert.ok(
    topicTextRelevanceBonus("eat", "p-eat", {
      title: "自己吃辅食",
      paragraphs: ["握着勺子喝完了米糊。"],
      photoCaptions: { "p-eat": "端着小碗吃面条" },
    }) > 0.3,
  );
  assert.ok(
    topicTextRelevanceBonus("eat", "p-slide", {
      title: "去公园玩",
      paragraphs: ["在草地上跑了一下午。"],
      photoCaptions: { "p-slide": "在公园滑滑梯" },
    }) < 0,
  );

  // 同一天 3 张候选（每天封顶 2 张）：p-unrelated 视觉分略高但图注是滑滑梯，p-eat-1/p-eat-2 图注与正文都是吃饭
  const days = [];
  for (let d = 1; d <= 5; d += 1) {
    const dayStr = `2026-07-0${d}`;
    days.push({
      day: dayStr,
      dateLabel: dayStr,
      ageLabel: "1 岁 6 个月",
      photos: [
        mkPhoto(`unrelated-${d}`, `${dayStr} 10:00:00`),
        mkPhoto(`eatA-${d}`, `${dayStr} 12:00:00`),
        mkPhoto(`eatB-${d}`, `${dayStr} 18:00:00`),
      ],
    });
  }
  const allPhotos = days.flatMap((d) => d.photos);
  const archive = {
    time: { today: "2026-09-16" },
    birthDay: "2025-01-03",
    privilege: {
      confirmed: new Set(),
      trusted: new Set(),
      checked: new Set(allPhotos.map((p) => p.id)),
    },
    chapters: [{ year: "2026", months: [{ month: "2026-07", memories: [], photoDays: days }] }],
  };
  const byId = new Map(allPhotos.map((p) => [p.id, p]));
  const topics = (id) => {
    const isUnrelated = id.startsWith("unrelated-");
    const matches = Object.fromEntries(CAROUSEL_THEMES.map((k) => [k, k === "eat" ? (isUnrelated ? 92 : 84) : 0]));
    return {
      topic: "吃饭",
      water: false,
      value: isUnrelated ? 0.92 : 0.84,
      confidence: 0.9,
      carousel: {
        promptVersion: "home-carousel-v4",
        takenAt: byId.get(id).takenAt,
        matches,
        clarity: isUnrelated ? 92 : 85,
        expression: 85,
        qualified: true,
        eyesOpen: true,
        sleeping: false,
        childMain: true,
        faceClear: true,
        faceUnblocked: true,
        motionBlur: false,
        sensitive: false,
        approvedThemes: ["eat"],
      },
    };
  };
  const dayContext = new Map(
    days.map((d, idx) => {
      const n = idx + 1;
      return [
        d.day,
        {
          title: "自己拿勺吃饭",
          paragraphs: ["中午坐在餐椅上大口吃面条和鸡蛋。"],
          photoCaptions: {
            [`unrelated-${n}`]: "在公园草地上滑滑梯",
            [`eatA-${n}`]: "自己握着勺子吃面条",
            [`eatB-${n}`]: "端着小碗喝白粥",
          },
        },
      ];
    }),
  );

  const { memories } = selectHomeMemories(archive, topics, { dayContext });
  const eatMemory = memories.find((m) => m.key === "topic:eat");
  assert.ok(eatMemory);
  assert.equal(
    eatMemory.slides.some((s) => s.media.id.startsWith("unrelated-")),
    false,
    "明确写着滑滑梯的无关照片不应挤掉真正吃饭的照片",
  );
});

// ── 3.6 雪姨短片页与 3.7 日页缩略图优先级测试 ───────────────────────────────────────────────

test("3.6 /films/xueyi 渲染清晰「← 首页」返回入口与真实元数据简介，不伪造空字幕轨", () => {
  const html = renderToStaticMarkup(React.createElement(XueyiFilmPage));
  assert.match(html, /href="\/"/);
  assert.match(html, /← 首页/);
  assert.match(html, /2026 年 10 月/);
  assert.match(html, /当时 1 岁 9 个月/);
  assert.match(html, /6:12/);
  assert.doesNotMatch(html, /<track/);
});

test("3.7 PhotoGrid 多图日页：全部使用 thumbnail 规格，首图 eager + fetchpriority=high，其余 lazy", () => {
  const photos = Array.from({ length: 7 }, (_, i) => mkPhoto(`g-${i}`));
  const html = renderToStaticMarkup(
    React.createElement(PhotoGrid, {
      photos,
      dateLabel: "2026 年 11 月 10 日",
      ageLabel: "1 岁 10 个月",
      priority: true,
    }),
  );
  const imgTags = [...html.matchAll(/<img[^>]+>/g)].map((m) => m[0]);
  assert.equal(imgTags.length, 7);
  // 全部 7 张网格缩略图都应请求 variant=thumbnail，不再把首格塞成百 KB 的 variant=web
  for (const tag of imgTags) {
    assert.match(tag, /variant=thumbnail/);
    assert.doesNotMatch(tag, /variant=web/);
  }
  // 首图 eager + high，其余 6 张 lazy
  assert.match(imgTags[0], /loading="eager"/);
  assert.match(imgTags[0], /fetchpriority="high"/i);
  for (const tag of imgTags.slice(1)) {
    assert.match(tag, /loading="lazy"/);
  }
});
