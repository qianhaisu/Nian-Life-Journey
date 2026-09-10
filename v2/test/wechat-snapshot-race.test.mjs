import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanWechatSnapshot, hashWechatFile, loadWechatBundle } from "../lib/ingest/wechat-snapshot.ts";

// WeFlow writes `.<name>.weflow-partial-<pid>-<id>.md` beside the real transcript while it exports and
// removes it when done. A scan that lists such a file and then fails to open it used to surface a raw
// ENOENT, which reads as a bug rather than as what it is: the export moved under us. The contract these
// tests hold is narrow — a file that disappears makes snapshot verification FAIL, and never gets skipped
// so the import can continue with a partial view.

const makeRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-snapshot-race-"));
  const dir = path.join(root, "texts", "conv");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "conv.md"),
    "# 家庭群\n\n- 会话ID: `12345@chatroom`\n- 会话类型: 群聊\n- 消息数量: 2\n- 导出时间: 2026\\-09\\-10 11:00:00\n- 导出工具: WeFlow\n\n---\n## 2026\\-09\\-10 11:10:48 Sender\nfirst\n## 2026\\-09\\-10 11:12:58 Sender\nsecond",
    "utf8",
  );
  return root;
};

test("a transcript that disappears after the scan fails verification instead of raising ENOENT", async () => {
  const root = makeRoot();
  try {
    const snapshot = await scanWechatSnapshot(root);
    const transcript = snapshot.files.find((file) => file.kind === "markdown");
    assert.ok(transcript, "the scan should list the transcript");
    fs.rmSync(transcript.absolutePath);
    await assert.rejects(() => hashWechatFile(transcript), /WECHAT_SNAPSHOT_CHANGED_DURING_SCAN/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a vanished entry is never silently skipped — the load stops", async () => {
  const root = makeRoot();
  try {
    // A snapshot entry pointing at a path that no longer exists is exactly the state the race leaves
    // behind. Reading it must stop the run, not return an empty transcript that parses to 0 messages
    // (which would let a conversation look "already complete" and be marked done).
    const snapshot = await scanWechatSnapshot(root);
    const transcript = snapshot.files.find((file) => file.kind === "markdown");
    fs.rmSync(transcript.absolutePath);
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 10, maxMedia: 1 }), (error) => {
      assert.match(error.message, /WECHAT_SNAPSHOT_CHANGED_DURING_SCAN|WECHAT_NO_VALID_SESSION/);
      assert.doesNotMatch(error.message, /ENOENT/);
      return true;
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only a missing file is reported as drift — other read failures keep their own error", async () => {
  const root = makeRoot();
  try {
    const snapshot = await scanWechatSnapshot(root);
    const transcript = snapshot.files.find((file) => file.kind === "markdown");
    // A directory is present but unreadable as a stream. That is not drift, so it must not be
    // relabelled as drift; otherwise a genuine read fault would be mistaken for a racing export.
    await assert.rejects(
      () => hashWechatFile({ ...transcript, absolutePath: path.join(root, "texts") }),
      (error) => {
        assert.doesNotMatch(error.message, /WECHAT_SNAPSHOT_CHANGED_DURING_SCAN/);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a stable export root still loads normally, with the offset-bearing since honoured", async () => {
  const root = makeRoot();
  try {
    const all = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 1 });
    assert.equal(all.availableMessageCount, 2);

    // A bare YYYY-MM-DD is parsed as UTC midnight, which is 08:00 in Shanghai — both messages here
    // are later than that, so both stay eligible.
    const byDate = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 1, since: "2026-09-10" });
    assert.equal(byDate.availableMessageCount, 2);

    // An explicit offset selects precisely. 11:12:58 onwards is one message, not two.
    const byInstant = await loadWechatBundle(root, { maxMessages: 10, maxMedia: 1, since: "2026-09-10T11:12:58+08:00" });
    assert.equal(byInstant.availableMessageCount, 1);
    assert.equal(byInstant.bundle.messages[0].sentAt, "2026-09-10T11:12:58+08:00");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
