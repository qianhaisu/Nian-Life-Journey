import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
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

test("loadWechatBundle classifies invalid, present, needs_review, and missing media in one pass", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-classify-"));
  try {
    const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 120, g: 80, b: 48 } } }).jpeg().toBuffer();
    await writeFile(path.join(root, "bad.jpg"), Buffer.from("this is not a jpeg"));
    await writeFile(path.join(root, "photo1.jpg"), image);
    await writeFile(path.join(root, "photo2.jpg"), image);
    await writeFile(
      path.join(root, "session.md"),
      "# Synthetic Conversation\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Synthetic Sender\n![bad](bad.jpg)\n\n![p1](photo1.jpg)\n\n![p2](photo2.jpg)\n\n![missing](missing.jpg)\n",
    );
    const loaded = await loadWechatBundle(root, { maxMessages: 100, maxMedia: 1 });
    const byPath = new Map(loaded.bundle.mediaRefs.map((ref) => [ref.relativePath, ref]));
    assert.equal(byPath.get("bad.jpg")?.availability, "invalid");
    assert.equal(byPath.get("photo1.jpg")?.availability, "present");
    assert.equal(byPath.get("photo2.jpg")?.availability, "needs_review");
    assert.equal(byPath.get("missing.jpg")?.availability, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker fails a single item closed with WECHAT_MEDIA_HASH_CHANGED when photo bytes mutate without a snapshot-visible change", async () => {
  const root = await createFixture();
  const repository = createInMemoryRepository();
  const storage = new CountingStorage();
  const photoPath = path.join(root, "photo.jpg");
  // fs mtime carries sub-millisecond precision on file creation that a Date-based utimes() call
  // cannot reproduce exactly; pin the mtime via utimes() once so the later restore (same code path,
  // same numeric input) round-trips bit-for-bit instead of drifting the snapshot fingerprint.
  const pinnedSeconds = Date.now() / 1000;
  await utimes(photoPath, pinnedSeconds, pinnedSeconds);
  const originalStat = await stat(photoPath);
  const originalBytes = await readFile(photoPath);
  const hookedRepository = {
    ...repository,
    async claimChatImportTask(input) {
      const claimed = await repository.claimChatImportTask(input);
      const mutated = Buffer.from(originalBytes);
      mutated[mutated.length - 5] ^= 0xff;
      await writeFile(photoPath, mutated);
      await utimes(photoPath, originalStat.mtimeMs / 1000, originalStat.mtimeMs / 1000);
      return claimed;
    },
  };
  try {
    const report = await runWechatImportWorker({ sourceRoot: root, profileId: "profile-wechat-hash-changed-test", contributorId: "contributor-system", repository: hookedRepository, storage, leaseOwner: "synthetic-hash-worker", now: new Date().toISOString() });
    assert.equal(report.status, "failed");
    assert.equal(report.safeErrorCode, "WECHAT_MEDIA_HASH_CHANGED");
    assert.equal(storage.putCalls.length, 0);
    assert.equal((await repository.getChatImportTask(report.taskId)).status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("worker resumes from the last saved checkpoint after an interruption, processing only the remaining message", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-resume-"));
  try {
    const photo1 = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 120, g: 80, b: 48 } } }).jpeg().toBuffer();
    const photo2 = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 200, b: 30 } } }).jpeg().toBuffer();
    await writeFile(path.join(root, "photo1.jpg"), photo1);
    await writeFile(path.join(root, "photo2.jpg"), photo2);
    await writeFile(
      path.join(root, "session.md"),
      "# Synthetic Conversation\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Synthetic Sender\nFirst message\n\n![p1](photo1.jpg)\n\n## 2026\\-08\\-31 09:02:02 Synthetic Sender\nSecond message\n\n![p2](photo2.jpg)\n",
    );
    const repository = createInMemoryRepository();
    const storage = new CountingStorage();
    const baseOptions = { sourceRoot: root, profileId: "profile-wechat-resume-test", contributorId: "contributor-system", storage, maxMessages: 100, maxMedia: 20 };

    let interruptAfterFirstMessage = true;
    const interruptingRepository = {
      ...repository,
      async saveChatImportCheckpoint(input) {
        const saved = await repository.saveChatImportCheckpoint(input);
        if (interruptAfterFirstMessage && input.currentStage === "media_link" && saved?.checkpoint?.messageOrdinal === 1) {
          throw new Error("SYNTHETIC_INTERRUPT");
        }
        return saved;
      },
    };

    const first = await runWechatImportWorker({ ...baseOptions, repository: interruptingRepository, leaseOwner: "worker-before-crash", now: new Date().toISOString() });
    assert.equal(first.status, "failed");
    assert.equal(first.safeErrorCode, "SYNTHETIC_INTERRUPT");
    assert.equal(first.createdMessages, 1);
    assert.equal(storage.putCalls.length, 3);
    const afterCrash = await repository.getChatImportTask(first.taskId);
    assert.equal(afterCrash.status, "failed");
    assert.equal(afterCrash.checkpoint.messageOrdinal, 1);

    interruptAfterFirstMessage = false;
    const second = await runWechatImportWorker({ ...baseOptions, repository, taskId: first.taskId, retryFailed: true, leaseOwner: "worker-after-recovery", now: new Date().toISOString() });
    assert.equal(second.status, "completed");
    assert.equal(second.createdMessages, 1);
    assert.equal(second.reusedMessages, 0);
    assert.equal(second.createdMediaAssets, 1);
    assert.equal(second.uploadedObjects, 3);
    assert.equal(storage.putCalls.length, 6);

    const store = await repository.getStore();
    assert.equal(store.rawSources.length, 2);
    assert.equal(store.mediaAssets.length, 2);
    assert.equal(store.mediaLocations.length, 8);
    const finalTask = await repository.getChatImportTask(first.taskId);
    assert.equal(finalTask.status, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an incremental bundle (more messages added to the same export) only creates the new messages, not duplicates of the old ones", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-incremental-"));
  try {
    const photo1 = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 120, g: 80, b: 48 } } }).jpeg().toBuffer();
    await writeFile(path.join(root, "photo1.jpg"), photo1);
    await writeFile(
      path.join(root, "session.md"),
      "# Synthetic Conversation\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Synthetic Sender\nFirst message\n\n![p1](photo1.jpg)\n",
    );
    const repository = createInMemoryRepository();
    const storage = new CountingStorage();
    const baseOptions = { sourceRoot: root, profileId: "profile-wechat-incremental-test", contributorId: "contributor-system", repository, storage, maxMessages: 100, maxMedia: 20 };

    const firstRun = await runWechatImportWorker({ ...baseOptions, leaseOwner: "worker-batch-1", now: new Date().toISOString() });
    assert.equal(firstRun.status, "completed");
    assert.equal(firstRun.createdMessages, 1);

    const photo2 = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 200, b: 30 } } }).jpeg().toBuffer();
    await writeFile(path.join(root, "photo2.jpg"), photo2);
    await writeFile(
      path.join(root, "session.md"),
      "# Synthetic Conversation\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Synthetic Sender\nFirst message\n\n![p1](photo1.jpg)\n\n## 2026\\-08\\-31 09:02:02 Synthetic Sender\nSecond message\n\n![p2](photo2.jpg)\n",
    );

    const secondRun = await runWechatImportWorker({ ...baseOptions, leaseOwner: "worker-batch-2", now: new Date().toISOString() });
    assert.equal(secondRun.status, "completed");
    assert.equal(secondRun.createdMessages, 1);
    assert.equal(secondRun.reusedMessages, 1);
    assert.equal(secondRun.createdMediaAssets, 1);
    assert.equal(secondRun.uploadedObjects, 3);

    const store = await repository.getStore();
    assert.equal(store.rawSources.length, 2);
    assert.equal(store.mediaAssets.length, 2);
    assert.equal(storage.putCalls.length, 6);

    const rerun = await runWechatImportWorker({ ...baseOptions, leaseOwner: "worker-batch-2-rerun", now: new Date().toISOString() });
    assert.equal(rerun.status, "completed");
    assert.equal(rerun.createdMessages, 0);
    assert.equal(rerun.uploadedObjects, 0);
    assert.equal((await repository.getStore()).rawSources.length, 2);
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
