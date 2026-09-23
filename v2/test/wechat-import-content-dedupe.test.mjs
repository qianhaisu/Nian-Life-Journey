import test from "node:test";
import assert from "node:assert/strict";
import { contentKeyOf, matchArchivedByContent, senderDigestForDisplayName } from "../lib/ingest/wechat-content-dedupe.ts";

// 2026-09-23：写入前的内容去重。形状照阿静私聊与作战部队群的真实重复（JSON 与 Markdown 两种导出、
// 群改名后的新会话 id、每日切片），文字为合成改写，不含家人原话。
const WO = senderDigestForDisplayName("我"), TED = senderDigestForDisplayName("Ted"), XUE = senderDigestForDisplayName("hxx.");
const row = (id, at, sender, text, label = "conversation:old") => ({ id, capturedAt: at, text, sourceType: "wechat", sourceLabel: label, metadata: { senderDigest: sender } });

test("已有的消息换一个会话 id 再导一次：全部命中，新增为 0", () => {
  const archived = [
    row("a1", "2025-09-01T10:00:00+08:00", WO, "\n> 苏静: 你觉得要看这个医生吗\n\n可以先看个几百的？\n"),
    row("a2", "2025-09-01T10:00:05+08:00", XUE, "\n\[链接\]宝宝辅食怎么做\n"),
    row("a3", "2025-09-01T10:01:00+08:00", XUE, "\n\[视频\]\n"),
  ];
  const reexport = [
    { key: "n1", source: row("n1", "2025-09-01T10:00:00.000Z".replace("Z", "+00:00").replace("2025-09-01T10", "2025-09-01T02"), TED, "可以先看个几百的？[引用 苏静：你觉得要看这个医生吗]", "conversation:new") },
    { key: "n2", source: row("n2", "2025-09-01T10:00:05+08:00", XUE, "宝宝辅食怎么做", "conversation:renamed") },
    { key: "n3", source: row("n3", "2025-09-01T10:01:00+08:00", XUE, "", "conversation:slice") },
  ];
  const hit = matchArchivedByContent(reexport, archived);
  assert.equal(hit.size, 3, "三条都已存在");
  assert.equal(reexport.filter((x) => !hit.has(x.key)).length, 0, "新增为 0");
  assert.equal(hit.get("n1").id, "a1");
});

test("真正的新消息照常新建：秒、发送人、说的话任一不同都不算重复", () => {
  const archived = [row("a1", "2025-09-01T10:00:00+08:00", XUE, "睡着了")];
  const incoming = [
    { key: "later", source: row("x", "2025-09-01T10:00:01+08:00", XUE, "睡着了") },
    { key: "other", source: row("y", "2025-09-01T10:00:00+08:00", WO, "睡着了") },
    { key: "text", source: row("z", "2025-09-01T10:00:00+08:00", XUE, "醒了") },
  ];
  assert.equal(matchArchivedByContent(incoming, archived).size, 0);
});

test("同一秒同一句话出现两次：库里只有一条时，第二条照常新建（按次数）", () => {
  const archived = [row("a1", "2025-09-01T10:00:00+08:00", XUE, "哈哈哈")];
  const incoming = [{ key: "p", source: row("p", "2025-09-01T10:00:00+08:00", XUE, "哈哈哈") }, { key: "q", source: row("q", "2025-09-01T10:00:00+08:00", XUE, "哈哈哈") }];
  const hit = matchArchivedByContent(incoming, archived);
  assert.deepEqual([...hit.keys()], ["p"]);
});

test("非微信来源、没有发送人：不参与内容去重", () => {
  assert.equal(contentKeyOf({ capturedAt: "2025-09-01T10:00:00+08:00", text: "x", sourceType: "family_photo", metadata: { senderDigest: XUE } }), null);
  assert.equal(contentKeyOf({ capturedAt: "2025-09-01T10:00:00+08:00", text: "x", sourceType: "wechat", metadata: {} }), null);
});
