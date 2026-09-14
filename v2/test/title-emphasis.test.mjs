// 首页题签的局部着色（lib/title-emphasis.ts）与首页主照片的去处（components/home-lead.tsx）。
// 2026-09-14 用户反馈：着色不该只有 cold / hot 那一篇；点首页照片应该进入这张照片那一天的故事，不是放大。
import test from "node:test";
import assert from "node:assert/strict";
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
  story: { eventId, href: `/events/${eventId}`, title },
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
