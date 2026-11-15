import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildHomeBentoModel,
  collectPublishedDays,
  isGenuineTravelTrip,
  selectFamilyVoices,
  selectHomeHeroCover,
  selectTimeCapsules,
  selectTravelFootprint,
} from "../lib/home-bento.ts";
import {
  buildDayMemory,
  buildPrebirthMemory,
  MEMORY_MAX_SLIDES,
  MEMORY_MIN_SLIDES,
  PREBIRTH_MIN_SLIDES,
  selectHomeMemories,
} from "../lib/home-memory.ts";
import {
  CAROUSEL_PROMPT_VERSION,
  CAROUSEL_THEMES,
  prebirthCarouselQualified,
  prebirthRankScore,
  topicLookupFrom,
} from "../lib/home-memory-topics.ts";
import {
  P5_FAMILY_QUOTE_SEEDS,
  P5_HERO_SEED_CANDIDATES,
} from "../lib/p5-homepage-seeds.ts";
import { HomeMemory } from "../components/home-memory.tsx";
import {
  FamilyVoicesTile,
  GrowthHighlightTile,
  LatestDayTile,
  RecentJournalSection,
  TimeCapsuleSection,
  TravelFootprintCard,
} from "../components/home-bento-sections.tsx";

function makePhoto(id, takenAt, overrides = {}) {
  return {
    id,
    profileId: "zhang-nian",
    type: "photo",
    src: `/api/media/${id}/web`,
    thumbnailSrc: `/api/media/${id}/thumb`,
    alt: "张年的生活照",
    takenAt,
    visibility: "family",
    width: 1440,
    height: 1920,
    ...overrides,
  };
}

function makeArchive(overrides = {}) {
  const media = overrides.media ?? [];
  return {
    birthDay: "2025-01-03",
    media,
    events: [],
    traceEvents: [],
    eventIdentities: [],
    chapters: [
      {
        year: "2026",
        ageSpan: "1 岁 到 1 岁 10 个月",
        months: [
          {
            month: "2026-11",
            label: "2026 年 11 月",
            shortLabel: "11 月",
            ageLabel: "1 岁 10 个月",
            memories: [],
            traceDays: [],
            photos: [],
            photoCount: media.length,
            videoCount: 0,
            photoDays: [],
            withheldMediaCount: 0,
          },
        ],
      },
      {
        year: "2025",
        ageSpan: "出生 到 11 个月",
        months: [
          {
            month: "2025-11",
            label: "2025 年 11 月",
            shortLabel: "11 月",
            ageLabel: "10 个月",
            memories: [],
            traceDays: [],
            photos: [],
            photoCount: 2,
            videoCount: 0,
            photoDays: [],
            withheldMediaCount: 0,
          },
        ],
      },
    ],
    snapshots: [],
    privilege: {
      confirmed: new Set(media.map((m) => m.id)),
      trusted: new Set(media.map((m) => m.id)),
      checked: new Set(media.map((m) => m.id)),
      excluded: new Set(),
    },
    store: {
      profile: {
        id: "zhang-nian",
        displayName: "张年",
        birthDate: "2025-01-03",
        timezone: "Asia/Shanghai",
        bio: "",
        visibility: "family",
      },
      contributors: [],
      rawSources: [],
      events: [],
      media,
      mediaAssets: [],
      dailyTraces: [],
      monthlySnapshots: [],
      qualityReviews: [],
    },
    time: { today: "2026-11-12" },
    ...overrides,
  };
}

test("5.2 selectHomeHeroCover：按 homeHeroMediaId -> P5 核验种子 -> 近 30 天长边 ≥1080 正面非闭眼照 三级选图", () => {
  const seedPrimaryId = P5_HERO_SEED_CANDIDATES[0].mediaId;
  const explicitId = "m-explicit-hero-1111";
  const smallId = "m-small-800";
  const sleepId = "m-sleep-2000";
  const awakeId = "m-awake-1600";

  const media = [
    makePhoto(explicitId, "2026-11-11T08:00:00Z", { width: 1280, height: 1706 }),
    makePhoto(seedPrimaryId, "2026-11-09T09:00:00Z", { width: 3120, height: 4160 }),
    makePhoto(smallId, "2026-11-10T10:00:00Z", { width: 720, height: 960 }),
    makePhoto(sleepId, "2026-11-10T13:00:00Z", { width: 1600, height: 2000 }),
    makePhoto(awakeId, "2026-11-08T15:00:00Z", { width: 1600, height: 2133 }),
  ];

  const topics = (id) => {
    if (id === sleepId) {
      return {
        topic: "睡觉",
        water: false,
        value: 0.95,
        confidence: 0.95,
        carousel: {
          qualified: true,
          childMain: true,
          faceClear: true,
          faceUnblocked: true,
          eyesOpen: false,
          sleeping: true,
          clarity: 96,
          expression: 92,
          motionBlur: false,
          sensitive: false,
        },
      };
    }
    if (id === awakeId) {
      return {
        topic: "笑",
        water: false,
        value: 0.9,
        confidence: 0.9,
        carousel: {
          qualified: true,
          childMain: true,
          faceClear: true,
          faceUnblocked: true,
          eyesOpen: true,
          sleeping: false,
          clarity: 90,
          expression: 91,
          motionBlur: false,
          sensitive: false,
        },
      };
    }
    return undefined;
  };

  // 1) 当月显式设置 homeHeroMediaId 时优先命中
  const explicitCover = selectHomeHeroCover({
    archive: makeArchive({ media }),
    monthContents: [
      {
        schema: "nianlife.month-content/1",
        month: "2026-11",
        homeHeroMediaId: explicitId,
        days: [
          {
            day: "2026-11-11",
            kind: "story",
            title: "穿着红卫衣指小车",
            paragraphs: ["早起指着窗外的小汽车。"],
            photoCaptions: { [explicitId]: "举起右手望着镜头" },
            firstScreenMediaIds: [explicitId],
            expandedMediaIds: [explicitId],
          },
          {
            day: "2026-11-09",
            kind: "story",
            title: "厚棉服里的笑脸",
            paragraphs: ["穿上厚棉服准备出门。"],
            firstScreenMediaIds: [seedPrimaryId],
            expandedMediaIds: [seedPrimaryId],
          },
        ],
      },
    ],
    topics,
    today: "2026-11-12",
  });
  assert.ok(explicitCover);
  assert.equal(explicitCover.media.id, explicitId);
  assert.equal(explicitCover.day, "2026-11-11");
  assert.equal(explicitCover.dayTitle, "穿着红卫衣指小车");
  assert.equal(explicitCover.caption, "举起右手望着镜头");
  assert.equal(explicitCover.href, "/memory/2026/11/11");

  // 2) 未设 homeHeroMediaId 时命中已人工目视核验的 P5 种子（ecdc3bd2...）
  const seedCover = selectHomeHeroCover({
    archive: makeArchive({ media }),
    monthContents: [
      {
        schema: "nianlife.month-content/1",
        month: "2026-11",
        days: [
          {
            day: "2026-11-09",
            kind: "story",
            title: "厚棉服里的笑脸",
            paragraphs: ["穿上厚棉服准备出门。"],
            firstScreenMediaIds: [seedPrimaryId],
            expandedMediaIds: [seedPrimaryId],
          },
        ],
      },
    ],
    topics,
    today: "2026-11-12",
  });
  assert.ok(seedCover);
  assert.equal(seedCover.media.id, seedPrimaryId);
  assert.equal(seedCover.day, "2026-11-09");
  assert.equal(seedCover.href, "/memory/2026/11/09");

  // 3) 无种子且未设 homeHeroMediaId 时：排除长边 <1080 与闭眼/睡觉图，选中近 30 天清晰正脸照
  const fallbackMedia = media.filter((m) => m.id !== seedPrimaryId && m.id !== explicitId);
  const fallbackCover = selectHomeHeroCover({
    archive: makeArchive({ media: fallbackMedia }),
    monthContents: [
      {
        schema: "nianlife.month-content/1",
        month: "2026-11",
        days: [
          {
            day: "2026-11-10",
            kind: "story",
            title: "午睡沉沉",
            paragraphs: ["午后在被窝里睡着了。"],
            firstScreenMediaIds: [smallId, sleepId],
            expandedMediaIds: [smallId, sleepId],
          },
          {
            day: "2026-11-08",
            kind: "story",
            title: "草坪迎风大笑",
            paragraphs: ["在草坪上仰头笑起来。"],
            firstScreenMediaIds: [awakeId],
            expandedMediaIds: [awakeId],
          },
        ],
      },
    ],
    topics,
    today: "2026-11-12",
  });
  assert.ok(fallbackCover);
  assert.equal(fallbackCover.media.id, awakeId);
  assert.equal(fallbackCover.day, "2026-11-08");
});

test("5.2 & 5.3 selectHomeMemories + HomeMemory：首段永不把「睡着的样子」置顶，主按钮显示「播放回忆 · <主题名>」", () => {
  const sleepDays = Array.from({ length: 12 }, (_, idx) => {
    const n = idx + 1;
    const day = `2026-10-${String(n).padStart(2, "0")}`;
    const p = makePhoto(`m-sleep-${n}`, `${day}T13:00:00Z`);
    return { day, dateLabel: day, ageLabel: "1 岁 9 个月", photos: [p] };
  });
  const eatDays = Array.from({ length: 12 }, (_, idx) => {
    const n = idx + 1;
    const day = `2026-09-${String(n).padStart(2, "0")}`;
    const p = makePhoto(`m-eat-${n}`, `${day}T12:00:00Z`);
    return { day, dateLabel: day, ageLabel: "1 岁 8 个月", photos: [p] };
  });
  const allMedia = [...sleepDays, ...eatDays].flatMap((d) => d.photos);
  const archive = makeArchive({
    media: allMedia,
    chapters: [
      {
        year: "2026",
        ageSpan: "1 岁 到 1 岁 10 个月",
        months: [
          {
            month: "2026-10",
            label: "2026 年 10 月",
            shortLabel: "10 月",
            ageLabel: "1 岁 9 个月",
            memories: [],
            traceDays: [],
            photos: sleepDays.flatMap((d) => d.photos),
            photoCount: 6,
            videoCount: 0,
            photoDays: sleepDays,
            withheldMediaCount: 0,
          },
          {
            month: "2026-09",
            label: "2026 年 9 月",
            shortLabel: "9 月",
            ageLabel: "1 岁 8 个月",
            memories: [],
            traceDays: [],
            photos: eatDays.flatMap((d) => d.photos),
            photoCount: 6,
            videoCount: 0,
            photoDays: eatDays,
            withheldMediaCount: 0,
          },
        ],
      },
    ],
  });
  const mediaById = new Map(allMedia.map((m) => [m.id, m]));

  const topics = (id) => {
    const isSleep = id.startsWith("m-sleep-");
    const isEat = id.startsWith("m-eat-");
    if (!isSleep && !isEat) return undefined;
    const matches = Object.fromEntries(CAROUSEL_THEMES.map((k) => [k, 0]));
    if (isSleep) matches.sleep = 95;
    if (isEat) matches.eat = 90;
    return {
      topic: isSleep ? "睡觉" : "吃饭",
      water: false,
      childInFrame: true,
      value: isSleep ? 0.95 : 0.88,
      confidence: 0.95,
      carousel: {
        promptVersion: "home-carousel-v4",
        takenAt: mediaById.get(id).takenAt,
        matches,
        clarity: 92,
        expression: 90,
        qualified: true,
        eyesOpen: !isSleep,
        sleeping: isSleep,
        childMain: true,
        faceClear: true,
        faceUnblocked: true,
        motionBlur: false,
        sensitive: false,
        approvedThemes: [...CAROUSEL_THEMES],
      },
    };
  };

  const { memories } = selectHomeMemories(archive, topics);
  assert.ok(memories.length >= 2);
  assert.notEqual(memories[0].key, "topic:sleep", "首段回忆不得是闭眼睡眠主题");
  assert.equal(memories[0].key, "topic:eat");
  assert.ok(memories.some((m) => m.key === "topic:sleep"), "换一段仍保留睡着的样子");

  const heroCover = {
    media: {
      id: "m-hero-1109",
      type: "photo",
      src: "/api/media/m-hero-1109/web",
      thumbnailSrc: "/api/media/m-hero-1109/thumb",
      alt: "张年穿着红卫衣看镜头",
      width: 1440,
      height: 1920,
    },
    day: "2026-11-09",
    dateLabel: "2026 年 11 月 9 日",
    ageLabel: "1 岁 10 个月",
    dayTitle: "穿着红卫衣去公园",
    caption: "睁大眼睛望着镜头",
    href: "/memory/2026/11/09",
    linkLabel: "读这一天",
  };

  const html = renderToStaticMarkup(
    React.createElement(HomeMemory, { memories, heroCover }),
  );
  assert.match(html, /class="memory-play-cta"/);
  assert.match(html, /播放回忆 · 吃饭这件事/);
  assert.doesNotMatch(html, /class="memory-play"/, "首页不再使用右下角无字小圆按钮");
  assert.match(html, /穿着红卫衣去公园/);
  assert.match(html, /睁大眼睛望着镜头/);
  assert.doesNotMatch(html, /class="memory-read"/, "首页不再渲染「读这一天」胶囊");
  assert.doesNotMatch(html, /读这一天/);
  assert.match(html, /换一段/);

  // 行程详情页（trip: 前缀）保持原有小圆按钮与行程封面，不受首页 heroCover 影响
  const tripMemory = {
    ...memories[0],
    key: "trip:2025-12-sichuan",
    title: "四川跨年之旅",
  };
  const tripHtml = renderToStaticMarkup(
    React.createElement(HomeMemory, { memories: [tripMemory], heroCover }),
  );
  assert.match(tripHtml, /class="memory-play"/);
  assert.doesNotMatch(tripHtml, /class="memory-play-cta"/);
});

test("5.4 selectFamilyVoices：严格只读 featuredQuote 与 P5 核验种子，绝不抓正文请假后勤话", () => {
  assert.equal(P5_FAMILY_QUOTE_SEEDS.length, 24);
  for (const seed of P5_FAMILY_QUOTE_SEEDS) {
    assert.doesNotMatch(seed.text, /迟一点|请假|接送/);
    assert.ok(seed.sourceId.startsWith("wechat-message:"));
  }

  // 空档案（既无已发布日也无对应 rawSources）返回空数组，FamilyVoicesTile 整卡隐藏
  const emptyArchive = makeArchive({ chapters: [] });
  const emptyVoices = selectFamilyVoices(emptyArchive, [], "2026-11-12", 3);
  assert.deepEqual(emptyVoices, []);
  assert.equal(
    renderToStaticMarkup(React.createElement(FamilyVoicesTile, { voices: emptyVoices })),
    "",
  );

  // 当档案中存在对应日期与未设 featuredQuote 的请假后勤日时：种子正常点亮，后勤话绝不入选
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      days: [
        {
          day: "2026-11-11",
          kind: "story",
          title: "自己指着书架挑故事",
          paragraphs: ["晚饭后自己指着书架挑故事书。"],
          featuredQuote: {
            text: "小年现在睡前非要自己挑两本绘本才肯躺下。",
            speaker: "爸爸",
            sourceId: "wechat-message:test-1111",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-03",
          kind: "story",
          title: "清早补觉晚到",
          paragraphs: [
            "妈妈在群里说：「昨晚半夜不睡觉现在还在睡，今天迟一点」，外婆也说：「下午早点去接他回来」。",
          ],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-10",
      days: [
        {
          day: "2026-10-22",
          kind: "story",
          title: "捧着小碗找点心",
          paragraphs: ["吃完晚饭还探头看桌上的水果。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-07",
      days: [
        {
          day: "2026-07-14",
          kind: "story",
          title: "自己拎着小鞋去泡澡",
          paragraphs: ["听到泡澡就自己拎起两只小鞋。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
      ],
    },
  ];
  const archive = makeArchive();
  const days = collectPublishedDays(archive, monthContents, "2026-11-12");
  const voices = selectFamilyVoices(archive, days, "2026-11-12", 4, { monthContents });

  assert.equal(voices.length, 3);
  assert.equal(voices.some((v) => v.quote.includes("自己挑两本绘本")), true);
  assert.equal(voices.some((v) => v.quote.includes("总是担心没吃的")), true);
  assert.equal(voices.some((v) => v.quote.includes("两只鞋子一拿")), true);
  assert.equal(voices.some((v) => v.quote.includes("迟一点")), false);
  assert.equal(voices.some((v) => v.quote.includes("早点去接")), false);
});

test("5.6 & 5.7 近月成长链接当月月页、旅行足迹只统计真正的旅行（排除回老家与常住记录）、不包含那年今天/去年今日且全页零隐藏路由链接", () => {
  assert.equal(
    isGenuineTravelTrip({
      id: "2026-10-wenzhou",
      title: "国庆回温州外婆家",
      kind: "hometown",
      from: "2026-10-01",
      to: "2026-10-04",
      placeIds: ["cn-zj-wenzhou"],
      summary: "回温州看外公外婆。",
      evidence: ["2026-10-01"],
    }),
    false,
  );
  assert.equal(
    isGenuineTravelTrip({
      id: "stay-2025-03-15-cn-zj-wenzhou",
      title: "住在温州的日子",
      kind: "travel",
      from: "2025-03-15",
      to: "2025-04-20",
      placeIds: ["cn-zj-wenzhou"],
      summary: "这段时间住在温州。",
      evidence: ["livedIn"],
    }),
    false,
  );
  assert.equal(
    isGenuineTravelTrip({
      id: "record-2026-08-01-cn-shanghai",
      title: "抵达上海",
      kind: "travel",
      from: "2026-08-01",
      to: "2026-08-01",
      placeIds: ["cn-shanghai"],
      recordOnly: true,
      summary: "抵达上海。",
      evidence: ["2026-08-01"],
    }),
    false,
  );

  const footprint = selectTravelFootprint("2025-01-03", [], "2026-11-12");
  assert.equal(footprint.countryCount, 2);
  assert.equal(footprint.cityCount, 11);
  assert.equal(
    footprint.cities.some((c) => c.name.includes("温州") || c.name.includes("西安")),
    false,
    "回老家（温州/西安）与常住记录不得混入旅行足迹卡片",
  );
  assert.notEqual(footprint.latestTrip?.kind, "hometown");

  const media = [
    makePhoto("m-1110", "2026-11-10T10:00:00Z"),
    makePhoto("m-1108", "2026-11-08T10:00:00Z"),
    makePhoto("m-1106", "2026-11-06T10:00:00Z"),
    makePhoto("m-1104", "2026-11-04T10:00:00Z"),
    makePhoto("m-2605", "2026-05-15T10:00:00Z"),
    makePhoto("m-2601", "2026-01-03T10:00:00Z"),
    makePhoto("m-2511", "2025-11-12T10:00:00Z"),
  ];
  const archive = makeArchive({ media });
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      intro: "十一月小年爱上自己翻看绘本，在公园里跑得越来越稳。",
      days: [
        {
          day: "2026-11-10",
          kind: "story",
          title: "草坪追泡泡",
          paragraphs: ["下午在草坪上追泡泡。"],
          featuredQuote: {
            text: "慢点跑，泡泡还在前面等你呢。",
            speaker: "妈妈",
            sourceId: "src-1110",
          },
          firstScreenMediaIds: ["m-1110"],
          expandedMediaIds: ["m-1110"],
        },
        {
          day: "2026-11-08",
          kind: "story",
          title: "书架前挑绘本",
          paragraphs: ["晚饭后去书架前挑绘本。"],
          firstScreenMediaIds: ["m-1108"],
          expandedMediaIds: ["m-1108"],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "阳台看麻雀",
          paragraphs: ["指着窗外树梢上的麻雀。"],
          firstScreenMediaIds: ["m-1106"],
          expandedMediaIds: ["m-1106"],
        },
        {
          day: "2026-11-04",
          kind: "story",
          title: "骑小车绕客厅",
          paragraphs: ["骑着小车绕客厅一圈。"],
          firstScreenMediaIds: ["m-1104"],
          expandedMediaIds: ["m-1104"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-05",
      days: [
        {
          day: "2026-05-15",
          kind: "story",
          title: "五月林荫散步",
          paragraphs: ["扶着推车慢慢走。"],
          firstScreenMediaIds: ["m-2605"],
          expandedMediaIds: ["m-2605"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-01",
      days: [
        {
          day: "2026-01-03",
          kind: "story",
          title: "一周岁抓周",
          paragraphs: ["抓起了小画册。"],
          firstScreenMediaIds: ["m-2601"],
          expandedMediaIds: ["m-2601"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2025-11",
      days: [
        {
          day: "2025-11-12",
          kind: "story",
          title: "松手迈出第一步",
          paragraphs: ["在沙发边松开手迈出第一步。"],
          firstScreenMediaIds: ["m-2511"],
          expandedMediaIds: ["m-2511"],
        },
      ],
    },
  ];

  const model = buildHomeBentoModel({
    archive,
    monthContents,
    today: "2026-11-12",
  });

  assert.equal(model.growth?.href, "/memory/2026/11");
  assert.equal("onThisDay" in model, false, "首页模型不包含那年今天/去年今日");

  const combinedMarkup = [
    model.latestDay ? renderToStaticMarkup(React.createElement(LatestDayTile, { card: model.latestDay })) : "",
    model.growth ? renderToStaticMarkup(React.createElement(GrowthHighlightTile, { growth: model.growth })) : "",
    renderToStaticMarkup(React.createElement(FamilyVoicesTile, { voices: model.voices })),
    renderToStaticMarkup(
      React.createElement(RecentJournalSection, {
        days: model.journal.days,
        latestMonthHref: model.journal.latestMonthHref,
        latestMonthLabel: model.journal.latestMonthLabel,
      }),
    ),
    renderToStaticMarkup(React.createElement(TimeCapsuleSection, { capsules: model.capsules })),
    renderToStaticMarkup(React.createElement(TravelFootprintCard, { footprint: model.travel })),
  ].join("\n");

  assert.doesNotMatch(combinedMarkup, /那年今天|去年今日|otd-card/);
  assert.doesNotMatch(
    combinedMarkup,
    /href="[^"]*(?:\/memory\/growth|\/memory\/people|\/health)(?:["/?#])/,
    "首页任何模块不得包含指向已下线栏目的链接",
  );
});

function makeCarouselLabel(takenAt, matchOverrides = {}, extra = {}) {
  const matches = Object.fromEntries(CAROUSEL_THEMES.map((k) => [k, 0]));
  for (const [k, v] of Object.entries(matchOverrides)) {
    matches[k] = v;
  }
  const clarity = extra.clarity ?? 92;
  const expression = extra.expression ?? 90;
  const approvedThemes = extra.approvedThemes ?? [...CAROUSEL_THEMES];
  const sleeping = Boolean(extra.sleeping);
  const eyesOpen = extra.eyesOpen ?? !sleeping;
  return {
    topic: extra.topic ?? "笑",
    water: Boolean(matches.water >= 80),
    childInFrame: true,
    value: extra.value ?? 0.9,
    confidence: 0.95,
    carousel: {
      promptVersion: "home-carousel-v4",
      takenAt,
      matches,
      clarity,
      expression,
      qualified: true,
      eyesOpen,
      sleeping,
      childMain: true,
      faceClear: true,
      faceUnblocked: true,
      motionBlur: false,
      sensitive: false,
      approvedThemes,
    },
  };
}

test("5.2 selectHomeMemories：不传 rotationSlot 保持基线；传 rotationSlot 轮换清醒主题、跨主题优先权与近期 day 回忆且永不置顶睡着", () => {
  const buildTopicDays = (prefix, month, count, startDay = 1) =>
    Array.from({ length: count }, (_, idx) => {
      const dayNum = startDay + idx;
      const day = `${month}-${String(dayNum).padStart(2, "0")}`;
      const p = makePhoto(`${prefix}-${dayNum}`, `${day}T10:00:00Z`);
      return { day, dateLabel: `${day}`, ageLabel: "1 岁 8 个月", photos: [p] };
    });

  // 各主题独立素材（8 天各 1 张）+ 跨主题共享素材（8 天各 1 张，同时合格 laugh / eat / water）
  const laughDays = buildTopicDays("laugh", "2026-06", 8, 1);
  const eatDays = buildTopicDays("eat", "2026-06", 8, 11);
  const waterDays = buildTopicDays("water", "2026-07", 8, 1);
  const outdoorDays = buildTopicDays("outdoor", "2026-07", 8, 11);
  const sleepDays = buildTopicDays("sleep", "2026-08", 8, 1);
  const sharedDays = buildTopicDays("shared", "2026-08", 8, 11);
  const summerSeasonDays = buildTopicDays("summer", "2026-08", 8, 21);

  // 2026-11 三个已发布日：11-10（10张）、11-08（10张）丰富日 + 11-06（6张 < MEMORY_MIN_SLIDES）
  const novDays = [
    {
      day: "2026-11-10",
      dateLabel: "2026 年 11 月 10 日",
      ageLabel: "1 岁 10 个月",
      photos: Array.from({ length: 10 }, (_, i) =>
        makePhoto(`nov10-${i}`, `2026-11-10T${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}:00Z`),
      ),
    },
    {
      day: "2026-11-08",
      dateLabel: "2026 年 11 月 8 日",
      ageLabel: "1 岁 10 个月",
      photos: Array.from({ length: 10 }, (_, i) =>
        makePhoto(`nov08-${i}`, `2026-11-08T${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "30"}:00Z`),
      ),
    },
    {
      day: "2026-11-06",
      dateLabel: "2026 年 11 月 6 日",
      ageLabel: "1 岁 10 个月",
      photos: Array.from({ length: 6 }, (_, i) =>
        makePhoto(`nov06-${i}`, `2026-11-06T${String(9 + i).padStart(2, "0")}:00:00Z`),
      ),
    },
  ];

  const allDays = [
    ...laughDays,
    ...eatDays,
    ...waterDays,
    ...outdoorDays,
    ...sleepDays,
    ...sharedDays,
    ...summerSeasonDays,
    ...novDays,
  ];
  const byMonth = new Map();
  for (const d of allDays) {
    const m = d.day.slice(0, 7);
    byMonth.set(m, [...(byMonth.get(m) ?? []), d]);
  }
  const allMedia = allDays.flatMap((d) => d.photos);
  const byId = new Map(allMedia.map((p) => [p.id, p]));

  const archive = makeArchive({
    media: allMedia,
    chapters: [
      {
        year: "2026",
        ageSpan: "1 岁 到 1 岁 10 个月",
        months: [...byMonth.entries()].map(([month, photoDays]) => ({
          month,
          label: month,
          shortLabel: month,
          ageLabel: "1 岁 10 个月",
          memories: [],
          traceDays: [],
          photos: photoDays.flatMap((d) => d.photos),
          photoCount: photoDays.reduce((sum, d) => sum + d.photos.length, 0),
          videoCount: 0,
          photoDays,
          withheldMediaCount: 0,
        })),
      },
    ],
  });

  const topics = (id) => {
    const takenAt = byId.get(id)?.takenAt;
    if (!takenAt) return undefined;
    if (id.startsWith("laugh-")) return makeCarouselLabel(takenAt, { laugh: 92 });
    if (id.startsWith("eat-")) return makeCarouselLabel(takenAt, { eat: 92 }, { topic: "吃饭" });
    if (id.startsWith("water-")) return makeCarouselLabel(takenAt, { water: 92 }, { topic: "玩水" });
    if (id.startsWith("outdoor-")) return makeCarouselLabel(takenAt, { outdoor: 92 }, { topic: "户外" });
    if (id.startsWith("sleep-")) return makeCarouselLabel(takenAt, { sleep: 96 }, { topic: "睡觉", sleeping: true, clarity: 96, expression: 95 });
    if (id.startsWith("shared-")) return makeCarouselLabel(takenAt, { laugh: 92, eat: 92, water: 92 });
    if (id.startsWith("summer-")) return makeCarouselLabel(takenAt, { summer: 92 }, { topic: "其他" });
    return undefined;
  };

  const dayContext = new Map([
    ["2026-11-10", { title: "草坪追泡泡", paragraphs: ["下午在草坪上追泡泡。"] }],
    ["2026-11-08", { title: "客厅开小汽车", paragraphs: ["骑着小车绕客厅。"] }],
    ["2026-11-06", { title: "阳台看麻雀", paragraphs: ["看着树梢上的麻雀。"] }],
  ]);

  // 1) 缺省或显式传入 rotationSlot: undefined 时 100% 保持基线
  const baselineOmitted = selectHomeMemories(archive, topics, { dayContext });
  const baselineUndefined = selectHomeMemories(archive, topics, { dayContext, rotationSlot: undefined });
  assert.deepEqual(baselineUndefined, baselineOmitted);
  assert.equal(baselineOmitted.memories.some((m) => m.kind === "day"), false, "基线不混入 day 主题");
  const baselineWater = baselineOmitted.memories.find((m) => m.key === "topic:water");
  assert.ok(baselineWater?.slides.some((s) => s.media.id.startsWith("shared-")), "基线按 TOPIC_THEMES 先建 water，跨主题照片归 water");

  // 2) 传入不同 rotationSlot：轮换清醒主题顺序与跨主题优先权，topic:sleep 留在末尾且绝不置顶
  const leadKeys = [];
  for (const slot of [0, 1, 2, 3]) {
    const res = selectHomeMemories(archive, topics, { dayContext, rotationSlot: slot });
    assert.ok(res.memories.length > 0);
    assert.notEqual(res.memories[0].key, "topic:sleep", `slot=${slot} 首段绝不能是睡眠主题`);
    leadKeys.push(res.memories[0].key);

    const topicMemories = res.memories.filter((m) => m.kind === "topic");
    assert.equal(topicMemories.at(-1)?.key, "topic:sleep", `slot=${slot} 睡眠主题保持在 topic 末尾`);

    const dayMemories = res.memories.filter((m) => m.kind === "day");
    assert.deepEqual(
      dayMemories.map((m) => m.key),
      ["day:2026-11-10", "day:2026-11-08"],
      `slot=${slot} 应引入最近 2 个满足 >= MEMORY_MIN_SLIDES 场景的已发布日并跳过不足 8 场景的 11-06`,
    );
    assert.equal(dayMemories[0].title, "草坪追泡泡");
    assert.equal(dayMemories[0].href, "/memory/2026/11/10");

    // 全段跨主题/季节/日页照片零重复
    const allIds = res.memories.flatMap((m) => m.slides.map((s) => s.media.id));
    assert.equal(new Set(allIds).size, allIds.length, `slot=${slot} 跨段不得出现重复照片`);
  }
  assert.deepEqual(leadKeys, ["topic:laugh", "topic:eat", "topic:water", "topic:outdoor"]);

  // 跨主题优先权：slot=0 时笑先拿 shared-*；slot=1 时吃饭先拿 shared-*
  const slot0Laugh = selectHomeMemories(archive, topics, { dayContext, rotationSlot: 0 }).memories.find((m) => m.key === "topic:laugh");
  const slot1Eat = selectHomeMemories(archive, topics, { dayContext, rotationSlot: 1 }).memories.find((m) => m.key === "topic:eat");
  assert.ok(slot0Laugh?.slides.some((s) => s.media.id.startsWith("shared-")));
  assert.ok(slot1Eat?.slides.some((s) => s.media.id.startsWith("shared-")));

  // 3) 仅剩 topic:sleep + 季节/日页（无任何清醒 topic）时，首段仍绝不放 topic:sleep
  const sleepAndSeasonOnly = allDays.filter((d) => d.day.startsWith("2026-08"));
  const sleepOnlyMedia = sleepAndSeasonOnly.flatMap((d) => d.photos);
  const sleepOnlyArchive = makeArchive({
    media: sleepOnlyMedia,
    chapters: [
      {
        year: "2026",
        ageSpan: "1 岁 到 1 岁 10 个月",
        months: [
          {
            month: "2026-08",
            label: "2026 年 8 月",
            shortLabel: "8 月",
            ageLabel: "1 岁 7 个月",
            memories: [],
            traceDays: [],
            photos: sleepOnlyMedia,
            photoCount: sleepOnlyMedia.length,
            videoCount: 0,
            photoDays: sleepAndSeasonOnly,
            withheldMediaCount: 0,
          },
        ],
      },
    ],
  });
  for (const slot of [0, 1, 2]) {
    const res = selectHomeMemories(sleepOnlyArchive, topics, { rotationSlot: slot });
    assert.ok(res.memories.length >= 2);
    assert.notEqual(res.memories[0].key, "topic:sleep", `无清醒 topic 时 slot=${slot} 首段仍不得是 topic:sleep`);
    assert.ok(res.memories.some((m) => m.key === "topic:sleep"));
  }
});

test("5.2 pickSlides 与 coverIndexOf：候选富余时按 rotationSlot 轮换时间桶选片与最近 40% 窗口封面", () => {
  // 1) 幻灯片轮换：14 天 × 每天 2 张 = 28 张（> MEMORY_MAX_SLIDES=20），每桶两张差值 0.04 <= 0.08；
  //    再混入同桶低分候选（差值 0.17 > 0.08），验证仅在 0.08 容差内轮换且不选低分图。
  const days = Array.from({ length: 14 }, (_, idx) => {
    const day = `2026-07-${String(idx + 1).padStart(2, "0")}`;
    return {
      day,
      dateLabel: day,
      ageLabel: "1 岁 6 个月",
      photos: [
        makePhoto(`a-${idx}`, `${day}T09:00:00Z`),
        makePhoto(`b-${idx}`, `${day}T15:00:00Z`),
      ],
    };
  });
  const surplusMedia = days.flatMap((d) => d.photos);
  const surplusById = new Map(surplusMedia.map((p) => [p.id, p]));
  const surplusArchive = makeArchive({
    media: surplusMedia,
    chapters: [
      {
        year: "2026",
        ageSpan: "1 岁 6 个月",
        months: [
          {
            month: "2026-07",
            label: "2026 年 7 月",
            shortLabel: "7 月",
            ageLabel: "1 岁 6 个月",
            memories: [],
            traceDays: [],
            photos: surplusMedia,
            photoCount: surplusMedia.length,
            videoCount: 0,
            photoDays: days,
            withheldMediaCount: 0,
          },
        ],
      },
    ],
  });

  const slideTopics = (id) => {
    const takenAt = surplusById.get(id)?.takenAt;
    if (!takenAt) return undefined;
    const isB = id.startsWith("b-");
    // a-*: value = 0.94; b-*: value = 0.90 (within 0.08), except b-0 = 0.77 (> 0.08 below 0.94)
    if (id === "b-0") {
      return makeCarouselLabel(takenAt, { laugh: 80 }, { clarity: 80, expression: 60, value: 0.77 });
    }
    const score = isB ? 90 : 94;
    return makeCarouselLabel(takenAt, { laugh: score }, { clarity: score, expression: score, value: score / 100 });
  };

  const slot0Laugh = selectHomeMemories(surplusArchive, slideTopics, { rotationSlot: 0 }).memories.find((m) => m.key === "topic:laugh");
  const slot1Laugh = selectHomeMemories(surplusArchive, slideTopics, { rotationSlot: 1 }).memories.find((m) => m.key === "topic:laugh");
  assert.ok(slot0Laugh && slot1Laugh);
  assert.equal(slot0Laugh.slides.length, MEMORY_MAX_SLIDES);
  assert.equal(slot1Laugh.slides.length, MEMORY_MAX_SLIDES);
  const slot0Ids = slot0Laugh.slides.map((s) => s.media.id);
  const slot1Ids = slot1Laugh.slides.map((s) => s.media.id);
  assert.notDeepEqual(slot0Ids, slot1Ids, "存在 0.08 容差内富余候选时，不同 rotationSlot 应轮换选片");
  assert.equal(slot0Ids.includes("b-0"), false);
  assert.equal(slot1Ids.includes("b-0"), false, "低分（>0.08 差距）候选不得被轮换进来");

  // 2) 封面轮换：10 天 × 1 张（<= MEMORY_MAX_SLIDES，幻灯片固定），最近 40% 窗口（下标 6..9）取前 3 高分轮换，
  //    前 60%（下标 0）即使满分 1.00 也绝不当封面。
  const coverDays = Array.from({ length: 10 }, (_, idx) => {
    const day = `2026-07-${String(idx + 1).padStart(2, "0")}`;
    return { day, dateLabel: day, ageLabel: "1 岁 6 个月", photos: [makePhoto(`c-${idx}`, `${day}T10:00:00Z`)] };
  });
  const coverMedia = coverDays.flatMap((d) => d.photos);
  const coverById = new Map(coverMedia.map((p) => [p.id, p]));
  const coverArchive = makeArchive({
    media: coverMedia,
    chapters: [
      {
        year: "2026",
        ageSpan: "1 岁 6 个月",
        months: [
          {
            month: "2026-07",
            label: "2026 年 7 月",
            shortLabel: "7 月",
            ageLabel: "1 岁 6 个月",
            memories: [],
            traceDays: [],
            photos: coverMedia,
            photoCount: coverMedia.length,
            videoCount: 0,
            photoDays: coverDays,
            withheldMediaCount: 0,
          },
        ],
      },
    ],
  });
  const scoreMap = {
    "c-0": 100,
    "c-1": 85,
    "c-2": 85,
    "c-3": 85,
    "c-4": 85,
    "c-5": 85,
    "c-6": 96,
    "c-7": 94,
    "c-8": 92,
    "c-9": 84,
  };
  const coverTopics = (id) => {
    const takenAt = coverById.get(id)?.takenAt;
    const s = scoreMap[id];
    if (!takenAt || !s) return undefined;
    return makeCarouselLabel(takenAt, { laugh: s }, { clarity: s, expression: s, value: s / 100 });
  };

  const covers = [0, 1, 2, 3].map((slot) => {
    const laugh = selectHomeMemories(coverArchive, coverTopics, { rotationSlot: slot }).memories.find((m) => m.key === "topic:laugh");
    assert.ok(laugh);
    assert.ok(laugh.coverIndex >= Math.ceil(laugh.slides.length * 0.6), `slot=${slot} 封面必须落在后 40% 窗口`);
    return laugh.slides[laugh.coverIndex].media.id;
  });
  assert.deepEqual(covers, ["c-6", "c-7", "c-8", "c-6"], "封面应在后 40% 窗口的 top 3 中按 rotationSlot 取模轮换");

  // 也验证单日 day memory（buildDayMemory）在富余候选时随 rotationSlot 轮换选片与封面
  const dayPhotos = Array.from({ length: 24 }, (_, i) =>
    makePhoto(`d-${i}`, `2026-11-10T${String(8 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 === 0 ? "00" : "25"}:00Z`),
  );
  const dayTopics = (id) => {
    const n = Number(id.split("-")[1]);
    return { topic: n % 2 === 0 ? "笑" : "玩玩具", water: false, value: n % 2 === 0 ? 0.94 : 0.9, confidence: 0.9 };
  };
  const dayPublished = [
    {
      id: "ev-1110",
      title: "草坪追泡泡",
      weight: "memory",
      signature: { day: "2026-11-10", dateLabel: "2026 年 11 月 10 日", ageLabel: "1 岁 10 个月" },
      noPhoto: false,
      photoCount: dayPhotos.length,
      videoCount: 0,
    },
  ];
  const day0 = buildDayMemory({
    day: "2026-11-10",
    dateLabel: "2026 年 11 月 10 日",
    photos: dayPhotos,
    published: dayPublished,
    privilege: { checked: new Set(dayPhotos.map((p) => p.id)), confirmed: new Set(), trusted: new Set() },
    topics: dayTopics,
    rotationSlot: 0,
  });
  const day1 = buildDayMemory({
    day: "2026-11-10",
    dateLabel: "2026 年 11 月 10 日",
    photos: dayPhotos,
    published: dayPublished,
    privilege: { checked: new Set(dayPhotos.map((p) => p.id)), confirmed: new Set(), trusted: new Set() },
    topics: dayTopics,
    rotationSlot: 1,
  });
  assert.ok(day0 && day1);
  assert.equal(day0.slides.length, MEMORY_MAX_SLIDES);
  assert.equal(day1.slides.length, MEMORY_MAX_SLIDES);
  assert.notDeepEqual(day0.slides.map((s) => s.media.id), day1.slides.map((s) => s.media.id));
  assert.notEqual(day0.slides[day0.coverIndex].media.id, day1.slides[day1.coverIndex].media.id);
});

test("5.4 home-memory-topics：既有 v4 标注无 prebirth 字段仍有效，prebirthCarouselQualified 严格卡控出生前门槛", () => {
  const legacyV4 = makeCarouselLabel("2025-08-01T10:00:00+08:00", { laugh: 90 }).carousel;
  const approvedPrebirth = {
    ...makeCarouselLabel("2024-09-12T10:00:00+08:00", {}, { clarity: 90, expression: 85 }).carousel,
    childMain: false,
    faceClear: false,
    eyesOpen: false,
    prebirth: 92,
    prebirthApproved: true,
    sceneKey: "nursery-prep",
  };
  const invalidScore = {
    ...approvedPrebirth,
    prebirth: 105,
  };
  const invalidFlag = {
    ...approvedPrebirth,
    prebirthApproved: "yes",
  };

  const lookup = topicLookupFrom({
    version: 1,
    model: "deepseek-chat",
    promptVersion: CAROUSEL_PROMPT_VERSION,
    assessedAt: "2026-11-15T00:00:00Z",
    scope: "test",
    topics: {
      "v4-legacy": { topic: "笑", water: false, value: 0.9, confidence: 0.95, carousel: legacyV4 },
      "pb-good": { topic: "其他", water: false, value: 0.7, confidence: 0.9, carousel: approvedPrebirth },
      "pb-bad-score": { topic: "其他", water: false, value: 0.7, confidence: 0.9, carousel: invalidScore },
      "pb-bad-flag": { topic: "其他", water: false, value: 0.7, confidence: 0.9, carousel: invalidFlag },
    },
  });

  assert.equal(CAROUSEL_THEMES.length, 11);
  assert.equal(CAROUSEL_PROMPT_VERSION, "home-carousel-v4");
  assert.ok(lookup("v4-legacy")?.carousel, "existing v4 labels without prebirth remain valid");
  assert.equal(prebirthRankScore(lookup("v4-legacy")), 0);
  assert.ok(lookup("pb-good")?.carousel);
  assert.equal(lookup("pb-good")?.carousel?.prebirth, 92);
  assert.equal(lookup("pb-good")?.carousel?.prebirthApproved, true);
  assert.equal(lookup("pb-bad-score")?.carousel, undefined);
  assert.equal(lookup("pb-bad-flag")?.carousel, undefined);

  const birthDay = "2025-01-03";
  assert.equal(prebirthCarouselQualified(lookup("pb-good"), "2024-09-12T10:00:00+08:00", birthDay), true);
  assert.equal(prebirthCarouselQualified(lookup("pb-good"), "2025-01-03T10:00:00+08:00", birthDay), false);
  assert.equal(prebirthCarouselQualified(lookup("pb-good"), "", birthDay), false);
  assert.ok(prebirthRankScore(lookup("pb-good")) > 0.85);

  const rejectedChildMain = {
    ...lookup("pb-good"),
    carousel: { ...approvedPrebirth, childMain: true },
  };
  const rejectedLowScore = {
    ...lookup("pb-good"),
    carousel: { ...approvedPrebirth, prebirth: 79 },
  };
  const rejectedUnapproved = {
    ...lookup("pb-good"),
    carousel: { ...approvedPrebirth, prebirthApproved: false },
  };
  const rejectedBlur = {
    ...lookup("pb-good"),
    carousel: { ...approvedPrebirth, motionBlur: true },
  };
  assert.equal(prebirthCarouselQualified(rejectedChildMain, "2024-09-12T10:00:00+08:00", birthDay), false);
  assert.equal(prebirthCarouselQualified(rejectedLowScore, "2024-09-12T10:00:00+08:00", birthDay), false);
  assert.equal(prebirthCarouselQualified(rejectedUnapproved, "2024-09-12T10:00:00+08:00", birthDay), false);
  assert.equal(prebirthCarouselQualified(rejectedBlur, "2024-09-12T10:00:00+08:00", birthDay), false);
});

test("5.5 buildPrebirthMemory & selectHomeMemories：2024 出生前照片按月均衡、正序带图注生成「等待你的日子」，且绝不漏入出生后主题/季节", () => {
  const birthDay = "2025-01-03";
  const labelMap = new Map();
  const captions = new Map();
  const prebirthMedia = [];

  const addPrebirth = (id, takenAt, prebirthScore, extraCarousel = {}, caption = undefined) => {
    prebirthMedia.push(makePhoto(id, takenAt));
    const base = makeCarouselLabel(takenAt, {}, { clarity: 90, expression: 85 }).carousel;
    labelMap.set(id, {
      topic: "其他",
      water: false,
      childInFrame: false,
      value: 0.7,
      confidence: 0.9,
      carousel: {
        ...base,
        childMain: false,
        faceClear: false,
        eyesOpen: false,
        approvedThemes: [],
        prebirth: prebirthScore,
        prebirthApproved: true,
        ...extraCarousel,
      },
    });
    if (caption) captions.set(id, caption);
  };

  // < 6 张时不输出主题
  assert.equal(PREBIRTH_MIN_SLIDES, 6);
  addPrebirth("pb-few-1", "2024-06-02T10:00:00+08:00", 88);
  addPrebirth("pb-few-2", "2024-08-02T10:00:00+08:00", 89);
  assert.equal(buildPrebirthMemory(prebirthMedia, birthDay, labelMap, captions), undefined);

  // 清空构造完整测试集合：6 月塞 18 张不同日期（测试跨月轮转均衡 + 同一天最多 2 张），
  // 8/10/11/12 月各若干张，含同 sceneKey 去重，以及一张带 childMain:true / laugh:98 的 2024 混淆照片。
  prebirthMedia.length = 0;
  labelMap.clear();
  captions.clear();

  // 同一天 2024-06-05 放 3 张间隔 > 10 分钟，验证 CROSS_DAY_PER_DAY_MAX = 2 只保留最高分的 2 张
  addPrebirth("pb-0605-a", "2024-06-05T09:00:00+08:00", 81);
  addPrebirth("pb-0605-b", "2024-06-05T11:00:00+08:00", 95, {}, "窗边晒着刚洗好的小纱布");
  addPrebirth("pb-0605-c", "2024-06-05T15:00:00+08:00", 90);
  for (let d = 6; d <= 20; d += 1) {
    addPrebirth(`pb-06-${d}`, `2024-06-${String(d).padStart(2, "0")}T10:00:00+08:00`, 80 + (d % 10));
  }
  // 共享同一个 sceneKey，仅高分 pb-0802-hi 留下
  addPrebirth("pb-0802-lo", "2024-08-02T10:00:00+08:00", 82, { sceneKey: "shared-crib" });
  addPrebirth("pb-0802-hi", "2024-08-04T10:00:00+08:00", 96, { sceneKey: "shared-crib" }, "婴儿床拼好了");
  addPrebirth("pb-1012", "2024-10-12T10:00:00+08:00", 93, {}, "秋天傍晚去江边散步");
  addPrebirth("pb-1220", "2024-12-20T18:00:00+08:00", 98, {}, "待产包最后核对了一遍");

  const built = buildPrebirthMemory(prebirthMedia, birthDay, labelMap, captions);
  assert.ok(built);
  assert.equal(built.kind, "prebirth");
  assert.equal(built.key, "prebirth:2024");
  assert.equal(built.title, "等待你的日子");
  assert.equal(built.subtitle, "2024 年 6 月 — 12 月 · 出生之前");
  assert.equal(built.href, "/memory#year-2024");
  assert.equal(built.linkLabel, "翻到 2024 年");
  assert.equal(built.slides.length, MEMORY_MAX_SLIDES);

  const builtIds = built.slides.map((s) => s.media.id);
  // 同一天最高两张保留、最低分的 pb-0605-a 被淘汰
  assert.equal(builtIds.includes("pb-0605-a"), false);
  // 同 sceneKey 只留更高分 pb-0802-hi
  assert.equal(builtIds.includes("pb-0802-lo"), false);
  assert.ok(builtIds.includes("pb-0802-hi"));
  // 按月 round-robin 均衡：8 月、10 月、12 月都必须入选，不会被 6 月挤掉
  assert.ok(builtIds.includes("pb-1012"));
  assert.ok(builtIds.includes("pb-1220"));
  // 最终按拍摄时间升序排列
  const times = built.slides.map((s) => s.media.takenAt);
  assert.deepEqual(times, [...times].sort());
  // 每张保留 dateLabel，带 caption 的正确挂载
  assert.ok(built.slides.every((s) => Boolean(s.dateLabel)));
  assert.equal(built.slides.find((s) => s.media.id === "pb-1220")?.caption, "待产包最后核对了一遍");

  // 加上历史误标为 childMain:true / laugh:98 的 2024 照片与出生后 laugh 照片，验证零泄漏与排序置前
  const sneakyPrebirthPhoto = makePhoto("pb-sneaky-laugh", "2024-11-29T10:00:00+08:00");
  labelMap.set("pb-sneaky-laugh", makeCarouselLabel("2024-11-29T10:00:00+08:00", { laugh: 98, autumn: 95 }));

  const postBirthPhotos = Array.from({ length: 8 }, (_, idx) => {
    const day = `2025-08-${String(idx + 2).padStart(2, "0")}`;
    const id = `post-laugh-${idx}`;
    labelMap.set(id, makeCarouselLabel(`${day}T10:00:00+08:00`, { laugh: 94, summer: 90 }));
    return makePhoto(id, `${day}T10:00:00+08:00`);
  });

  const allPre = [...prebirthMedia, sneakyPrebirthPhoto];
  const allMedia = [...allPre, ...postBirthPhotos];
  const groupByMonth = (items, monthPrefix) => {
    const byDay = new Map();
    for (const p of items) {
      const d = p.takenAt.slice(0, 10);
      if (!d.startsWith(monthPrefix)) continue;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(p);
    }
    return [...byDay.entries()].map(([day, photos]) => ({
      day,
      dateLabel: day,
      photos,
      withheldCount: 0,
    }));
  };

  const archive = makeArchive({
    media: allMedia,
    privilege: {
      confirmed: new Set(allMedia.map((m) => m.id)),
      checked: new Set(allMedia.map((m) => m.id)),
      excluded: new Set(),
    },
    chapters: [
      {
        year: "2025",
        ageSpan: "出生 到 11 个月",
        months: [
          {
            month: "2025-08",
            label: "2025 年 8 月",
            shortLabel: "8 月",
            ageLabel: "7 个月",
            memories: [],
            traceDays: [],
            photos: postBirthPhotos,
            photoCount: postBirthPhotos.length,
            videoCount: 0,
            photoDays: groupByMonth(postBirthPhotos, "2025-08"),
            withheldMediaCount: 0,
          },
        ],
      },
      {
        year: "2024",
        ageSpan: "出生之前",
        months: [
          {
            month: "2024-06",
            label: "2024 年 6 月",
            shortLabel: "6 月",
            memories: [],
            traceDays: [],
            photos: [],
            photoCount: 0,
            videoCount: 0,
            photoDays: groupByMonth(allPre, "2024-06"),
            withheldMediaCount: 0,
          },
          {
            month: "2024-08",
            label: "2024 年 8 月",
            shortLabel: "8 月",
            memories: [],
            traceDays: [],
            photos: [],
            photoCount: 0,
            videoCount: 0,
            photoDays: groupByMonth(allPre, "2024-08"),
            withheldMediaCount: 0,
          },
          {
            month: "2024-10",
            label: "2024 年 10 月",
            shortLabel: "10 月",
            memories: [],
            traceDays: [],
            photos: [],
            photoCount: 0,
            videoCount: 0,
            photoDays: groupByMonth(allPre, "2024-10"),
            withheldMediaCount: 0,
          },
          {
            month: "2024-11",
            label: "2024 年 11 月",
            shortLabel: "11 月",
            memories: [],
            traceDays: [],
            photos: [],
            photoCount: 0,
            videoCount: 0,
            photoDays: groupByMonth(allPre, "2024-11"),
            withheldMediaCount: 0,
          },
          {
            month: "2024-12",
            label: "2024 年 12 月",
            shortLabel: "12 月",
            memories: [],
            traceDays: [],
            photos: [],
            photoCount: 0,
            videoCount: 0,
            photoDays: groupByMonth(allPre, "2024-12"),
            withheldMediaCount: 0,
          },
        ],
      },
    ],
    time: { today: "2026-11-15", hasExplicitDate: true },
  });

  const dayContext = new Map([
    ["2024-12-20", { title: "待产清单", photoCaptions: { "pb-1220": "来自日上下文的待产包配文" } }],
  ]);

  const selected = selectHomeMemories(archive, (id) => labelMap.get(id), {
    dayContext,
    rotationSlot: 0,
  });
  assert.equal(selected.memories[0]?.key, "topic:laugh");
  assert.equal(selected.memories[1]?.key, "prebirth:2024");
  assert.equal(
    selected.memories[1]?.slides.find((s) => s.media.id === "pb-1220")?.caption,
    "来自日上下文的待产包配文",
  );
  for (const theme of selected.memories) {
    if (theme.kind === "topic" || theme.kind === "season") {
      for (const slide of theme.slides) {
        assert.ok(
          (slide.media.takenAt ?? "").slice(0, 10) >= birthDay,
          `pre-birth photo ${slide.media.id} must never leak into ${theme.key}`,
        );
      }
    }
  }

  // 纯出生前档案（无出生后主题）时，「等待你的日子」落在首位 index 0
  const preOnlyArchive = {
    ...archive,
    media: allPre,
    chapters: [archive.chapters[1]],
  };
  const preOnlySelected = selectHomeMemories(preOnlyArchive, (id) => labelMap.get(id), {
    dayContext,
  });
  assert.equal(preOnlySelected.memories[0]?.key, "prebirth:2024");
});

test("5.6 selectTimeCapsules：2024 出生前日记（prebirthApproved 与 curated firstScreenMediaIds 兜底）以 ageDisplay「出生前」进入过去的张年", () => {
  const mApproved = makePhoto("m-2408-approved", "2024-08-18T10:00:00+08:00");
  const mCurated = makePhoto("m-2411-curated", "2024-11-10T10:00:00+08:00");
  const mBlur = makePhoto("m-2409-blur", "2024-09-05T10:00:00+08:00");

  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2024-08",
      coverMediaId: null,
      days: [
        {
          day: "2024-08-18",
          title: "第一次布置婴儿床",
          kind: "story",
          paragraphs: ["阳光照进房间里，先把小床装好。"],
          firstScreenMediaIds: [],
          expandedMediaIds: ["m-2408-approved"],
          photoCaptions: {},
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2024-09",
      coverMediaId: null,
      days: [
        {
          day: "2024-09-05",
          title: "跑糊的一张试拍",
          kind: "story",
          paragraphs: ["当时没站稳。"],
          firstScreenMediaIds: ["m-2409-blur"],
          expandedMediaIds: ["m-2409-blur"],
          photoCaptions: {},
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2024-11",
      coverMediaId: "m-2411-curated",
      days: [
        {
          day: "2024-11-10",
          title: "待产包清点了两遍",
          kind: "story",
          paragraphs: ["纱布巾和包被都叠进箱子里。"],
          firstScreenMediaIds: ["m-2411-curated"],
          expandedMediaIds: ["m-2411-curated"],
          photoCaptions: {},
        },
      ],
    },
  ];

  const topics = (id) => {
    if (id === "m-2408-approved") {
      return {
        topic: "其他",
        water: false,
        childInFrame: false,
        value: 0.72,
        confidence: 0.9,
        carousel: {
          ...makeCarouselLabel("2024-08-18T10:00:00+08:00", {}, { clarity: 91, expression: 84 }).carousel,
          childMain: false,
          faceClear: false,
          eyesOpen: false,
          prebirth: 92,
          prebirthApproved: true,
        },
      };
    }
    if (id === "m-2409-blur") {
      return {
        topic: "其他",
        water: false,
        childInFrame: false,
        value: 0.4,
        confidence: 0.9,
        carousel: {
          ...makeCarouselLabel("2024-09-05T10:00:00+08:00").carousel,
          childMain: false,
          motionBlur: true,
          prebirth: 95,
          prebirthApproved: true,
        },
      };
    }
    return undefined;
  };

  const archive = makeArchive({
    birthDay: "2025-01-03",
    media: [mApproved, mCurated, mBlur],
    privilege: {
      confirmed: new Set(["m-2408-approved", "m-2411-curated", "m-2409-blur"]),
      checked: new Set(["m-2408-approved", "m-2411-curated", "m-2409-blur"]),
      excluded: new Set(),
    },
    chapters: [
      {
        year: "2024",
        ageSpan: "出生之前",
        months: monthContents.map((mc) => ({
          month: mc.month,
          label: mc.month,
          shortLabel: mc.month.slice(5),
          memories: [],
          traceDays: [],
          photos: [],
          photoCount: mc.days[0].expandedMediaIds.length,
          videoCount: 0,
          photoDays: [
            {
              day: mc.days[0].day,
              dateLabel: mc.days[0].day,
              photos: mc.days[0].expandedMediaIds.map((id) =>
                [mApproved, mCurated, mBlur].find((m) => m.id === id),
              ),
              withheldCount: 0,
            },
          ],
          withheldMediaCount: 0,
        })),
      },
    ],
    time: { today: "2026-11-15", hasExplicitDate: true },
  });

  const publishedDays = collectPublishedDays(archive, monthContents, "2026-11-15", topics);
  const capsules = selectTimeCapsules(archive, publishedDays, topics, "2026-11-15", 4);

  assert.deepEqual(
    capsules.map((c) => c.day),
    ["2024-11-10", "2024-08-18"],
  );
  assert.equal(capsules[0].ageDisplay, "出生前");
  assert.equal(capsules[0].badgeLabel, "出生前");
  assert.equal(capsules[1].ageDisplay, "出生前");
  assert.equal(capsules[1].badgeLabel, "出生前");
  assert.equal(capsules[0].photo.id, "m-2411-curated");
  assert.equal(capsules[1].photo.id, "m-2408-approved");

  // 即使调用方手动传入 ageDisplay 缺失的出生前记录，selectTimeCapsules 也应兜底为「出生前」
  const manualDays = publishedDays.map((d) =>
    d.day === "2024-08-18" ? { ...d, ageDisplay: undefined, isPrebirth: undefined } : d,
  );
  const manualCapsules = selectTimeCapsules(archive, manualDays, topics, "2026-11-15", 4);
  assert.equal(manualCapsules.find((c) => c.day === "2024-08-18")?.ageDisplay, "出生前");
});
