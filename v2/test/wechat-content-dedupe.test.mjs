import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  buildArchiveIndex,
  classifyDocumentMessages,
  commitReservation,
  normalizeWechatText,
  releaseReservation,
  senderDigestForDisplayName,
  senderDigestsFor,
  shanghaiDateDaysAgo,
} from "../lib/ingest/wechat-content-dedupe.ts";

const CHAT_A = "wechat-session:44486556869@chatroom";
const CHAT_B = "wechat-session:52605546577@chatroom";
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const senderIdOf = (name) => `sender:${sha256(name).slice(0, 24)}`;
const digestOf = (name) => senderDigestForDisplayName(name);

// One transcript message, as the parsers produce it.
const msg = (ordinal, sentAt, text, { sender = "妈妈", refs = [] } = {}) => ({
  sentAt, text,
  senderId: senderIdOf(sender),
  senderName: sender,
  mediaRefs: refs,
  sourceLocator: { recordOrdinal: ordinal },
});
// One archived row, as raw_sources holds it.
const row = (sessionKey, sentAt, text, { sender = "妈妈", evidence = [], checksums = [], rowId = "row" } = {}) => ({
  sessionKey, sentAt, text, rowId,
  senderDigest: digestOf(sender),
  mediaEvidence: evidence.map((path) => ({ digest: sha256(path), state: "present" })),
  checksums,
});

test("text comparison is full, unescaped, and blind to how an attachment was rendered", () => {
  assert.equal(normalizeWechatText("好的\\[强\\]  \n谢谢"), "好的[强]谢谢");
  assert.equal(normalizeWechatText("![photo](media/images/a.jpg)"), "");
  assert.equal(normalizeWechatText("\n[media]\n"), "");
  assert.equal(normalizeWechatText("[视频文件](media/videos/a.mp4)"), "");
  // an ordinary link someone sent is words, not an attachment
  assert.equal(normalizeWechatText("[攻略](https://example.com/guide)"), "[攻略](https://example.com/guide)");
  // never truncated
  const long = "长".repeat(400);
  assert.equal(normalizeWechatText(`${long}尾`).length, 401);
});

test("two chats holding the same words in the same second stay two messages", () => {
  const index = buildArchiveIndex([row(CHAT_B, "2026-09-14T08:45:05+08:00", "早上好")]);
  const result = classifyDocumentMessages([msg(1, "2026-09-14T08:45:05+08:00", "早上好")], index, CHAT_A);
  assert.deepEqual([...result.ordinals], [1]);
  assert.equal(result.alreadyArchived, 0);
  assert.equal(result.ambiguous.length, 0);
});

test("the same second and the same words from a different person is a different message", () => {
  const index = buildArchiveIndex([row(CHAT_A, "2026-09-14T08:45:05+08:00", "早上好", { sender: "爸爸" })]);
  const result = classifyDocumentMessages([msg(1, "2026-09-14T08:45:05+08:00", "早上好", { sender: "妈妈" })], index, CHAT_A);
  assert.deepEqual([...result.ordinals], [1]);
});

test("two media-only messages in the same second are told apart by their attachments", () => {
  const hashA = `sha256:${"a".repeat(64)}`;
  const hashB = `sha256:${"b".repeat(64)}`;
  const archived = () => buildArchiveIndex([row(CHAT_A, "2026-09-14T09:00:00+08:00", "\n[media]\n", { evidence: ["texts/c/media/images/a.jpg"], checksums: [hashA] })]);
  // different content in the same second — a different message
  const other = classifyDocumentMessages([msg(1, "2026-09-14T09:00:00+08:00", "![](texts/c/media/images/b.jpg)", { refs: [{ relativePath: "texts/c/media/images/b.jpg", checksum: hashB }] })], archived(), CHAT_A);
  assert.deepEqual([...other.ordinals], [1], "a different file is a different message");
  // the same file — the same message
  const same = classifyDocumentMessages([msg(2, "2026-09-14T09:00:00+08:00", "![](texts/c/media/images/a.jpg)", { refs: [{ relativePath: "texts/c/media/images/a.jpg", checksum: hashA }] })], archived(), CHAT_A);
  assert.equal(same.ordinals.size, 0, "the same file is the same message");
  assert.equal(same.alreadyArchived, 1);
  // a different path with no content hash on either side decides nothing: it is listed, not guessed
  const noHashes = buildArchiveIndex([row(CHAT_A, "2026-09-14T09:00:00+08:00", "\n[media]\n", { evidence: ["texts/c/media/images/a.jpg"], rowId: "row-p" })]);
  const undecided = classifyDocumentMessages([msg(3, "2026-09-14T09:00:00+08:00", "![](texts/c/media/images/b.jpg)", { refs: [{ relativePath: "texts/c/media/images/b.jpg" }] })], noHashes, CHAT_A);
  assert.equal(undecided.ordinals.size, 0);
  assert.deepEqual(undecided.ambiguous.map((item) => [item.recordOrdinal, item.reason]), [[3, "attachment_evidence_unknown"]]);
});

test("attachments with the same content under different paths match; different content does not", () => {
  const index = buildArchiveIndex([row(CHAT_A, "2026-09-14T09:00:00+08:00", "", { evidence: ["old/export/media/images/a.jpg"], checksums: [`sha256:${"a".repeat(64)}`] })]);
  const same = classifyDocumentMessages([msg(1, "2026-09-14T09:00:00+08:00", "![](new/export/media/images/a.jpg)", { refs: [{ relativePath: "new/export/media/images/a.jpg", checksum: `sha256:${"a".repeat(64)}` }] })], index, CHAT_A);
  assert.equal(same.alreadyArchived, 1);
  const index2 = buildArchiveIndex([row(CHAT_A, "2026-09-14T09:00:00+08:00", "", { evidence: ["old/export/media/images/a.jpg"], checksums: [`sha256:${"a".repeat(64)}`] })]);
  const differ = classifyDocumentMessages([msg(1, "2026-09-14T09:00:00+08:00", "![](new/export/media/images/a.jpg)", { refs: [{ relativePath: "new/export/media/images/a.jpg", checksum: `sha256:${"b".repeat(64)}` }] })], index2, CHAT_A);
  assert.deepEqual([...differ.ordinals], [1]);
});

test("a long message is not matched by a shared prefix", () => {
  const prefix = "这是很长的一段话，".repeat(40);
  const index = buildArchiveIndex([row(CHAT_A, "2026-09-14T10:00:00+08:00", `${prefix}今天去打疫苗`)]);
  const result = classifyDocumentMessages([msg(1, "2026-09-14T10:00:00+08:00", `${prefix}今天没有去`)], index, CHAT_A);
  assert.deepEqual([...result.ordinals], [1]);
});

test("the same message in the .md and the .json of one chat is imported once — after the write lands", () => {
  const index = buildArchiveIndex([]);
  // Markdown: escaped sender spelling and escaped text
  const md = [msg(3, "2026-09-14T22:49:33+08:00", "晚安\\!", { sender: "hxx\\." })];
  const first = classifyDocumentMessages(md, index, CHAT_A);
  assert.deepEqual([...first.ordinals], [3]);
  // Not archived yet: the import has not been confirmed
  const jsonBeforeCommit = classifyDocumentMessages([msg(912, "2026-09-14T14:49:33.000Z", "晚安!", { sender: "hxx." })], index, CHAT_A);
  assert.deepEqual([...jsonBeforeCommit.ordinals], [912], "an unconfirmed reservation must not hide the message");
  releaseReservation(jsonBeforeCommit.reservation);
  // Now the .md import succeeds
  commitReservation(index, first.reservation);
  const jsonAfterCommit = classifyDocumentMessages([msg(912, "2026-09-14T14:49:33.000Z", "晚安!", { sender: "hxx." })], index, CHAT_A);
  assert.equal(jsonAfterCommit.ordinals.size, 0);
  assert.equal(jsonAfterCommit.alreadyArchived, 1);
});

test("a failed import is retried, not swallowed", () => {
  const index = buildArchiveIndex([]);
  const first = classifyDocumentMessages([msg(1, "2026-09-14T08:00:00+08:00", "新消息")], index, CHAT_A);
  assert.deepEqual([...first.ordinals], [1]);
  releaseReservation(first.reservation); // the import threw
  const retry = classifyDocumentMessages([msg(1, "2026-09-14T08:00:00+08:00", "新消息")], index, CHAT_A);
  assert.deepEqual([...retry.ordinals], [1]);
  commitReservation(index, retry.reservation);
  const third = classifyDocumentMessages([msg(1, "2026-09-14T08:00:00+08:00", "新消息")], index, CHAT_A);
  assert.equal(third.ordinals.size, 0);
});

test("genuinely repeated messages in one second are all kept", () => {
  const index = buildArchiveIndex([row(CHAT_A, "2026-09-14T08:00:01+08:00", "[强]")]);
  const result = classifyDocumentMessages([
    msg(7, "2026-09-14T08:00:01+08:00", "\\[强\\]"),
    msg(8, "2026-09-14T08:00:01+08:00", "\\[强\\]"),
  ], index, CHAT_A);
  assert.deepEqual([...result.ordinals], [8], "the archive holds one of the two; the second still needs importing");
  assert.equal(result.alreadyArchived, 1);
});

test("what cannot be decided is listed, never skipped and never blindly imported", () => {
  // archived row says "this message had an attachment" but carries no evidence of which file
  const index = buildArchiveIndex([{ sessionKey: CHAT_A, sentAt: "2026-09-14T09:00:00+08:00", text: "\n[media]\n", senderDigest: digestOf("妈妈"), mediaEvidence: [], checksums: [], rowId: "row-x" }]);
  const result = classifyDocumentMessages([msg(1, "2026-09-14T09:00:00+08:00", "![](texts/c/media/images/a.jpg)", { refs: [{ relativePath: "texts/c/media/images/a.jpg" }] })], index, CHAT_A);
  assert.equal(result.ordinals.size, 0);
  assert.equal(result.alreadyArchived, 0);
  assert.deepEqual(result.ambiguous.map((item) => [item.recordOrdinal, item.reason, item.archivedRowIds]), [[1, "attachment_evidence_unknown", ["row-x"]]]);
});

test("a row whose chat could not be mapped makes a message ambiguous, never archived", () => {
  const index = buildArchiveIndex([{ sessionKey: undefined, sentAt: "2026-09-14T09:30:00+08:00", text: "他今天会走了", senderDigest: digestOf("妈妈"), rowId: "row-legacy" }]);
  const result = classifyDocumentMessages([msg(4, "2026-09-14T09:30:00+08:00", "他今天会走了")], index, CHAT_A);
  assert.equal(result.ordinals.size, 0);
  assert.deepEqual(result.ambiguous.map((item) => [item.reason, item.archivedRowIds]), [["unmapped_conversation", ["row-legacy"]]]);
});

test("sender digests cover both exporters' spellings", () => {
  const digests = senderDigestsFor({ senderId: senderIdOf("hxx\\."), senderName: "hxx\\." });
  assert.ok(digests.has(digestOf("hxx\\.")), "the escaped spelling");
  assert.ok(digests.has(digestOf("hxx.")), "the plain spelling");
});

test("since-days is a Shanghai calendar date", () => {
  assert.equal(shanghaiDateDaysAgo(0, new Date("2026-09-15T15:30:00Z")), "2026-09-15");
  assert.equal(shanghaiDateDaysAgo(3, new Date("2026-09-15T15:30:00Z")), "2026-09-12");
  assert.equal(shanghaiDateDaysAgo(0, new Date("2026-09-15T16:30:00Z")), "2026-09-16");
  assert.throws(() => shanghaiDateDaysAgo(-1), /WECHAT_SINCE_DAYS_INVALID/);
});
