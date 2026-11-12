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

test("selectFamilyVoices：优先挑 10–72 字的完整对话原句，短碎词仅在不足时兜底", () => {
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
            "昨晚睡得很踏实，妈妈说：「几乎没醒」，潇潇老师夸：「你们有魔法」。",
          ],
          firstScreenMediaIds: [],
          expandedMediaIds: [],
        },
        {
          day: "2026-11-09",
          kind: "story",
          title: "绘本角讲故事",
          paragraphs: [
            "妈妈笑着说：「今天小年自己翻开绘本指着小汽车念个不停。」爸爸说：「晚上回来再给你讲一遍挖掘机好不好？」",
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

  // 若请求 3 条而完整句只有 2 条，第 3 条才回退到短句兜底
  const topThree = selectFamilyVoices(archive, days, "2026-11-12", 3);
  assert.equal(topThree.length, 3);
  assert.equal([...topThree[0].quote].length >= 10 && [...topThree[1].quote].length >= 10, true);
  assert.equal(topThree[2].quote, "你们有魔法");
});
