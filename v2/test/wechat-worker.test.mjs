import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { promisify } from "node:util";
import { createInMemoryRepository } from "../lib/db/in-memory-chat-import-repository.ts";
import { assertWechatSnapshot, loadWechatBundle, scanWechatSnapshot } from "../lib/ingest/wechat-snapshot.ts";
import { runWechatImportWorker } from "../lib/ingest/wechat-worker.ts";

const execFileAsync = promisify(execFile);
const cliScript = path.join(process.cwd(), "scripts", "wechat-import-worker.mjs");

class CountingStorage {
  constructor() {
    this.objects = new Map();
    this.putCalls = [];
  }

  async put(input) {
    const chunks = [];
    if (input.body instanceof Uint8Array) chunks.push(input.body);
    else for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    this.objects.set(input.key, bytes);
    this.putCalls.push({ key: input.key, size: bytes.byteLength });
    return { providerRef: input.key, mimeType: input.mimeType, fileSize: bytes.byteLength, checksum: input.checksum };
  }

  async get(key) { return this.objects.get(key) ?? null; }
  async delete(key) { this.objects.delete(key); }
  async verify(key, checksum) {
    const bytes = this.objects.get(key);
    if (!bytes) return { exists: false, checksumVerified: false };
    const actual = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    return { exists: true, checksumVerified: actual === checksum.toLowerCase(), fileSize: bytes.byteLength };
  }
  url() { return null; }
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-worker-"));
  const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 120, g: 80, b: 48 } } }).jpeg().toBuffer();
  await writeFile(path.join(root, "photo.jpg"), image);
  await writeFile(path.join(root, "session.md"), "# Synthetic Conversation\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Synthetic Sender\nA synthetic note.\n\n![synthetic](photo.jpg)\n\n![missing](missing.jpg)\n");
  return root;
}

test("worker uploads one verified object set, persists private evidence, and reruns idempotently", async () => {
  const root = await createFixture();
  const repository = createInMemoryRepository();
  const storage = new CountingStorage();
  const options = { sourceRoot: root, profileId: "profile-wechat-worker-test", contributorId: "contributor-system", repository, storage, leaseOwner: "synthetic-worker", maxMessages: 100, maxMedia: 20, now: new Date().toISOString() };
  try {
    const first = await runWechatImportWorker(options);
    assert.equal(first.status, "completed_with_warnings");
    assert.equal(first.createdMessages, 1);
    assert.equal(first.reusedMessages, 0);
    assert.equal(first.createdMediaAssets, 1);
    assert.equal(first.reusedMediaAssets, 1);
    assert.equal(first.createdMediaLocations, 4);
    assert.equal(first.reusedMediaLocations, 0);
    assert.equal(first.uploadedObjects, 3);
    assert.equal(first.reusedObjects, 0);
    assert.ok(first.uploadedBytes > 0);
    assert.deepEqual(first.warningCounts, [{ code: "media_missing", count: 1 }]);
    assert.equal(storage.putCalls.length, 3);
    assert.equal(new Set(storage.putCalls.map((call) => call.key)).size, 3);

    const storeAfterFirst = await repository.getStore();
    assert.equal(storeAfterFirst.rawSources.length, 1);
    assert.equal(storeAfterFirst.rawSources[0].visibility, "private");
    assert.equal(storeAfterFirst.mediaAssets.length, 1);
    assert.equal(storeAfterFirst.mediaLocations.length, 4);
    assert.equal(storeAfterFirst.mediaLocations.filter((location) => location.provider === "hot" && location.variant === "original")[0].status, "awaiting_archive");
    assert.equal(storeAfterFirst.events.length, 0);
    assert.equal(storeAfterFirst.dailyTraces.length, 0);
    assert.equal(storeAfterFirst.organizerRuns.length, 0);

    const second = await runWechatImportWorker({ ...options, leaseOwner: "synthetic-worker-rerun", now: new Date().toISOString() });
    assert.equal(second.status, "completed_with_warnings");
    assert.equal(second.createdMessages, 0);
    assert.equal(second.reusedMessages, 0);
    assert.equal(second.uploadedObjects, 0);
    assert.equal(second.createdMediaAssets, 0);
    assert.equal(second.createdMediaLocations, 0);
    assert.equal(storage.putCalls.length, 3);
    const storeAfterSecond = await repository.getStore();
    assert.equal(storeAfterSecond.rawSources.length, 1);
    assert.equal(storeAfterSecond.mediaAssets.length, 1);
    assert.equal(storeAfterSecond.mediaLocations.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot validation detects source mutation and enforces canary bounds", async () => {
  const root = await createFixture();
  try {
    const snapshot = await scanWechatSnapshot(root);
    await assertWechatSnapshot(root, snapshot.rootFingerprint);
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 101 }), /WECHAT_MESSAGE_LIMIT_INVALID/);
    await assert.rejects(() => loadWechatBundle(root, { maxMedia: 21 }), /WECHAT_MEDIA_LIMIT_INVALID/);
    const markdown = await readFile(path.join(root, "session.md"), "utf8");
    await writeFile(path.join(root, "session.md"), `${markdown}\nsynthetic mutation\n`);
    await assert.rejects(() => assertWechatSnapshot(root, snapshot.rootFingerprint), /WECHAT_SNAPSHOT_MISMATCH/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker records snapshot drift as a failed task before any media upload", async () => {
  const root = await createFixture();
  const baseRepository = createInMemoryRepository();
  const storage = new CountingStorage();
  const repository = {
    ...baseRepository,
    async claimChatImportTask(input) {
      const claimed = await baseRepository.claimChatImportTask(input);
      const markdownPath = path.join(root, "session.md");
      const markdown = await readFile(markdownPath, "utf8");
      await writeFile(markdownPath, `${markdown}\nsynthetic claim-time mutation\n`);
      return claimed;
    },
  };
  try {
    const report = await runWechatImportWorker({ sourceRoot: root, profileId: "profile-wechat-snapshot-drift-test", contributorId: "contributor-system", repository, storage, leaseOwner: "synthetic-drift-worker", now: new Date().toISOString() });
    assert.equal(report.status, "failed");
    assert.equal(report.safeErrorCode, "WECHAT_SNAPSHOT_MISMATCH");
    assert.equal(storage.putCalls.length, 0);
    assert.equal((await baseRepository.getChatImportTask(report.taskId)).status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capacity-audit CLI reports bounded metadata without importing or leaking source root", async () => {
  const root = await createFixture();
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, "--source-root", root, "--capacity-audit"], { env: process.env });
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "capacity-audit");
    assert.equal(report.status, "ok");
    assert.equal(report.selectedMessageCount, 1);
    assert.equal(report.presentMediaCount, 1);
    assert.equal(report.missingMediaCount, 1);
    assert.equal(JSON.stringify(report).includes(root), false);
    assert.equal(JSON.stringify(report).includes("session.md"), false);
    assert.equal(JSON.stringify(report).includes("Synthetic"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
