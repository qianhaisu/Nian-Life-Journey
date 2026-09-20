// 微信导出去重规则的合成样本验证。
// 覆盖总计划第 9 节点名的场景：群名变更、重复导入，以及 R1 返修点：
// 会话隔离、缺 ID、空 ID、内容/附件变更、无法证明包含时不丢消息。
// 全部合成数据；群 ID 为虚构值，不使用真实会话标识。
import test from "node:test";
import assert from "node:assert/strict";
import {
  messageIdentity,
  contentFingerprint,
  compareExports,
  selectCanonical,
  countDistinctMessages,
  parseMarkdownExport,
  unescapeMarkdown,
  classifyDivergence,
} from "../scripts/health-audit/wechat-export-dedupe.mjs";

const CONV_A = "wxid:10000000001@chatroom.example";
const CONV_B = "wxid:10000000002@chatroom.example";

const msg = (id, t, content = `m${id}`) => ({
  platformMessageId: String(id), createTime: t, content, type: "文本", senderUsername: "u1",
});
const run = (n, from = 1000) => Array.from({ length: n }, (_, i) => msg(i + 1, from + i));

test("消息身份必须带会话；不给会话直接报错，而不是悄悄跨会话合并", () => {
  assert.throws(() => messageIdentity(msg(1, 5), null), /需要会话身份/);
  assert.throws(() => messageIdentity(msg(1, 5), "  "), /需要会话身份/);
});

test("不同会话里 ID 与时间都相同的两条消息，是两条，不是一条", () => {
  const a = messageIdentity(msg(7, 100), CONV_A);
  const b = messageIdentity(msg(7, 100), CONV_B);
  assert.notEqual(a.key, b.key);

  const sel = selectCanonical([
    { dir: "群甲", file: "a.json", format: "json", wxid: "10000000001@chatroom.example", messages: run(50) },
    { dir: "群乙", file: "b.json", format: "json", wxid: "10000000002@chatroom.example", messages: run(50) },
  ]);
  assert.deepEqual(sel.map((e) => e.status), ["canonical", "canonical"]);
  // 两个群各 50 条 = 100，不能被折成 50
  assert.equal(countDistinctMessages(sel).identified, 100);
});

test("空串 / 纯空白 / 'null' 字面量的 platformMessageId 要回退到 localId", () => {
  assert.equal(messageIdentity({ platformMessageId: "", localId: 9, createTime: 1 }, CONV_A).idKind, "local");
  assert.equal(messageIdentity({ platformMessageId: "   ", localId: 9, createTime: 1 }, CONV_A).idKind, "local");
  assert.equal(messageIdentity({ platformMessageId: "null", localId: 9, createTime: 1 }, CONV_A).idKind, "local");
  assert.equal(messageIdentity({ platformMessageId: "0", localId: 9, createTime: 1 }, CONV_A).idKind, "platform");
});

test("localId 标为弱身份，platformMessageId 为强身份", () => {
  assert.equal(messageIdentity({ platformMessageId: "x", createTime: 1 }, CONV_A).strength, "strong");
  assert.equal(messageIdentity({ localId: 3, createTime: 1 }, CONV_A).strength, "weak");
});

test("两个 ID 都缺的消息识别为 null，既不能去重也不能当作已被包含", () => {
  assert.equal(messageIdentity({ createTime: 1, content: "孤儿消息" }, CONV_A), null);
});

test("群名变更后重复导出：可证明包含时才判 superseded", () => {
  const older = run(120);
  const newer = [...older, ...run(6, 90000)];
  const cmp = compareExports(newer, older, CONV_A);
  assert.equal(cmp.verdict, "a_contains_b");
  assert.equal(cmp.containmentProvable, true);

  const sel = selectCanonical([
    { dir: "群聊_旧名", file: "旧.json", format: "json", wxid: "10000000001@chatroom.example", messages: older },
    { dir: "群聊_新名", file: "新.json", format: "json", wxid: "10000000001@chatroom.example", messages: newer },
  ]);
  const old_ = sel.find((e) => e.dir === "群聊_旧名");
  assert.equal(old_.status, "superseded");
  assert.equal(old_.supersededBy, "群聊_新名");
  assert.equal(countDistinctMessages(sel).identified, 126);
});

test("旧导出含无法识别身份的独有消息时，不得判 superseded —— 不丢消息", () => {
  const shared = run(40);
  const older = [...shared, { createTime: 77, content: "没有任何 ID 的独有消息" }];
  const newer = [...shared, ...run(3, 90000)];

  const cmp = compareExports(newer, older, CONV_A);
  assert.equal(cmp.bUnidentified, 1);
  assert.equal(cmp.verdict, "overlapping");
  assert.equal(cmp.containmentProvable, false);

  const sel = selectCanonical([
    { dir: "旧导出", file: "o.json", format: "json", wxid: "10000000001@chatroom.example", messages: older },
    { dir: "新导出", file: "n.json", format: "json", wxid: "10000000001@chatroom.example", messages: newer },
  ]);
  const old_ = sel.find((e) => e.dir === "旧导出");
  assert.equal(old_.status, "overlapping");
  assert.equal(old_.canonical, true, "证明不了包含就保留，不能丢");
  assert.match(old_.reason, /缺少可用 ID/);
});

test("同 ID 但内容变了：不判 identical，标 content_divergent 并保留两份", () => {
  const a = [msg(1, 100, "原始内容"), msg(2, 101)];
  const b = [msg(1, 100, "编辑后的内容"), msg(2, 101)];
  const cmp = compareExports(a, b, CONV_A);
  assert.equal(cmp.verdict, "content_divergent");
  assert.equal(cmp.divergentKeys.length, 1);

  const sel = selectCanonical([
    { dir: "导出甲", file: "a.json", format: "json", wxid: "10000000001@chatroom.example", messages: a },
    { dir: "导出乙", file: "b.json", format: "json", wxid: "10000000001@chatroom.example", messages: b },
  ]);
  assert.ok(sel.every((e) => e.canonical), "内容分歧时两份都留着");
  assert.ok(sel.some((e) => e.status === "content_divergent"));
});

test("同 ID 但附件路径变了也算内容分歧", () => {
  const a = [{ platformMessageId: "1", createTime: 1, type: "图片", mediaPath: "images/a.jpg" }];
  const b = [{ platformMessageId: "1", createTime: 1, type: "图片", mediaPath: "images/b.jpg" }];
  assert.notEqual(contentFingerprint(a[0]), contentFingerprint(b[0]));
  assert.equal(compareExports(a, b, CONV_A).verdict, "content_divergent");
});

test("同一消息 ID 但 createTime 不同不算同一条", () => {
  assert.equal(compareExports([msg(1, 100)], [msg(1, 200)], CONV_A).verdict, "disjoint");
});

test("同一会话 JSON 与 Markdown 并存：JSON 规范，Markdown 不重复计数", () => {
  const full = run(300);
  const sel = selectCanonical([
    { dir: "群丙", file: "c.json", format: "json", wxid: "10000000003@chatroom.example", messages: full },
    { dir: "群丙", file: "c.md", format: "md", wxid: "10000000003@chatroom.example", messages: full.slice(0, 20) },
  ]);
  assert.equal(sel.find((e) => e.format === "md").status, "secondary_format");
  assert.equal(countDistinctMessages(sel).identified, 300);
});

test("只有 Markdown 的会话，Markdown 就是规范输入", () => {
  const sel = selectCanonical([
    { dir: "私聊丁", file: "d.md", format: "md", wxid: "user-0004.example", messages: run(42) },
  ]);
  assert.equal(sel[0].canonical, true);
  assert.equal(countDistinctMessages(sel).identified, 42);
});

test("wxid 缺失时退回目录名，不把身份不明的两份误判为同一会话", () => {
  const sel = selectCanonical([
    { dir: "未知1", file: "a.json", format: "json", wxid: null, messages: run(3) },
    { dir: "未知2", file: "b.json", format: "json", wxid: "", messages: run(3) },
  ]);
  assert.deepEqual(sel.map((e) => e.canonical), [true, true]);
  assert.equal(countDistinctMessages(sel).identified, 6);
});

test("重复导入同一份：内容完全相同只保留一份，不翻倍", () => {
  const same = run(60);
  assert.equal(compareExports(same, same.slice(), CONV_A).verdict, "identical");
  const sel = selectCanonical([
    { dir: "群戊-导出1", file: "f1.json", format: "json", wxid: "10000000005@chatroom.example", messages: same },
    { dir: "群戊-导出2", file: "f2.json", format: "json", wxid: "10000000005@chatroom.example", messages: same.slice() },
  ]);
  assert.equal(sel.filter((e) => e.canonical).length, 1);
  assert.equal(countDistinctMessages(sel).identified, 60);
});

test("无法识别身份的消息单独计数，不并入去重数也不被丢弃", () => {
  const sel = selectCanonical([
    { dir: "群己", file: "g.json", format: "json", wxid: "10000000006@chatroom.example",
      messages: [...run(10), { createTime: 1, content: "无 ID 1" }, { createTime: 2, content: "无 ID 2" }] },
  ]);
  const c = countDistinctMessages(sel);
  assert.deepEqual(c, { identified: 10, unidentified: 2, total: 12 });
});

test("重复运行结果稳定：同一输入两次选择结论一致", () => {
  const input = () => [
    { dir: "群庚-旧", file: "g1.json", format: "json", wxid: "10000000007@chatroom.example", messages: run(100) },
    { dir: "群庚-新", file: "g2.json", format: "json", wxid: "10000000007@chatroom.example", messages: run(140) },
  ];
  assert.deepEqual(
    selectCanonical(input()).map((e) => [e.dir, e.status]),
    selectCanonical(input()).map((e) => [e.dir, e.status]),
  );
});

test("附件从占位符落盘为文件路径：算版本升级，不算内容改动，选更全的那份并留说明", () => {

  const placeholder = { platformMessageId: "9", createTime: 50, type: "视频消息", localType: 43, content: "[视频]", senderUsername: "u9" };
  const resolved = { ...placeholder, content: "media/videos/20260101_000000_1.mp4" };
  assert.equal(classifyDivergence(resolved, placeholder), "attachment_resolved_in_a");
  assert.equal(classifyDivergence(placeholder, resolved), "attachment_resolved_in_b");

  const older = [...run(30), placeholder];
  const newer = [...run(30), resolved, ...run(4, 90000)];
  const cmp = compareExports(newer, older, CONV_A);
  assert.equal(cmp.verdict, "a_contains_b");
  assert.equal(cmp.containmentProvable, true);

  const sel = selectCanonical([
    { dir: "旧导出", file: "o.json", format: "json", wxid: "10000000008@chatroom.example", messages: older },
    { dir: "新导出", file: "n.json", format: "json", wxid: "10000000008@chatroom.example", messages: newer },
  ]);
  const old_ = sel.find((e) => e.dir === "旧导出");
  assert.equal(old_.status, "superseded");
  assert.match(old_.reason, /占位符/, "必须写清楚为什么选新的那份");
  assert.deepEqual(old_.notes, [{ against: "新导出", attachmentResolvedInCanonical: 1 }]);
});

test("反向：待压制的那份附件更全时，不判包含——不能丢掉更完整的版本", () => {
  const placeholder = { platformMessageId: "9", createTime: 50, type: "视频消息", localType: 43, content: "[视频]", senderUsername: "u9" };
  const resolved = { ...placeholder, content: "media/videos/x.mp4" };
  const bigger = [...run(30), placeholder, ...run(4, 90000)];
  const smallerButRicher = [...run(30), resolved];
  const cmp = compareExports(bigger, smallerButRicher, CONV_A);
  assert.equal(cmp.verdict, "content_divergent");
  assert.equal(cmp.containmentProvable, false);
});

test("被压制那份附件较旧时，超集自己不能被反向比较标成分歧", () => {
  const placeholder = { platformMessageId: "9", createTime: 50, type: "视频消息", localType: 43, content: "[视频]", senderUsername: "u9" };
  const resolved = { ...placeholder, content: "media/videos/y.mp4" };
  const older = [...run(30), placeholder];
  const newer = [...run(30), resolved, ...run(4, 90000)];
  const sel = selectCanonical([
    { dir: "旧导出", file: "o.json", format: "json", wxid: "10000000009@chatroom.example", messages: older },
    { dir: "新导出", file: "n.json", format: "json", wxid: "10000000009@chatroom.example", messages: newer },
  ]);
  assert.equal(sel.find((e) => e.dir === "新导出").status, "canonical");
  assert.equal(sel.find((e) => e.dir === "旧导出").status, "superseded");
  assert.equal(countDistinctMessages(sel).identified, 35);
});

// ---- R2：Codex 复现的两条丢版本路径 ----

test("F4a 同一份导出内同键两个版本，不得被 Map 覆盖后误判 identical", () => {
  const newer = { platformMessageId: "1", createTime: 10, content: "新内容", type: "t", senderUsername: "u" };
  const older = { platformMessageId: "1", createTime: 10, content: "旧内容", type: "t", senderUsername: "u" };
  const A = [newer];
  const B = [older, newer];
  const cmp = compareExports(A, B, CONV_A);
  assert.notEqual(cmp.verdict, "identical", "A 缺了 B 的旧版本，不能判 identical");
  assert.equal(cmp.containmentProvable, false, "A 不包含 B");
  assert.equal(cmp.divergences[0].versionsInB, 2);
  assert.equal(cmp.divergences[0].versionsMissingInA, 1);

  const sel = selectCanonical([
    { dir: "少版本", file: "a.json", format: "json", wxid: "10000000010@chatroom.example", messages: A },
    { dir: "多版本", file: "b.json", format: "json", wxid: "10000000010@chatroom.example", messages: B },
  ]);
  assert.ok(sel.every((e) => e.canonical), "证明不了包含，两份都保留");
});

test("F4b Markdown 含 JSON 没有的独有消息时，不得因格式被压制", () => {
  const shared = run(20);
  const jsonExport = shared;
  const mdExport = [...shared, msg(999, 77777, "只在 Markdown 里的一条")];
  const sel = selectCanonical([
    { dir: "导出JSON", file: "a.json", format: "json", wxid: "10000000011@chatroom.example", messages: jsonExport },
    { dir: "导出MD", file: "b.md", format: "md", wxid: "10000000011@chatroom.example", messages: mdExport },
  ]);
  const md = sel.find((e) => e.format === "md");
  assert.equal(md.status, "format_variant_unverified");
  assert.equal(md.canonical, true, "有独有消息就不能当格式副本丢掉");
  assert.equal(countDistinctMessages(sel).identified, 21, "独有消息必须计入");
});

test("F4b 已证明被 JSON 完整包含的 Markdown，才降为 secondary_format", () => {
  const full = run(30);
  const sel = selectCanonical([
    { dir: "导出JSON", file: "a.json", format: "json", wxid: "10000000012@chatroom.example", messages: full },
    { dir: "导出MD", file: "b.md", format: "md", wxid: "10000000012@chatroom.example", messages: full.slice(0, 10) },
  ]);
  const md = sel.find((e) => e.format === "md");
  assert.equal(md.status, "secondary_format");
  assert.equal(md.supersededBy, "导出JSON");
  assert.equal(countDistinctMessages(sel).identified, 30);
});

// ---------------------------------------------------------------------------
// R3：Markdown 导出的真实解析。
// 背景：盘点脚本一度用 {localId: i+1, createTime: 0, content: ""} 伪造 Markdown
// 消息去比对，结论与真实内容无关。解析必须真解析，且不得编造 ID。
// ---------------------------------------------------------------------------

const MD_SAMPLE = [
  "# 会话记录",
  "会话ID: `10000000020@chatroom.example`",
  "",
  "## 2026-01-02 08:00:00 甲",
  "第一条正文",
  "",
  "## 2026-01-02 08:00:05 乙",
  "第二条第一行",
  "第二条第二行",
  "",
  "## 2026-01-02 08:00:09 甲",
  "带转义的内容 \- 破折号 \[方括号\] \. 句点",
].join("\n");

test("R3a Markdown 解析出真实条数、时间、发送人与多行正文", () => {
  const msgs = parseMarkdownExport(MD_SAMPLE);
  assert.equal(msgs.length, 3);
  assert.equal(msgs[0].createTime, "2026-01-02 08:00:00");
  assert.equal(msgs[0].senderDisplayName, "甲");
  assert.equal(msgs[0].content, "第一条正文");
  assert.equal(msgs[1].content, "第二条第一行\n第二条第二行", "多行正文必须完整保留");
  assert.equal(msgs[2].content, "带转义的内容 - 破折号 [方括号] . 句点", "转义必须还原");
});

test("R3b 解析不编造 ID —— Markdown 消息在会话内一律无法识别身份", () => {
  const msgs = parseMarkdownExport(MD_SAMPLE);
  for (const m of msgs) {
    assert.equal(m.localId, undefined, "不得编造 localId");
    assert.equal(m.platformMessageId, undefined, "不得编造 platformMessageId");
    assert.equal(messageIdentity(m, "10000000020@chatroom.example"), null);
  }
  const sel = selectCanonical([
    { dir: "仅MD", file: "a.md", format: "md",
      wxid: "10000000020@chatroom.example", messages: msgs },
  ]);
  // 只有一份导出时它就是规范输入；但消息全部不可识别，必须如实计入 unidentified
  assert.equal(sel[0].canonical, true);
  const c = countDistinctMessages(sel);
  assert.equal(c.identified, 0);
  assert.equal(c.unidentified, 3);
  assert.equal(c.total, 3, "不可识别的消息不能被悄悄丢掉");
});

test("R3c 真实 Markdown 喂进比较时，无 ID 即无法证明被包含（绝不因此丢内容）", () => {
  const json = [
    { platformMessageId: "p1", createTime: "2026-01-02 08:00:00", content: "第一条正文" },
    { platformMessageId: "p2", createTime: "2026-01-02 08:00:05",
      content: "第二条第一行\n第二条第二行" },
  ];
  const md = parseMarkdownExport(MD_SAMPLE);
  const sel = selectCanonical([
    { dir: "导出JSON", file: "a.json", format: "json",
      wxid: "10000000021@chatroom.example", messages: json },
    { dir: "导出MD", file: "b.md", format: "md",
      wxid: "10000000021@chatroom.example", messages: md },
  ]);
  const m = sel.find((e) => e.format === "md");
  assert.equal(m.status, "format_variant_unverified");
  assert.equal(m.canonical, true, "证明不了包含就必须保留，不能按格式副本压制");
});

test("R3d 转义还原是内容比较的前提，否则同一条消息会被判成两条", () => {
  assert.equal(unescapeMarkdown("a \- b"), "a - b");
  assert.equal(unescapeMarkdown("\[x\]"), "[x]");
  assert.equal(unescapeMarkdown("无转义"), "无转义");
  const raw = { createTime: "t", content: "a \- b" };
  const parsed = parseMarkdownExport("## 2026-01-02 08:00:00 甲\na \- b")[0];
  assert.notEqual(contentFingerprint(raw), contentFingerprint(parsed),
    "未还原转义的内容指纹与还原后不同——这正是必须在解析阶段还原的原因");
});

test("R3e 空输入与无标题输入不抛错，返回空数组", () => {
  assert.deepEqual(parseMarkdownExport(""), []);
  assert.deepEqual(parseMarkdownExport("没有任何标题行\n只是正文"), []);
  assert.deepEqual(parseMarkdownExport(null), []);
});
