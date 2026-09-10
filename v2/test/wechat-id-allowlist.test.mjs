import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { promisify } from "node:util";
import { loadWechatBundle } from "../lib/ingest/wechat-snapshot.ts";
import { chatImportBatchId } from "../lib/ingest/chat-import-bundle.ts";

const execFileAsync = promisify(execFile);
const driver = path.join(process.cwd(), "scripts", "wechat-import-all.mjs");
const DOC = "texts/conv/conv.md";

// Four messages at 10:00 / 11:00 / 12:00 / 13:00 Shanghai. The last one carries a real JPEG, because
// the interesting failure only appears for messages with media: loadWechatBundle parses the document
// twice and canonicalMessageId takes attachment checksums as input, so a media-bearing message has a
// different id in each pass. Selection therefore keys on the record ordinal; the id set is what the
// driver verifies afterwards.
const header = (count) => [
  "# 家庭群",
  "",
  "- 会话ID: `12345@chatroom`",
  "- 会话类型: 群聊",
  `- 消息数量: ${count}`,
  "- 导出时间: 2026\\-09\\-10 14:00:00",
  "- 导出工具: WeFlow",
  "",
  "---",
].join("\n");
const BODY = [
  header(4),
  "## 2026\\-09\\-10 10:00:00 Sender",
  "first",
  "## 2026\\-09\\-10 11:00:00 Sender",
  "second",
  "## 2026\\-09\\-10 12:00:00 Sender",
  "third",
  "## 2026\\-09\\-10 13:00:00 Sender",
  "![photo](photo.jpg)",
].join("\n");

async function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-allowlist-"));
  const dir = path.join(root, "texts", "conv");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "conv.md"), BODY, "utf8");
  await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 120, b: 200 } } }).jpeg().toFile(path.join(dir, "photo.jpg"));
  return root;
}
const fileSha = (root) => createHash("sha256").update(fs.readFileSync(path.join(root, DOC.replaceAll("/", path.sep)))).digest("hex");

async function loadAll(root) {
  return loadWechatBundle(root, { maxMessages: 10, maxMedia: 10 });
}

function writeBatch(root, overrides = {}) {
  const file = path.join(root, "batch.json");
  fs.writeFileSync(file, JSON.stringify({ document: DOC, fileSha256: fileSha(root), ...overrides }, null, 2));
  return file;
}

const runDriver = async (root, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ["--import", "tsx", driver, "--source-root", root, ...args], { env: process.env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

test("two approved batches over one document and one since get different import batch ids", () => {
  // The regression this pins: createChatImportTask upserts on importBatchId and returns the existing
  // row, so when the text-only half and the media half of one conversation shared an id, the second
  // batch found the first one's completed task and reported zero created, zero reused, "completed".
  const snapshot = { rootFingerprint: "root-fp", conversationDigest: "conv-digest" };
  const since = "2025-01-03";
  const a = chatImportBatchId(snapshot, since, "idset-aaa");
  const b = chatImportBatchId(snapshot, since, "idset-bbb");
  assert.notEqual(a, b);
  assert.match(a, /:batch=idset-aaa$/);
  // and no batch key keeps the old value exactly, so existing tasks are untouched
  assert.equal(chatImportBatchId(snapshot, since), `wechat-import:root-fp:conv-digest:since=${new Date(Date.parse(since)).toISOString()}`);
  assert.equal(chatImportBatchId(snapshot), "wechat-import:root-fp:conv-digest");
});

test("the allowlist selects exactly the listed messages and nothing else", async () => {
  const root = await makeRoot();
  try {
    const loaded = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 10, recordOrdinals: new Set([1, 3]) });
    assert.equal(loaded.availableMessageCount, 2);
    assert.deepEqual(loaded.bundle.messages.map((m) => m.sourceLocator.recordOrdinal), [1, 3]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a media-bearing message is selectable, which an id allowlist could not do", async () => {
  const root = await makeRoot();
  try {
    // Ordinal 4 is the message with the JPEG. Its id differs between the discovery parse and the
    // reparse with real checksums, so keying on the id would select nothing at all here.
    const loaded = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 10, recordOrdinals: new Set([4]) });
    assert.equal(loaded.availableMessageCount, 1);
    assert.equal(loaded.bundle.messages[0].mediaRefs.length, 1);
    assert.equal(loaded.bundle.messages[0].mediaRefs[0].availability, "present");
    assert.match(String(loaded.bundle.messages[0].mediaRefs[0].checksum), /^sha256:[0-9a-f]{64}$/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the order is since, then allowlist, then truncation", async () => {
  const root = await makeRoot();
  try {
    const loaded = await loadWechatBundle(root, {
      maxMessages: 1, maxMedia: 10,
      since: "2026-09-10T10:30:00+08:00",
      recordOrdinals: new Set([1, 2, 3, 4]),
    });
    assert.equal(loaded.availableMessageCount, 3, "three survive `since` and the allowlist");
    assert.equal(loaded.selectedMessageCount, 1, "truncation applies last");
    assert.equal(loaded.bundle.messages[0].sourceLocator.recordOrdinal, 2, "and keeps the earliest survivor");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the allowlist cannot resurrect a message excluded by since", async () => {
  const root = await makeRoot();
  try {
    const loaded = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 10, since: "2026-09-10T11:30:00+08:00", recordOrdinals: new Set([1]) });
    assert.equal(loaded.availableMessageCount, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("an empty allowlist is a mistake, not a request to import everything", async () => {
  const root = await makeRoot();
  try {
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 10, maxMedia: 10, recordOrdinals: new Set() }), /WECHAT_MESSAGE_ALLOWLIST_EMPTY/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver dry-runs an exact batch, verifying the approved ids against the document", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const pick = all.bundle.messages.filter((m) => [1, 4].includes(m.sourceLocator.recordOrdinal));
    const file = writeBatch(root, { messageIds: pick.map((m) => m.messageId), recordOrdinals: pick.map((m) => m.sourceLocator.recordOrdinal) });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /all 2 approved id\(s\) verified against the document/);
    assert.match(r.stdout, /would import 2 message\(s\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses when the approved ids are not what the document yields", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const first = all.bundle.messages[0];
    // right ordinal, wrong id: exactly the shape of a document edited under a stable ordinal
    const file = writeBatch(root, { messageIds: ["canonical:not-the-real-one"], recordOrdinals: [first.sourceLocator.recordOrdinal] });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /approved message ids do not match what the document yields/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose ordinals are not all in the document, instead of importing fewer", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const file = writeBatch(root, { messageIds: [all.bundle.messages[0].messageId, "canonical:x"], recordOrdinals: [1, 9999] });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /matched 1 of 2 message\(s\)/);
    assert.match(r.stderr, /Refusing to import a partial batch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses duplicate ids, duplicate ordinals, and mismatched counts", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const id = all.bundle.messages[0].messageId;
    const dupIds = writeBatch(root, { messageIds: [id, id], recordOrdinals: [1, 2] });
    const a = await runDriver(root, ["--id-file", dupIds, "--dry-run"]);
    assert.notEqual(a.code, 0);
    assert.match(a.stderr, /only 1 are distinct/);

    const dupOrd = writeBatch(root, { messageIds: [id, all.bundle.messages[1].messageId], recordOrdinals: [1, 1] });
    const b = await runDriver(root, ["--id-file", dupOrd, "--dry-run"]);
    assert.notEqual(b.code, 0);
    assert.match(b.stderr, /only 1 are distinct/);

    const mism = writeBatch(root, { messageIds: [id], recordOrdinals: [1, 2] });
    const c = await runDriver(root, ["--id-file", mism, "--dry-run"]);
    assert.notEqual(c.code, 0);
    assert.match(c.stderr, /must describe the same messages/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose source file has changed since approval", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const file = writeBatch(root, { messageIds: [all.bundle.messages[0].messageId], recordOrdinals: [1] });
    fs.appendFileSync(path.join(root, DOC.replaceAll("/", path.sep)), "\n## 2026\\-09\\-10 15:00:00 Sender\nlater", "utf8");
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /source file changed since the batch was approved/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose conversation identity does not match", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const file = writeBatch(root, { messageIds: [all.bundle.messages[0].messageId], recordOrdinals: [1], conversationId: "conversation:not-this-one" });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /conversation identity mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose document is not in the export root", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const file = writeBatch(root, { document: "texts/conv/missing.md", messageIds: [all.bundle.messages[0].messageId], recordOrdinals: [1] });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /matched 0 conversation\(s\), expected exactly 1/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("--id-file and --only are mutually exclusive, so identity never comes from a drifting index", async () => {
  const root = await makeRoot();
  try {
    const all = await loadAll(root);
    const file = writeBatch(root, { messageIds: [all.bundle.messages[0].messageId], recordOrdinals: [1] });
    const r = await runDriver(root, ["--id-file", file, "--only", "0", "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /mutually exclusive/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a malformed batch file is rejected before anything else happens", async () => {
  const root = await makeRoot();
  try {
    const bad = path.join(root, "bad.json");
    fs.writeFileSync(bad, "{not json");
    const r1 = await runDriver(root, ["--id-file", bad, "--dry-run"]);
    assert.notEqual(r1.code, 0);
    assert.match(r1.stderr, /could not be read as JSON/);

    const empty = writeBatch(root, { messageIds: [], recordOrdinals: [] });
    const r2 = await runDriver(root, ["--id-file", empty, "--dry-run"]);
    assert.notEqual(r2.code, 0);
    assert.match(r2.stderr, /non-empty "messageIds" array/);

    const noOrd = writeBatch(root, { messageIds: ["canonical:x"] });
    const r3 = await runDriver(root, ["--id-file", noOrd, "--dry-run"]);
    assert.notEqual(r3.code, 0);
    assert.match(r3.stderr, /non-empty "recordOrdinals" array/);

    const noSha = path.join(root, "nosha.json");
    fs.writeFileSync(noSha, JSON.stringify({ document: DOC, messageIds: ["canonical:x"], recordOrdinals: [1] }));
    const r4 = await runDriver(root, ["--id-file", noSha, "--dry-run"]);
    assert.notEqual(r4.code, 0);
    assert.match(r4.stderr, /"fileSha256" as 64 lowercase hex/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
