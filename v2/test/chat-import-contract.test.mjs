import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { createInMemoryRepository, createAsyncChatImportRepository } from "../lib/db/in-memory-chat-import-repository.ts";
import { createJsonRepository } from "../lib/db/json-repository.ts";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });

const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

function uid(prefix) { return `${prefix}-${randomUUID()}`; }
function source(profileId, overrides = {}) {
  return { id: uid("source"), profileId, sourceType: "wechat", contentTypes: ["family"], contributorId: "contributor-system", capturedAt: "2026-08-31T10:00:00.000Z", importedAt: "2026-08-31T10:00:00.000Z", text: "synthetic message", mediaIds: [], sourceLabel: "WeChat message", visibility: "private", status: "uploaded", provider: "wechat", providerExternalId: uid("external"), ...overrides };
}
function asset(profileId, overrides = {}) {
  return { id: uid("asset"), profileId, mediaType: "photo", mimeType: "image/jpeg", checksum: `sha256:${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`, archiveStatus: "awaiting_archive", createdAt: "2026-08-31T10:00:00.000Z", ...overrides };
}
function media(profileId, sourceId, assetId) {
  return { id: uid("media"), profileId, rawSourceId: sourceId, mediaAssetId: assetId, type: "photo", src: "/api/media/synthetic?variant=web", mimeType: "image/jpeg", alt: "synthetic image", takenAt: "2026-08-31T10:00:00.000Z", visibility: "private", width: 10, height: 10 };
}
function location(assetId, provider, providerRef) {
  return { id: uid("location"), mediaAssetId: assetId, provider, variant: "original", providerRef, status: provider === "hot" ? "awaiting_archive" : "ready", mimeType: "image/jpeg", createdAt: "2026-08-31T10:00:00.000Z", updatedAt: "2026-08-31T10:00:00.000Z" };
}

const adapters = [
  ["in-memory", () => createInMemoryRepository()],
  ["async", () => createAsyncChatImportRepository(createInMemoryRepository())],
  ["json", () => createJsonRepository()],
];

function addTaskTests(name, createRepository, profileIdForTest = () => uid("profile")) {
  test(`[${name}] task creation is idempotent and concurrent claim has one winner`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const importBatchId = uid("batch");
    const [first, second] = await Promise.all([
      repo.createChatImportTask({ profileId, importBatchId, now: "2026-08-31T10:00:00.000Z" }),
      repo.createChatImportTask({ profileId, importBatchId, now: "2026-08-31T10:00:00.000Z" }),
    ]);
    assert.equal(first.id, second.id);
    const claims = await Promise.all([
      repo.claimChatImportTask({ taskId: first.id, leaseOwner: "worker-a", leaseMs: 60_000, now: "2026-08-31T10:00:01.000Z" }),
      repo.claimChatImportTask({ taskId: first.id, leaseOwner: "worker-b", leaseMs: 60_000, now: "2026-08-31T10:00:01.000Z" }),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await repo.getChatImportTask(first.id)).status, "running");
  });

  test(`[${name}] checkpoint, heartbeat, warning completion, cancel, and retry preserve lifecycle rules`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const task = await repo.createChatImportTask({ profileId, importBatchId: uid("batch"), maxAttempts: 2, now: "2026-08-31T10:00:00.000Z" });
    const claimed = await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker", leaseMs: 60_000, now: "2026-08-31T10:00:01.000Z" });
    await repo.saveChatImportCheckpoint({ taskId: task.id, leaseOwner: "worker", checkpoint: { snapshotDigest: "snapshot-a", documentOrdinal: 0, messageOrdinal: 1 }, currentStage: "bundle_parse", processedMessages: 1, warnings: 1, warningCounts: [{ code: "media_missing", count: 1 }], now: "2026-08-31T10:00:02.000Z" });
    await repo.heartbeatChatImportTask({ taskId: task.id, leaseOwner: "worker", leaseMs: 60_000, now: "2026-08-31T10:00:03.000Z" });
    await assert.rejects(() => repo.saveChatImportCheckpoint({ taskId: task.id, leaseOwner: "worker", checkpoint: { snapshotDigest: "snapshot-b", documentOrdinal: 0, messageOrdinal: 2 }, now: "2026-08-31T10:00:04.000Z" }), /CHECKPOINT_SNAPSHOT_MISMATCH/);
    const completed = await repo.completeChatImportWithWarnings({ taskId: task.id, leaseOwner: "worker", warningCounts: [{ code: "media_missing", count: 1 }], now: "2026-08-31T10:00:05.000Z" });
    assert.equal(completed.status, "completed_with_warnings");
    assert.equal(completed.warnings, 1);
    const cancelledTask = await repo.createChatImportTask({ profileId, importBatchId: uid("batch"), now: "2026-08-31T10:00:00.000Z" });
    await repo.requestChatImportCancel(cancelledTask.id, "2026-08-31T10:00:01.000Z");
    const cancelled = await repo.acknowledgeChatImportCancel({ taskId: cancelledTask.id, now: "2026-08-31T10:00:02.000Z" });
    assert.equal(cancelled.status, "cancelled");
    const retryTask = await repo.createChatImportTask({ profileId, importBatchId: uid("batch"), maxAttempts: 2, now: "2026-08-31T10:00:00.000Z" });
    await repo.claimChatImportTask({ taskId: retryTask.id, leaseOwner: "worker", leaseMs: 60_000, now: "2026-08-31T10:00:01.000Z" });
    await repo.failChatImportTask({ taskId: retryTask.id, leaseOwner: "worker", safeErrorCode: "SYNTHETIC_FAILURE", now: "2026-08-31T10:00:02.000Z" });
    await repo.retryChatImportTask(retryTask.id, "2026-08-31T10:00:03.000Z");
    const reclaimed = await repo.claimChatImportTask({ taskId: retryTask.id, leaseOwner: "worker-2", leaseMs: 60_000, now: "2026-08-31T10:00:04.000Z" });
    assert.equal(reclaimed.attempt, 2);
    assert.equal(reclaimed.status, "running");
  });

  test(`[${name}] source and media persistence is idempotent across WeChat and Quark locations`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const sourceInput = source(profileId);
    const assetInput = asset(profileId);
    const mediaInput = media(profileId, sourceInput.id, assetInput.id);
    const wechatLocation = location(assetInput.id, "wechat", uid("wechat-ref"));
    const first = await repo.persistChatImportMessage({ source: sourceInput, media: [mediaInput], assets: [assetInput], locations: [wechatLocation] });
    const second = await repo.persistChatImportMessage({ source: { ...sourceInput, id: uid("different-source") }, media: [mediaInput], assets: [assetInput], locations: [wechatLocation] });
    assert.equal(first.sourceCreated, true);
    assert.equal(second.sourceCreated, false);
    assert.equal(second.reusedAssetIds.length, 1);
    assert.equal(second.reusedLocationIds.length, 1);
    const sameChecksumDifferentProvider = asset(profileId, { id: uid("quark-asset"), checksum: assetInput.checksum });
    const quarkLocation = location(sameChecksumDifferentProvider.id, "quark", uid("quark-ref"));
    const crossProvider = await repo.persistChatImportMessage({ source: sourceInput, media: [], assets: [sameChecksumDifferentProvider], locations: [quarkLocation] });
    assert.equal(crossProvider.reusedAssetIds.length, 1);
    assert.equal(crossProvider.createdLocationIds.length, 1);
    if ("getStore" in repo) {
      const store = await repo.getStore();
      assert.equal(store.rawSources.filter((item) => item.providerExternalId === sourceInput.providerExternalId).length, 1);
      assert.equal(store.mediaAssets.filter((item) => item.checksum === assetInput.checksum).length, 1);
      assert.equal(store.mediaLocations.filter((item) => item.mediaAssetId === assetInput.id || item.mediaAssetId === store.mediaAssets.find((item) => item.checksum === assetInput.checksum)?.id).length, 2);
    }
  });

  test(`[${name}] media ID conflicts are rejected instead of silently changing provenance`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const sourceInput = source(profileId);
    const firstAsset = asset(profileId);
    const mediaInput = media(profileId, sourceInput.id, firstAsset.id);
    await repo.persistChatImportMessage({ source: sourceInput, media: [mediaInput], assets: [firstAsset] });
    const secondAsset = asset(profileId, { checksum: `sha256:${"b".repeat(64)}` });
    await assert.rejects(() => repo.persistChatImportMessage({ source: { ...sourceInput, id: uid("source") }, media: [{ ...mediaInput, mediaAssetId: secondAsset.id }], assets: [secondAsset] }), /MEDIA_ID_CONFLICT/);
  });

  test(`[${name}] source, asset, and location identity conflicts leave no partial writes`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const sourceInput = source(profileId);
    const assetInput = asset(profileId);
    const originalLocation = location(assetInput.id, "wechat", uid("wechat-ref"));
    await repo.persistChatImportMessage({ source: sourceInput, media: [], assets: [assetInput], locations: [originalLocation] });
    await assert.rejects(() => repo.persistChatImportMessage({ source: { ...sourceInput, providerExternalId: uid("different-external") }, media: [], assets: [] }), /RAW_SOURCE_ID_CONFLICT/);
    await assert.rejects(() => repo.persistChatImportMessage({ source: sourceInput, media: [], assets: [{ ...assetInput, checksum: `sha256:${"b".repeat(64)}` }], locations: [] }), /MEDIA_ASSET_ID_CONFLICT/);
    await assert.rejects(() => repo.persistChatImportMessage({ source: sourceInput, media: [], assets: [assetInput], locations: [{ ...originalLocation, providerRef: uid("different-ref") }] }), /MEDIA_LOCATION_ID_CONFLICT/);
    if ("getStore" in repo) {
      const store = await repo.getStore();
      assert.equal(store.rawSources.filter((item) => item.id === sourceInput.id).length, 1);
      assert.equal(store.mediaAssets.filter((item) => item.id === assetInput.id).length, 1);
      assert.equal(store.mediaLocations.filter((item) => item.id === originalLocation.id).length, 1);
    }
  });
}

for (const [name, createRepository] of adapters) addTaskTests(name, createRepository);

if (process.env.DATABASE_URL) {
  const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
  const { closePool } = await import("../lib/db/client.ts");
  const { Client } = await import("pg");
  const profileId = uid("profile-chat-contract");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("insert into profiles (id, display_name, birth_date, timezone, visibility) values ($1, 'Synthetic Contract', '2020-01-01', 'UTC', 'private')", [profileId]);
  await client.end();
  addTaskTests("postgres", () => createPostgresRepository(), () => profileId);
  test.after(async () => {
    const cleanup = new Client({ connectionString: process.env.DATABASE_URL });
    await cleanup.connect();
    await cleanup.query("delete from media_locations where media_asset_id in (select id from media_assets where profile_id = $1)", [profileId]);
    for (const table of ["media", "media_assets", "raw_sources", "chat_import_tasks"]) await cleanup.query(`delete from ${table} where profile_id = $1`, [profileId]);
    await cleanup.query("delete from profiles where id = $1", [profileId]);
    await cleanup.end();
    await closePool();
  });
} else {
  test("[postgres] real contract skipped when DATABASE_URL is unavailable", { skip: true }, () => {});
}
