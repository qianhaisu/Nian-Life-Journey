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

test("首页便签的标签说清这块是什么：「这几天的提醒事项」（可见文字与区域名称一致）", async () => {
  const { HomeReminders } = await import("../components/home-reminders.tsx");
  const html = renderToStaticMarkup(React.createElement(HomeReminders, { reminders: [{ id: "r1", title: "合成提醒", whenText: "9 月 15 日", whenDay: "2026-09-15", sources: [] }] }));
  assert.match(html, /<section class="home-notes" aria-label="这几天的提醒事项"><p class="home-notes-label">这几天的提醒事项<\/p>/);
  assert.equal(renderToStaticMarkup(React.createElement(HomeReminders, { reminders: [] })), "", "没有有效提醒时整块不画，不写成「全部完成」");
});

test("首页题签按规则局部着色，其余文字保持原样", () => {
  const html = render({ slides: [slide("event-v2-e98e09bddcec2801bcb726d0261d7d3d", "小年也扎了个小辫子", "wechat-media:def")], today: "2026-09-14" });
  assert.match(html, /<h1 class="home-title"><span>小年也扎了个<\/span><span class="home-emphasis home-emphasis--sage">小辫子<\/span><\/h1>/);
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

// PAGE-0915-FULL-REMEDIATION-R1 A1：题签旁要有故事自己的日子，跟页面顶部「今天/现在几岁」
// （clockLine）分开一行——不能让一段旧故事的标题看起来像今天发生的。
test("题签下面单独一行故事自己的日期与当时年龄，和顶部的「今天」分开", () => {
  const html = render({ slides: [slide("event-v2-11f294e5906320de95580078c404cb59", "体重接近23斤了", "wechat-media:x")], clockLine: "2026 年 9 月 15 日 · 现在 1 岁 8 个月", today: "2026-09-15" });
  assert.match(html, /<p class="home-today"><time dateTime="2026-09-15">2026 年 9 月 15 日 · 现在 1 岁 8 个月<\/time><\/p>/);
  assert.match(html, /<p class="home-story-when"><time dateTime="2025-12-18">2025 年 12 月 18 日<\/time><span> · 当时 11 个月<\/span><\/p>/);
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

test("app/home.css：桌面竖照/方照按约 75dvh 限高（带地板与天花板），横照不套这条、左栏整体居中而不是上下分推", () => {
  const css = fs.readFileSync(new URL("../app/home.css", import.meta.url), "utf8");
  const desktop = css.slice(css.indexOf("@media (min-width: 900px)"));
  const heightRule = desktop.match(/\.home-figure--portrait \.home-photo img,\s*\n\s*\.home-figure--square \.home-photo img \{([^}]*)\}/);
  assert.ok(heightRule, "找不到竖照/方照的限高规则");
  assert.match(heightRule[1], /max-height:\s*clamp\(420px,\s*75dvh,\s*780px\)/);
  assert.doesNotMatch(desktop, /\.home-figure--landscape[^,{]*\{[^}]*max-height/, "横照不应该被单独限高");
  const asideRule = desktop.match(/\.home-aside \{([^}]*)\}/)[1];
  assert.match(asideRule, /justify-content:\s*center/);
  assert.doesNotMatch(asideRule, /space-between/);
  assert.match(asideRule, /gap:\s*clamp\(56px,\s*6vw,\s*72px\)/);
});
