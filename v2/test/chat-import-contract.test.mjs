import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONTRACT_DATABASE_URL, SKIP_REASON } from "./fixtures/contract-database.mjs";
import { createInMemoryRepository, createAsyncChatImportRepository } from "../lib/db/in-memory-chat-import-repository.ts";
import { createJsonRepository } from "../lib/db/json-repository.ts";

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

  test(`[${name}] an expired lease can be reclaimed by a different worker, and the stale owner's writes are then rejected`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const task = await repo.createChatImportTask({ profileId, importBatchId: uid("batch"), now: "2026-08-31T10:00:00.000Z" });
    const claimed = await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker-a", leaseMs: 5_000, now: "2026-08-31T10:00:00.000Z" });
    assert.equal(claimed.leaseOwner, "worker-a");
    const stillLeased = await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker-b", leaseMs: 5_000, now: "2026-08-31T10:00:02.000Z" });
    assert.equal(stillLeased, null);
    const takenOver = await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker-b", leaseMs: 5_000, now: "2026-08-31T10:00:06.000Z" });
    assert.equal(takenOver.leaseOwner, "worker-b");
    assert.equal(takenOver.attempt, 2);
    await assert.rejects(() => repo.heartbeatChatImportTask({ taskId: task.id, leaseOwner: "worker-a", now: "2026-08-31T10:00:07.000Z" }), /LEASE_NOT_OWNED|LEASE_EXPIRED/);
    await assert.rejects(() => repo.saveChatImportCheckpoint({ taskId: task.id, leaseOwner: "worker-a", checkpoint: { snapshotDigest: "s", documentOrdinal: 0, messageOrdinal: 1 }, now: "2026-08-31T10:00:07.000Z" }), /LEASE_NOT_OWNED|LEASE_EXPIRED/);
  });

  test(`[${name}] maxAttempts exhaustion fails the task closed instead of claiming it forever`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const task = await repo.createChatImportTask({ profileId, importBatchId: uid("batch"), maxAttempts: 1, now: "2026-08-31T10:00:00.000Z" });
    const claimed = await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker", leaseMs: 1_000, now: "2026-08-31T10:00:00.000Z" });
    assert.equal(claimed.attempt, 1);
    const notReclaimable = await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker-2", leaseMs: 1_000, now: "2026-08-31T10:00:05.000Z" });
    assert.equal(notReclaimable, null);
    const final = await repo.getChatImportTask(task.id);
    assert.equal(final.status, "failed");
    assert.equal(final.safeErrorCode, "MAX_ATTEMPTS_EXCEEDED");
  });

  test(`[${name}] a gracefully cancelled task can be resumed (retry), and the resume clears the stale cancel request instead of re-cancelling itself`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const task = await repo.createChatImportTask({ profileId, importBatchId: uid("batch"), maxAttempts: 3, now: "2026-08-31T10:00:00.000Z" });
    await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker", leaseMs: 60_000, now: "2026-08-31T10:00:00.000Z" });
    await repo.requestChatImportCancel(task.id, "2026-08-31T10:00:01.000Z");
    const cancelled = await repo.acknowledgeChatImportCancel({ taskId: task.id, leaseOwner: "worker", now: "2026-08-31T10:00:02.000Z" });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.attempt, 1);
    // retryChatImportTask used to reject any status other than "failed" (INVALID_RETRY_TRANSITION);
    // a gracefully cancelled task must be resumable the same way, and must not carry the stale
    // cancelRequestedAt forward (or the resumed worker would cancel itself again on its first
    // heartbeat).
    const resumed = await repo.retryChatImportTask(task.id, "2026-08-31T10:00:03.000Z");
    assert.equal(resumed.status, "retry_pending");
    assert.equal(resumed.cancelRequestedAt, undefined);
    const reclaimed = await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker-2", leaseMs: 60_000, now: "2026-08-31T10:00:04.000Z" });
    assert.equal(reclaimed.status, "running");
    assert.equal(reclaimed.cancelRequestedAt, undefined);
    assert.equal(reclaimed.attempt, 2);
  });

  test(`[${name}] resuming a cancelled task whose failure-retry budget is already exhausted still transitions to retry_pending (the budget only gates future claims, not the cancel-resume itself)`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const task = await repo.createChatImportTask({ profileId, importBatchId: uid("batch"), maxAttempts: 1, now: "2026-08-31T10:00:00.000Z" });
    await repo.claimChatImportTask({ taskId: task.id, leaseOwner: "worker", leaseMs: 60_000, now: "2026-08-31T10:00:00.000Z" });
    await repo.requestChatImportCancel(task.id, "2026-08-31T10:00:01.000Z");
    await repo.acknowledgeChatImportCancel({ taskId: task.id, leaseOwner: "worker", now: "2026-08-31T10:00:02.000Z" });
    const resumed = await repo.retryChatImportTask(task.id, "2026-08-31T10:00:03.000Z");
    assert.equal(resumed.status, "retry_pending", "unlike a failed task at maxAttempts, resuming a cancel must not throw MAX_ATTEMPTS_EXCEEDED");
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

function addBatchTests(name, createRepository, profileIdForTest = () => uid("profile")) {
  test(`[${name}] persistChatImportBatch: first write creates everything, rerun is fully idempotent`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const s1 = source(profileId);
    const s2 = source(profileId);
    const a1 = asset(profileId);
    const items = [
      { source: s1, media: [], assets: [a1], locations: [location(a1.id, "wechat", uid("ref"))] },
      { source: s2, media: [], assets: [], locations: [] },
    ];
    const first = await repo.persistChatImportBatch(items);
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].sourceCreated, true);
    assert.equal(first.items[1].sourceCreated, true);
    assert.equal(first.items[0].createdAssetIds.length, 1);

    const rerun = await repo.persistChatImportBatch(items);
    assert.ok(rerun.items.every((r) => r.sourceCreated === false), "rerunning the identical batch must find every source already there");
    assert.equal(rerun.items[0].createdAssetIds.length, 0);
    assert.equal(rerun.items[0].reusedAssetIds.length, 1);
  });

  test(`[${name}] persistChatImportBatch: a canonical identity repeated within the SAME batch resolves to one row, attributed as created only once`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const sharedAsset = asset(profileId);
    const s1 = source(profileId);
    const s2 = source(profileId);
    const items = [
      { source: s1, media: [], assets: [sharedAsset], locations: [location(sharedAsset.id, "wechat", uid("ref-a"))] },
      { source: s2, media: [], assets: [sharedAsset], locations: [location(sharedAsset.id, "wechat", uid("ref-b"))] },
    ];
    const result = await repo.persistChatImportBatch(items);
    const createdCount = result.items.reduce((n, r) => n + r.createdAssetIds.length, 0);
    const reusedCount = result.items.reduce((n, r) => n + r.reusedAssetIds.length, 0);
    assert.equal(createdCount, 1, "the shared asset must be created exactly once across the whole batch");
    assert.equal(reusedCount, 1, "the second item referencing it must see it as reused, not created again");
    if ("getStore" in repo) {
      const store = await repo.getStore();
      assert.equal(store.mediaAssets.filter((a) => a.id === sharedAsset.id).length, 1);
      assert.equal(store.mediaLocations.filter((l) => l.mediaAssetId === sharedAsset.id).length, 2, "both messages' own locations must persist even though the asset is shared");
    }
  });

  test(`[${name}] persistChatImportBatch: one item's identity conflict fails the whole batch atomically, never a silent partial write`, async () => {
    const repo = createRepository();
    const profileId = profileIdForTest();
    const good1 = source(profileId);
    const good2 = source(profileId);
    const conflictingAsset = asset(profileId);
    await repo.persistChatImportBatch([{ source: source(profileId), media: [], assets: [conflictingAsset], locations: [] }]);
    const clashingAsset = { ...conflictingAsset, checksum: `sha256:${"b".repeat(64)}` };
    await assert.rejects(() => repo.persistChatImportBatch([
      { source: good1, media: [], assets: [], locations: [] },
      { source: good2, media: [], assets: [clashingAsset], locations: [] },
    ]));
    if ("getStore" in repo) {
      const store = await repo.getStore();
      assert.equal(store.rawSources.some((s) => s.id === good1.id), false, "good1 must not have been partially committed when good2's item later conflicted");
      assert.equal(store.rawSources.some((s) => s.id === good2.id), false);
    }
  });
}

for (const [name, createRepository] of adapters) { addTaskTests(name, createRepository); addBatchTests(name, createRepository); }

if (CONTRACT_DATABASE_URL) {
  const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
  const { closePool } = await import("../lib/db/client.ts");
  const { Client } = await import("pg");
  const profileId = uid("profile-chat-contract");
  const client = new Client({ connectionString: CONTRACT_DATABASE_URL });
  await client.connect();
  await client.query("insert into profiles (id, display_name, birth_date, timezone, visibility) values ($1, 'Synthetic Contract', '2020-01-01', 'UTC', 'private')", [profileId]);
  await client.end();
  addTaskTests("postgres", () => createPostgresRepository(), () => profileId);
  addBatchTests("postgres", () => createPostgresRepository(), () => profileId);

  test("[postgres] concurrent persistChatImportBatch calls sharing a canonical identity converge to one row, never a duplicate", async () => {
    const repo1 = createPostgresRepository();
    const repo2 = createPostgresRepository();
    const sharedAsset = asset(profileId);
    const s1 = source(profileId);
    const s2 = source(profileId);
    const items1 = [{ source: s1, media: [], assets: [sharedAsset], locations: [location(sharedAsset.id, "wechat", uid("ref-concurrent-a"))] }];
    const items2 = [{ source: s2, media: [], assets: [sharedAsset], locations: [location(sharedAsset.id, "wechat", uid("ref-concurrent-b"))] }];
    const [result1, result2] = await Promise.all([repo1.persistChatImportBatch(items1), repo2.persistChatImportBatch(items2)]);
    const createdCount = result1.items[0].createdAssetIds.length + result2.items[0].createdAssetIds.length;
    const reusedCount = result1.items[0].reusedAssetIds.length + result2.items[0].reusedAssetIds.length;
    assert.equal(createdCount, 1, "exactly one of the two concurrent batches must win the create");
    assert.equal(reusedCount, 1, "the other must resolve to reused, via the real unique constraint, not a race");
    const client = new Client({ connectionString: CONTRACT_DATABASE_URL });
    await client.connect();
    const rows = await client.query("select count(*)::int n from media_assets where id = $1", [sharedAsset.id]);
    assert.equal(rows.rows[0].n, 1);
    const locs = await client.query("select count(*)::int n from media_locations where media_asset_id = $1", [sharedAsset.id]);
    assert.equal(locs.rows[0].n, 2, "both concurrent batches' own locations must still persist even though they share one asset");
    await client.end();
  });
  test.after(async () => {
    const cleanup = new Client({ connectionString: CONTRACT_DATABASE_URL });
    await cleanup.connect();
    await cleanup.query("delete from media_locations where media_asset_id in (select id from media_assets where profile_id = $1)", [profileId]);
    for (const table of ["media", "media_assets", "raw_sources", "chat_import_tasks"]) await cleanup.query(`delete from ${table} where profile_id = $1`, [profileId]);
    await cleanup.query("delete from profiles where id = $1", [profileId]);
    await cleanup.end();
    await closePool();
  });
} else {
  test("[postgres] chat import contract suite", { skip: SKIP_REASON }, () => {});
}
