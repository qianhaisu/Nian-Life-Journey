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
  selectTravelFootprint,
} from "../lib/home-bento.ts";
import { selectHomeMemories } from "../lib/home-memory.ts";
import { CAROUSEL_THEMES } from "../lib/home-memory-topics.ts";
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
