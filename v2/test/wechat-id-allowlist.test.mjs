import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { loadWechatBundle } from "../lib/ingest/wechat-snapshot.ts";

const execFileAsync = promisify(execFile);
const driver = path.join(process.cwd(), "scripts", "wechat-import-all.mjs");
const DOC = "texts/conv/conv.md";

// Three messages, 10:00 / 11:00 / 12:00 Shanghai on the same day.
const BODY = [
  "# 家庭群",
  "",
  "- 会话ID: `12345@chatroom`",
  "- 会话类型: 群聊",
  "- 消息数量: 3",
  "- 导出时间: 2026\\-09\\-10 13:00:00",
  "- 导出工具: WeFlow",
  "",
  "---",
  "## 2026\\-09\\-10 10:00:00 Sender",
  "first",
  "## 2026\\-09\\-10 11:00:00 Sender",
  "second",
  "## 2026\\-09\\-10 12:00:00 Sender",
  "third",
].join("\n");

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-allowlist-"));
  fs.mkdirSync(path.join(root, "texts", "conv"), { recursive: true });
  fs.writeFileSync(path.join(root, DOC.replaceAll("/", path.sep)), BODY, "utf8");
  return root;
}
const fileSha = (root) => createHash("sha256").update(fs.readFileSync(path.join(root, DOC.replaceAll("/", path.sep)))).digest("hex");

async function idsOf(root) {
  const loaded = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 1 });
  return loaded.bundle.messages.map((m) => m.messageId);
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

test("the allowlist selects exactly the listed messages and nothing else", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const loaded = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 1, messageIds: new Set([ids[0], ids[2]]) });
    assert.equal(loaded.availableMessageCount, 2);
    assert.deepEqual(loaded.bundle.messages.map((m) => m.messageId), [ids[0], ids[2]]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the order is since, then allowlist, then truncation", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    // since drops the 10:00 message; the allowlist names all three; maxMessages keeps one.
    // If the allowlist ran before `since` the 10:00 message would come back. If truncation ran before
    // the allowlist the surviving message could be one the caller never approved.
    const loaded = await loadWechatBundle(root, {
      maxMessages: 1, maxMedia: 1,
      since: "2026-09-10T10:30:00+08:00",
      messageIds: new Set(ids),
    });
    assert.equal(loaded.availableMessageCount, 2, "two messages survive `since` and the allowlist");
    assert.equal(loaded.selectedMessageCount, 1, "truncation applies last");
    assert.equal(loaded.bundle.messages[0].messageId, ids[1], "and it keeps the earliest surviving message");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the allowlist cannot resurrect a message excluded by since", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const loaded = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 1, since: "2026-09-10T11:30:00+08:00", messageIds: new Set([ids[0]]) });
    assert.equal(loaded.availableMessageCount, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("an empty allowlist is a mistake, not a request to import everything", async () => {
  const root = makeRoot();
  try {
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 10, maxMedia: 1, messageIds: new Set() }), /WECHAT_MESSAGE_ALLOWLIST_EMPTY/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver dry-runs an exact batch and reports the approved count", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const file = writeBatch(root, { messageIds: [ids[0], ids[2]] });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /would import 2 message\(s\)/);
    assert.match(r.stdout, /--id-file: 2 message id\(s\)/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose ids are not all in the document, instead of importing fewer", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const file = writeBatch(root, { messageIds: [ids[0], "canonical:does-not-exist"] });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /matched 1 of 2 message\(s\)/);
    assert.match(r.stderr, /Refusing to import a partial batch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch with duplicate ids", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const file = writeBatch(root, { messageIds: [ids[0], ids[0]] });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /only 1 are distinct/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose source file has changed since approval", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const file = writeBatch(root, { messageIds: [ids[0]] });
    fs.appendFileSync(path.join(root, DOC.replaceAll("/", path.sep)), "\n## 2026\\-09\\-10 13:00:00 Sender\nfourth", "utf8");
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /source file changed since the batch was approved/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose conversation identity does not match", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const file = writeBatch(root, { messageIds: [ids[0]], conversationId: "conversation:not-this-one" });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /conversation identity mismatch/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("the driver refuses a batch whose document is not in the export root", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const file = writeBatch(root, { document: "texts/conv/missing.md", messageIds: [ids[0]] });
    const r = await runDriver(root, ["--id-file", file, "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /matched 0 conversation\(s\), expected exactly 1/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("--id-file and --only are mutually exclusive, so identity never comes from a drifting index", async () => {
  const root = makeRoot();
  try {
    const ids = await idsOf(root);
    const file = writeBatch(root, { messageIds: [ids[0]] });
    const r = await runDriver(root, ["--id-file", file, "--only", "0", "--dry-run"]);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /mutually exclusive/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("a malformed batch file is rejected before anything else happens", async () => {
  const root = makeRoot();
  try {
    const bad = path.join(root, "bad.json");
    fs.writeFileSync(bad, "{not json");
    const r1 = await runDriver(root, ["--id-file", bad, "--dry-run"]);
    assert.notEqual(r1.code, 0);
    assert.match(r1.stderr, /could not be read as JSON/);

    const empty = writeBatch(root, { messageIds: [] });
    const r2 = await runDriver(root, ["--id-file", empty, "--dry-run"]);
    assert.notEqual(r2.code, 0);
    assert.match(r2.stderr, /non-empty "messageIds" array/);

    const noSha = path.join(root, "nosha.json");
    fs.writeFileSync(noSha, JSON.stringify({ document: DOC, messageIds: ["canonical:x"] }));
    const r3 = await runDriver(root, ["--id-file", noSha, "--dry-run"]);
    assert.notEqual(r3.code, 0);
    assert.match(r3.stderr, /"fileSha256" as 64 lowercase hex/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
