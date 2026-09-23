// 首页「几段各有主题的回忆」+ 每周提醒 7 天窗口的纯函数。
//
// 这些测试钉的是**产品承诺**，不是实现细节：
//   · 每段回忆有各自的主题（天 / 季节 / 年），标题与副标题的粒度跟着主题走；
//   · 幻灯片只收主体核验通过的照片（不是来源担保）；
//   · 每组连拍取像素最大的那一张（不是第一张够大的）；
//   · 跨天主题每天最多两张，且不写配文；
//   · 现在没有音轨——trackSrc 必须返回 undefined，不能指向一个 404。
import test from "node:test";
import assert from "node:assert/strict";
import {
  selectHomeMemories, buildDayMemory, MEMORY_MIN_SLIDES, MEMORY_MAX_SLIDES, CROSS_DAY_PER_DAY_MAX,
} from "../lib/home-memory.ts";
import { moodFor, MEMORY_TRACKS, pickTrack } from "../lib/home-memory-mood.ts";
import { reminderInWindow, lastMentionedOn, windowStart, windowEnd } from "../lib/home-reminder-window.ts";
import { lastMentionFrom } from "../lib/upcoming-contract.ts";

// ── 夹具 ──────────────────────────────────────────────────────────────────────

const photo = (id, takenAt, extra = {}) => ({
  id, src: `/api/media/${id}?variant=web`, thumbnailSrc: null,
  width: 3000, height: 4000, type: "photo", posterSrc: null,
  takenAt, durationSeconds: null, alt: "一张照片", ...extra,
});

const story = (id, day, title) => ({
  id, title, weight: "memory",
  signature: { day, dateLabel: day, ageLabel: "1 岁 8 个月" },
  noPhoto: false, photoCount: 0, videoCount: 0,
});

/** 主体核验通过的集合 = privilege.checked（不是 trusted）。 */
const archiveOf = (months, { checked } = {}) => {
  const all = months.flatMap((m) => m.photoDays.flatMap((d) => d.photos));
  return {
    time: { today: "2026-09-16" },
    birthDay: "2025-01-03",
    privilege: {
      confirmed: new Set(),
      trusted: new Set(),
      checked: new Set(checked ?? all.map((p) => p.id)),
    },
    chapters: [{ year: "2026", months }],
  };
};

const monthOf = (month, days, memories = []) => ({
  month, memories,
  photoDays: days.map((d) => ({ day: d.day, dateLabel: d.day, ageLabel: "1 岁 8 个月", photos: d.photos })),
});

/** n 个不同瞬间（间隔 10 分钟，超过 90 秒所以不会被折叠成一组）。 */
const moments = (prefix, day, n, hourStart = 9) =>
  Array.from({ length: n }, (_, i) =>
    photo(`${prefix}-${i}`, `${day} ${String(hourStart + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}:00`));

// ── 主题：天 ──────────────────────────────────────────────────────────────────

test("天主题：标题是当天已发布记忆的标题原文，副标题是具体日期 + 当时年龄", () => {
  const photos = moments("m", "2026-09-09", 8);
  const memory = buildDayMemory({
    day: "2026-09-09", dateLabel: "2026 年 9 月 9 日", ageLabel: "1 岁 8 个月",
    photos, published: [story("e1", "2026-09-09", "他说了「打开」，还没很标准")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
  });
  assert.equal(memory.kind, "day");
  assert.equal(memory.title, "他说了「打开」，还没很标准");
  assert.equal(memory.subtitle, "2026 年 9 月 9 日 · 当时 1 岁 8 个月");
  assert.equal(memory.linkLabel, "读读这一天");
  assert.equal(memory.href, "/events/e1");
  assert.equal(memory.dateTime, "2026-09-09");
});

test("没有已发布记忆的一天不做天主题——它得有真名字和能点进去的去处", () => {
  const photos = moments("m", "2026-09-09", 8);
  assert.equal(buildDayMemory({
    day: "2026-09-09", dateLabel: "2026 年 9 月 9 日", photos, published: [],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
  }), undefined);
});

test("不足 6 个瞬间不成段——宁可没有，不凑数", () => {
  const photos = moments("m", "2026-09-09", MEMORY_MIN_SLIDES - 1);
  assert.equal(buildDayMemory({
    day: "2026-09-09", dateLabel: "d", photos, published: [story("e1", "2026-09-09", "标题")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
  }), undefined);
});

test("只收主体核验通过的照片：来源担保（trusted）不再算数", () => {
  const photos = moments("m", "2026-09-09", 8);
  const memory = buildDayMemory({
    day: "2026-09-09", dateLabel: "d", photos, published: [story("e1", "2026-09-09", "标题")],
    // checked 为空、trusted 满上——旧口径会放行，新口径必须挡住
    privilege: { checked: new Set(), trusted: new Set(photos.map((p) => p.id)) },
  });
  assert.equal(memory, undefined, "没有主体核验就不该出现在首页");
});

test("每组连拍取像素最大的那一张（微信压缩版不能顶替原图）", () => {
  // 同一时刻两张：压缩版在前、原图在后。旧实现取「第一张够大的」＝压缩版。
  const day = "2026-09-09";
  const photos = [];
  for (let i = 0; i < 7; i += 1) {
    const at = `${day} 1${i}:00:00`;
    photos.push(photo(`small-${i}`, at, { width: 960, height: 1280 }));
    photos.push(photo(`orig-${i}`, at, { width: 3120, height: 4160 }));
  }
  const memory = buildDayMemory({
    day, dateLabel: "d", photos, published: [story("e1", day, "标题")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
  });
  assert.equal(memory.slides.length, 7);
  for (const slide of memory.slides) {
    assert.match(slide.media.id, /^orig-/, `取到了压缩版：${slide.media.id}`);
  }
});

test("配文只用当天已发布标题原文，且不压在第一张和最后一张上", () => {
  const photos = moments("m", "2026-09-09", 9);
  const memory = buildDayMemory({
    day: "2026-09-09", dateLabel: "d", photos,
    published: [story("e1", "2026-09-09", "他说了「打开」")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
  });
  const captions = memory.slides.map((s) => s.caption).filter(Boolean);
  assert.ok(captions.length >= 1 && captions.length <= 2);
  for (const caption of captions) assert.equal(caption, "他说了「打开」");
  assert.equal(memory.slides[0].caption, undefined, "第一张先让人看照片");
  assert.equal(memory.slides.at(-1).caption, undefined, "结尾自然停住");
});

// ── 主题：季节与年 ────────────────────────────────────────────────────────────

test("首页保留跨日主题与季节，并交替展示", () => {
  // 季节要凑得出一段，就得有足够多的不同日子：每天封顶 CROSS_DAY_PER_DAY_MAX 张，
  // 所以一季至少要 3 个日子。生产里一季有 24–42 个，这里照那个形状写。
  const months = [
    monthOf("2026-09", [
      { day: "2026-09-09", photos: moments("a", "2026-09-09", 8) },
      { day: "2026-09-02", photos: moments("b", "2026-09-02", 8) },
    ], [story("e1", "2026-09-09", "他说了「打开」"), story("e2", "2026-09-02", "开始要说话了")]),
    monthOf("2026-08", [
      { day: "2026-08-20", photos: moments("c", "2026-08-20", 8) },
      { day: "2026-08-06", photos: moments("c2", "2026-08-06", 8) },
    ], [story("e3", "2026-08-20", "八月的一天")]),
    monthOf("2026-07", [
      { day: "2026-07-15", photos: moments("d", "2026-07-15", 8) },
      { day: "2026-07-03", photos: moments("d2", "2026-07-03", 8) },
    ], [story("e4", "2026-07-15", "七月的一天")]),
  ];
  const { memories } = selectHomeMemories(
    archiveOf(months),
    () => ({ topic: "睡觉", water: true, value: 0.9, confidence: 0.9 }),
  );
  assert.ok(memories.length >= 2, `应当有多段，实得 ${memories.length}`);
  const kinds = new Set(memories.map((m) => m.kind));
  assert.deepEqual([...kinds].sort(), ["season", "topic"]);
  // 相邻两段不应是同一种主题（轮流取的直接后果）
  assert.notEqual(memories[0].kind, memories[1].kind, "第一段和第二段应当是不同主题");
});

// 跨天主题的夹具必须摊到**足够多的不同日子**：每天封顶 CROSS_DAY_PER_DAY_MAX 张，
// 所以「两天各 6 张」只能凑出 4 张，达不到 6 个瞬间的下限——那是上限在正常工作，不是 bug。
// 生产里一季有 24–42 个不同的日子，这里照那个形状写。
test("季节主题：标题是日期事实，副标题是月份跨度 + 两端月龄（原则二，2026-09-19 补）", () => {
  const months = [
    monthOf("2026-07", [
      { day: "2026-07-05", photos: moments("a", "2026-07-05", 4) },
      { day: "2026-07-15", photos: moments("b", "2026-07-15", 4) },
    ]),
    monthOf("2026-08", [
      { day: "2026-08-10", photos: moments("c", "2026-08-10", 4) },
      { day: "2026-08-20", photos: moments("d", "2026-08-20", 4) },
    ]),
  ];
  const { memories } = selectHomeMemories(archiveOf(months));
  const summer = memories.find((m) => m.kind === "season");
  assert.ok(summer, "应当有一个季节主题");
  assert.equal(summer.title, "2026 年的夏天");
  assert.match(summer.subtitle, /6 月 — 8 月/);
  // 2026-09-19：季节副标题补上第二个时钟。夹具出生日 2025-01-03，2026 年夏天 6–8 月 = 1 岁 5 个月到 1 岁 7 个月。
  assert.match(summer.subtitle, /当时 1 岁 5 个月 — 1 岁 7 个月/, "季节跨整月，用月龄不用按天算");
  assert.equal(summer.dateTime, undefined, "跨天主题没有单一日期");
  assert.equal(summer.linkLabel, "翻到 2026 年");
});

test("冬天按人说话的方式跨年：2025 年的冬天 = 2025-12 到 2026-02", () => {
  const months = [
    monthOf("2025-12", [
      { day: "2025-12-06", photos: moments("a", "2025-12-06", 4) },
      { day: "2025-12-13", photos: moments("b", "2025-12-13", 4) },
    ]),
    monthOf("2026-01", [
      { day: "2026-01-20", photos: moments("c", "2026-01-20", 4) },
      { day: "2026-01-31", photos: moments("d", "2026-01-31", 4) },
    ]),
  ];
  const { memories } = selectHomeMemories(archiveOf(months));
  const winter = memories.find((m) => m.kind === "season");
  assert.ok(winter, "应当有一个季节主题");
  assert.equal(winter.title, "2025 年的冬天", "1 月属于上一年的冬天，不是 2026 年的冬天");
  assert.match(winter.subtitle, /12 月 — 次年 2 月/);
});

test("跨天主题：同一天最多两张，一整季不能变成某一个下午", () => {
  // 一天里 20 个瞬间，另外两天各 6 个。不设上限的话第一天会吃掉整段。
  const months = [
    monthOf("2026-07", [
      { day: "2026-07-01", photos: moments("big", "2026-07-01", 20, 6) },
      { day: "2026-07-15", photos: moments("b", "2026-07-15", 6) },
      { day: "2026-07-28", photos: moments("c", "2026-07-28", 6) },
    ]),
  ];
  const { memories } = selectHomeMemories(archiveOf(months));
  const season = memories.find((m) => m.kind === "season");
  assert.ok(season);
  const perDay = new Map();
  for (const slide of season.slides) {
    const day = slide.media.takenAt.slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  for (const [day, n] of perDay) {
    assert.ok(n <= CROSS_DAY_PER_DAY_MAX, `${day} 取了 ${n} 张，超过每天上限`);
  }
  assert.ok(perDay.size >= 2, "一整季应当来自多个日子");
});

test("跨天主题不写配文：不拿某一天的标题去概括一整季", () => {
  const months = [
    monthOf("2026-07", [
      { day: "2026-07-05", photos: moments("a", "2026-07-05", 4) },
      { day: "2026-07-15", photos: moments("b", "2026-07-15", 4) },
    ], [story("e1", "2026-07-15", "七月的一天")]),
    monthOf("2026-08", [
      { day: "2026-08-10", photos: moments("c", "2026-08-10", 4) },
      { day: "2026-08-20", photos: moments("d", "2026-08-20", 4) },
    ]),
  ];
  const { memories } = selectHomeMemories(archiveOf(months));
  const season = memories.find((m) => m.kind === "season");
  assert.ok(season);
  assert.equal(season.slides.every((s) => s.caption === undefined), true);
});

test("一段回忆最多 MEMORY_MAX_SLIDES 张（Teddy 2026-09-17：20+）", () => {
  const photos = moments("m", "2026-09-09", 30, 6);
  const memory = buildDayMemory({
    day: "2026-09-09", dateLabel: "d", photos, published: [story("e1", "2026-09-09", "标题")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
  });
  assert.equal(memory.slides.length, MEMORY_MAX_SLIDES);
  assert.equal(memory.slides[0].media.id, "m-0", "开头是这一天的第一个瞬间");
  assert.equal(memory.slides.at(-1).media.id, "m-29", "结尾是最后一个瞬间——不是被截断在中午");
});

test("一天都不合格时说明白原因，不编一段内容", () => {
  const { memories, absence } = selectHomeMemories(archiveOf([
    monthOf("2026-09", [{ day: "2026-09-09", photos: moments("m", "2026-09-09", 2) }]),
  ]));
  assert.equal(memories.length, 0);
  assert.equal(absence.kind, "no_qualified_theme");
});

test("主题候选数超过 HOME_MEMORIES_MAX 时（day/topic×7/season×4），「笑」仍然轮得到", () => {
  // 2026-09-17 线上真实发生过的回归：加了 week 主题之后没跟着调 HOME_MEMORIES_MAX，
  // week 在第 0 轮多占一格，把后面每轮 topic 组该出现的位置整体推后一格——（week 已于 2026-09-19 删除，这条测试仍守「候选超过上限时排队顺序正确」这个目的）
  // topic 组第三项「笑」因此被挤出九段之外（线上实测：八段回忆里 water/sleep 都在，笑没了）。
  //
  // 这条测试第一版只给了 day/season 各一个候选，凑不满 HOME_MEMORIES_MAX 就先撞到「没料了」，
  // 于是不管 MAX 设成 8 还是 9 都会通过——测的其实是空集合，不是排队顺序。
  // Teddy 2026-09-17 又把 HOME_MEMORIES_MAX 从 9 放宽到 20——夹具的候选总数如果还停在 10，
  // 20 顶得住任何排队顺序，这条测试会再次退化成"测空集合"。所以这一版把候选总量堆到
  // 超过 20（week1 + day3 + topic7 + season4 = 15……不够，再加 day 到 8 个月 = 20，
  // 刚好压着上限，真正验证"超过供给"时排队顺序仍然对——day 给够 8 个月、topic 七项全给上、
  // season 四季全给上，让真实候选数超过 20，好过 20 之后的截断继续正确跳过供给不足的陷阱。
  const byPrefix = (rules) => (id) => rules.find(([p]) => id.startsWith(p))?.[1];
  const topicLabel = (topic, water = false) => ({ topic, water, value: 0.9, confidence: 0.9 });
  const topics = byPrefix([
    ["wtr", { topic: "其他", water: true, waterKind: "泳池", childInFrame: true, swimming: true, value: 0.9, confidence: 0.9 }],
    ["slp", topicLabel("睡觉")], ["lgh", topicLabel("笑")], ["eat", topicLabel("吃饭")],
    ["out", topicLabel("户外")], ["toy", topicLabel("玩玩具")], ["hld", topicLabel("抱着")],
  ]);

  const spread8 = (prefix, month) => ["01", "04", "08", "11", "15", "18", "22", "25"]
    .map((d) => ({ day: `${month}-${d}`, photos: moments(`${prefix}${d}`, `${month}-${d}`, 3) }));

  const dayMonths = ["2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09"]
    .map((m, i) => monthOf(m, [{ day: `${m}-10`, photos: moments(`d${i}`, `${m}-10`, 8) }],
      [story(`e${i}`, `${m}-10`, `第 ${i + 1} 个月的一天`)]));

  const topicMonth = monthOf("2025-10", [
    ...spread8("wtr", "2025-10"), ...spread8("slp", "2025-10"), ...spread8("lgh", "2025-10"),
    ...spread8("eat", "2025-10"), ...spread8("out", "2025-10"), ...spread8("toy", "2025-10"),
    ...spread8("hld", "2025-10"),
  ]);

  // season：2026 年四季各给够本（每季至少 3 个不同日子），和 day/topic 的 2025 年日期不重叠。
  const seasonDays = ({ prefix, days }) => days.map((d) => ({ day: d, photos: moments(`${prefix}${d.slice(5, 7)}${d.slice(8)}`, d, 4) }));
  const months = [
    ...dayMonths,
    topicMonth,
    monthOf("2026-03", seasonDays({ prefix: "sp", days: ["2026-03-05", "2026-03-15"] })), // 春
    monthOf("2026-04", seasonDays({ prefix: "sp", days: ["2026-04-05", "2026-04-15"] })),
    monthOf("2026-06", seasonDays({ prefix: "su", days: ["2026-06-05", "2026-06-15"] })), // 夏
    monthOf("2026-07", seasonDays({ prefix: "su", days: ["2026-07-05", "2026-07-15"] })),
    monthOf("2025-11", seasonDays({ prefix: "au", days: ["2025-11-05", "2025-11-15"] })), // 秋
    monthOf("2025-12", seasonDays({ prefix: "au", days: ["2025-12-05", "2025-12-15"] })),
    monthOf("2026-01", seasonDays({ prefix: "wi", days: ["2026-01-05", "2026-01-15"] })), // 冬（跨年）
    monthOf("2026-02", seasonDays({ prefix: "wi", days: ["2026-02-05", "2026-02-15"] })),
  ];

  const archive = { ...archiveOf(months), time: { today: "2026-09-13" } };
  const { memories } = selectHomeMemories(archive, topics);

  const kinds = new Set(memories.map((m) => m.kind));
  assert.ok(!kinds.has("week"), `week 主题已删除（Teddy 2026-09-19），实得 kinds=${[...kinds].join("/")}`);
  assert.ok(!kinds.has("day"), `不应有 day 主题，实得 kinds=${[...kinds].join("/")}`);
  assert.ok(kinds.has("season"), `应当有 season 主题，实得 kinds=${[...kinds].join("/")}`);
  assert.ok(kinds.has("topic"), `应当有 topic 主题，实得 kinds=${[...kinds].join("/")}`);
  const titles = memories.map((m) => m.title);
  assert.ok(titles.includes("笑起来的时候"),
    `「笑」不该被别的主题占的那一格挤出去，实得 ${titles.join(" / ")}`);
  assert.ok(memories.length <= 20, `不能超过 HOME_MEMORIES_MAX=20，实得 ${memories.length}`);
});

// ── 主题：玩水 / 睡觉 / 笑 …… ─────────────────────────────────────────────────

/** 一个假的标注 lookup。生产里这份数据来自逐张看过的视觉标注缓存。 */
const labels = (map, fallback) => (id) => map[id] ?? fallback;

/** 八个不同的日子，每天 3 个瞬间——跨天主题每天封顶 2 张，所以够凑 6 张以上。 */
const eightDays = (prefix) => {
  const days = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22",
    "2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22"];
  return [
    monthOf("2026-07", days.slice(0, 4).map((d) => ({ day: d, photos: moments(`${prefix}${d}`, d, 3) }))),
    monthOf("2026-08", days.slice(4).map((d) => ({ day: d, photos: moments(`${prefix}${d}`, d, 3) }))),
  ];
};

test("主题回忆：泳池的照片聚成「玩水的日子」，横跨很多天", () => {
  const months = eightDays("w");
  const { memories } = selectHomeMemories(
    archiveOf(months),
    labels({}, { topic: "笑", water: true, waterKind: "泳池", swimming: true, childInFrame: true, value: 0.9, confidence: 0.9 }),
  );
  const water = memories.find((m) => m.title === "玩水的日子");
  assert.ok(water, `应当有一段玩水的回忆，实得 ${memories.map((m) => m.title).join(" / ")}`);
  assert.equal(water.kind, "topic");
  assert.ok(water.slides.length >= MEMORY_MIN_SLIDES);
  assert.equal(water.href, undefined, "一个主题横跨很多个月，没有对得上的单一去处");
  assert.equal(water.dateTime, undefined, "跨天主题没有单一日期");
  assert.ok(water.slides.every((s) => s.caption === undefined), "跨天主题不写配文");
  // 原则三：不写计数式描述。以前这里断言副标题含「N 个日子」——那个数字对家人没有意义，还违反原则三
  // （2026-09-19 Teddy 桌面验收，第一段回忆变成「玩水的日子」后图上露出「5 个日子」）。
  assert.doesNotMatch(water.subtitle, /\d+\s*个日子/, "副标题不写计数");
  assert.match(water.subtitle, /当时|2026 年 \d+ 月/, "副标题读得出时间（原则二）");
});

test("「玩水」不看 topic 判成了什么——在泳池里笑，两段回忆都该成立", () => {
  // 每一张的 topic 都是「笑」、把握很高，但它们是泳池照片。
  // 旧口径（强制单选主题）会把水整个丢掉，那正是 2026-09-16 只认出 2 张水的原因。
  const months = eightDays("p");
  const { memories } = selectHomeMemories(
    archiveOf(months),
    labels({}, { topic: "笑", water: true, waterKind: "泳池", childInFrame: true, swimming: true, value: 0.9, confidence: 0.95 }),
  );
  assert.ok(memories.some((m) => m.title === "玩水的日子"), "topic 是「笑」不该让这段回忆消失");
  assert.ok(memories.some((m) => m.title === "笑起来的时候"), "同一批照片也该能聚成「笑」");
});

test("洗澡和湖边河边不算「玩水的日子」——宁可没有这一段", () => {
  // Teddy 2026-09-17：「尽量多换成泳池游泳 不要洗澡的 湖边河边的」。
  // 线上 226 张有水的照片里 109 张是湖边河边、19 张是洗澡，正是它看起来不像玩水的原因。
  // **swimming: true 也不许把它捞回来。** 这正是 2026-09-17 线上那张澡盆照片的形状：
  // 模型判的是 kind=洗澡 + swimming=true，旧规则 `swimming === true || kind === '泳池'`
  // 于是照样放行。洗澡是无条件否决。
  for (const waterKind of ["洗澡", "湖边河边"]) {
    const { memories } = selectHomeMemories(
      archiveOf(eightDays(`k${waterKind}`)),
      labels({}, { topic: "其他", water: true, waterKind, swimming: true, value: 0.95, confidence: 0.95 }),
    );
    assert.equal(memories.some((m) => m.title === "玩水的日子"), false,
      `${waterKind} 不该凑成一段「玩水的日子」`);
  }
});

test("站在水边被抱着不算玩水——人得真的泡在水里", () => {
  // 2026-09-17 线上那一张：大人抱着 5 个月的张年站在湖边，背后是水面和远山。
  // 模型判成 泳池 + child=true + swimming=false——前两项都对，人却根本没沾水。
  // 「画面里有这个孩子」不等于「这个孩子在玩水」，所以 swimming 必须单独要求。
  const { memories } = selectHomeMemories(
    archiveOf(eightDays("poolside")),
    labels({}, { topic: "抱着", water: true, waterKind: "泳池", childInFrame: true, swimming: false, value: 0.95, confidence: 0.95 }),
  );
  assert.equal(memories.some((m) => m.title === "玩水的日子"), false,
    "只是站在池边/湖边，不该凑成一段「玩水的日子」");
});

test("封面取价值分最高的那一张，不是时间上最早的那一张", () => {
  // 「睡着的样子」的封面曾经是出生当天医院小床里的新生儿——副标题跨到 2026 年 9 月，
  // 时间铺开了，但第一眼看到的还是最小的时候。封面单独挑，播放顺序仍按时间。
  const photos = moments("m", "2026-09-09", 12, 6);
  const topics = (id) => ({
    topic: "笑", water: false, confidence: 0.9,
    value: id === "m-7" ? 0.99 : 0.72, // 第 8 张最好，但它不在开头
  });
  const memory = buildDayMemory({
    day: "2026-09-09", dateLabel: "d", photos, published: [story("e1", "2026-09-09", "标题")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
    topics,
  });
  assert.equal(memory.slides[memory.coverIndex].media.id, "m-7", "封面该是价值分最高的那一张");
  assert.notEqual(memory.coverIndex, 0, "封面不该永远是第一张");
  const times = memory.slides.map((s) => s.media.takenAt);
  assert.deepEqual(times, [...times].sort(), "播放顺序仍然是时间顺序");
});

test("跨时间主题的封面来自靠后那一段——不能又是最小的时候", () => {
  // 2026-09-17：把封面改成"取价值分最高的一张"之后，「睡着的样子」的封面
  // 从出生当天的新生儿换成了**另一张新生儿**。价值分的口径奖励「脸看得清、构图完整」，
  // 而新生儿特写恰好满分，所以跨越一生的主题里分最高的永远在最早那几周。
  // 这个夹具照着那个形状写：最早那一段分最高，封面仍然必须落在靠后那一段。
  const days = ["2025-02-04", "2025-03-11", "2025-04-08", "2025-05-13",
    "2026-06-02", "2026-07-07", "2026-08-11", "2026-09-01"];
  const months = [
    monthOf("2025-02", days.slice(0, 4).map((d) => ({ day: d, photos: moments(`c${d}`, d, 3) }))),
    monthOf("2026-06", days.slice(4).map((d) => ({ day: d, photos: moments(`c${d}`, d, 3) }))),
  ];
  const { memories } = selectHomeMemories(archiveOf(months), (id) => ({
    topic: "睡觉", water: false, confidence: 0.95,
    value: id.startsWith("c2025") ? 0.99 : 0.75, // 最早那一段分最高
  }));
  const sleep = memories.find((m) => m.title === "睡着的样子");
  assert.ok(sleep, "应当有一段睡觉的回忆");
  const coverYear = sleep.slides[sleep.coverIndex].media.takenAt.slice(0, 4);
  assert.equal(coverYear, "2026", `封面不该来自最早那一段，实得 ${coverYear}`);
  const times = sleep.slides.map((s) => s.media.takenAt);
  assert.deepEqual(times, [...times].sort(), "播放顺序仍然是时间顺序");
});

test("季节/一周主题：同一天的名额也要顾话题多样性，不能两个都给同一件事", () => {
  // 只在最后 pickSlides 那一步去重是不够的：如果某一天恰好把同一件事拍得格外清楚
  // （比如同一顿饭拍了两张，两张价值分都很高），capPerDay 会在更早的一步就把
  // 「这一天只有吃饭」焊死，pickSlides 拿到的候选池里那天已经没有别的话题可选了。
  const day1 = [
    photo("d1-eat-a", "2026-07-01 08:00:00", { }), photo("d1-eat-b", "2026-07-01 12:00:00", { }),
    photo("d1-laugh", "2026-07-01 15:00:00", { }), photo("d1-out", "2026-07-01 17:00:00", { }),
  ];
  const labelOf = (id) => {
    if (id === "d1-eat-a") return { topic: "吃饭", value: 0.95, confidence: 0.9, water: false };
    if (id === "d1-eat-b") return { topic: "吃饭", value: 0.93, confidence: 0.9, water: false };
    if (id === "d1-laugh") return { topic: "笑", value: 0.85, confidence: 0.9, water: false };
    if (id === "d1-out") return { topic: "户外", value: 0.8, confidence: 0.9, water: false };
    // 其余陪衬的日子：value 故意压在 TOPIC_MIN_VALUE(0.7) 以下——2026-09-23 加了跨段去重之后，
    // 如果这里给到 0.7 以上，d2/d3/d4 这 6 张会自己先凑成一段「玩玩具」主题（先建的段先挑），
    // 把这条季节候选全部去重掉，季节反而因为供给耗尽建不出来。这条测试要测的是
    // 「季节内部同一天的多样性」，不是跨段去重，所以让陪衬照片够不上任何主题的门槛。
    return { topic: "玩玩具", value: 0.5, confidence: 0.9, water: false };
  };
  const months = [monthOf("2026-07", [
    { day: "2026-07-01", photos: day1 },
    { day: "2026-07-08", photos: moments("d2", "2026-07-08", 2) },
    { day: "2026-07-15", photos: moments("d3", "2026-07-15", 2) },
    { day: "2026-07-22", photos: moments("d4", "2026-07-22", 2) },
  ])];
  const { memories } = selectHomeMemories(archiveOf(months), labelOf);
  const summer = memories.find((m) => m.kind === "season");
  assert.ok(summer, "应当有一个季节主题");
  const day1Topics = summer.slides
    .filter((s) => s.media.takenAt.startsWith("2026-07-01"))
    .map((s) => labelOf(s.media.id).topic);
  assert.equal(day1Topics.length, CROSS_DAY_PER_DAY_MAX, "7/1 这一天仍然只占 2 个名额");
  assert.ok(new Set(day1Topics).size > 1,
    `7/1 这一天的 2 个名额不该都给「吃饭」，实得 ${day1Topics.join("/")}`);
});

test("day 主题选片不能被一个话题占满——Teddy 2026-09-17：「吃的和喝奶的有好多」", () => {
  // 查过账本：那一周价值分最高的 30 张里「吃饭」占 11 张、「笑」占 12 张，其余话题挤不进来。
  // 这里搭一个同构的场景：30 张照片，「吃饭」14 张、价值分最高；其余 16 张分给五个话题，
  // 价值分略低但都过了 0.7 的门槛。纯按价值分选，MEMORY_MAX_SLIDES=20 张会几乎全是「吃饭」；
  // 打开 diversify 之后，同一个话题不该占掉一半以上。
  const topicOf = (id) => {
    const n = Number(id.split("-")[1]);
    if (n < 14) return { topic: "吃饭", value: 0.95, confidence: 0.9, water: false };
    const others = ["笑", "户外", "玩玩具", "抱着", "睡觉"];
    const which = others[n % others.length];
    return { topic: which, value: 0.8, confidence: 0.9, water: false };
  };
  const photos = moments("m", "2026-09-09", 30, 6);
  const memory = buildDayMemory({
    day: "2026-09-09", dateLabel: "d", photos, published: [story("e1", "2026-09-09", "标题")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
    topics: (id) => topicOf(id),
  });
  const topicsPicked = memory.slides.map((s) => topicOf(s.media.id).topic);
  const counts = {};
  for (const t of topicsPicked) counts[t] = (counts[t] ?? 0) + 1;
  assert.ok(counts["吃饭"] < memory.slides.length / 2,
    `「吃饭」不该占掉一半以上，实得 ${JSON.stringify(counts)}（共 ${memory.slides.length} 张）`);
  assert.ok(Object.keys(counts).length >= 4,
    `应当出现至少 4 个不同话题，实得 ${Object.keys(counts).join("/")}`);
});

test("空泳池不算「玩水的日子」——画面里得真的有这个孩子", () => {
  // 2026-09-17 查账本：45 张判为泳池的照片里 **21 张根本没有孩子**——酒店空泳池、
  // 只有水面、只有泳圈玩具，而它们的 value 照样 ≥ 0.7。价值分没兜住这一条，
  // 所以「画面里有没有孩子」必须单独问、单独判。
  const { memories } = selectHomeMemories(
    archiveOf(eightDays("emptypool")),
    labels({}, { topic: "其他", water: true, waterKind: "泳池", childInFrame: false, value: 0.95, confidence: 0.95 }),
  );
  assert.equal(memories.some((m) => m.title === "玩水的日子"), false,
    "空泳池的风景照不该凑成一段「玩水的日子」");
});

test("没问过画面里有没有孩子的，也不放行——没问过不等于没有", () => {
  // childInFrame 缺失 = media-water-v1 那批压根没问过这一项，不是「问过、没有孩子」。
  // 两者都不放行，但理由不同：这一条是"没有依据"，上一条是"有依据、依据说不行"。
  const { memories } = selectHomeMemories(
    archiveOf(eightDays("notasked")),
    labels({}, { topic: "其他", water: true, waterKind: "泳池", value: 0.95, confidence: 0.95 }),
  );
  assert.equal(memories.some((m) => m.title === "玩水的日子"), false);
});

test("没问过是哪一种水的照片也不进「玩水」——没依据就不说", () => {
  // waterKind 缺失 = 「没问过」，不是「问过、是泳池」。不能靠 water 布尔一个字段就当泳池用。
  const { memories } = selectHomeMemories(
    archiveOf(eightDays("unknown")),
    labels({}, { topic: "其他", water: true, value: 0.95, confidence: 0.95 }),
  );
  assert.equal(memories.some((m) => m.title === "玩水的日子"), false);
});

test("价值分不够的照片进不了主题回忆——宁可没有这一段", () => {
  const months = eightDays("low");
  const { memories } = selectHomeMemories(
    archiveOf(months),
    labels({}, { topic: "睡觉", water: true, value: 0.3, confidence: 0.95 }),
  );
  assert.equal(memories.some((m) => m.kind === "topic"), false,
    "全部低于价值分下限时，一段主题回忆都不该出现");
});

test("读不到标注缓存时主题回忆一段都不出，天与季节照常", () => {
  const months = eightDays("n");
  // 不传 lookup ＝ 缓存缺失
  const { memories } = selectHomeMemories(archiveOf(months));
  assert.equal(memories.some((m) => m.kind === "topic"), false,
    "不知道画面里是什么，就不能说这是一段玩水的回忆");
  assert.ok(memories.some((m) => m.kind === "season"), "季节的依据是日期事实，不受影响");
});

test("选片：先按价值分砍掉差的一半，再沿时间铺开——两个都要", () => {
  // 好坏交替：偶数张高分、奇数张低分，均匀分布在一整天里。
  // 这样「只按价值取」和「只按时间取」会给出不同答案，才测得出来。
  const photos = moments("m", "2026-09-09", 30, 6);
  const valueOf = (id) => (Number(id.split("-")[1]) % 2 === 0 ? 0.95 : 0.3);
  const topics = (id) => ({ topic: "笑", water: false, value: valueOf(id), confidence: 0.9 });
  const memory = buildDayMemory({
    day: "2026-09-09", dateLabel: "d", photos, published: [story("e1", "2026-09-09", "标题")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
    topics,
  });
  assert.equal(memory.slides.length, MEMORY_MAX_SLIDES);

  const picked = memory.slides.map((s) => s.media.id);
  const good = picked.filter((id) => valueOf(id) >= 0.9).length;
  assert.ok(good >= 10, `绝大多数应当是高价值的那一批，实得 ${good}/12`);

  // 时间覆盖：不能 12 张全挤在一天的前三分之一（Teddy 2026-09-17 第 4 条那个毛病）
  const index = picked.map((id) => Number(id.split("-")[1]));
  assert.ok(Math.min(...index) <= 4, `应当包含靠前的瞬间，最早的是第 ${Math.min(...index)} 个`);
  assert.ok(Math.max(...index) >= 25, `应当包含靠后的瞬间，最晚的是第 ${Math.max(...index)} 个`);

  // 取完之后按时间排回去播放，不是按分数排
  const times = memory.slides.map((s) => s.media.takenAt);
  assert.deepEqual(times, [...times].sort(), "播放顺序仍然是时间顺序");
});

test("时间覆盖对跨天主题同样成立：一个主题不能只剩最小的时候", () => {
  // 2025 上半年的照片分高，2026 的分低——上一版会把 12 张全从 2025 挑走。
  const days = ["2025-02-04", "2025-03-11", "2025-04-08", "2025-05-13",
    "2026-06-02", "2026-07-07", "2026-08-11", "2026-09-01"];
  const months = [
    monthOf("2025-02", days.slice(0, 4).map((d) => ({ day: d, photos: moments(`s${d}`, d, 3) }))),
    monthOf("2026-06", days.slice(4).map((d) => ({ day: d, photos: moments(`s${d}`, d, 3) }))),
  ];
  const { memories } = selectHomeMemories(archiveOf(months), (id) => ({
    topic: "睡觉", water: false, confidence: 0.95,
    value: id.startsWith("s2025") ? 0.95 : 0.72,
  }));
  const sleep = memories.find((m) => m.title === "睡着的样子");
  assert.ok(sleep, "应当有一段睡觉的回忆");
  const years = new Set(sleep.slides.map((s) => s.media.takenAt.slice(0, 4)));
  assert.ok(years.has("2026"), `不能只剩 2025 年的照片，实得 ${[...years].join("/")}`);
});

test("连拍折叠只看像素，不看价值分——压缩版分再高也不能顶替原图", () => {
  // 这条是防回归：去重和选美是两把尺子。两张画面几乎一样的图价值分也几乎一样，
  // 一旦让价值分参与去重，压缩版侥幸高 0.01 分就又把原图顶掉了。
  const day = "2026-09-09";
  const photos = [];
  for (let i = 0; i < 7; i += 1) {
    const at = `${day} 1${i}:00:00`;
    photos.push(photo(`small-${i}`, at, { width: 960, height: 1280 }));
    photos.push(photo(`orig-${i}`, at, { width: 3120, height: 4160 }));
  }
  const topics = (id) => ({
    topic: "笑", water: false, confidence: 0.9,
    value: id.startsWith("small-") ? 0.99 : 0.50, // 压缩版分更高
  });
  const memory = buildDayMemory({
    day, dateLabel: "d", photos, published: [story("e1", day, "标题")],
    privilege: { checked: new Set(photos.map((p) => p.id)) },
    topics,
  });
  for (const slide of memory.slides) {
    assert.match(slide.media.id, /^orig-/, `价值分把压缩版选上来了：${slide.media.id}`);
  }
});

// ── 跨段去重与同场景去重（Teddy 2026-09-23） ─────────────────────────────────

test("跨段去重：同一张照片不能在两段回忆里各出现一次", () => {
  // 同一批照片对「水」和「笑」两个主题都合格（topic 是「笑」，同时又是泳池实拍）。
  // 供给充足（8 天 × 3 张 = 24 张，两段各只需要 6 张），所以两段都建得出来，
  // 但选中的照片必须是两个不相交的子集，不能同一张在两段里各出现一次。
  const months = eightDays("shared");
  const { memories } = selectHomeMemories(
    archiveOf(months),
    labels({}, { topic: "笑", water: true, waterKind: "泳池", childInFrame: true, swimming: true, value: 0.9, confidence: 0.95 }),
  );
  const water = memories.find((m) => m.title === "玩水的日子");
  const laugh = memories.find((m) => m.title === "笑起来的时候");
  assert.ok(water && laugh, "供给充足，两段都该建得出来");
  const waterIds = new Set(water.slides.map((s) => s.media.id));
  const overlap = laugh.slides.filter((s) => waterIds.has(s.media.id));
  assert.equal(overlap.length, 0, `两段回忆共用了 ${overlap.map((s) => s.media.id).join(",")}，跨段去重没生效`);
});

test("跨段去重供给耗尽时，后建的段没有照片可选，宁可不出这一段", () => {
  // 每天正好 2 张（等于 CROSS_DAY_PER_DAY_MAX），且全部同时合格「水」与「笑」。
  // 「水」在 TOPIC_THEMES 里排在「笑」前面，会先把每天 2 张的名额全部拿走，
  // 「笑」的候选池因此被跨段去重清空——不该复用，也不该报错，只是这一段不出现。
  const days = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22",
    "2026-08-01", "2026-08-08", "2026-08-15", "2026-08-22"];
  const months = [
    monthOf("2026-07", days.slice(0, 4).map((d) => ({ day: d, photos: moments(`tight${d}`, d, 2) }))),
    monthOf("2026-08", days.slice(4).map((d) => ({ day: d, photos: moments(`tight${d}`, d, 2) }))),
  ];
  const { memories } = selectHomeMemories(
    archiveOf(months),
    labels({}, { topic: "笑", water: true, waterKind: "泳池", childInFrame: true, swimming: true, value: 0.9, confidence: 0.95 }),
  );
  const water = memories.find((m) => m.title === "玩水的日子");
  const laugh = memories.find((m) => m.title === "笑起来的时候");
  assert.ok(water, "先建的「水」应当拿到全部供给（每天正好 2 张，等于每天上限）");
  assert.equal(water.slides.length, 16, "8 天 × 每天 2 张全部归「水」");
  assert.equal(laugh, undefined, "「水」用完了全部供给，「笑」没有照片可选，宁可不出这一段");
});

test("同一段里同一场景（替代规则：同一天且拍摄时间相差 10 分钟以内）最多留一张，且是价值分更高的那一张", () => {
  const closeDay = "2026-07-01";
  // 3 分钟之内两张，替代规则判成同一场景；真正的同场景标注字段到位前，这条链式规则代它判。
  const scenePair = [photo("scene-low", `${closeDay} 09:00:00`), photo("scene-high", `${closeDay} 09:03:00`)];
  const otherDays = ["2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29", "2026-08-05"]
    .map((day, i) => ({ day, photos: moments(`solo${i}`, day, 1) }));
  const months = [
    monthOf("2026-07", [{ day: closeDay, photos: scenePair }, ...otherDays.slice(0, 4)]),
    monthOf("2026-08", otherDays.slice(4)),
  ];
  const labelOf = (id) => {
    if (id === "scene-low") return { topic: "笑", value: 0.6, confidence: 0.9, water: false };
    if (id === "scene-high") return { topic: "笑", value: 0.95, confidence: 0.9, water: false };
    return { topic: "笑", value: 0.85, confidence: 0.9, water: false };
  };
  const { memories } = selectHomeMemories(archiveOf(months), labelOf);
  const laugh = memories.find((m) => m.title === "笑起来的时候");
  assert.ok(laugh, "应当有一段「笑」的回忆");
  const closeDaySlides = laugh.slides.filter((s) => s.media.takenAt.startsWith(closeDay));
  assert.equal(closeDaySlides.length, 1, "同一场景（10 分钟以内）只能留一张");
  assert.equal(closeDaySlides[0].media.id, "scene-high", "留下的应当是价值分更高的那一张");
});

test("恰好相差 10 分钟不算同一场景——不能把 moments() 这类刻意隔开的瞬间也收成一场", () => {
  // 替代规则是"严格小于 10 分钟"，不是"小于等于"。选片逻辑到处假设「隔 10 分钟＝不同瞬间」
  // （见 moments() 夹具），这条测试钉住这个边界不会被后续改动悄悄收紧。
  const day = "2026-07-01";
  const exactGap = [photo("a", `${day} 09:00:00`, {}), photo("b", `${day} 09:10:00`, {})];
  const otherDays = ["2026-07-08", "2026-07-15", "2026-07-22", "2026-07-29"]
    .map((d, i) => ({ day: d, photos: moments(`x${i}`, d, 2) }));
  const months = [monthOf("2026-07", [{ day, photos: exactGap }, ...otherDays])];
  const { memories } = selectHomeMemories(
    archiveOf(months),
    labels({}, { topic: "笑", value: 0.9, confidence: 0.9, water: false }),
  );
  const laugh = memories.find((m) => m.title === "笑起来的时候");
  assert.ok(laugh, "应当有一段「笑」的回忆");
  const thatDay = laugh.slides.filter((s) => s.media.takenAt.startsWith(day));
  assert.equal(thatDay.length, 2, "恰好 10 分钟的两张仍然算两个场景，都该有机会入选");
});

// ── 配乐 ──────────────────────────────────────────────────────────────────────

test("配乐：两首真实音轨都在站内，随机挑一首，不按情绪选曲", () => {
  assert.equal(MEMORY_TRACKS.length, 2, "Teddy 2026-09-16 放了两首");
  for (const track of MEMORY_TRACKS) {
    assert.match(track.src, /^\/audio\/memory-\d+\.mp3$/, "必须是站内永久地址，不是临时外链");
    assert.ok(track.title.length > 0, "读屏要念得出真实曲名");
  }
  // 抽签真的会抽到两首，而不是永远第一首
  const seen = new Set(Array.from({ length: 80 }, () => pickTrack().src));
  assert.equal(seen.size, 2, `随机挑曲应当两首都挑得到，实得 ${[...seen].join(" / ")}`);
});

test("情绪判定仍然按真实依据走，理由说得出是哪一条", () => {
  const calm = moodFor({ slides: 10, photos: 40, firstHour: 8, lastHour: 21, titles: [] });
  assert.equal(calm.mood, "calm");
  assert.match(calm.reason, /21 点/);
  assert.equal(moodFor({ slides: 8, photos: 20, firstHour: 9, lastHour: 16, titles: ["爸爸说儿子一直在笑"] }).mood, "bright");
  assert.equal(moodFor({ slides: 8, photos: 20, firstHour: 9, lastHour: 16, titles: ["周末去公园"] }).mood, "open");
  const tender = moodFor({ slides: 8, photos: 16, firstHour: 10, lastHour: 15, titles: ["中午剩了点饭"] });
  assert.equal(tender.mood, "tender");
  assert.match(tender.reason, /没有命中/);
});

// ── 每周提醒的 7 天窗口 ────────────────────────────────────────────────────────

const wechat = { raised: { role: { kind: "family_member", role: "妈妈" }, modality: "plan", summary: "s", onDay: "2026-09-12" }, reviewState: "approved", itemId: "i", noChangeEvidence: true };
const recordCheck = { raised: { role: { kind: "record_check", label: "档案核对提醒" }, modality: "statement", summary: "s", onDay: "2026-09-13" }, reviewState: "approved", itemId: "i", noChangeEvidence: true };

test("窗口是周一至周日，含跨月和跨年边界", () => {
  for (const day of ["2026-09-21", "2026-09-22", "2026-09-27"]) {
    assert.equal(windowStart(day), "2026-09-21");
    assert.equal(windowEnd(day), "2026-09-27");
  }
  assert.equal(windowStart("2026-10-01"), "2026-09-28");
  assert.equal(windowEnd("2026-10-01"), "2026-10-04");
  assert.equal(windowStart("2027-01-01"), "2026-12-28");
  assert.equal(windowEnd("2027-01-01"), "2027-01-03");
});

test("最近一次提及压过首次提出——这正是 evidence.day 单独不够用的地方", () => {
  const item = { evidence: { day: "2026-08-04" }, lastMentionedOn: "2026-09-15" };
  assert.equal(lastMentionedOn(item), "2026-09-15");
  assert.equal(reminderInWindow(item, wechat, "2026-09-16").inWindow, true);
});

test("只在首次提出、之后没人再提的旧事落在窗口外（不是过期，只是不属于本周）", () => {
  const verdict = reminderInWindow({ evidence: { day: "2026-08-11" } }, wechat, "2026-09-16");
  assert.equal(verdict.inWindow, false);
  assert.match(verdict.reason, /早于窗口起点/);
});

test("档案核对提醒不是微信提及，即使日期在窗口内也不显示", () => {
  const verdict = reminderInWindow({ evidence: { day: "2026-09-13" } }, recordCheck, "2026-09-16");
  assert.equal(verdict.inWindow, false);
  assert.match(verdict.reason, /不是微信/);
});

test("没有任何消息日期时不显示，且绝不拿今天顶替起算点", () => {
  const verdict = reminderInWindow({ evidence: undefined }, wechat, "2026-09-16");
  assert.equal(verdict.inWindow, false);
  assert.match(verdict.reason, /没有可用的消息日期/);
});

test("lastMentionFrom 只认 restated / rescheduled，不把完成当成一次提及", () => {
  assert.equal(lastMentionFrom([
    { day: "2026-09-01", change: "restated" },
    { day: "2026-09-10", change: "done" },
  ]), "2026-09-01");
  assert.equal(lastMentionFrom([
    { day: "2026-09-01", change: "restated" },
    { day: "2026-09-08", change: "rescheduled" },
  ]), "2026-09-08");
  assert.equal(lastMentionFrom([]), undefined);
});


test("homepage excludes single-day stories and single-day topics", () => {
  const day = "2026-09-09";
  const archive = archiveOf([monthOf("2026-09", [
    { day, photos: moments("single", day, 12) },
  ], [story("single-story", day, "A day")])]);
  const result = selectHomeMemories(archive,
    () => ({ topic: "睡觉", water: false, value: 0.9, confidence: 0.9 }));
  assert.equal(result.memories.length, 0);
  assert.equal(result.absence.kind, "no_qualified_theme");
});
