// 首页题签的局部着色（lib/title-emphasis.ts）与首页主照片的去处（components/home-lead.tsx）。
// 2026-09-14 用户反馈：着色不该只有 cold / hot 那一篇；点首页照片应该进入这张照片那一天的故事，不是放大。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React ??= React;
const { titleEmphasis, TITLE_PHRASE_RULES, TITLE_PHRASE_GROUPS, TITLE_EMPHASIS_MAX_SPANS, TITLE_EMPHASIS_MAX_SHARE } = await import("../lib/title-emphasis.ts");
const { HomeLead } = await import("../components/home-lead.tsx");

const texts = (title) => titleEmphasis(title).map((span) => [span.text, span.accent]);

test("定稿那一篇照旧：cold 蓝、hot 桃红", () => {
  assert.deepEqual(texts("他会说 cold，也会说 hot"), [["cold", "blue"], ["hot", "rose"]]);
});

test("用户点名的两篇各标一个小词组，不是整句", () => {
  assert.deepEqual(texts("小年也扎了个小辫子"), [["小辫子", "sage"]]);
  assert.deepEqual(texts("张年入选毕业庆典节目"), [["庆典节目", "rose"]]);
});

test("规则按词组命中，不绑定具体标题：换一篇同样有这个词的标题也会标", () => {
  assert.deepEqual(texts("外婆给他扎了两个辫子"), [["辫子", "sage"]]);
  assert.deepEqual(texts("托班的庆典节目彩排"), [["庆典节目", "rose"]]);
});

test("长的词组先占位，同一处不叠两段", () => {
  const spans = titleEmphasis("小辫子");
  assert.ok(spans.length <= 1);
  assert.ok(!titleEmphasis("小年也扎了个小辫子").some((span) => span.text === "辫子"));
});

test("拉丁词按词边界：photo、hotel 里的 hot 不会被标出来", () => {
  assert.deepEqual(texts("photo 里的 hotel"), []);
  assert.deepEqual(texts("说 HOT 的那天"), [["HOT", "rose"]], "大小写不影响，标出来的是标题里原样的字");
});

test("命中不了就是原样文字；标题本身就是一个词组时不整句染色", () => {
  assert.deepEqual(titleEmphasis("第一次自己走到门口"), []);
  assert.deepEqual(titleEmphasis("生日"), [], "两个字的标题整句都是词组，超过一半，不上色");
  assert.deepEqual(titleEmphasis(""), []);
});

test("克制：每个标题最多两段、着色总长不超过一半", () => {
  const title = "生日演出上说 cold 和 hot，还扎了小辫子";
  const spans = titleEmphasis(title);
  assert.ok(spans.length <= TITLE_EMPHASIS_MAX_SPANS);
  const colored = spans.reduce((sum, span) => sum + span.end - span.start, 0);
  assert.ok(colored <= title.length * TITLE_EMPHASIS_MAX_SHARE);
  for (const span of spans) assert.equal(title.slice(span.start, span.end), span.text, "位置与文字一致");
});

test("规则表本身保持小词组：中文 ≤4 字或一个英文词，颜色只用站点已有的三支", () => {
  for (const rule of TITLE_PHRASE_RULES) {
    assert.ok(/^[A-Za-z]+$/.test(rule.phrase) || [...rule.phrase].length <= 4, `词组过长：${rule.phrase}`);
    assert.ok(["blue", "rose", "sage"].includes(rule.accent));
  }
  assert.deepEqual(Object.keys(TITLE_PHRASE_GROUPS).sort(), ["look", "occasion", "spoken"]);
});

const render = (props) => renderToStaticMarkup(React.createElement(HomeLead, props));
const slide = (eventId, title, mediaId) => ({
  key: `${eventId}|${mediaId}`,
  story: { eventId, href: `/events/${eventId}`, title, day: "2025-12-18", dateLabel: "2025 年 12 月 18 日", ageLabel: "11 个月" },
  photo: { media: { id: mediaId, src: `/api/media/${mediaId}?variant=web`, width: 1600, height: 1200, alt: "那天的照片", type: "photo" }, day: "2026-08-19", dayLabel: "2026 年 8 月 19 日", ageLabel: "1 岁 7 个月" },
});

test("首页主照片是指向这一对绑定所属故事的链接，有说清去处的可读名称，不再是放大按钮", () => {
  const html = render({ slides: [slide("event-v2-afcea68eff8b3ece3440d13f74d57c37", "张年入选毕业庆典节目", "wechat-media:abc")], today: "2026-09-14" });
  assert.match(html, /<a class="home-photo" aria-label="读这张照片的那一天：张年入选毕业庆典节目" href="\/events\/event-v2-afcea68eff8b3ece3440d13f74d57c37">/);
  assert.doesNotMatch(html, /打开这一天的完整照片|zoom-in/);
  assert.doesNotMatch(html, /<button[^>]*class="home-photo"/);
});

// 2026-09-16 改版：这一块原本断言旧便签「这几天的提醒事项」，以及「没有事项时整块不画」。
// 两条都被用户的第 4、5 条取代了——标题统一成「每周提醒」，而且**没有事项时标题照画、下面留白**
// （留白是一句真话，整块消失会让人以为这周的提醒还没读出来）。详细断言在 home-reminders.test.mjs，
// 这里只留一条最小的名称一致性检查，免得两个文件重复维护同一组断言。
test("首页提醒区的可见标题与可访问名称一致：「每周提醒」", async () => {
  const { HomeReminders } = await import("../components/home-reminders.tsx");
  const html = renderToStaticMarkup(React.createElement(HomeReminders, {
    storageScope: "p1",
    rangeStart: "2026-09-09", rangeEnd: "2026-09-15",
    reminders: [{ id: "r1", title: "合成提醒", whenText: "9 月 15 日", whenDay: "2026-09-15", actionable: true, sources: [] }],
  }));
  assert.match(html, /aria-labelledby="weekly-heading"/);
  assert.match(html, /<h2 class="weekly-heading" id="weekly-heading">每周提醒<\/h2>/);
});

test("首页题签按规则局部着色，其余文字保持原样", () => {
  const html = render({ slides: [slide("event-v2-e98e09bddcec2801bcb726d0261d7d3d", "小年也扎了个小辫子", "wechat-media:def")], today: "2026-09-14" });
  // 2026-09-16 视觉验收：名字额外包了一层 .keep-whole（不可断行），因为线上出现过把「张小年」
  // 劈到两行的断行。着色规则本身没变：命中的仍然只有「小辫子」一段，其余文字原样。
  assert.match(html, /<h1 class="home-title"><span><span class="keep-whole">小年<\/span>也扎了个<\/span><span class="home-emphasis home-emphasis--sage">小辫子<\/span><\/h1>/);
});

test("题签里的名字不被断行：包成一段 .keep-whole，标题文字一个字不变", () => {
  const html = render({ slides: [slide("event-v2-0000000000000000000000000000abcd", "就哭一声，张小年是个硬汉", "wechat-media:def")], today: "2026-09-14" });
  assert.match(html, /<h1 class="home-title">就哭一声，<span class="keep-whole">张小年<\/span>是个硬汉<\/h1>/);
});

// PAGE-0915-HOME-BALANCE：CSS 选不出一张 <img> 自己的长宽比，桌面竖照限高、横照不限高这条只能靠
// 组件算好方向、写成类名。这里钉住三种方向都标对，且不影响照片链接本身。
test("首页主照片按方向标 home-figure--portrait/landscape/square，供桌面版式挑竖照限高", () => {
  const portrait = render({ slides: [{ ...slide("event-v2-11f294e5906320de95580078c404cb59", "竖照那天", "wechat-media:tall"), photo: { ...slide("e", "t", "m").photo, media: { id: "wechat-media:tall", src: "/api/media/tall?variant=web", width: 1200, height: 1600, alt: "竖照", type: "photo" } } }], today: "2026-09-14" });
  assert.match(portrait, /<figure class="home-figure home-figure--portrait">/);

  const landscape = render({ slides: [slide("event-v2-21318c0b4837bca17f39fc37bb092602", "横照那天", "wechat-media:wide")], today: "2026-09-14" });
  assert.match(landscape, /<figure class="home-figure home-figure--landscape">/);

  const square = render({ slides: [{ ...slide("event-v2-4ee118293a728414a49b8c629a57b5f3", "方照那天", "wechat-media:sq"), photo: { ...slide("e", "t", "m").photo, media: { id: "wechat-media:sq", src: "/api/media/sq?variant=web", width: 1200, height: 1200, alt: "方照", type: "photo" } } }], today: "2026-09-14" });
  assert.match(square, /<figure class="home-figure home-figure--square">/);
});

// PAGE-0915-FULL-REMEDIATION-R1 A1：题签旁要有故事自己的日子。
// 2026-09-15 用户：首页不再显示「今天 · 现在几岁」那一行，照片下方也不再重复印日期与当时年龄——
// 日期年龄只在题签下面出现一次。
test("首页只在题签下面显示一次故事自己的日期与当时年龄，没有今天那一行，照片下方不重复", () => {
  const html = render({ slides: [slide("event-v2-11f294e5906320de95580078c404cb59", "体重接近23斤了", "wechat-media:x")] });
  assert.doesNotMatch(html, /home-today|现在 /, "no today/current-age line");
  assert.match(html, /<p class="home-story-when"><time dateTime="2025-12-18">2025 年 12 月 18 日<\/time><span> · 当时 11 个月<\/span><\/p>/);
  assert.equal((html.match(/当时 /g) ?? []).length, 1, "the date and age appear once");
  assert.doesNotMatch(html, /<figcaption/, "a single slide has no caption row left");
  const two = render({ slides: [slide("event-a", "第一段", "wechat-media:a"), slide("event-b", "第二段", "wechat-media:b")] });
  assert.match(two, /<figcaption class="home-caption"><button class="home-swap"/);
  assert.doesNotMatch(two.match(/<figcaption.*?<\/figcaption>/s)?.[0] ?? "", /<time|当时/, "the caption only swaps photos");
});

test("没有合格照片的纯文字 slide，题签下面照样有故事自己的日期——不是只有配了图才有", () => {
  const html = renderToStaticMarkup(React.createElement(HomeLead, {
    slides: [{ key: "event-v2-9be207929e855a69c91a1cd93bc10d64", story: { eventId: "event-v2-9be207929e855a69c91a1cd93bc10d64", href: "/events/event-v2-9be207929e855a69c91a1cd93bc10d64", title: "只有文字的一段", day: "2026-03-02", dateLabel: "2026 年 3 月 2 日", ageLabel: "1 岁 2 个月" } }],
    today: "2026-09-15",
  }));
  assert.doesNotMatch(html, /home-figure/);
  assert.match(html, /<p class="home-story-when"><time dateTime="2026-03-02">2026 年 3 月 2 日<\/time><span> · 当时 1 岁 2 个月<\/span><\/p>/);
});

// PAGE-0915-FULL-REMEDIATION-R1 A3：换图重新挂载 <img>（key=slide.key），首帧透明、onLoad 后淡入，
// 不会出现"看着还是上一张、其实已经换了故事"的中间状态。
test("主照片按 slide.key 重新挂载，首帧不透明度为 0，等 onLoad 才淡入", () => {
  const html = render({ slides: [slide("event-v2-e98e09bddcec2801bcb726d0261d7d3d", "小年也扎了个小辫子", "wechat-media:y")], today: "2026-09-14" });
  assert.match(html, /style="[^"]*opacity:0"/);
});

// PAGE-0915-FULL-REMEDIATION-R2：Codex 审核发现 `if (slides.length === 0) return null;` 原来插在
// 两个 useState 和 useEffect 之间——slides 在空和非空之间变化时，同一个组件实例调用的 Hook 数量
// 会不一样，违反 Hooks 规则。修好之后所有 Hook 都在提前返回之前，早退挪到最后。
// react-dom/server 的单次渲染看不出"同一实例换 props 后 Hook 数量变没变"（那需要真的挂载后再换
// props 重渲染，这个仓库的测试基础设施里没有 jsdom/客户端渲染环境）；这里能验证的是两条分支各自
// 独立渲染都安全（不抛错、行为对），并且直接核对源码里 Hook 调用确实都在早退判断之前。
test("空 slides：安全渲染成空字符串，不抛错", () => {
  assert.equal(render({ slides: [], today: "2026-09-15" }), "");
});

test("非空 slides：安全渲染出主体内容，不抛错", () => {
  const html = render({ slides: [slide("event-v2-11f294e5906320de95580078c404cb59", "有内容的一段", "wechat-media:z")], today: "2026-09-15" });
  assert.match(html, /home-figure/);
  assert.match(html, /有内容的一段/);
});

test("home-lead.tsx：三个 Hook（useState ×2、useEffect）都在 `if (!slide) return null;` 之前，顺序和数量不随 slides 是否为空而变", () => {
  const src = fs.readFileSync(new URL("../components/home-lead.tsx", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export function HomeLead("));
  const earlyReturnIdx = body.indexOf("if (!slide) return null;");
  assert.ok(earlyReturnIdx > 0, "找不到早退判断，或者判断条件变了");
  const before = body.slice(0, earlyReturnIdx);
  // useState 第二次调用带了泛型参数（useState<string | null>(...)），匹配 "useState(" 或
  // "useState<" 两种写法。
  assert.equal((before.match(/useState[(<]/g) ?? []).length, 2, "两个 useState 都该在早退之前");
  assert.equal((before.match(/useEffect\(/g) ?? []).length, 1, "useEffect 也该在早退之前");
  const firstHookIdx = body.search(/useState[(<]/);
  assert.doesNotMatch(body.slice(0, firstHookIdx), /return/, "第一个 Hook 之前不该有提前返回");
});

// 2026-09-16 改版：上一版这里钉的是 `.home-figure--portrait` 的 75dvh 限高和 `.home-aside`
// 的整块居中——那是"一张大照片 + 左栏题签"的两栏首页，已经被「一段回忆 + 每周提醒」整个取代，
// 那些类名在 app/home.css 里不再存在。断言跟着版式走，但**守的教训不变**：
// 手机第一屏必须同时读得到照片、日期和题签（2026-09-16 那次题签被顶到底栏下面就是没守住），
// 宽屏上竖照不能铺成一堵墙，照片本身不许加滤镜。
test("app/home.css：回忆舞台限高保住第一屏的题签与日期，宽屏不铺成一堵墙，照片不加滤镜", () => {
  const css = fs.readFileSync(new URL("../app/home.css", import.meta.url), "utf8");
  const stage = css.match(/\.memory-frames \{([^}]*)\}/);
  assert.ok(stage, "找不到 .memory-frames 的规则");
  // 限高用视口单位 + 像素天花板：纯百分比在小屏（667）上会把题签重新顶下去。
  assert.match(stage[1], /max-height:\s*min\(72svh,\s*620px\)/, "手机上必须给舞台一个视口高度上限");
  assert.match(stage[1], /aspect-ratio:\s*4 \/ 5/, "竖照占绝大多数，舞台按 4:5 立起来");

  // 宽屏上照片不能无上限地铺满版心。守的是这条意图，不是某个具体数字：2026-09-19 桌面首屏
  // 改成「左文右图」（参照 taito.ai），图文比例经 Teddy 两轮验收——照片是近方形的大图（约 1.1:1），
  // 占宽约 54–60%，而不是 620px 的竖长条。所以这里不再钉 max-width:620px，钉的是：
  // ① 照片高度同时受视口高度和像素天花板约束；② 照片列宽必须是 min(占比, 高×比例) 这种有上限的写法，
  // 不能是 1fr（矮屏上会被撑成扁条、竖照被裁穿人脸）；③ 照片高度取同一个变量。
  const desktop = css.slice(css.indexOf("@media (min-width: 900px)"));
  assert.match(desktop, /--home-photo-h:\s*min\(calc\(100svh - \d+px\),\s*\d+px\)/, "照片高度上限必须同时受视口高度和像素天花板约束");
  assert.match(desktop, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+min\(\d+%,\s*calc\(var\(--home-photo-h\) \* [\d.]+\)\)/, "照片列宽必须是 min(占比, 高度×比例)，不能是 1fr");
  assert.match(desktop, /\.memory-frames \{[^}]*height:\s*var\(--home-photo-h\)/, "宽屏照片高度取同一个变量");

  // 原则/任务书：不给照片加全局滤镜，只有图上文字区域可以用局部遮罩（.memory-scrim）。
  assert.doesNotMatch(css, /\.memory-frames img \{[^}]*filter:/, "照片保持原色，不许加滤镜");
  assert.doesNotMatch(css, /\.memory-player-stage img \{[^}]*filter:/, "播放器里的照片同样不加滤镜");

  // 播放入口只有图标，但命中区域不许缩水（≥44px）。
  // **断言的是 44px 这条底线，不是某一个具体数字。** 2026-09-17 按 Teddy 的意见把播放键
  // 从 56px 收到 52px 做视觉精修，写死 56px 的旧断言当场就炸了——尺寸是设计可以调的，
  // 触达下限不是。测试该钉住的是后者。
  const play = css.match(/\.memory-play \{([^}]*)\}/);
  assert.ok(play, "找不到 .memory-play");
  const playWidth = Number(play[1].match(/width:\s*(\d+)px/)?.[1]);
  const playHeight = Number(play[1].match(/height:\s*(\d+)px/)?.[1]);
  assert.ok(playWidth >= 44, `播放键宽 ${playWidth}px，低于 44px 触达下限`);
  assert.ok(playHeight >= 44, `播放键高 ${playHeight}px，低于 44px 触达下限`);
});

// ── 原则五在年页/索引行上的落地（2026-09-16 视觉验收）──────────────────────────
// 年页每月取 6 条（yearTitlesPerMonth），按 WEIGHT_RANK 排，高档不足 6 条时用 trace 补满，
// 所以这几行本来就混着两种分量。`size="line"` 那一支原来连 weight 都不带，于是
// 「小年年升入大班了」和一条普通日子是同一段 markup。这两条钉住：weight 传到了类名上，
// 而且 CSS 真的把两种分量分开了（不是只加了个类名没人用）。
test("年页的行条目带上自己的分量：memory-weight-* 必须出现在 .memory-line 上", async () => {
  const React = (await import("react")).default;
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { EditorialMemory } = await import("../components/editorial-memory.tsx");
  const line = (weight) => renderToStaticMarkup(React.createElement(EditorialMemory, {
    memory: { id: "e1", title: "小年年升入大班了", excerpt: undefined, weight, signature: { day: "2026-07-23", dateLabel: "7 月 23 日", ageLabel: undefined }, lead: undefined },
    size: "line",
  }));
  assert.match(line("highlight"), /class="memory-line memory-weight-highlight"/);
  assert.match(line("trace"), /class="memory-line memory-weight-trace"/);
  assert.match(line("highlight"), /小年年升入大班了/, "标题一个字都不该被改写");
});

test("globals.css：里程碑行和普通一天行不是同一个字号——原则五「一眼就能分辨」", () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const trace = css.match(/\.memory-line\.memory-weight-trace span \{([^}]*)\}/);
  const high = css.match(/\.memory-line\.memory-weight-highlight span[^{]*\{([^}]*)\}|\.memory-line\.memory-weight-memory span,\s*\n\.memory-line\.memory-weight-highlight span,\s*\n\.memory-line\.memory-weight-chapter span \{([^}]*)\}/);
  assert.ok(trace, "找不到 trace 行的样式");
  assert.ok(high, "找不到高档行的样式");
  const traceSize = Number((trace[1].match(/font-size:\s*([\d.]+)rem/) ?? [])[1]);
  const highSize = Number(((high[1] ?? high[2]).match(/font-size:\s*([\d.]+)rem/) ?? [])[1]);
  assert.ok(traceSize > 0 && highSize > 0, `字号没解析出来 trace=${traceSize} high=${highSize}`);
  assert.ok(highSize > traceSize * 1.15, `高档行要明显更大：high=${highSize}rem trace=${traceSize}rem`);
});
