// 「每周提醒」组件（2026-09-16 改版）。
//
// 这个文件原本钉的是旧版便签（.home-note / 「这几天的提醒事项」/ 无内容时不画「＋」）。
// 那一版已经被用户 2026-09-16 的第 4、5 条取代：标题统一成「每周提醒」，每条带一个真的复选框，
// 来源收进独立的「查看来源」。测试跟着产品走，断言换成新的承诺——不是把旧断言删掉了事。
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.React ??= React;
const { HomeReminders } = await import("../components/home-reminders.tsx");

const bare = (id, title) => ({ id, title, whenText: "时间待确认", sources: [] });
const render = (props) => renderToStaticMarkup(React.createElement(HomeReminders, { storageScope: "p1", ...props }));

test("标题是「每周提醒」，旧名字一个都不出现", () => {
  const html = render({ reminders: [bare("r1", "带尿不湿")] });
  assert.match(html, /每周提醒/);
  assert.doesNotMatch(html, /这几天的提醒事项/);
  assert.doesNotMatch(html, /给爸爸妈妈的每周提醒/);
});

test("一条都没有时，标题照画、下面留白——不写「全部完成」、不放空卡", () => {
  const html = render({ reminders: [] });
  assert.match(html, /每周提醒/, "标题保留");
  assert.doesNotMatch(html, /全部完成|暂无|没有待办/, "不能把留白说成别的意思");
  assert.doesNotMatch(html, /<li/, "没有事项就没有列表项");
});

test("每条提醒都有一个真的复选框，并且标签和它绑定（键盘与读屏可用）", () => {
  const html = render({ reminders: [bare("r1", "带尿不湿")] });
  assert.match(html, /<input[^>]*type="checkbox"/, "必须是原生 checkbox，不是 div 假装的");
  assert.match(html, /id="weekly-r1"/);
  assert.match(html, /for="weekly-r1"/, "label 必须 for 到那个 input，否则点标签不切换、读屏也读不出关系");
});

test("默认未勾选：服务端渲染不能把已保存的勾选状态冲掉", () => {
  const html = render({ reminders: [bare("r1", "带尿不湿")] });
  assert.doesNotMatch(html, /checked/, "SSR 一律未勾选，真实状态挂载后从本机读");
  assert.doesNotMatch(html, /is-checked/);
});

test("查看来源是独立交互，不套在勾选的 label 里", () => {
  const withSource = {
    ...bare("r2", "给崽约体检"),
    sources: [{
      kindLabel: "提出", roleText: "妈妈", toneLabel: "打算",
      recordedOn: "2026-09-12", recordedOnLabel: "2026 年 9 月 12 日",
      summary: "妈妈说想约个体检。", link: { href: "/memory/2026/09", label: "翻到 2026 年 9 月" },
    }],
  };
  const html = render({ reminders: [withSource] });
  assert.match(html, /<details class="weekly-detail">/);
  assert.match(html, /查看来源/);
  // label 在 details 之前闭合：点「查看来源」不会连带勾选那一条。
  const labelEnd = html.indexOf("</label>");
  const detailsStart = html.indexOf("<details");
  assert.ok(labelEnd > 0 && detailsStart > labelEnd, "details 必须在 label 之外");
});

test("没有 note 也没有 sources 时不画一个点开什么都没有的「查看来源」", () => {
  const html = render({ reminders: [bare("r1", "买鸡蛋")] });
  assert.doesNotMatch(html, /<details/);
});

test("超出默认位的本周事项收在可展开处，一条都不会因为放不下而消失", () => {
  const html = render({ reminders: [bare("r1", "第一条"), bare("r2", "第二条")], more: [bare("r3", "第三条")] });
  assert.match(html, /<details class="weekly-more">/);
  assert.match(html, /本周还记着的其他事/);
  assert.match(html, /第三条/);
  assert.doesNotMatch(html, /还有 \d+ 条|共 \d+ 条/, "折叠标题不写数字（原则三）");
});

test("statusLabel 有值时照常显示，不因为换了外壳就丢字", () => {
  const html = render({ reminders: [{ ...bare("r3", "带去打疫苗"), statusLabel: "待核实" }] });
  assert.match(html, /带去打疫苗/);
  assert.match(html, /weekly-status">.*待核实/);
});
