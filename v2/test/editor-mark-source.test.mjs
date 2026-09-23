import test from "node:test";
import assert from "node:assert/strict";
import { classifyDays, dayFingerprint } from "../scripts/editor/mark-source.mjs";
import { appendDay } from "../scripts/editor/append-day.mjs";

// 2026-09-23：9/19 批量生成的天没有 _source，被 append-day 一律当人工内容锁死。
// mark-source 只凭生成记录判定「机器写的」；对不上的一律不标记（= 继续按人工保护）。
const d = (day, title, extra = {}) => ({ day, kind: "story", title, paragraphs: [`${title}。`], firstScreenMediaIds: [], expandedMediaIds: [], ...extra });
const month = (days) => ({ schema: "nianlife.month-content/1", month: "2025-12", days });

test("和批量生成产物逐字相同的天标成 machine，并写明依据", () => {
  const built = month([d("2025-12-01", "一号"), d("2025-12-02", "二号")]);
  const current = month([d("2025-12-01", "一号", { ageLabel: "0岁10个月" }), d("2025-12-02", "二号")]);
  const { content, stats } = classifyDays(current, { generated: [{ label: "batch-20260919", content: built }] });
  assert.deepEqual(stats, { machine: 2, human: 0, unknown: 0 });
  assert.equal(content.days[0]._source, "machine");
  assert.equal(content.days[0]._sourceBasis, "batch-20260919");
});

test("和生成记录对不上的天（有人改过一个字）不标记，继续按人工保护", () => {
  const built = month([d("2025-12-01", "一号")]);
  const current = month([d("2025-12-01", "一号", { paragraphs: ["一号，改过一个字。"] })]);
  const { content, stats, days } = classifyDays(current, { generated: [{ label: "batch", content: built }] });
  assert.deepEqual(stats, { machine: 0, human: 0, unknown: 1 });
  assert.equal(content.days[0]._source, undefined);
  assert.match(days[0].basis, /按人工处理/);
  // append-day 仍然拒绝覆盖它
  assert.equal(appendDay(content, { day: "2025-12-01", kind: "story", title: "新", paragraphs: ["新"] }, { birthDay: "2025-01-03" }).skipped, true);
});

test("已有的 human 标记原样保留；夜间编辑账上发布过的天算 machine", () => {
  const current = month([d("2025-12-01", "一号", { _source: "human" }), d("2025-12-02", "二号")]);
  const { stats, content } = classifyDays(current, { ledgerPublished: [{ day: "2025-12-02", title: "二号" }] });
  assert.deepEqual(stats, { machine: 1, human: 1, unknown: 0 });
  assert.equal(content.days[0]._source, "human");
});

test("有记录的机器修订（修订后的版本也在生成记录里）算 machine", () => {
  const revised = month([d("2025-12-01", "一号（修订）")]);
  const { stats } = classifyDays(revised, { generated: [{ label: "batch", content: month([d("2025-12-01", "一号")]) }, { label: "d1-fix", content: revised }] });
  assert.equal(stats.machine, 1);
});

test("指纹只看页面上显示的字段", () => {
  assert.equal(dayFingerprint(d("x", "t", { ageLabel: "a", sourceIds: ["1"] })), dayFingerprint(d("x", "t")));
  assert.notEqual(dayFingerprint(d("x", "t")), dayFingerprint(d("x", "t", { expandedMediaIds: ["m"] })));
});
