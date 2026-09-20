// HEALTH-01：微信导出去重规则的合成样本验证。
// 覆盖计划第 9 节点名的两类：群名变更、重复导入。全部用合成数据，不含真实病历或家庭消息。
import test from "node:test";
import assert from "node:assert/strict";
import {
  messageKey,
  compareExports,
  selectCanonical,
  countDistinctMessages,
} from "../scripts/health-audit/wechat-export-dedupe.mjs";

const msg = (id, t) => ({ platformMessageId: String(id), createTime: t, content: `m${id}` });
const run = (n, from = 1000) => Array.from({ length: n }, (_, i) => msg(i + 1, from + i));

test("消息键：platformMessageId 缺失时退回 localId，两者都缺则无键", () => {
  assert.equal(messageKey({ platformMessageId: "7", createTime: 5 }), "7@5");
  assert.equal(messageKey({ localId: 7, createTime: 5 }), "local:7@5");
  assert.equal(messageKey({ createTime: 5 }), null);
});

test("同一消息 ID 但 createTime 不同不算同一条，不会被悄悄合并", () => {
  assert.equal(compareExports([msg(1, 100)], [msg(1, 200)]), "disjoint");
});

test("群名变更后重复导出：旧导出是新导出的真子集，判 superseded 而不是两个群", () => {
  const older = run(7799);
  const newer = [...older, ...run(66, 90000)];
  assert.equal(compareExports(newer, older), "a_superset");

  const sel = selectCanonical([
    { dir: "群聊_旧名", file: "旧.json", format: "json", wxid: "44486556869@chatroom", messages: older },
    { dir: "群聊_新名", file: "新.json", format: "json", wxid: "44486556869@chatroom", messages: newer },
  ]);
  const old_ = sel.find((e) => e.dir === "群聊_旧名");
  const new_ = sel.find((e) => e.dir === "群聊_新名");
  assert.equal(old_.status, "superseded");
  assert.equal(old_.canonical, false);
  assert.equal(old_.supersededBy, "群聊_新名");
  assert.equal(new_.canonical, true);
  // 关键：总数是超集的 7865，不是 7799+7865
  assert.equal(countDistinctMessages(sel), 7865);
});

test("目录名不同但 wxid 相同才算同一会话；wxid 不同的两个群不互相压制", () => {
  const sel = selectCanonical([
    { dir: "群A", file: "a.json", format: "json", wxid: "aaa@chatroom", messages: run(5) },
    { dir: "群B", file: "b.json", format: "json", wxid: "bbb@chatroom", messages: run(5) },
  ]);
  assert.deepEqual(sel.map((e) => e.status), ["canonical", "canonical"]);
  // 内容指纹相同不等于同一会话：两个群各自保留
  assert.equal(countDistinctMessages(sel), 5);
});

test("wxid 缺失时退回目录名，不把身份不明的两份误判为同一会话", () => {
  const sel = selectCanonical([
    { dir: "未知1", file: "a.json", format: "json", wxid: null, messages: run(3) },
    { dir: "未知2", file: "b.json", format: "json", wxid: null, messages: run(3) },
  ]);
  assert.deepEqual(sel.map((e) => e.canonical), [true, true]);
});

test("同一会话 JSON 与 Markdown 并存：JSON 为规范输入，Markdown 不重复计数", () => {
  const full = run(600);
  const sel = selectCanonical([
    { dir: "群C", file: "c.json", format: "json", wxid: "ccc@chatroom", messages: full },
    { dir: "群C", file: "c.md", format: "md", wxid: "ccc@chatroom", messages: full.slice(0, 50) },
  ]);
  const md = sel.find((e) => e.format === "md");
  assert.equal(md.status, "secondary_format");
  assert.equal(md.canonical, false);
  assert.equal(countDistinctMessages(sel), 600);
});

test("只有 Markdown 的会话，Markdown 就是规范输入", () => {
  const sel = selectCanonical([
    { dir: "私聊D", file: "d.md", format: "md", wxid: "ddd", messages: run(42) },
  ]);
  assert.equal(sel[0].canonical, true);
  assert.equal(countDistinctMessages(sel), 42);
});

test("部分重叠且谁都不是超集：标 overlapping 交人工，不自动丢弃任何一份", () => {
  const a = run(10);
  const b = [...a.slice(5), ...run(5, 50000)];
  assert.equal(compareExports(a, b), "overlapping");
  const sel = selectCanonical([
    { dir: "群E1", file: "e1.json", format: "json", wxid: "eee@chatroom", messages: a },
    { dir: "群E2", file: "e2.json", format: "json", wxid: "eee@chatroom", messages: b },
  ]);
  assert.ok(sel.every((e) => e.status === "overlapping"));
  assert.ok(sel.every((e) => e.canonical), "重叠时不擅自丢弃，两份都留着");
});

test("重复导入同一份：内容完全相同只保留一份，不翻倍", () => {
  const same = run(120);
  assert.equal(compareExports(same, same.slice()), "identical");
  const sel = selectCanonical([
    { dir: "群F-导出1", file: "f1.json", format: "json", wxid: "fff@chatroom", messages: same },
    { dir: "群F-导出2", file: "f2.json", format: "json", wxid: "fff@chatroom", messages: same.slice() },
  ]);
  assert.equal(sel.filter((e) => e.canonical).length, 1);
  assert.equal(countDistinctMessages(sel), 120);
});

test("重复运行结果稳定：同一输入两次选择结论一致", () => {
  const input = () => [
    { dir: "群G-旧", file: "g1.json", format: "json", wxid: "ggg@chatroom", messages: run(100) },
    { dir: "群G-新", file: "g2.json", format: "json", wxid: "ggg@chatroom", messages: run(140) },
  ];
  const a = selectCanonical(input()).map((e) => [e.dir, e.status]);
  const b = selectCanonical(input()).map((e) => [e.dir, e.status]);
  assert.deepEqual(a, b);
});
