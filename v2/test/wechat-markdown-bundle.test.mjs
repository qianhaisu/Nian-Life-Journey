import test from "node:test";
import assert from "node:assert/strict";
import { parseWechatMarkdown } from "../lib/ingest/wechat-markdown.ts";
import { validateChatImportBundle } from "../lib/ingest/chat-import-bundle.ts";

test("official markdown parses deterministic messages and media states", () => {
  const media = new Map([["photo.jpg", { checksum: "sha256:abc", availability: "present" }]]);
  const parsed = parseWechatMarkdown({ root: "C:/export", document: "conversation.md", media, text: "\uFEFF# Redacted\n- a: b\n- c: d\n- e: f\n- g: h\n- i: j\n---\n## 2026\\-08\\-31 09:01:02 Sender\nhello\n\n> quote\n## 2026\\-08\\-31 09:01:02 Sender\n![x](photo.jpg)\n## 2026\\-08\\-31 09:01:02 Sender\nmissing ![x](missing.jpg)" });
  assert.equal(parsed.messages.length, 3);
  assert.equal(parsed.messages[0].sentAt, "2026-08-31T09:01:02+08:00");
  assert.equal(parsed.messages[1].messageType, "image");
  assert.equal(parsed.messages[2].mediaRefs[0].availability, "missing");
  assert.notEqual(parsed.messages[1].messageId, parsed.messages[2].messageId);
});

test("re-exporting the same conversation keeps the same conversationId and messageIds", () => {
  const media = new Map();
  const header = (messageCount, exportedAt) =>
    `# 家庭群\n\n- 会话ID: \`12345@chatroom\`\n- 会话类型: 群聊\n- 消息数量: ${messageCount}\n- 导出时间: ${exportedAt}\n- 导出工具: WeFlow\n\n---\n## 2026\\-08\\-31 09:01:02 Sender\nhello`;
  const first = parseWechatMarkdown({ root: "C:/export", document: "conversation.md", media, text: header(100, "2026\\-09\\-01 10:00:00") });
  const second = parseWechatMarkdown({ root: "C:/export", document: "conversation.md", media, text: header(148, "2026\\-09\\-03 22:00:00") });
  assert.equal(first.conversationId, second.conversationId);
  assert.equal(first.messages[0].messageId, second.messages[0].messageId);
});

test("auxiliary markdown is excluded and unsafe references reject validation", () => {
  const auxiliary = parseWechatMarkdown({ root: "C:/export", document: "extra.md", media: new Map(), text: "# Auxiliary\nno records" });
  assert.equal(auxiliary.messages.length, 0);
  assert.throws(() => validateChatImportBundle({ schemaVersion: "chat-import-bundle/v1", parserVersion: "test", sourceProvider: "wechat-official-markdown", sourceTimezone: "Asia/Shanghai", exportSnapshot: { rootFingerprint: "x", capturedAt: "x", fileCount: 1 }, conversations: [], participants: [], messages: [{ messageId: "x", conversationId: "c", senderId: "s", direction: "unknown", sentAt: "2026-01-01T00:00:00+08:00", messageType: "text", text: "", mediaRefs: [{ id: "m", relativePath: "../escape.jpg", availability: "missing" }], sourceLocator: { document: "d", recordOrdinal: 1 } }], mediaRefs: [], warnings: [] }));
});
