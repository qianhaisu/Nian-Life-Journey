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
import { importWechatBundle } from "../lib/ingest/wechat-import.ts";

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
    // The wechat-provider and hot-provider MediaAsset entries for one photo now merge into a
    // single asset per message (batch persistence consolidated what used to be two separate
    // persist calls for the same checksum), so there is no artificial self-reuse to report.
    assert.equal(first.reusedMediaAssets, 0);
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

test("conversationIndex selects a specific conversation deterministically, and an out-of-range index is rejected instead of silently falling back", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-conv-index-"));
  try {
    const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    await writeFile(path.join(root, "a.jpg"), image);
    await writeFile(path.join(root, "b.jpg"), image);
    await writeFile(path.join(root, "conversation-a.md"), "# A\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Sender A\nmessage in conversation A\n\n![a](a.jpg)\n");
    await writeFile(path.join(root, "conversation-b.md"), "# B\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Sender B\nmessage in conversation B\n\n![b](b.jpg)\n");
    const first = await loadWechatBundle(root, { maxMessages: 100, maxMedia: 20, conversationIndex: 0 });
    const second = await loadWechatBundle(root, { maxMessages: 100, maxMedia: 20, conversationIndex: 1 });
    assert.notEqual(first.selectedDocument, second.selectedDocument, "index 0 and index 1 must resolve to different conversations");
    // Selecting the same index again must be stable (same document each time), matching the
    // requirement that a chosen medium-scale conversation stays chosen across process restarts.
    const firstAgain = await loadWechatBundle(root, { maxMessages: 100, maxMedia: 20, conversationIndex: 0 });
    assert.equal(first.selectedDocument, firstAgain.selectedDocument);
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 100, maxMedia: 20, conversationIndex: 2 }), /WECHAT_NO_VALID_SESSION/);
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 100, maxMedia: 20, conversationIndex: -1 }), /WECHAT_CONVERSATION_INDEX_INVALID/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("two different conversations from the same source-root snapshot get independent ChatImportTask rows, never colliding on the same batch id", async () => {
  // Root cause of a real bug found while calibrating throughput on a medium-scale conversation:
  // importBatchId used to be derived only from the whole-directory snapshot fingerprint, so ANY
  // conversation picked via conversationIndex from the same source root collided with whichever
  // conversation had already been imported first — a later index's "full conversation" run would
  // just find that already-terminal task and short-circuit with all-zero counts, never doing any
  // work at all. The batch id must include the selected conversation's own identity.
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-batch-id-"));
  try {
    const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
    await writeFile(path.join(root, "a.jpg"), image);
    await writeFile(path.join(root, "b.jpg"), image);
    await writeFile(path.join(root, "conversation-a.md"), "# A\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Sender A\nmessage in conversation A\n\n![a](a.jpg)\n");
    await writeFile(path.join(root, "conversation-b.md"), "# B\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Sender B\nmessage in conversation B\n\n![b](b.jpg)\n");
    const repository = createInMemoryRepository();
    const options = { sourceRoot: root, profileId: "profile-wechat-batch-id-test", contributorId: "contributor-system", repository, storage: new CountingStorage(), maxMessages: 100, maxMedia: 20, now: new Date().toISOString() };
    const first = await runWechatImportWorker({ ...options, conversationIndex: 0, leaseOwner: "worker-conv-a" });
    assert.equal(first.status, "completed");
    assert.equal(first.createdMessages, 1);
    const second = await runWechatImportWorker({ ...options, conversationIndex: 1, leaseOwner: "worker-conv-b" });
    assert.equal(second.status, "completed", "the second conversation must actually run, not short-circuit against the first one's already-terminal task");
    assert.equal(second.createdMessages, 1);
    assert.notEqual(first.taskId, second.taskId);
    const store = await repository.getStore();
    assert.equal(store.chatImportTasks.length, 2);
    assert.equal(store.rawSources.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot validation detects source mutation and enforces canary bounds", async () => {
  const root = await createFixture();
  try {
    const snapshot = await scanWechatSnapshot(root);
    await assertWechatSnapshot(root, snapshot.rootFingerprint);
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 200_001 }), /WECHAT_MESSAGE_LIMIT_INVALID/);
    await assert.rejects(() => loadWechatBundle(root, { maxMedia: 200_001 }), /WECHAT_MEDIA_LIMIT_INVALID/);
    await assert.rejects(() => loadWechatBundle(root, { maxMessages: 0 }), /WECHAT_MESSAGE_LIMIT_INVALID/);
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

test("loadWechatBundle classifies invalid, present, deferred_by_limit, and missing media in one pass", async () => {
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
    assert.equal(byPath.get("photo2.jpg")?.availability, "deferred_by_limit");
    assert.equal(byPath.get("missing.jpg")?.availability, "missing");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a media item deferred by the canary's maxMedia cap is never counted as a data-quality warning, and never appears once the cap is lifted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-deferred-"));
  try {
    const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 120, g: 80, b: 48 } } }).jpeg().toBuffer();
    await writeFile(path.join(root, "photo1.jpg"), image);
    await writeFile(path.join(root, "photo2.jpg"), image);
    await writeFile(
      path.join(root, "session.md"),
      "# Synthetic Conversation\n- participant: redacted\n---\n## 2026\\-08\\-31 09:01:02 Synthetic Sender\n![p1](photo1.jpg)\n\n![p2](photo2.jpg)\n",
    );
    const repository = createInMemoryRepository();
    const storage = new CountingStorage();
    const capped = await runWechatImportWorker({ sourceRoot: root, profileId: "profile-wechat-deferred-capped", contributorId: "contributor-system", repository, storage, leaseOwner: "worker-capped", maxMessages: 100, maxMedia: 1, now: new Date().toISOString() });
    assert.equal(capped.status, "completed", "a cap-deferred item is not a data-quality issue and must not flip the task to completed_with_warnings");
    assert.deepEqual(capped.warningCounts, []);

    const uncapped = await runWechatImportWorker({ sourceRoot: root, profileId: "profile-wechat-deferred-uncapped", contributorId: "contributor-system", repository: createInMemoryRepository(), storage: new CountingStorage(), leaseOwner: "worker-uncapped", maxMessages: 100, maxMedia: 20, now: new Date().toISOString() });
    assert.equal(uncapped.status, "completed");
    assert.deepEqual(uncapped.warningCounts, [], "a full (unlimited) import must never produce deferred_by_limit at all");
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

// Batch size is clamped to [20, 100] in production (see wechat-worker.ts), so a two-batch test at
// the minimum batch size needs at least 21 messages: batch 1 is messages 1-20, batch 2 starts at
// 21. Only ordinals in `photoAt` get an actual JPEG (keeps the fixture and the run fast); the rest
// are plain text messages, which is realistic (WeChat conversations are mostly text).
async function createMultiMessageFixture(root, count, photoAt) {
  const photoBuffers = new Map();
  let md = "# Synthetic Conversation\n- participant: redacted\n---\n";
  for (let i = 1; i <= count; i++) {
    const hh = String(9 + Math.floor(i / 60)).padStart(2, "0");
    const mm = String(i % 60).padStart(2, "0");
    md += `## 2026\\-08\\-31 ${hh}:${mm}:00 Synthetic Sender\nmessage ${i}\n`;
    if (photoAt.includes(i)) {
      if (!photoBuffers.has(i)) photoBuffers.set(i, await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: i % 255, g: 80, b: 48 } } }).jpeg().toBuffer());
      await writeFile(path.join(root, `p${i}.jpg`), photoBuffers.get(i));
      md += `\n![p](p${i}.jpg)\n`;
    }
    md += "\n";
  }
  await writeFile(path.join(root, "session.md"), md);
}

test("worker resumes from the last saved checkpoint after an interruption, replaying only the unconfirmed batch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-resume-"));
  try {
    await createMultiMessageFixture(root, 21, [1, 21]);
    const repository = createInMemoryRepository();
    const storage = new CountingStorage();
    const baseOptions = { sourceRoot: root, profileId: "profile-wechat-resume-test", contributorId: "contributor-system", storage, maxMessages: 100, maxMedia: 100, messageBatchSize: 20 };

    // Intercept BEFORE the real checkpoint write commits — the crash must land while batch 2's
    // durable checkpoint write is still in flight, not after it already succeeded (which would
    // just mean batch 2 legitimately finished and there is nothing left to replay).
    let interruptOnBatch2 = true;
    const interruptingRepository = {
      ...repository,
      async saveChatImportCheckpoint(input) {
        if (interruptOnBatch2 && input.currentStage === "media_link" && input.checkpoint.messageOrdinal === 21) {
          throw new Error("SYNTHETIC_INTERRUPT");
        }
        return repository.saveChatImportCheckpoint(input);
      },
    };

    const first = await runWechatImportWorker({ ...baseOptions, repository: interruptingRepository, leaseOwner: "worker-before-crash", now: new Date().toISOString() });
    assert.equal(first.status, "failed");
    assert.equal(first.safeErrorCode, "SYNTHETIC_INTERRUPT");
    // Batch 2's data was actually persisted (persistChatImportBatch already committed) before the
    // crash landed on its checkpoint write — this run's own local counters see all 21 as created,
    // but the DURABLE checkpoint (asserted below) is what governs replay, and it correctly stayed
    // at the end of batch 1.
    assert.equal(first.createdMessages, 21);
    const afterCrash = await repository.getChatImportTask(first.taskId);
    assert.equal(afterCrash.status, "failed");
    assert.equal(afterCrash.checkpoint.messageOrdinal, 20, "checkpoint must stay at the end of the last CONFIRMED batch, not advance into the crashed one");

    interruptOnBatch2 = false;
    const second = await runWechatImportWorker({ ...baseOptions, repository, taskId: first.taskId, retryFailed: true, leaseOwner: "worker-after-recovery", now: new Date().toISOString() });
    assert.equal(second.status, "completed");
    // The whole unconfirmed batch (message 21) is replayed, but its RawSource/MediaAsset/
    // MediaLocation already exist from the crashed run's already-committed persist — so replay
    // must find them as reused, never re-created, and never re-upload the photo.
    assert.equal(second.createdMessages, 0, "message 21 was already persisted before the crash; replay must not create it again");
    assert.equal(second.reusedMessages, 1);
    assert.equal(second.createdMediaAssets, 0);
    assert.equal(second.reusedMediaAssets, 1);
    assert.equal(second.uploadedObjects, 0, "the photo was already uploaded before the crash; replay must not re-upload it");
    assert.equal(storage.putCalls.length, 6, "3 objects for message 1's photo + 3 for message 21's photo, never re-uploaded on replay");

    const store = await repository.getStore();
    assert.equal(store.rawSources.length, 21);
    assert.equal(store.mediaAssets.length, 2);
    const finalTask = await repository.getChatImportTask(first.taskId);
    assert.equal(finalTask.status, "completed");
    assert.equal(finalTask.processedMessages, 21);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a gracefully cancelled task resumes with --retry-failed and completes the conversation without recreating or re-uploading anything already done", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nianlife-wechat-cancel-resume-"));
  try {
    await createMultiMessageFixture(root, 21, [1, 21]);
    const repository = createInMemoryRepository();
    const storage = new CountingStorage();
    const baseOptions = { sourceRoot: root, profileId: "profile-wechat-cancel-resume-test", contributorId: "contributor-system", storage, maxMessages: 100, maxMedia: 100, messageBatchSize: 20 };

    // Batch size is clamped to a floor of 20, so batch 1 covers messages 1-20 and batch 2 is just
    // message 21. Each batch does two heartbeat checks (one before uploads, one after); batch 1
    // uses calls 1 and 2, so requesting the cancel on call 3 lands at the very start of batch 2,
    // after batch 1 has already fully committed.
    let heartbeatCalls = 0;
    const cancellingRepository = {
      ...repository,
      async heartbeatChatImportTask(input) {
        heartbeatCalls += 1;
        if (heartbeatCalls === 3) await repository.requestChatImportCancel(input.taskId);
        return repository.heartbeatChatImportTask(input);
      },
    };

    const first = await runWechatImportWorker({ ...baseOptions, repository: cancellingRepository, leaseOwner: "worker-before-cancel", now: new Date().toISOString() });
    assert.equal(first.status, "cancelled");
    assert.equal(first.createdMessages, 20, "batch 1 (messages 1-20) must have committed before the graceful stop took effect");
    const taskId = first.taskId;
    const afterCancel = await repository.getChatImportTask(taskId);
    assert.equal(afterCancel.status, "cancelled");
    assert.equal(afterCancel.checkpoint.messageOrdinal, 20);

    const resumed = await runWechatImportWorker({ ...baseOptions, repository, taskId, retryFailed: true, leaseOwner: "worker-after-resume", now: new Date().toISOString() });
    assert.equal(resumed.status, "completed", "the resumed run must actually be allowed to run, not just fail again as terminal");
    assert.equal(resumed.createdMessages, 1, "only the remaining message (21) should be created on resume");
    assert.equal(resumed.uploadedObjects, 3, "only message 21's photo should upload; message 1's photo was already uploaded before the cancel");
    const finalTask = await repository.getChatImportTask(taskId);
    assert.equal(finalTask.status, "completed");
    assert.equal(finalTask.processedMessages, 21);
    assert.equal(finalTask.cancelRequestedAt, undefined, "resuming must clear the stale cancel request so the worker doesn't immediately cancel itself again");
    assert.equal(storage.putCalls.length, 6, "3 objects for photo1 (before cancel) + 3 for photo2 (after resume), never re-uploaded");
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

test("a message persisted by a worker that then loses its lease is never lost: the takeover worker finds it as reused, never re-created, never missing", async () => {
  // Root-causing a historical count mismatch (task said createdMessages:100, only 99 distinct
  // RawSource rows existed): the worker only advances checkpoint.messageOrdinal past a message
  // AFTER that message's persistChatImportMessage call has already committed, so a crash or lease
  // loss between "persist succeeds" and "checkpoint commits" cannot lose the row — a takeover
  // worker reprocesses that same message and correctly finds it (reused), never re-creating or
  // dropping it. This test proves that invariant holds for the current code.
  const repository = createInMemoryRepository();
  const bundle = {
    schemaVersion: "chat-import-bundle/v1",
    parserVersion: "wechat-official-markdown/1",
    sourceProvider: "wechat-official-markdown",
    sourceTimezone: "Asia/Shanghai",
    exportSnapshot: { rootFingerprint: "fp", capturedAt: "2026-08-31T00:00:00.000Z", fileCount: 1 },
    conversations: [{ id: "conversation:1", name: "c", participantIds: [] }],
    participants: [],
    messages: [{ messageId: "canonical:msg-1", conversationId: "conversation:1", senderId: "sender:1", direction: "unknown", sentAt: "2026-08-31T09:00:00+08:00", messageType: "text", text: "hello", mediaRefs: [], sourceLocator: { document: "session.md", recordOrdinal: 1 } }],
    mediaRefs: [],
    warnings: [],
  };
  const options = { profileId: "profile-lease-race-test", contributorId: "contributor-system", now: "2026-08-31T09:00:00.000Z" };

  // Worker A persists message 1 successfully...
  const firstAttempt = await importWechatBundle(bundle, repository, options);
  assert.equal(firstAttempt.createdMessages, 1);
  // ...but before A's own checkpoint-save can commit, its lease is deemed lost (crash, network
  // partition, etc). A takeover worker B resumes from the last COMMITTED checkpoint (still 0,
  // since A's checkpoint-save never happened) and reprocesses the same message.
  const secondAttempt = await importWechatBundle(bundle, repository, options);
  assert.equal(secondAttempt.createdMessages, 0);
  assert.equal(secondAttempt.reusedMessages, 1);

  const store = await repository.getStore();
  const matching = store.rawSources.filter((source) => source.providerExternalId === "canonical:msg-1");
  assert.equal(matching.length, 1, "the message must exist exactly once: never duplicated, never lost");
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

test("real (non-audit) CLI import fails closed instead of silently defaulting to the local JSON store when REPOSITORY_BACKEND is unset", async () => {
  const root = await createFixture();
  try {
    const env = { ...process.env };
    delete env.REPOSITORY_BACKEND;
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, "--source-root", root, "--profile-id", "profile-zhangnian"], { env }).catch((error) => error);
    assert.notEqual(result.code, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "rejected");
    assert.equal(report.safeErrorCode, "WECHAT_BACKEND_NOT_SPECIFIED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real (non-audit) CLI import fails closed when REPOSITORY_BACKEND is explicitly json, not just when it's unset", async () => {
  const root = await createFixture();
  try {
    const env = { ...process.env, REPOSITORY_BACKEND: "json" };
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, "--source-root", root, "--profile-id", "profile-zhangnian"], { env }).catch((error) => error);
    assert.notEqual(result.code, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "rejected");
    assert.equal(report.safeErrorCode, "WECHAT_BACKEND_NOT_SPECIFIED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capacity-audit CLI never requires a backend at all — it only reads the source, it never persists", async () => {
  const root = await createFixture();
  try {
    const env = { ...process.env };
    delete env.REPOSITORY_BACKEND;
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, "--source-root", root, "--capacity-audit"], { env });
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
