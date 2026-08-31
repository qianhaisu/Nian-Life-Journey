import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getStore } from "../lib/db/repository.ts";
import { ingestQuarkFile, QuarkAdapterError } from "../lib/ingest/quark.ts";
import { syncQuarkScope } from "../tools/quark-connector/index.ts";
import { QuarkCliAdapter, mapQuarkSearchItem, parseQuarkNdjson } from "../tools/quark-connector/cli-adapter.ts";
import { FakeQuarkClient, quarkFile } from "../tools/quark-connector/fake-client.ts";

const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }

test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

test("connector keeps pure NDJSON mapping but never executes the official CLI", async () => {
  const records = parseQuarkNdjson(JSON.stringify({ code: 0, msg: "成功", action: "search", type: "result", data: { file_list: [{ fid: "fid-photo", filename: "family.jpg", category: 3, size: 128, updated_at: 1787911200000, path: "夸克网盘/家庭/family.jpg" }] } }));
  assert.equal(records[0].type, "result");
  assert.deepEqual(mapQuarkSearchItem(records[0].data.file_list[0]), {
    providerRef: "fid-photo",
    path: "夸克网盘/家庭/family.jpg",
    filename: "family.jpg",
    mimeType: "image/jpeg",
    mediaType: "photo",
    size: 128,
  });
  const adapter = new QuarkCliAdapter();
  const status = await adapter.checkAuth();
  assert.equal(status.status, "unsupported");
  assert.equal(status.code, "QUARK_CAPABILITY_UNSUPPORTED");
  await assert.rejects(() => adapter.list({ query: "张年照片" }), (error) => {
    assert.ok(error instanceof QuarkAdapterError);
    assert.equal(error.code, "QUARK_CAPABILITY_UNSUPPORTED");
    return true;
  });
  await assert.rejects(() => adapter.download("fid-photo"), (error) => {
    assert.ok(error instanceof QuarkAdapterError);
    assert.equal(error.code, "QUARK_CAPABILITY_UNSUPPORTED");
    return true;
  });
});

test("sync paginates fake pages, retries transient list errors, and preserves providerRef idempotency", async () => {
  const videoBytes = Buffer.from("video-bytes");
  const documentBytes = Buffer.from("document-bytes");
  const video = quarkFile({ providerRef: "fid-video-page", filename: "day.mp4", mimeType: "video/mp4", size: videoBytes.byteLength, takenAt: "2026-08-28T10:00:00.000Z" });
  const document = quarkFile({ providerRef: "fid-document-page", filename: "note.pdf", mimeType: "application/pdf", size: documentBytes.byteLength, takenAt: "2026-08-29T10:00:00.000Z" });
  const client = new FakeQuarkClient({ pages: [{ files: [video], cursor: "page-2" }, { files: [document] }], files: { [video.providerRef]: videoBytes, [document.providerRef]: documentBytes }, listFailures: 1 });
  const options = { profileId: "profile-quark-pagination-test", contributorId: "contributor-dad", visibility: "family", maxRetries: 1 };
  const result = await syncQuarkScope(client, { query: "张年家庭媒体" }, options);
  assert.equal(result.files.length, 2);
  assert.equal(result.imported.length, 2);
  assert.equal(result.cursor, undefined);
  assert.equal(client.listScopes.length, 3);
  const state = (await getStore()).connectorStates.find((item) => item.profileId === options.profileId);
  assert.equal(state?.status, "connected");
  assert.equal(state?.cursor, undefined);
  const duplicate = await ingestQuarkFile(video, options, client);
  assert.equal(duplicate.duplicate, true);
  const store = await getStore();
  assert.equal(store.mediaLocations.filter((item) => item.provider === "quark" && item.providerRef === video.providerRef).length, 1);
});

test("unsupported authorization stops import before media writes", async () => {
  const before = await getStore();
  const client = new FakeQuarkClient({ auth: { status: "unsupported", code: "QUARK_AGENT_UNSUPPORTED", officialCode: -104, officialMessage: "无法识别当前 Agent 环境，禁止继续使用", message: "无法识别当前 Agent 环境，禁止继续使用" }, pages: [{ files: [quarkFile({ providerRef: "fid-never-imported" })] }] });
  await assert.rejects(() => syncQuarkScope(client, { query: "张年照片" }, { profileId: "profile-quark-auth-test", contributorId: "contributor-dad", visibility: "family" }), (error) => {
    assert.ok(error instanceof QuarkAdapterError);
    assert.equal(error.code, "QUARK_AGENT_UNSUPPORTED");
    assert.equal(error.officialCode, -104);
    assert.equal(error.officialMessage, "无法识别当前 Agent 环境，禁止继续使用");
    return true;
  });
  const after = await getStore();
  assert.equal(after.rawSources.length, before.rawSources.length);
  assert.equal(after.mediaAssets.length, before.mediaAssets.length);
  assert.equal(after.mediaLocations.length, before.mediaLocations.length);
  assert.equal(after.connectorStates.find((item) => item.profileId === "profile-quark-auth-test")?.status, "auth_required");
});

test("CLI adapter reports folder and cursor requests as QUARK_CAPABILITY_UNSUPPORTED, never fake pagination", async () => {
  const adapter = new QuarkCliAdapter({ runner: async () => { throw new Error("CLI must not be invoked for unsupported capabilities"); } });
  await assert.rejects(() => adapter.list({ folder: "夸克网盘/家庭" }), (error) => {
    assert.ok(error instanceof QuarkAdapterError);
    assert.equal(error.code, "QUARK_CAPABILITY_UNSUPPORTED");
    return true;
  });
  await assert.rejects(() => adapter.list({ query: "张年照片", cursor: "next-page" }), (error) => {
    assert.ok(error instanceof QuarkAdapterError);
    assert.equal(error.code, "QUARK_CAPABILITY_UNSUPPORTED");
    return true;
  });
});