import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildHomeBentoModel,
  buildHomeClockHeader,
  cleanDisplayText,
  collectPublishedDays,
  computeHomeRotationSeed,
  pickRotatedCapsules,
  pickRotatedJournalDays,
  pickRotatedVoices,
  selectFamilyVoices,
  selectRecentJournalDays,
  selectTimeCapsules,
  selectTravelFootprint,
} from "../lib/home-bento.ts";
import {
  FamilyVoicesTile,
  GrowthHighlightTile,
  LatestDayTile,
  RecentJournalSection,
  TimeCapsuleSection,
  TravelFootprintCard,
} from "../components/home-bento-sections.tsx";

function makeMedia(id, takenAt, overrides = {}) {
  return {
    id,
    profileId: "zhang-nian",
    type: "photo",
    src: `/api/media/${id}/web`,
    thumbnailSrc: `/api/media/${id}/thumb`,
    alt: "WeChat image",
    takenAt,
    visibility: "family",
    width: 1200,
    height: 1500,
    ...overrides,
  };
}

function makeBaseArchive(overrides = {}) {
  const media = overrides.media ?? [
    makeMedia("m-1110", "2026-11-10T09:00:00Z"),
    makeMedia("m-1108", "2026-11-08T10:00:00Z"),
    makeMedia("m-1106", "2026-11-06T15:00:00Z"),
    makeMedia("m-1104", "2026-11-04T16:00:00Z"),
    makeMedia("m-1102", "2026-11-02T11:00:00Z"),
    makeMedia("m-0901", "2026-09-01T08:30:00Z"),
    makeMedia("m-0515", "2026-05-15T10:00:00Z"),
    makeMedia("m-0103", "2026-01-03T12:00:00Z"),
    makeMedia("m-2511", "2025-11-12T10:00:00Z"),
  ];

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
            photoCount: 5,
            videoCount: 0,
            photoDays: [],
            withheldMediaCount: 0,
          },
        ],
      },
    ],
    snapshots: [
      {
        id: "snap-2026-11",
        profileId: "zhang-nian",
        month: "2026-11",
        summary: "入秋之后越来越爱自己拿勺子吃饭，听到熟悉的儿歌会跟着节拍晃脑袋。",
        highlights: [
          "自己拿勺子稳稳吃饭",
          "主动和托班小伙伴挥手再见",
          "睡前自己挑绘本翻页",
        ],
        visibility: "family",
      },
    ],
    privilege: {
      confirmed: new Set(["m-0901", "m-0515", "m-0103", "m-2511"]),
      trusted: new Set(media.map((m) => m.id)),
      checked: new Set(["m-1108", "m-0901", "m-0515"]),
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
    time: {
      today: "2026-11-12",
    },
    ...overrides,
  };
}

function makeSampleMonthContents() {
  return [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      cardLine: "入秋之后越来越爱自己拿勺子吃饭，听到熟悉的儿歌会跟着节拍晃脑袋。",
      intro: "十一个月里，小年在餐桌边和绘本角都有了自己的小主意。",
      days: [
        {
          day: "2026-11-10",
          kind: "story",
          title: "在草坪上追泡泡",
          paragraphs: [
            "下午阳光正好，小年在小区草坪上追着泡泡跑了一整圈。妈妈笑着说：「慢点跑，泡泡还在前面等你呢[旺柴]」",
          ],
          featuredQuote: {
            text: "慢点跑，泡泡还在前面等你呢[旺柴]",
            speaker: "妈妈",
            sourceId: "src-1110",
          },
          firstScreenMediaIds: ["m-1110"],
          expandedMediaIds: ["m-1110"],
        },
        {
          day: "2026-11-08",
          kind: "story",
          title: "自己选了小熊绘本",
          paragraphs: [
            "晚饭后自己走到书架前把小熊绘本抱过来。爸爸说：「今天要讲两遍小熊刷牙吗？」他用力点点头。",
          ],
          featuredQuote: {
            text: "今天要讲两遍小熊刷牙吗？",
            speaker: "爸爸",
            sourceId: "src-1108",
          },
          firstScreenMediaIds: ["m-1108"],
          expandedMediaIds: ["m-1108"],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "托班点心吃得干干净净",
          paragraphs: [
            "潇潇老师在群里说：「小年今天自己把南瓜粥喝完啦，还帮旁边小朋友递纸巾[呲牙]」[media]",
          ],
          featuredQuote: {
            text: "小年今天自己把南瓜粥喝完啦，还帮旁边小朋友递纸巾[呲牙]",
            speaker: "潇潇老师",
            sourceId: "src-1106",
          },
          firstScreenMediaIds: ["m-1106"],
          expandedMediaIds: ["m-1106"],
        },
        {
          day: "2026-11-04",
          kind: "story",
          title: "和外婆在阳台晒太阳",
          paragraphs: [
            "外婆说：「小家伙一听到小鸟叫就指着树梢看半天。」",
          ],
          featuredQuote: {
            text: "小家伙一听到小鸟叫就指着树梢看半天。",
            speaker: "外婆",
            sourceId: "src-1104",
          },
          firstScreenMediaIds: ["m-1104"],
          expandedMediaIds: ["m-1104"],
        },
        {
          day: "2026-11-02",
          kind: "text-only",
          title: "睡前哼着儿歌拍手",
          paragraphs: ["关掉大灯后躺在小床上，自己拍着手哼了两句两只老虎。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-09",
      days: [
        {
          day: "2026-09-01",
          kind: "story",
          title: "第一次背小书包进托班",
          paragraphs: ["九月第一天背上蓝色小书包，在门口回头挥了挥手。"],
          firstScreenMediaIds: ["m-0901"],
          expandedMediaIds: ["m-0901"],
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
          title: "在公园草地上稳稳散步",
          paragraphs: ["五月的风很软，小年扶着小推车在林荫道上走了好远。"],
          firstScreenMediaIds: ["m-0515"],
          expandedMediaIds: ["m-0515"],
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
          title: "满一周岁抓周礼",
          paragraphs: ["一岁生日这天抓起了一本小画册和一把木头小勺。"],
          firstScreenMediaIds: ["m-0103"],
          expandedMediaIds: ["m-0103"],
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
          title: "扶着沙发迈出第一步",
          paragraphs: ["去年十一月，小年松开手迈出了独立走路的第一步。"],
          firstScreenMediaIds: ["m-2511"],
          expandedMediaIds: ["m-2511"],
        },
      ],
    },
  ];
}

test("buildHomeClockHeader：输出当前日期与现在年龄双时钟，生日当天不写「现在 出生的那天」", () => {
  const normal = buildHomeClockHeader("2025-01-03", "2026-11-12");
  assert.equal(normal.todayLabel, "2026 年 11 月 12 日");
  assert.equal(normal.currentAgeLabel, "现在 1 岁 10 个月");
  assert.equal(normal.kickerText, "2026 年 11 月 12 日 · 现在 1 岁 10 个月");

  const birth = buildHomeClockHeader("2025-01-03", "2025-01-03");
  assert.equal(birth.currentAgeLabel, "出生那天");
});

test("cleanDisplayText：剥离微信表情符、[media] 占位符与管线词汇", () => {
  assert.equal(cleanDisplayText("今天自己吃完南瓜粥啦[旺柴][呲牙] [media]"), "今天自己吃完南瓜粥啦");
  assert.equal(cleanDisplayText("已归档 29 个月份"), "");
  assert.equal(cleanDisplayText("微信同步成功"), "");
});

test("buildHomeBentoModel：Tile 2 自动避开 Tile 1 正在展示的同一天，近期日常也不与前两处重复", () => {
  const archive = makeBaseArchive();
  const monthContents = makeSampleMonthContents();
  const model = buildHomeBentoModel({
    archive,
    monthContents,
    today: "2026-11-12",
    activeLeadDay: "2026-11-10",
    answerLine: "入秋之后越来越爱自己拿勺子吃饭，听到熟悉的儿歌会跟着节拍晃脑袋。",
  });

  // Tile 1 是 11-10，Tile 2 应选最新的另一天 11-08
  assert.ok(model.latestDay);
  assert.equal(model.latestDay.day, "2026-11-08");
  assert.equal(model.latestDay.ageDisplay, "当时 1 岁 10 个月");
  assert.equal(model.latestDay.href, "/memory/2026/11/08");

  // 近期日常 3 张卡排除 11-10 与 11-08，依次为 11-06、11-04、11-02
  assert.deepEqual(
    model.journal.days.map((d) => d.day),
    ["2026-11-06", "2026-11-04", "2026-11-02"],
  );
  assert.equal(model.journal.latestMonthHref, "/memory/2026/11");
  assert.equal(model.journal.latestMonthLabel, "翻到 2026 年 11 月");

  // Tile 3 成长亮点避开顶部 RecentAnswer 原句，改取非重复的月度导语 + 真实短标签
  assert.ok(model.growth);
  assert.equal(model.growth.headline, "十一个月里，小年在餐桌边和绘本角都有了自己的小主意。");
  assert.ok(model.growth.tags.includes("自己拿勺子稳稳吃饭"));
});

test("selectFamilyVoices：只提取已确认称谓的真实引语，清洗微信表情并按说话人去重多样化", () => {
  const archive = makeBaseArchive();
  const monthContents = makeSampleMonthContents();
  const days = collectPublishedDays(archive, monthContents, "2026-11-12");
  const voices = selectFamilyVoices(archive, days, "2026-11-12", 3);

  assert.equal(voices.length, 3);
  const speakers = voices.map((v) => v.speaker);
  assert.deepEqual(speakers, ["妈妈", "爸爸", "潇潇老师"]);
  for (const voice of voices) {
    assert.doesNotMatch(voice.quote, /\[旺柴\]|\[呲牙\]|\[media\]/);
    assert.ok(voice.ageDisplay?.startsWith("当时 "));
    assert.match(voice.href, /^\/memory\/2026\/11\/\d{2}$/);
  }
});

test("selectTimeCapsules（原则六）：严格 ≥45 天、跨月分散、按关系优先，不足 2 张时整节收起", () => {
  const archive = makeBaseArchive();
  const monthContents = makeSampleMonthContents();
  const days = collectPublishedDays(archive, monthContents, "2026-11-12");

  const capsules = selectTimeCapsules(archive, days, () => undefined, "2026-11-12", 4);
  assert.equal(capsules.length, 4);

  // 全部早于当前月且距离今天 ≥45 天，且每一张来自不同日历月
  const months = capsules.map((c) => c.month);
  assert.equal(new Set(months).size, 4);
  assert.ok(capsules.every((c) => c.month < "2026-11"));
  assert.ok(capsules.some((c) => c.reason === "anniversary" && c.month === "2025-11"));
  assert.ok(capsules.some((c) => c.reason === "half_year" && c.month === "2026-05"));
  assert.ok(capsules.some((c) => c.badgeLabel === "满 1 周岁"));

  // 当只有 1 个早期月份合格时，返回空数组以折叠整个时间胶囊区块（绝不凑数）
  const onlyOneOld = days.filter((d) => d.month === "2026-11" || d.month === "2026-05");
  const collapsed = selectTimeCapsules(archive, onlyOneOld, () => undefined, "2026-11-12", 4);
  assert.deepEqual(collapsed, []);
  assert.equal(renderToStaticMarkup(React.createElement(TimeCapsuleSection, { capsules: collapsed })), "");
});

test("selectTravelFootprint：纯静态数据计算国家与印章城市数，带双时钟与旅程链接", () => {
  const footprint = selectTravelFootprint("2025-01-03", [], "2026-11-12");
  assert.ok(footprint.countryCount >= 2);
  assert.ok(footprint.cityCount >= 10);
  assert.ok(footprint.latestTrip);
  assert.ok(footprint.latestTrip.ageDisplay?.startsWith("当时 "));
  assert.match(footprint.latestTrip.href, /^\/travel\/[a-z0-9-]+$/);
  assert.ok(footprint.cities.length >= 8);
  assert.ok(footprint.cities.every((c) => c.href.startsWith("/travel/")));
});

test("服务端组件渲染检查：无裸 ISO 日期、无工程统计芯片、无禁用衬线字体与发黄底色", () => {
  const archive = makeBaseArchive();
  const model = buildHomeBentoModel({
    archive,
    monthContents: makeSampleMonthContents(),
    today: "2026-11-12",
    activeLeadDay: "2026-11-10",
  });

  const html = [
    renderToStaticMarkup(React.createElement(LatestDayTile, { card: model.latestDay })),
    renderToStaticMarkup(React.createElement(GrowthHighlightTile, { growth: model.growth })),
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

  const visibleText = html.replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(visibleText, /\b202[56]-\d{2}(?:-\d{2})?\b/, "可见文案不得裸露原始 ISO 日期");
  for (const forbidden of ["已归档", "本月真实记录", "更新至", "微信同步", "含照片与记录", "[media]", "[旺柴]"]) {
    assert.ok(!visibleText.includes(forbidden), `不得出现工程或仪表盘词：${forbidden}`);
  }

  const homeCss = fs.readFileSync(new URL("../app/home.css", import.meta.url), "utf8");
  const filmCss = fs.readFileSync(new URL("../app/films/film-entry.css", import.meta.url), "utf8");
  for (const css of [homeCss, filmCss]) {
    assert.doesNotMatch(css, /LXGW WenKai|Songti|Lora|#F8F4EC|#F9F6F0|#FCF9F4/i);
  }

  // Tile 5 短片卡必须高于 .bento-tile (0,1,0) 优先级保持 #0F172A 曜石深色底，不受 CSS 导入顺序影响
  assert.match(homeCss, /\.bento-tile\.tile-film\s*\{[^}]*#0F172A/i);
  assert.match(filmCss, /\.home-v2\s+\.bento-tile\.tile-film\s*\{[^}]*#0F172A/i);

  // .tile-growth-clock 不得降低不透明度，确保对浅紫底对比度稳过 WCAG AA 4.5:1
  const growthClock = homeCss.match(/\.tile-growth-clock\s*\{([^}]*)\}/);
  assert.ok(growthClock);
  assert.doesNotMatch(growthClock[1], /opacity\s*:/);

  // .tile-voices 采用紧凑顶部对齐堆叠，避免标题下方出现空白断层
  const voicesTile = homeCss.match(/\.tile-voices\s*\{([^}]*)\}/);
  assert.ok(voicesTile);
  assert.match(voicesTile[1], /justify-content:\s*flex-start/);
});

test("selectRecentJournalDays：优先挑选近期窗口内带公开照片的日子，不足时才用纯文字日回填", () => {
  const archive = makeBaseArchive({
    media: [
      makeMedia("m-1106", "2026-11-06T15:00:00Z"),
      makeMedia("m-1104", "2026-11-04T16:00:00Z"),
      makeMedia("m-1101", "2026-11-01T10:00:00Z"),
    ],
  });
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      days: [
        {
          day: "2026-11-08",
          kind: "text-only",
          title: "晚饭后拍手唱歌",
          paragraphs: ["晚饭后坐在餐椅里拍着手哼歌。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-07",
          kind: "text-only",
          title: "午睡醒来找小熊",
          paragraphs: ["午睡醒来第一件事就是抱起床头的小熊。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "草坪追泡泡",
          paragraphs: ["下午在草坪上追着泡泡跑。"],
          firstScreenMediaIds: ["m-1106"],
          expandedMediaIds: ["m-1106"],
        },
        {
          day: "2026-11-04",
          kind: "story",
          title: "阳台晒太阳",
          paragraphs: ["和外婆在阳台上晒太阳看小鸟。"],
          firstScreenMediaIds: ["m-1104"],
          expandedMediaIds: ["m-1104"],
        },
        {
          day: "2026-11-01",
          kind: "story",
          title: "周末逛公园",
          paragraphs: ["周末一家人推着小车逛公园。"],
          firstScreenMediaIds: ["m-1101"],
          expandedMediaIds: ["m-1101"],
        },
      ],
    },
  ];

  const days = collectPublishedDays(archive, monthContents, "2026-11-12");
  const journal = selectRecentJournalDays(archive, days, "2026-11-12", new Set(), 3);
  assert.deepEqual(
    journal.days.map((d) => d.day),
    ["2026-11-06", "2026-11-04", "2026-11-01"],
  );
  assert.ok(journal.days.every((d) => Boolean(d.photo)));

  // 当带图日不足 3 篇时，才用最新的纯文字日按时间顺序回填
  const twoPhotosOnly = days.filter((d) => d.day !== "2026-11-01");
  const fallbackJournal = selectRecentJournalDays(archive, twoPhotosOnly, "2026-11-12", new Set(), 3);
  assert.deepEqual(
    fallbackJournal.days.map((d) => d.day),
    ["2026-11-08", "2026-11-06", "2026-11-04"],
  );
});

test("selectFamilyVoices：只读取 featuredQuote，优先挑 10–72 字的完整对话原句，未标注正文的后勤句绝不抓取", () => {
  const archive = makeBaseArchive();
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      days: [
        {
          day: "2026-11-11",
          kind: "story",
          title: "安稳睡整觉",
          paragraphs: [
            "昨晚睡得很踏实，潇潇老师夸：「你们有魔法」。",
          ],
          featuredQuote: {
            text: "你们有魔法",
            speaker: "潇潇老师",
            sourceId: "src-1111",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-10",
          kind: "story",
          title: "翻开小汽车绘本",
          paragraphs: [
            "妈妈笑着说：「今天小年自己翻开绘本指着小汽车念个不停。」",
          ],
          featuredQuote: {
            text: "今天小年自己翻开绘本指着小汽车念个不停。",
            speaker: "妈妈",
            sourceId: "src-1110",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-09",
          kind: "story",
          title: "绘本角讲故事",
          paragraphs: [
            "爸爸说：「晚上回来再给你讲一遍挖掘机好不好？」",
          ],
          featuredQuote: {
            text: "晚上回来再给你讲一遍挖掘机好不好？",
            speaker: "爸爸",
            sourceId: "src-1109",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-08",
          kind: "story",
          title: "清早请假晚到",
          paragraphs: [
            "妈妈在群里说：「昨晚半夜不睡觉现在还在睡，今天迟一点」。",
          ],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
      ],
    },
  ];

  const days = collectPublishedDays(archive, monthContents, "2026-11-12");
  const topTwo = selectFamilyVoices(archive, days, "2026-11-12", 2);
  assert.equal(topTwo.length, 2);
  assert.ok(topTwo.every((v) => [...v.quote].length >= 10), "完整对话充足时不应选 4–5 字短词");
  assert.ok(topTwo.every((v) => !v.quote.includes("迟一点")), "未设 featuredQuote 的正文请假后勤话不得入选");

  // 若请求 3 条而完整句只有 2 条，第 3 条才回退到已核验 featuredQuote 短句兜底（仍不抓未核验正文）
  const topThree = selectFamilyVoices(archive, days, "2026-11-12", 3);
  assert.equal(topThree.length, 3);
  assert.equal([...topThree[0].quote].length >= 10 && [...topThree[1].quote].length >= 10, true);
  assert.equal(topThree[2].quote, "你们有魔法");
  assert.equal(topThree.some((v) => v.quote.includes("迟一点")), false);
});

test("智能封面与防雷同（未标注新月份）：动态识别托班集体横屏餐桌照，优先选家庭群/竖版独照", () => {
  const media = [
    // 11-10：爸爸/妈妈家庭故事日，[0] 为托班横屏餐桌，[1] 为托班户外竖图，[2] 为家庭群竖版独照（位于 expandedMediaIds）
    makeMedia("m-1110-lunch", "2026-11-10T19:35:00Z", { width: 1706, height: 1280, rawSourceId: "src-nursery-1110-a" }),
    makeMedia("m-1110-slide", "2026-11-10T21:00:00Z", { width: 1280, height: 1706, rawSourceId: "src-nursery-1110-b" }),
    makeMedia("m-1110-car", "2026-11-10T02:52:00Z", { width: 1280, height: 1707, rawSourceId: "src-family-1110" }),
    // 11-09：月度封面 13MP 竖版原图
    makeMedia("m-1109-cover", "2026-11-09T12:00:00Z", { width: 3120, height: 4160, rawSourceId: "src-family-1109" }),
    // 11-06：纯托班故事日，[0] 餐桌横图，[1] 午睡横图，[2] 涂贝壳竖版独照
    makeMedia("m-1106-lunch", "2026-11-06T19:26:00Z", { width: 1706, height: 1280, rawSourceId: "src-nursery-1106-a" }),
    makeMedia("m-1106-nap", "2026-11-06T21:24:00Z", { width: 1706, height: 1280, rawSourceId: "src-nursery-1106-b" }),
    makeMedia("m-1106-shell", "2026-11-06T21:32:00Z", { width: 1280, height: 1706, rawSourceId: "src-nursery-1106-c" }),
    // 11-05：混合故事日，[0] 餐桌横图，[1] 指认字母竖版独照
    makeMedia("m-1105-lunch", "2026-11-05T19:25:00Z", { width: 1706, height: 1280, rawSourceId: "src-nursery-1105-a" }),
    makeMedia("m-1105-alpha", "2026-11-05T21:07:00Z", { width: 1280, height: 1706, rawSourceId: "src-nursery-1105-b" }),
  ];

  const rawSources = [
    { id: "src-nursery-1110-a", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:nursery-room" },
    { id: "src-nursery-1110-b", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:nursery-room" },
    { id: "src-family-1110", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:home-family" },
    { id: "src-family-1109", profileId: "zhang-nian", sourceType: "family_photo", sourceLabel: "quark-album" },
    { id: "src-nursery-1106-a", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:nursery-room" },
    { id: "src-nursery-1106-b", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:nursery-room" },
    { id: "src-nursery-1106-c", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:nursery-room" },
    { id: "src-nursery-1105-a", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:nursery-room" },
    { id: "src-nursery-1105-b", profileId: "zhang-nian", sourceType: "wechat", sourceLabel: "conversation:nursery-room" },
  ];

  const base = makeBaseArchive({ media });
  const archive = {
    ...base,
    store: {
      ...base.store,
      media,
      rawSources,
    },
  };

  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      coverMediaId: "m-1109-cover",
      speakerBySourceId: {
        "txt-dad-1110": "爸爸",
        "txt-mom-1110": "妈妈",
        "txt-teacher-1106": "老师",
        "txt-mom-1105": "妈妈",
        "txt-teacher-1105": "老师",
      },
      days: [
        {
          day: "2026-11-10",
          kind: "story",
          title: "开了暖风一觉到天亮",
          paragraphs: ["入夜房间开了暖风，小年一觉睡到大天亮。"],
          sourceIds: ["txt-dad-1110", "txt-mom-1110"],
          firstScreenMediaIds: ["m-1110-lunch", "m-1110-slide"],
          expandedMediaIds: ["m-1110-lunch", "m-1110-slide", "m-1110-car"],
        },
        {
          day: "2026-11-09",
          kind: "story",
          title: "外婆带来的棉服",
          paragraphs: ["杭州降温后穿上了外婆带来的厚棉服。"],
          sourceIds: ["txt-mom-1110"],
          firstScreenMediaIds: ["m-1109-cover"],
          expandedMediaIds: ["m-1109-cover"],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "把苹果叫成阿果",
          paragraphs: ["嘴边常挂着《一闪一闪亮晶晶》，唯独把同学苹果叫成阿果。"],
          sourceIds: ["txt-teacher-1106"],
          firstScreenMediaIds: ["m-1106-lunch", "m-1106-nap", "m-1106-shell"],
          expandedMediaIds: ["m-1106-lunch", "m-1106-nap", "m-1106-shell"],
        },
        {
          day: "2026-11-05",
          kind: "story",
          title: "坐着新马桶数英文",
          paragraphs: ["坐在绿色小马桶上跟着大人数英文数字。"],
          sourceIds: ["txt-mom-1105", "txt-teacher-1105"],
          firstScreenMediaIds: ["m-1105-lunch", "m-1105-alpha"],
          expandedMediaIds: ["m-1105-lunch", "m-1105-alpha"],
        },
      ],
    },
  ];

  const model = buildHomeBentoModel({
    archive,
    monthContents,
    topics: () => undefined,
    today: "2026-11-12",
  });

  assert.equal(model.latestDay?.day, "2026-11-10");
  assert.equal(model.latestDay?.photo?.id, "m-1110-car", "纯家庭叙事日应优先挑家庭来源竖版独照，而非托班集体午饭");
  assert.deepEqual(
    model.journal.days.map((d) => [d.day, d.photo?.id]),
    [
      ["2026-11-09", "m-1109-cover"],
      ["2026-11-06", "m-1106-shell"],
      ["2026-11-05", "m-1105-alpha"],
    ],
    "4 张近期卡片应全部避开 1706x1280 托班集体餐桌/午睡横图",
  );
});

test("跨卡场景去重：多图日在撞场景时自动换图；单图同场景吃饭日在有其他候选日时自动错开", () => {
  const media = [
    makeMedia("m-d1-eat", "2026-11-10T12:00:00Z"),
    makeMedia("m-d2-eat", "2026-11-09T12:00:00Z"),
    makeMedia("m-d2-outdoor", "2026-11-09T16:00:00Z"),
    makeMedia("m-d3-eat-only", "2026-11-08T12:00:00Z"),
    makeMedia("m-d4-toy", "2026-11-07T17:00:00Z"),
    makeMedia("m-d5-hold", "2026-11-06T18:00:00Z"),
  ];
  const archive = makeBaseArchive({ media });
  const topicTable = {
    "m-d1-eat": { topic: "吃饭", water: false, value: 0.88, confidence: 0.9 },
    "m-d2-eat": { topic: "吃饭", water: false, value: 0.9, confidence: 0.9 },
    "m-d2-outdoor": { topic: "户外", water: false, value: 0.86, confidence: 0.9 },
    "m-d3-eat-only": { topic: "吃饭", water: false, value: 0.89, confidence: 0.9 },
    "m-d4-toy": { topic: "玩玩具", water: false, value: 0.85, confidence: 0.9 },
    "m-d5-hold": { topic: "抱着", water: false, value: 0.84, confidence: 0.9 },
  };

  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      days: [
        {
          day: "2026-11-10",
          kind: "story",
          title: "自己稳稳舀米饭",
          paragraphs: ["中午自己握着小勺把米饭舀进嘴里。"],
          firstScreenMediaIds: ["m-d1-eat"],
          expandedMediaIds: ["m-d1-eat"],
        },
        {
          day: "2026-11-09",
          kind: "story",
          title: "午饭后去公园跑",
          paragraphs: ["吃完饭去公园草地上追落叶。"],
          firstScreenMediaIds: ["m-d2-eat", "m-d2-outdoor"],
          expandedMediaIds: ["m-d2-eat", "m-d2-outdoor"],
        },
        {
          day: "2026-11-08",
          kind: "story",
          title: "餐椅上喝南瓜粥",
          paragraphs: ["坐在餐椅上喝完了半碗南瓜粥。"],
          firstScreenMediaIds: ["m-d3-eat-only"],
          expandedMediaIds: ["m-d3-eat-only"],
        },
        {
          day: "2026-11-07",
          kind: "story",
          title: "在地垫搭高积木",
          paragraphs: ["把木头积木一块块叠成高塔。"],
          firstScreenMediaIds: ["m-d4-toy"],
          expandedMediaIds: ["m-d4-toy"],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "窝在妈妈怀里看灯",
          paragraphs: ["傍晚被妈妈抱着看窗外亮起的路灯。"],
          firstScreenMediaIds: ["m-d5-hold"],
          expandedMediaIds: ["m-d5-hold"],
        },
      ],
    },
  ];

  const model = buildHomeBentoModel({
    archive,
    monthContents,
    topics: (id) => topicTable[id],
    today: "2026-11-12",
  });

  // LatestDay 选 11-10（吃饭）；11-09 自动从吃饭首图切换为户外图；11-08 因只有吃饭图而让位给 11-07 与 11-06
  assert.equal(model.latestDay?.day, "2026-11-10");
  assert.equal(model.latestDay?.photo?.id, "m-d1-eat");
  assert.deepEqual(
    model.journal.days.map((d) => [d.day, d.photo?.id]),
    [
      ["2026-11-09", "m-d2-outdoor"],
      ["2026-11-07", "m-d4-toy"],
      ["2026-11-06", "m-d5-hold"],
    ],
  );
});

test("跨模块媒体去重与时间胶囊多样化：避开 HomeMemory 封面/幻灯片图片，并输出无重复月份的 fullDateLabel", () => {
  const media = [
    makeMedia("m-1110-cover-dup", "2026-11-10T09:00:00Z"),
    makeMedia("m-1110-alt", "2026-11-10T16:00:00Z"),
    makeMedia("m-1108", "2026-11-08T10:00:00Z"),
    makeMedia("m-1106", "2026-11-06T10:00:00Z"),
    makeMedia("m-1104", "2026-11-04T10:00:00Z"),
    makeMedia("m-0820-mem-cover", "2026-08-20T10:00:00Z"),
    makeMedia("m-0820-alt", "2026-08-20T15:00:00Z"),
    makeMedia("m-0515-slide", "2026-05-15T10:00:00Z"),
    makeMedia("m-0515-fresh", "2026-05-15T16:00:00Z"),
    makeMedia("m-0310-laugh", "2026-03-10T10:00:00Z"),
    makeMedia("m-0210-water", "2026-02-10T10:00:00Z"),
    makeMedia("m-2511-step", "2025-11-12T10:00:00Z"),
  ];
  const archive = makeBaseArchive({
    media,
    privilege: {
      confirmed: new Set(media.map((m) => m.id)),
      trusted: new Set(media.map((m) => m.id)),
      checked: new Set(media.map((m) => m.id)),
      excluded: new Set(),
    },
  });

  const topicTable = {
    "m-0820-alt": { topic: "笑", water: false, value: 0.9, confidence: 0.9 },
    "m-0515-slide": { topic: "户外", water: false, value: 0.91, confidence: 0.9 },
    "m-0515-fresh": { topic: "户外", water: false, value: 0.88, confidence: 0.9 },
    "m-0310-laugh": { topic: "笑", water: false, value: 0.89, confidence: 0.9 },
    "m-0210-water": { topic: "玩水", water: true, value: 0.82, confidence: 0.9 },
    "m-2511-step": { topic: "玩玩具", water: false, value: 0.86, confidence: 0.9 },
  };

  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      days: [
        {
          day: "2026-11-10",
          kind: "story",
          title: "午后追阳光",
          paragraphs: ["在客厅地板上追着窗帘漏进来的光斑。"],
          firstScreenMediaIds: ["m-1110-cover-dup", "m-1110-alt"],
          expandedMediaIds: ["m-1110-cover-dup", "m-1110-alt"],
        },
        {
          day: "2026-11-08",
          kind: "story",
          title: "翻看小汽车书",
          paragraphs: ["自己坐在地垫上翻看小汽车绘本。"],
          firstScreenMediaIds: ["m-1108"],
          expandedMediaIds: ["m-1108"],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "阳台看小鸟",
          paragraphs: ["站在窗边听树上的麻雀叽叽喳喳。"],
          firstScreenMediaIds: ["m-1106"],
          expandedMediaIds: ["m-1106"],
        },
        {
          day: "2026-11-04",
          kind: "story",
          title: "推小推车散步",
          paragraphs: ["傍晚在小区步道上推着小车走。"],
          firstScreenMediaIds: ["m-1104"],
          expandedMediaIds: ["m-1104"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-08",
      days: [
        {
          day: "2026-08-20",
          kind: "story",
          title: "蹦床边笑个不停",
          paragraphs: ["午后在蹦床边咯咯笑个不停。"],
          firstScreenMediaIds: ["m-0820-mem-cover", "m-0820-alt"],
          expandedMediaIds: ["m-0820-mem-cover", "m-0820-alt"],
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
          title: "公园树荫散步",
          paragraphs: ["五月的风很轻，扶着小推车散步。"],
          firstScreenMediaIds: ["m-0515-slide", "m-0515-fresh"],
          expandedMediaIds: ["m-0515-slide", "m-0515-fresh"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-03",
      days: [
        {
          day: "2026-03-10",
          kind: "story",
          title: "对着镜子大笑",
          paragraphs: ["早上醒来对着穿衣镜拍手大笑。"],
          firstScreenMediaIds: ["m-0310-laugh"],
          expandedMediaIds: ["m-0310-laugh"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2026-02",
      days: [
        {
          day: "2026-02-10",
          kind: "story",
          title: "温水泳池踢水花",
          paragraphs: ["在婴儿泳池里开心地用脚丫踢起水花。"],
          firstScreenMediaIds: ["m-0210-water"],
          expandedMediaIds: ["m-0210-water"],
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
          title: "抓起彩色摇铃",
          paragraphs: ["坐在爬行垫上稳稳抓起彩色摇铃。"],
          firstScreenMediaIds: ["m-2511-step"],
          expandedMediaIds: ["m-2511-step"],
        },
      ],
    },
  ];

  const model = buildHomeBentoModel({
    archive,
    monthContents,
    topics: (id) => topicTable[id],
    today: "2026-11-12",
    excludePhotoIds: ["m-1110-cover-dup", "m-0820-mem-cover"],
    memorySlidePhotoIds: ["m-0515-slide"],
  });

  assert.equal(model.latestDay?.photo?.id, "m-1110-alt", "LatestDay 应避开 HomeMemory 封面已占用的图");
  const capsulePhotoIds = model.capsules.map((c) => c.photo.id);
  assert.ok(!capsulePhotoIds.includes("m-0820-mem-cover"), "时间胶囊硬性避开 HomeMemory 封面图");
  assert.ok(capsulePhotoIds.includes("m-0820-alt"), "同日有替代合格图时自动换用");
  assert.ok(capsulePhotoIds.includes("m-0515-fresh"), "优先避开已在幻灯片轮播中的 m-0515-slide");
  // 08-20 已占「笑」主题，第 4 张 season 胶囊优先挑「玩水」(02-10) 而非重复挑「笑」(03-10)
  assert.ok(capsulePhotoIds.includes("m-0210-water"));
  assert.equal(model.capsules.find((c) => c.day === "2026-08-20")?.fullDateLabel, "2026 年 8 月 20 日");
});

test("跨磁贴文案去重：成长亮点导语/标签与家人的话均不重复 RecentAnswer 或相邻日卡已展示内容", () => {
  const media = [
    makeMedia("m-1110", "2026-11-10T10:00:00Z"),
    makeMedia("m-1109", "2026-11-09T10:00:00Z"),
    makeMedia("m-1106", "2026-11-06T10:00:00Z"),
    makeMedia("m-1105", "2026-11-05T10:00:00Z"),
  ];
  const archive = makeBaseArchive({
    media,
    snapshots: [],
  });
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      cardLine: "十一月杭州天冷下来，小年挑完碗里的米饭，看见门口站着家长主动搬椅子过去",
      intro:
        "十一月初杭州天冷，小年穿上了外婆带来的棉服，还备上带扣子的灰色毛衣。回家喜欢骑小自行车，睡前还会一本本把绘本收好。",
      days: [
        {
          day: "2026-11-10",
          kind: "story",
          title: "开了暖风一觉到天亮",
          paragraphs: ["晚上开了暖风睡得很沉。"],
          firstScreenMediaIds: ["m-1110"],
          expandedMediaIds: ["m-1110"],
        },
        {
          day: "2026-11-09",
          kind: "story",
          title: "外婆带来的棉服",
          paragraphs: ["降温后穿上了外婆带来的厚棉服。"],
          firstScreenMediaIds: ["m-1109"],
          expandedMediaIds: ["m-1109"],
        },
        {
          day: "2026-11-08",
          kind: "text-only",
          title: "进教室一直戴着帽",
          paragraphs: ["早上进了教室也舍不得摘下小帽子。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-07",
          kind: "text-only",
          title: "骑小自行车绕客厅",
          paragraphs: ["爷爷夸他：「小年年会骑自行车转弯啦！」"],
          featuredQuote: {
            text: "小年年会骑自行车转弯啦！",
            speaker: "爷爷",
            sourceId: "src-1107",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "把苹果叫成阿果",
          paragraphs: ["认识班里小伙伴，唯独把苹果叫成阿果。"],
          firstScreenMediaIds: ["m-1106"],
          expandedMediaIds: ["m-1106"],
        },
        {
          day: "2026-11-05",
          kind: "story",
          title: "坐着新马桶数英文",
          paragraphs: ["坐在新买的小马桶上数英文数字。"],
          firstScreenMediaIds: ["m-1105"],
          expandedMediaIds: ["m-1105"],
        },
        {
          day: "2026-11-04",
          kind: "text-only",
          title: "搬把小椅子去门口",
          paragraphs: ["老师在群里夸：「小年看到家长在门口，主动搬椅子过去了，给家长坐坐。」"],
          featuredQuote: {
            text: "小年看到家长在门口，主动搬椅子过去了，给家长坐坐。",
            speaker: "老师",
            sourceId: "src-1104",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-03",
          kind: "text-only",
          title: "补完早觉听外语歌",
          paragraphs: ["妈妈笑着说：「我宣布，这是我张小年正确的打开方式。」"],
          featuredQuote: {
            text: "我宣布，这是我张小年正确的打开方式。",
            speaker: "妈妈",
            sourceId: "src-1103",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-02",
          kind: "text-only",
          title: "睡前一本本收好书",
          paragraphs: ["爸爸说：「今天自己把绘本全部放回书架，太棒了。」"],
          featuredQuote: {
            text: "今天自己把绘本全部放回书架，太棒了。",
            speaker: "爸爸",
            sourceId: "src-1102",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
      ],
    },
  ];

  const model = buildHomeBentoModel({
    archive,
    monthContents,
    today: "2026-11-12",
    answerLine: "十一月杭州天冷下来，小年挑完碗里的米饭，看见门口站着家长主动搬椅子过去",
  });

  const shownDayTitles = new Set([
    model.latestDay?.title,
    ...model.journal.days.map((d) => d.title),
  ]);
  assert.deepEqual(
    [...shownDayTitles],
    ["开了暖风一觉到天亮", "外婆带来的棉服", "把苹果叫成阿果", "坐着新马桶数英文"],
  );

  // 1. 成长亮点导语自动切到不与「外婆带来的棉服」撞车的第二句
  assert.ok(model.growth);
  assert.equal(model.growth.isCurrentMonth, true);
  assert.equal(model.growth.headline, "回家喜欢骑小自行车，睡前还会一本本把绘本收好。");

  // 2. 成长亮点标签绝不复读已展示的 4 张日卡标题，而是展示当月其余独立片段
  assert.ok(model.growth.tags.length >= 2);
  for (const tag of model.growth.tags) {
    assert.equal(shownDayTitles.has(tag), false, `成长标签不应重复已展示日卡标题：${tag}`);
  }
  assert.ok(model.growth.tags.includes("进教室一直戴着帽"));
  assert.ok(model.growth.tags.includes("补完早觉听外语歌"));

  // 3. 家人的话自动避开与顶部 RecentAnswer 同一件事的「主动搬椅子过去」引语
  assert.equal(model.voices.length, 3);
  for (const v of model.voices) {
    assert.doesNotMatch(v.quote, /主动搬椅子过去/);
  }
});

test("2026-11 真实导语全碰撞场景：当 intro 各句均复述已展示日卡或 RecentAnswer 时，自动提取未展示日的新鲜故事句并过滤撞梗标签", () => {
  const media = [
    makeMedia("m-1110", "2026-11-10T10:00:00Z"),
    makeMedia("m-1109", "2026-11-09T10:00:00Z"),
    makeMedia("m-1106", "2026-11-06T10:00:00Z"),
    makeMedia("m-1105", "2026-11-05T10:00:00Z"),
  ];
  const archive = makeBaseArchive({
    media,
    snapshots: [],
  });
  const cardLine = "十一月杭州天冷下来，小年挑完碗里的米饭，看见门口站着家长主动搬椅子过去";
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-11",
      cardLine,
      intro:
        "十一月初杭州天冷，穿上了外婆带来的厚棉服。在托班把苹果叫成「阿果」，看见门口有家长还会主动搬椅子过去。家里新添了马桶，他坐上去嘴里数着英文数字，屋里开了热空调那宿安安稳稳睡到天亮。",
      days: [
        {
          day: "2026-11-10",
          kind: "story",
          title: "开了暖风一觉到天亮",
          paragraphs: ["这宿屋里一直开着热空调，没有踢被子，安安稳稳睡到天亮。"],
          firstScreenMediaIds: ["m-1110"],
          expandedMediaIds: ["m-1110"],
        },
        {
          day: "2026-11-09",
          kind: "story",
          title: "外婆带来的棉服",
          paragraphs: ["降温后穿上了外婆带来的厚棉服。"],
          firstScreenMediaIds: ["m-1109"],
          expandedMediaIds: ["m-1109"],
        },
        {
          day: "2026-11-08",
          kind: "text-only",
          title: "进教室一直戴着帽",
          paragraphs: ["早上进了教室也一直戴着小帽子不肯摘下来。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-07",
          kind: "text-only",
          title: "骑小自行车",
          paragraphs: ["傍晚在客厅里稳稳骑着小自行车转圈。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-06",
          kind: "story",
          title: "把苹果叫成阿果",
          paragraphs: ["认识班里小伙伴，唯独把苹果叫成「阿果」。"],
          firstScreenMediaIds: ["m-1106"],
          expandedMediaIds: ["m-1106"],
        },
        {
          day: "2026-11-05",
          kind: "story",
          title: "坐着新马桶数英文",
          paragraphs: ["家里新添置的小马桶到了，坐上去嘴里还一串串数着英文。"],
          firstScreenMediaIds: ["m-1105"],
          expandedMediaIds: ["m-1105"],
        },
        {
          day: "2026-11-04",
          kind: "story",
          title: "搬把小椅子去门口",
          paragraphs: ["看见门口站着其他家长，自己主动搬起小椅子送过去。"],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-03",
          kind: "story",
          title: "补完早觉听外语歌",
          paragraphs: [
            "头天半夜醒来折腾了一阵，清早还在补觉，妈妈说「昨晚半夜不睡觉现在还在睡，今天迟一点」。",
          ],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-02",
          kind: "story",
          title: "睡前一本本收书",
          paragraphs: [
            "小年捧着绘本翻看时神情专注，到了快午睡的点，不用催促便默默把书一本一本收拢叠好，妈妈看着直乐，说「我宣布，这是我张小年正确的打开方式」。",
          ],
          featuredQuote: {
            text: "我宣布，这是我张小年正确的打开方式",
            speaker: "妈妈",
            sourceId: "src-1102",
          },
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
      ],
    },
  ];

  const model = buildHomeBentoModel({
    archive,
    monthContents,
    today: "2026-11-12",
    answerLine: cardLine,
  });

  assert.ok(model.growth);
  // intro 的三句话全部与已展示日卡（棉服 / 阿果 / 马桶英文 + 热空调睡到天亮）碰撞，不得选入 headline
  assert.doesNotMatch(model.growth.headline, /马桶|英文|睡到天亮|棉服|阿果|搬椅子/);
  // 11-03 的「半夜醒来折腾 / 补觉 / 迟一点」并非成长瞬间，应被压低，优先浮现 11-02 自主收绘本的成长句
  assert.doesNotMatch(model.growth.headline, /半夜醒|折腾|补觉|不睡觉|迟一点/);
  // 剥离句末家人引语子句，绝不出现未闭合的「/“ 或截断在引语中间，同时把妈妈的金句留给「家人的话」
  assert.equal(
    model.growth.headline,
    "小年捧着绘本翻看时神情专注，到了快午睡的点，不用催促便默默把书一本一本收拢叠好。",
  );
  assert.equal(
    (model.growth.headline.match(/「/g) ?? []).length,
    (model.growth.headline.match(/」/g) ?? []).length,
  );
  assert.ok(model.voices.some((v) => v.quote.includes("这是我张小年正确的打开方式")));
  assert.equal(model.voices.some((v) => v.quote.includes("迟一点")), false);

  // 标签中「搬把小椅子去门口」与 RecentAnswer「门口…主动搬椅子过去」语义重复，必须跳过，从而浮现「骑小自行车」
  assert.equal(model.growth.tags.includes("搬把小椅子去门口"), false);
  assert.equal(model.growth.tags.includes("骑小自行车"), true);
  // 已充当 headline 的那一天（11-02）不再重复出现在 tags 中
  assert.equal(model.growth.tags.includes("睡前一本本收书"), false);
  assert.deepEqual(model.growth.tags, ["补完早觉听外语歌", "进教室一直戴着帽", "骑小自行车"]);
});

test("selectTravelFootprint：当最近旅程 summary 首句复述标题时自动剥离首句，保留后续干货信息", () => {
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-10",
      days: [],
      travelRecords: [
        {
          id: "2026-10-yiwu-stopover",
          title: "回杭州路上在义乌住一晚",
          kind: "travel",
          from: "2026-10-04",
          to: "2026-10-05",
          placeIds: ["cn-zj-yiwu"],
          summary: "回杭州的路上，在义乌住了一晚。10 月 5 日下午从义乌出发，傍晚回到杭州的家。",
          evidence: ["2026-10-04 义乌入住记录"],
          reviewStatus: "approved",
          reviewedBy: "codex",
          visibility: "public",
          childPresent: true,
          reviewedAt: "2026-10-06T00:00:00Z",
          sourceFingerprints: [{ id: "wechat-message:yiwu-1", sha256: "a".repeat(64) }],
        },
      ],
    },
  ];

  const footprint = selectTravelFootprint("2025-01-03", monthContents, "2026-11-12");
  assert.ok(footprint.latestTrip);
  assert.equal(footprint.latestTrip.title, "回杭州路上在义乌住一晚");
  assert.equal(footprint.latestTrip.summary, "10 月 5 日下午从义乌出发，傍晚回到杭州的家。");
});

test("selectTimeCapsules：单一主题（含标题带「笑」的未标注瞬间）最多占 2 张，确保 4 张时间胶囊画面主题多样", () => {
  const media = [
    makeMedia("m-2606-art", "2026-06-10T10:00:00Z"),
    makeMedia("m-2511-laugh", "2025-11-16T10:00:00Z"),
    makeMedia("m-2508-water", "2025-08-12T10:00:00Z"),
    makeMedia("m-2503-laugh", "2025-03-18T10:00:00Z"),
    makeMedia("m-2501-first-laugh", "2025-01-19T10:00:00Z"),
  ];
  const archive = makeBaseArchive({
    media,
    privilege: {
      confirmed: new Set(media.map((m) => m.id)),
      trusted: new Set(media.map((m) => m.id)),
      checked: new Set(media.map((m) => m.id)),
      excluded: new Set(),
    },
  });
  const monthContents = [
    {
      schema: "nianlife.month-content/1",
      month: "2026-06",
      days: [
        {
          day: "2026-06-10",
          kind: "story",
          title: "荔枝拓印画，他还是最爱橘子",
          paragraphs: ["在桌前印出一串红荔枝，手里攥着小橘子不撒手。"],
          firstScreenMediaIds: ["m-2606-art"],
          expandedMediaIds: ["m-2606-art"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2025-11",
      days: [
        {
          day: "2025-11-16",
          kind: "story",
          title: "星期天去湖边，扶着方向盘大笑",
          paragraphs: ["坐在驾驶座上扶着方向盘咯咯大笑。"],
          firstScreenMediaIds: ["m-2511-laugh"],
          expandedMediaIds: ["m-2511-laugh"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2025-08",
      days: [
        {
          day: "2025-08-12",
          kind: "story",
          title: "傍晚小泳池踩水花",
          paragraphs: ["坐在院子小泳池里扑腾水花。"],
          firstScreenMediaIds: ["m-2508-water"],
          expandedMediaIds: ["m-2508-water"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2025-03",
      days: [
        {
          day: "2025-03-18",
          kind: "story",
          title: "睡觉扭来扭去，洗完澡笑得开心",
          paragraphs: ["洗完温水澡裹着浴巾笑得合不拢嘴。"],
          firstScreenMediaIds: ["m-2503-laugh"],
          expandedMediaIds: ["m-2503-laugh"],
        },
      ],
    },
    {
      schema: "nianlife.month-content/1",
      month: "2025-01",
      days: [
        {
          day: "2025-01-19",
          kind: "story",
          title: "第一次笑得这么开心",
          paragraphs: ["躺在小床上第一次笑得这么开心。"],
          firstScreenMediaIds: ["m-2501-first-laugh"],
          expandedMediaIds: ["m-2501-first-laugh"],
        },
      ],
    },
  ];

  const topicTable = {
    "m-2606-art": { topic: "玩玩具", water: false, value: 0.88, confidence: 0.9 },
    "m-2511-laugh": { topic: "玩玩具", water: false, value: 0.92, confidence: 0.9 },
    "m-2508-water": { topic: "玩水", water: true, value: 0.84, confidence: 0.9 },
    "m-2503-laugh": { topic: "笑", water: false, value: 0.95, confidence: 0.9 },
    // m-2501-first-laugh 故意不给 topic，模拟早期未标注但标题含「第一次笑」的里程碑
  };

  const days = collectPublishedDays(archive, monthContents, "2026-11-12", (id) => topicTable[id]);
  const capsules = selectTimeCapsules(archive, days, (id) => topicTable[id], "2026-11-12", 4);

  assert.equal(capsules.length, 4);
  const laughCount = capsules.filter((c) => /笑/.test(c.title)).length;
  assert.ok(laughCount <= 2, `「笑」主题胶囊不得超过 2 张，实际为 ${laughCount}`);
  assert.ok(capsules.some((c) => c.day === "2025-08-12"), "应选入玩水主题月份替代第 3 张大笑胶囊");
});

test("需求 3：computeHomeRotationSeed 与 buildHomeBentoModel 在不同时间窗/槽位下轮换家人的话、近期日常与过去的张年", () => {
  assert.equal(computeHomeRotationSeed(undefined), 0);
  const t0 = Date.UTC(2026, 10, 13, 8, 0, 0);
  const t1 = t0 + 30 * 60 * 1000;
  const t2 = t0 + 60 * 60 * 1000;
  assert.notEqual(computeHomeRotationSeed(t0), computeHomeRotationSeed(t1));
  assert.notEqual(computeHomeRotationSeed(t1), computeHomeRotationSeed(t2));

  const recentDays = [
    "2026-11-11",
    "2026-11-10",
    "2026-11-09",
    "2026-11-08",
    "2026-11-07",
    "2026-11-06",
    "2026-11-05",
    "2026-11-04",
  ];
  const pastDays = [
    "2026-08-15",
    "2026-07-18",
    "2026-06-25",
    "2026-05-04",
    "2026-03-12",
    "2025-12-26",
    "2025-10-10",
    "2025-08-12",
  ];
  const allDays = [...recentDays, ...pastDays];
  const media = allDays.map((d) => makeMedia(`m-${d}`, `${d}T10:00:00Z`));
  const topicsMap = Object.fromEntries(
    media.map((m, idx) => [
      m.id,
      {
        topic: ["户外", "玩水", "玩玩具", "吃饭", "笑"][idx % 5],
        water: idx % 5 === 1,
        value: 0.9,
        confidence: 0.95,
      },
    ]),
  );

  const speakers = ["妈妈", "爸爸", "外公", "奶奶", "雪姨", "老师"];
  const byMonth = new Map();
  for (let i = 0; i < allDays.length; i += 1) {
    const day = allDays[i];
    const month = day.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push({
      day,
      kind: "story",
      title: `${day} 留影记事`,
      paragraphs: [`${day} 这一天的真实日常片段记录。`],
      firstScreenMediaIds: [`m-${day}`],
      expandedMediaIds: [`m-${day}`],
      featuredQuote: {
        speaker: speakers[i % speakers.length],
        text: `这是第 ${i + 1} 条经过核验的家人原话记录`,
        sourceId: `src-${day}`,
      },
    });
  }
  const monthContents = [...byMonth.entries()].map(([month, days]) => ({
    schema: "nianlife.month-content/1",
    month,
    days,
  }));

  const archive = makeBaseArchive({
    media,
    privilege: {
      confirmed: new Set(media.map((m) => m.id)),
      checked: new Set(media.map((m) => m.id)),
    },
  });

  const m0 = buildHomeBentoModel({
    archive,
    monthContents,
    topics: (id) => topicsMap[id],
    today: "2026-11-12",
    activeLeadDay: "2026-11-11",
    rotationSlot: 0,
  });
  const m1 = buildHomeBentoModel({
    archive,
    monthContents,
    topics: (id) => topicsMap[id],
    today: "2026-11-12",
    activeLeadDay: "2026-11-11",
    rotationSlot: 1,
  });

  // 1. 三个板块候选池充足，且不同槽位产出的组合不同、无重复、无空卡
  assert.ok(m0.voicePool.length > 3);
  assert.ok(m0.journal.pool.length > 3);
  assert.ok(m0.capsulePool.length > 4);

  assert.notDeepEqual(
    m0.voices.map((v) => v.id),
    m1.voices.map((v) => v.id),
  );
  assert.notDeepEqual(
    m0.journal.days.map((d) => d.day),
    m1.journal.days.map((d) => d.day),
  );
  assert.notDeepEqual(
    m0.capsules.map((c) => c.day),
    m1.capsules.map((c) => c.day),
  );

  for (const model of [m0, m1]) {
    const voiceSpeakers = new Set(model.voices.map((v) => v.speaker));
    assert.equal(voiceSpeakers.size, model.voices.length, "家人的话同批应保持说话人多样");
    assert.equal(model.journal.days.length, 3);
    assert.equal(new Set(model.journal.days.map((d) => d.day)).size, 3);
    assert.ok(model.journal.days.every((d) => d.title && d.photo && d.href));
    assert.equal(model.capsules.length, 4);
    assert.equal(new Set(model.capsules.map((c) => c.month)).size, 4, "过去的张年同批应跨月去重");
  }

  // 2. 纯轮换函数直接测试：不越界且无重复
  assert.equal(pickRotatedVoices(m0.voicePool, 2, 99).length, 2);
  assert.equal(pickRotatedJournalDays(m0.journal.pool, 3, 99).length, 3);
  assert.equal(pickRotatedCapsules(m0.capsulePool, 4, 99).length, 4);

  // 3. 组件渲染「换一批」按钮：候选池大于展示数量时显示，小于等于时不显示
  const voicesHtml = renderToStaticMarkup(
    React.createElement(FamilyVoicesTile, { voices: m0.voices, pool: m0.voicePool }),
  );
  const journalHtml = renderToStaticMarkup(
    React.createElement(RecentJournalSection, {
      days: m0.journal.days,
      pool: m0.journal.pool,
      latestMonthHref: m0.journal.latestMonthHref,
      latestMonthLabel: m0.journal.latestMonthLabel,
    }),
  );
  const capsulesHtml = renderToStaticMarkup(
    React.createElement(TimeCapsuleSection, { capsules: m0.capsules, pool: m0.capsulePool }),
  );
  assert.match(voicesHtml, /换一批/);
  assert.match(journalHtml, /换一批/);
  assert.match(capsulesHtml, /换一批/);

  const smallVoicesHtml = renderToStaticMarkup(
    React.createElement(FamilyVoicesTile, { voices: m0.voices.slice(0, 2), pool: m0.voices.slice(0, 2) }),
  );
  assert.doesNotMatch(smallVoicesHtml, /换一批/);
});
