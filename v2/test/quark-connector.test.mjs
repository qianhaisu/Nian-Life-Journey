import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getStore } from "../lib/db/repository.ts";
import { ingestQuarkFile, QuarkAdapterError } from "../lib/ingest/quark.ts";
import { syncQuarkScope } from "../tools/quark-connector/index.ts";
import { QuarkCliAdapter } from "../tools/quark-connector/cli-adapter.ts";
import { FakeQuarkClient, quarkFile } from "../tools/quark-connector/fake-client.ts";

const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }

test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

test("CLI adapter maps official NDJSON and never invokes login or accepts token arguments", async () => {
  const calls = [];
  const adapter = new QuarkCliAdapter({
    sessionInput: "test query",
    sessionId: "1234567890-abcdef",
    runner: async (command, args) => {
      calls.push({ command, args });
      return { exitCode: 0, stderr: "", stdout: JSON.stringify({ code: 0, msg: "成功", action: "search", type: "result", data: { file_list: [{ fid: "fid-photo", filename: "family.jpg", category: 3, size: 128, updated_at: 1787911200000, path: "夸克网盘/家庭/family.jpg" }] } }) };
    },
  });
  const result = await adapter.list({ query: "张年照片" });
  assert.deepEqual(result.files[0], {
    providerRef: "fid-photo",
    path: "夸克网盘/家庭/family.jpg",
    filename: "family.jpg",
    mimeType: "image/jpeg",
    mediaType: "photo",
    size: 128,
    takenAt: "2026-08-28T10:00:00.000Z",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "search");
  assert.equal(calls[0].args.includes("--token"), false);
  assert.equal(calls[0].args.includes("--session-input"), true);
  assert.equal(calls[0].args.includes("--session-id"), true);
});

test("CLI adapter consumes the full search artifact without deleting the official artifact", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "nian-quark-artifact-"));
  const artifactPath = path.join(artifactRoot, "search.jsonl");
  await writeFile(artifactPath, [
    JSON.stringify({ fid: "fid-one", filename: "one.jpg", category: 3, size: 1 }),
    JSON.stringify({ fid: "fid-two", filename: "two.jpg", category: 3, size: 2 }),
  ].join("\n"));
  const adapter = new QuarkCliAdapter({
    artifactRoot,
    runner: async () => ({ exitCode: 0, stderr: "", stdout: [
      JSON.stringify({ code: 0, msg: "成功", action: "search", type: "result", data: { file_list: [{ fid: "fid-one", filename: "one.jpg", category: 3, size: 1 }] } }),
      JSON.stringify({ code: 0, msg: "", action: "search", type: "artifact", data: { file_path: artifactPath, count: 2, format: "jsonl" } }),
    ].join("\n") }),
  });
  try {
    const result = await adapter.list({ query: "家庭照片" });
    assert.deepEqual(result.files.map((file) => file.providerRef), ["fid-one", "fid-two"]);
    assert.equal((await readFile(artifactPath, "utf8")).split(/\r?\n/).length, 2);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("CLI adapter preserves official -104 as an unsupported-agent auth status", async () => {
  const calls = [];
  const adapter = new QuarkCliAdapter({
    runner: async (command, args) => {
      calls.push({ command, args });
      return { exitCode: 1, stderr: "", stdout: JSON.stringify({ code: -104, msg: "无法识别当前 Agent 环境，禁止继续使用", action: "get-user-info", type: "result", data: {} }) };
    },
  });
  const status = await adapter.checkAuth();
  assert.equal(status.status, "unsupported");
  assert.equal(status.code, "QUARK_AGENT_UNSUPPORTED");
  assert.equal(status.officialCode, -104);
  assert.equal(status.officialMessage, "无法识别当前 Agent 环境，禁止继续使用");
  assert.deepEqual(calls.map((call) => call.command), ["get-user-info"]);
  assert.equal(calls[0].args.includes("--token"), false);
});

test("CLI adapter accepts only a runtime file path and removes the read artifact", async () => {
  const readRoot = await mkdtemp(path.join(os.tmpdir(), "nian-quark-read-"));
  const targetPath = path.join(readRoot, "family.mp4");
  const bytes = Buffer.from("video-bytes");
  await writeFile(targetPath, bytes);
  const adapter = new QuarkCliAdapter({
    readRoot,
    runner: async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({ code: 0, msg: "成功", action: "read-file", type: "result", data: { totalCount: 1, successCount: 1, failCount: 0, files: [{ fid: "fid-video", fileName: "family.mp4", filePath: targetPath, fileSize: bytes.byteLength, success: true }] } }),
    }),
  });
  try {
    assert.deepEqual(Buffer.from(await adapter.download("fid-video")), bytes);
    await assert.rejects(() => readFile(targetPath));
    await assert.rejects(() => adapter.download("../outside"), (error) => {
      assert.ok(error instanceof QuarkAdapterError);
      assert.equal(error.code, "QUARK_METADATA_INVALID");
      return true;
    });
    const outsidePath = path.join(readRoot, "..", "outside.mp4");
    await assert.rejects(() => new QuarkCliAdapter({
      readRoot,
      runner: async () => ({ exitCode: 0, stderr: "", stdout: JSON.stringify({ code: 0, msg: "成功", action: "read-file", type: "result", data: { totalCount: 1, successCount: 1, failCount: 0, files: [{ fid: "fid-video", fileName: "outside.mp4", filePath: outsidePath, fileSize: bytes.byteLength, success: true }] } }) }),
    }).download("fid-video"), (error) => {
      assert.ok(error instanceof QuarkAdapterError);
      assert.equal(error.code, "QUARK_INVALID_OUTPUT");
      return true;
    });
  } finally {
    await rm(readRoot, { recursive: true, force: true });
  }
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