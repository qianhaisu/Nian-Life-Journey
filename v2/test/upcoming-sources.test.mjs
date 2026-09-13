// 来源摘要 on the front page (lib/upcoming.ts readHomeUpcomingSources, components/upcoming-tasks.tsx).
//
// The data track supplies one reviewed sentence per kind of evidence, with a role, a modality and
// the day it was said (lib/upcoming-provenance.ts, rows' `provenance` column since 0015). Everything
// below is about what the PAGE may do with that, and every case is one way of turning a source into
// a claim it does not support:
//
//   · 提出 and 完成 are separate rows. 「准备带去」 never becomes 「已经带到了」.
//   · `onDay` is the day somebody SPOKE. It renders as 记录于 and never as the day it happened.
//     `happenedOn` is the day it happened, and when the source did not say, nothing is printed —
//     the 2026-09-10 case, where 「已经带他看过咳嗽」 is a retelling of a visit on no stated date.
//   · modality survives. A question stays a question and a plan stays a plan.
//   · `unconfirmed` prints itself. No name is guessed.
//   · pending_review, no-source and a FAILED READ are three different sentences, and the third one
//     may not borrow either of the other two.
//
// The fixtures are shaped after the real rows (the cough item's 妈妈/plan raised note and 爸爸/relayed
// completion note are the two the data track quoted in its handoff), but they are fixtures: nothing
// here asserts what is in any database.
import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readHomeUpcomingSources } from "../lib/upcoming.ts";
// tsconfig sets jsx:"preserve" for Next, so tsx compiles these components with the classic runtime
// and their bodies call the global `React`. Next supplies it; a bare node --test run must.
globalThis.React ??= React;
const { UpcomingTasks } = await import("../components/upcoming-tasks.tsx");

const TODAY = "2026-09-13";
const BIRTH = "2025-01-03";

const item = (id, status, when, extra = {}) => ({
  id, title: `事项 ${id}`, when, status, evidence: { day: "2026-09-09" }, ...extra,
});
const note = (role, modality, summary, onDay, happenedOn) => ({ role, modality, summary, onDay, ...(happenedOn ? { happenedOn } : {}) });
const MUM = { kind: "family_member", role: "妈妈" };
const DAD = { kind: "family_member", role: "爸爸" };

function render(items, sources) {
  return renderToStaticMarkup(React.createElement(UpcomingTasks, {
    feed: { status: "ready", items }, today: TODAY, birthDay: BIRTH, sources,
  }));
}
const ready = (list) => ({ status: "ready", byItem: new Map(list.map((entry) => [entry.itemId, entry])) });

// The real pair: a mother's plan on 09-09, a father's retelling on 09-10 that the visit had already
// happened. The visit's own date is not in the archive, and this is the case that decides whether
// the page invents one.
const COUGH = item("cough", "done", { kind: "day", day: "2026-09-09" }, { statusEvidence: { day: "2026-09-10" } });
const COUGH_SOURCE = {
  itemId: "cough", reviewState: "approved", noChangeEvidence: false,
  raised: note(MUM, "plan", "妈妈先问要不要带他去看咳嗽，当天下午决定自己带他去。", "2026-09-09"),
  completed: note(DAD, "relayed", "爸爸说已经带他看过咳嗽，也吃了些药。", "2026-09-10"),
};

test("提出与完成是两行，各自带自己的角色、语气和日期", () => {
  const html = render([COUGH], ready([COUGH_SOURCE]));
  assert.match(html, /提出/);
  assert.match(html, /完成/);
  assert.match(html, /妈妈先问要不要带他去看咳嗽/);
  assert.match(html, /爸爸说已经带他看过咳嗽/);
  // Two rows, not one merged line — the whole point is that the family can see which message is
  // behind which half of the claim.
  assert.equal((html.match(/upcoming-source-row--/g) ?? []).length, 2);
  assert.match(html, /upcoming-source-row--raised/);
  assert.match(html, /upcoming-source-row--completed/);
});

test("done 不能把提出依据当完成依据：提出那句和完成那句各自挂在自己的标签下", () => {
  const html = render([COUGH], ready([COUGH_SOURCE]));
  const raised = html.slice(html.indexOf("upcoming-source-row--raised"), html.indexOf("upcoming-source-row--completed"));
  assert.match(raised, /提出/);
  assert.match(raised, /妈妈先问要不要带他去看咳嗽/);
  assert.ok(!raised.includes("爸爸说已经带他看过"), "提出那一行里不能出现完成的摘要");
  const completed = html.slice(html.indexOf("upcoming-source-row--completed"));
  assert.ok(!completed.includes("妈妈先问要不要带他去看咳嗽"), "完成那一行里不能出现提出的摘要");
});

test("onDay 只说「记录于」；没有 happenedOn 就不给实际发生日期", () => {
  const html = render([COUGH], ready([COUGH_SOURCE]));
  assert.equal((html.match(/记录于/g) ?? []).length, 2, "两行各说一次自己是哪天记下的");
  // The 09-10 retelling must not become a visit on 09-10, in any wording.
  assert.ok(!html.includes("实际完成于"), "来源没说哪天去的，页面就不能写实际完成日期");
  assert.ok(!html.includes("完成于 9 月 10 日"));
  assert.ok(!html.includes("就诊"), "页面不自己写「就诊」——那是来源里的事实，不是页面的措辞");
});

test("有 happenedOn 才写实际发生日期，而且写的是那一天，不是说话那一天", () => {
  const withDay = { ...COUGH_SOURCE, completed: note(DAD, "statement", "爸爸说 9 月 8 日带他去了医院。", "2026-09-10", "2026-09-08") };
  const html = render([COUGH], ready([withDay]));
  assert.match(html, /实际完成于/);
  assert.match(html, /实际完成于[\s\S]{0,80}2026-09-08/);
  assert.match(html, /记录于[\s\S]{0,80}2026-09-10/);
});

test("语气不能丢：疑问、计划、条件、转述各有各的词", () => {
  const tones = [["question", "问起"], ["plan", "打算"], ["condition", "有条件"], ["relayed", "转述"], ["statement", "说起"]];
  for (const [modality, label] of tones) {
    const html = render(
      [item("t", "open", { kind: "day", day: "2026-09-20" })],
      ready([{ itemId: "t", reviewState: "approved", noChangeEvidence: true, raised: note(MUM, modality, "一句经审核的摘要。", "2026-09-09") }]),
    );
    assert.match(html, new RegExp(label), `${modality} 应渲染成「${label}」`);
  }
});

test("来源人物未确认：照实写出来，不填名字", () => {
  const html = render(
    [item("u", "open", { kind: "unconfirmed" })],
    ready([{ itemId: "u", reviewState: "approved", noChangeEvidence: true, raised: note({ kind: "unconfirmed" }, "statement", "有人提到要去拿鞋子。", "2026-09-09") }]),
  );
  assert.match(html, /来源人物未确认/);
  assert.match(html, /upcoming-source-role--unconfirmed/);
  assert.ok(!/妈妈|爸爸|奶奶|外公|老师/.test(html), "未确认就不能出现任何角色名");
});

test("record_check 写来源性质，不假装是聊天里的人", () => {
  const html = render(
    [item("r", "open", { kind: "day", day: "2026-09-20" })],
    ready([{ itemId: "r", reviewState: "approved", noChangeEvidence: true, raised: note({ kind: "record_check", label: "档案核对" }, "statement", "档案里缺一次体检记录，待核对。", "2026-09-09") }]),
  );
  assert.match(html, /档案核对/);
  assert.ok(!html.includes("来源人物未确认"), "有真实来源性质就不写未确认");
});

test("pending_review 是「待审核」，不是「没有来源」", () => {
  const html = render(
    [item("p", "open", { kind: "day", day: "2026-09-20" })],
    ready([{ itemId: "p", reviewState: "pending_review", noChangeEvidence: true }]),
  );
  assert.match(html, /来源摘要待审核/);
  assert.ok(!html.includes("没有来源"));
  assert.ok(!html.includes("暂无"));
  // The item is still on the page, with its own checkable link.
  assert.match(html, /事项 p/);
  assert.match(html, /翻到/);
});

test("读取失败：自己说自己，既不说待审核，也不说没有来源，待办一条都不少", () => {
  const items = [item("a", "open", { kind: "day", day: "2026-09-20" }), item("b", "open", { kind: "day", day: "2026-09-21" })];
  const html = render(items, { status: "unreadable", reason: "the source read threw: connection terminated" });
  assert.match(html, /来源摘要这次没有读出来/);
  assert.ok(!html.includes("待审核"), "读挂了不能伪装成待审核");
  assert.ok(!/没有来源|暂无来源|无来源/.test(html), "也不能伪装成这几条事项本来就没有来源");
  assert.match(html, /事项 a/);
  assert.match(html, /事项 b/);
  assert.ok(!html.includes("upcoming-source-row"), "读不出来就一行摘要都不画");
  // The failure is stated once for the block, not once per todo.
  assert.equal((html.match(/upcoming-sources-unreadable/g) ?? []).length, 1);
});

test("没有来源读取时（sources 未传），页面回到原来的依据行，不说任何关于来源的话", () => {
  const html = render([item("a", "open", { kind: "day", day: "2026-09-20" })], undefined);
  assert.ok(!html.includes("待审核"));
  assert.ok(!html.includes("upcoming-source-row"));
  assert.match(html, /来源/, "原来的「来源 · 日期 · 翻到某月」仍在");
});

test("有了摘要行，同一个日期不再在上面重复印一遍", () => {
  const html = render([COUGH], ready([COUGH_SOURCE]));
  assert.ok(!html.includes("upcoming-meta"), "四种依据都有摘要行时，裸依据行整行不渲染");
  // 一条只有提出摘要、却有变更证据的事项：变更那半仍然给出可核对的链接。
  const halfHtml = render([COUGH], ready([{ ...COUGH_SOURCE, completed: undefined }]));
  assert.match(halfHtml, /后续/);
  assert.ok(!halfHtml.includes("完成于"), "没有完成摘要时也不写「完成于 X 日」");
});

test("排序、分组、删除线、展开都不因为来源摘要而改变", () => {
  const items = [
    item("done-1", "done", { kind: "day", day: "2026-09-09" }, { statusEvidence: { day: "2026-09-10" } }),
    item("open-1", "open", { kind: "day", day: "2026-09-20" }),
    item("tent-1", "tentative", { kind: "window", fromDay: "2026-09-07", toDay: "2026-09-13" }),
    item("open-2", "open", { kind: "unconfirmed" }),
    item("open-3", "open", { kind: "day", day: "2026-08-11" }),
  ];
  const sources = ready(items.map((row) => ({ itemId: row.id, reviewState: "approved", noChangeEvidence: true, raised: note(MUM, "statement", `关于 ${row.id} 的一句话。`, "2026-09-09") })));
  const withSources = render(items, sources);
  const without = render(items, undefined);
  const groups = (html) => [...html.matchAll(/upcoming-group--(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(groups(withSources), groups(without), "分组与组序不变");
  const order = (html) => [...html.matchAll(/事项 ([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(order(withSources), order(without), "条目次序不变");
  assert.match(withSources, /<del>事项 done-1<\/del>/, "完成仍然有删除线");
  assert.match(withSources, /展开全部/, "展开仍在");
});

test("readHomeUpcomingSources：按 itemId 归位，读挂了就是 unreadable", async () => {
  const ok = await readHomeUpcomingSources(async () => [COUGH_SOURCE, { itemId: "other", reviewState: "pending_review", noChangeEvidence: true }]);
  assert.equal(ok.status, "ready");
  assert.equal(ok.byItem.get("cough").raised.role.role, "妈妈");
  assert.equal(ok.byItem.get("other").reviewState, "pending_review");
  assert.equal(ok.byItem.size, 2);

  const failed = await readHomeUpcomingSources(async () => { throw new Error("connection terminated unexpectedly"); });
  assert.equal(failed.status, "unreadable", "读挂了不是「一条摘要都没有」");
  assert.match(failed.reason, /connection terminated/);
});
