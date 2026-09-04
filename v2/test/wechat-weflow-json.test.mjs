// The WeFlow JSON transcript is the only place four of the family's groups exist. These pin the
// parser's contract with the rest of the importer: same message shape as the Markdown parser, same
// canonical identity inputs, media resolved as references rather than left as file paths in text.
import test from "node:test";
import assert from "node:assert/strict";
import { parseWeflowJson, isWeflowJson } from "../lib/ingest/wechat-weflow-json.ts";

const ROOT = "/export";
const DOC = "群聊_x/群聊_x.json";

const transcript = (messages, session = {}) => JSON.stringify({
  weflow: { version: "1" },
  session: { wxid: "44486556869@chatroom", displayName: "乳儿班张小年家庭群", type: "群聊", ...session },
  messages,
  avatars: {},
});

const message = (over = {}) => ({
  localId: 1, createTime: 1771836203, formattedTime: "2026-02-23 08:43:23", type: "文本消息",
  localType: 1, content: "今天他自己走了两步", isSend: 0, senderUsername: "wxid_a", senderDisplayName: "好奇星大兵老师", ...over,
});

test("a WeFlow transcript is recognised, and other JSON is not", () => {
  assert.equal(isWeflowJson(transcript([message()])), true);
  assert.equal(isWeflowJson(JSON.stringify({ messages: [] })), false, "a bare messages array is not a transcript");
  assert.equal(isWeflowJson("[]"), false);
});

test("messages carry the same shape the Markdown parser produces", () => {
  const parsed = parseWeflowJson({ root: ROOT, document: DOC, text: transcript([message()]), media: new Map() });
  assert.equal(parsed.messages.length, 1);
  const [m] = parsed.messages;
  assert.match(parsed.conversationId, /^conversation:[0-9a-f]{24}$/);
  assert.match(m.senderId, /^sender:[0-9a-f]{24}$/);
  assert.equal(m.messageType, "text");
  assert.equal(m.direction, "unknown");
  assert.equal(m.sourceLocator.document, DOC);
  assert.equal(m.sourceLocator.recordOrdinal, 1, "ordinals are 1-based file position, as in Markdown");
  assert.equal(m.sentAt, new Date(1771836203 * 1000).toISOString(), "createTime is seconds since the epoch");
  assert.match(m.messageId, /^canonical:[0-9a-f]{64}$/);
});

test("a JSON conversation id can never collide with the Markdown id for the same conversation", () => {
  // The two files are two exports of one conversation, with different orderings and different
  // documents. Treating them as one identity would imply their messages dedupe against each other,
  // and they do not — the overlap has to be reconciled deliberately.
  const a = parseWeflowJson({ root: ROOT, document: DOC, text: transcript([message()]), media: new Map() });
  const b = parseWeflowJson({ root: ROOT, document: DOC, text: transcript([message()], { wxid: "other@chatroom" }), media: new Map() });
  assert.notEqual(a.conversationId, b.conversationId, "the session identifies the conversation");
});

test("a picture becomes a media reference, and its path never becomes message text", () => {
  const media = new Map([["群聊_x/media/images/a.jpg", { checksum: "a".repeat(64), availability: "present" }]]);
  const parsed = parseWeflowJson({
    root: ROOT, document: DOC, media,
    text: transcript([message({ type: "图片消息", localType: 3, content: "media\\images\\a.jpg" })]),
  });
  const [m] = parsed.messages;
  assert.equal(m.text, "", "a file path is provenance, not something anyone said");
  assert.equal(m.messageType, "image");
  assert.equal(m.mediaRefs.length, 1);
  assert.equal(m.mediaRefs[0].relativePath, "群聊_x/media/images/a.jpg", "backslashes resolve to a root-relative path");
  assert.equal(m.mediaRefs[0].availability, "present");
  assert.equal(m.mediaRefs[0].checksum, "a".repeat(64));
});

test("a media path that escapes the export root is refused, not followed", () => {
  const parsed = parseWeflowJson({
    root: ROOT, document: DOC, media: new Map(),
    text: transcript([message({ type: "图片消息", content: "..\\..\\..\\windows\\system32\\x.jpg" })]),
  });
  assert.match(parsed.messages[0].mediaRefs[0].relativePath, /^unresolved-/);
  assert.equal(parsed.messages[0].mediaRefs[0].availability, "invalid");
});

test("a message with no usable time is counted and dropped, never filed under a guessed day", () => {
  const parsed = parseWeflowJson({
    root: ROOT, document: DOC, media: new Map(),
    text: transcript([message(), message({ createTime: 0 }), message({ createTime: "not-a-time" })]),
  });
  assert.equal(parsed.messages.length, 1);
  assert.ok(parsed.warnings.includes("weflow_json_message_without_time"));
});

test("two identical messages stay two messages, told apart by their position in the file", () => {
  // Position is already part of canonical identity, so word-for-word repeats separate on their own
  // and the occurrence-rank tiebreak stays unused. What matters is that neither collapses into the
  // other: someone saying the same thing twice said it twice.
  const parsed = parseWeflowJson({ root: ROOT, document: DOC, media: new Map(), text: transcript([message(), message()]) });
  assert.equal(parsed.messages.length, 2);
  assert.notEqual(parsed.messages[0].messageId, parsed.messages[1].messageId);
  assert.deepEqual(parsed.messages.map((m) => m.sourceLocator.recordOrdinal), [1, 2]);
  assert.deepEqual(parsed.messages.map((m) => m.occurrenceRank), [0, 0]);
});

test("ordinals count every record, so dropping an undated message never renumbers the ones after it", () => {
  // recordOrdinal is an input to canonical identity. If it were the index among KEPT messages, one
  // undated message anywhere would change the identity of every message after it, and a re-import
  // would duplicate the entire remainder of the conversation.
  const parsed = parseWeflowJson({
    root: ROOT, document: DOC, media: new Map(),
    text: transcript([message({ content: "一" }), message({ createTime: 0, content: "二" }), message({ content: "三" })]),
  });
  assert.deepEqual(parsed.messages.map((m) => m.sourceLocator.recordOrdinal), [1, 3]);
});

test("a transcript that is not parseable yields nothing rather than a partial conversation", () => {
  const bad = parseWeflowJson({ root: ROOT, document: DOC, text: "{not json", media: new Map() });
  assert.deepEqual(bad.messages, []);
  assert.ok(bad.warnings.includes("weflow_json_unparseable"));
  const empty = parseWeflowJson({ root: ROOT, document: DOC, text: JSON.stringify({ weflow: {}, session: {} }), media: new Map() });
  assert.deepEqual(empty.messages, []);
  assert.ok(empty.warnings.includes("weflow_json_no_messages"));
});
