import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getStore } from "../lib/db/repository.ts";
import { POST as ingestPost } from "../app/api/internal/ingest/route.ts";
import { QuarkAdapterError } from "../lib/ingest/quark.ts";
import { QUARK_ARTIFACT_MAX_ITEMS, mapArtifactItemToMediaInput, processQuarkArtifactLines, validateQuarkArtifactItem } from "../lib/ingest/quark-artifact.ts";
import { ingestQuarkArtifactAsset } from "../lib/ingest/quark-artifact-asset.ts";
import { parseQuarkNdjson } from "../tools/quark-connector/cli-adapter.ts";
import { readQuarkArtifactLines } from "../lib/ingest/quark-artifact.ts";

const execFileAsync = promisify(execFile);
const repoRoot = path.join(process.cwd());
const dataFile = path.join(repoRoot, ".data", "nian-life.json");
const cliScript = path.join(repoRoot, "tools", "quark-connector", "ingest-artifact.ts");

let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
});

function photoItem(overrides = {}) {
  return { fid: "fid-photo", parent_fid: "fid-parent", category: 3, filename: "family.jpg", size: 1024, file_type: "image", format_type: "image/jpeg", obj_category: "图片", created_at: 1787911200, updated_at: 1787911200, file: true, path: "夸克网盘/家庭/family.jpg", ...overrides };
}

async function runCli(args, env = {}) {
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, ...args], { cwd: repoRoot, env: { ...process.env, ...env } });
    return { ...result, exitCode: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? 1 };
  }
}

test("processQuarkArtifactLines parses valid JSONL, converts ms timestamps, and keeps file_type/category 1|3 only", () => {
  const lines = [
    JSON.stringify(photoItem()),
    JSON.stringify({ ...photoItem({ fid: "fid-video" }), category: 1, filename: "clip.mp4", format_type: "video/mp4", created_at: 1787911200000, updated_at: 1787911260000 }),
  ];
  const result = processQuarkArtifactLines(lines);
  assert.equal(result.total, 2);
  assert.equal(result.imported.length, 2);
  const photo = result.imported.find((item) => item.providerRef === "fid-photo");
  const video = result.imported.find((item) => item.providerRef === "fid-video");
  assert.equal(photo.mediaType, "photo");
  assert.equal(photo.sourceCreatedAt, "2026-08-28T10:00:00.000Z");
  assert.equal(video.mediaType, "video");
  assert.equal(video.sourceCreatedAt, "2026-08-28T10:00:00.000Z");
  assert.equal(video.sourceUpdatedAt, "2026-08-28T10:01:00.000Z");
  const validated = validateQuarkArtifactItem(photoItem(), 1);
  assert.equal(typeof validated.file_type, "string");
});

test("processQuarkArtifactLines skips folders, other categories, invalid rows, and de-duplicates repeated fid", () => {
  const lines = [
    JSON.stringify(photoItem()),
    JSON.stringify(photoItem()), // duplicate fid
    JSON.stringify({ ...photoItem({ fid: "fid-folder" }), category: 0, file: false }),
    JSON.stringify({ ...photoItem({ fid: "fid-doc" }), category: 4 }),
    "{not valid json",
    JSON.stringify({ filename: "missing-fid.jpg", category: 3, file: true, format_type: "image/jpeg" }),
  ];
  const result = processQuarkArtifactLines(lines);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].providerRef, "fid-photo");
  assert.equal(result.skipped.some((entry) => entry.reason === "duplicate_in_artifact"), true);
  assert.equal(result.skipped.some((entry) => entry.reason === "not_file"), true);
  assert.equal(result.skipped.some((entry) => entry.reason === "unsupported_category"), true);
  assert.equal(result.invalid.length, 2);
});

test("processQuarkArtifactLines rejects artifacts larger than the 3000 item cap", () => {
  const lines = Array.from({ length: QUARK_ARTIFACT_MAX_ITEMS + 1 }, (_, index) => JSON.stringify(photoItem({ fid: `fid-${index}` })));
  assert.throws(() => processQuarkArtifactLines(lines), (error) => {
    assert.ok(error instanceof QuarkAdapterError);
    assert.equal(error.code, "QUARK_ARTIFACT_TOO_LARGE");
    return true;
  });
});

test("mapArtifactItemToMediaInput never carries big_thumbnail/check_link and leaves checksum/capturedAt absent", async () => {
  const item = validateQuarkArtifactItem(photoItem({ big_thumbnail: "https://transient.example/thumb.jpg", check_link: "https://transient.example/check" }), 1);
  const mapped = mapArtifactItemToMediaInput(item);
  assert.equal("big_thumbnail" in mapped, false);
  assert.equal("check_link" in mapped, false);
  assert.equal(JSON.stringify(mapped).includes("transient.example"), false);

  const { assetId, locationId } = await ingestQuarkArtifactAsset(mapped, { profileId: "profile-quark-artifact-test" });
  const store = await getStore();
  const asset = store.mediaAssets.find((entry) => entry.id === assetId);
  const location = store.mediaLocations.find((entry) => entry.id === locationId);
  assert.equal(asset.checksum, null);
  assert.equal(asset.takenAt, null);
  assert.equal(location.providerRef, "fid-photo");
  assert.equal(JSON.stringify(location).includes("transient.example"), false);
});

test("ingestQuarkArtifactAsset is idempotent by provider+providerRef and updates instead of duplicating", async () => {
  const item = mapArtifactItemToMediaInput(validateQuarkArtifactItem(photoItem({ fid: "fid-idempotent" }), 1));
  const first = await ingestQuarkArtifactAsset(item, { profileId: "profile-quark-artifact-test" });
  const second = await ingestQuarkArtifactAsset({ ...item, filename: "renamed.jpg" }, { profileId: "profile-quark-artifact-test" });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.assetId, second.assetId);
  const store = await getStore();
  assert.equal(store.mediaLocations.filter((entry) => entry.provider === "quark" && entry.providerRef === "fid-idempotent").length, 1);
  assert.equal(store.mediaAssets.find((entry) => entry.id === first.assetId).originalFilename, "renamed.jpg");
});

test("WorkBuddy stdout preview is limited to 5 rows while artifact processing uses all 10 rows", async () => {
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "nian-quark-artifact-precedence-"));
  const artifactPath = path.join(artifactRoot, "search.jsonl");
  const artifactItems = Array.from({ length: 10 }, (_, index) => photoItem({ fid: `fid-full-${index}` }));
  await writeFile(artifactPath, artifactItems.map((item) => JSON.stringify(item)).join("\n"));
  const previewItems = artifactItems.slice(0, 5);
  try {
    const stdout = [
      JSON.stringify({ code: 0, msg: "成功", action: "search", type: "result", data: { file_list: previewItems, total: 10 } }),
      JSON.stringify({ code: 0, msg: "", action: "search", type: "artifact", data: { file_path: artifactPath, count: 10, format: "jsonl" } }),
    ].join("\n");
    const records = parseQuarkNdjson(stdout);
    assert.equal(records.find((record) => record.type === "result").data.file_list.length, 5);
    assert.equal(records.find((record) => record.type === "artifact").data.file_path, artifactPath);
    assert.equal((await readQuarkArtifactLines(artifactPath)).filter(Boolean).length, 10);
    assert.equal(processQuarkArtifactLines(await readQuarkArtifactLines(artifactPath)).imported.length, 10);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("ingest-artifact CLI rejects an unsafe artifact path (non-.jsonl, missing file, path traversal, symlink)", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "nian-quark-cli-safety-"));
  try {
    const notJsonl = path.join(workDir, "search.txt");
    await writeFile(notJsonl, JSON.stringify(photoItem()));
    const wrongExt = await runCli(["--artifact", notJsonl, "--keyword", "张年照片"]);
    assert.notEqual(wrongExt.exitCode, 0);

    const missing = await runCli(["--artifact", path.join(workDir, "missing.jsonl"), "--keyword", "张年照片"]);
    assert.notEqual(missing.exitCode, 0);

    const traversal = await runCli(["--artifact", path.join(workDir, "..", "outside.jsonl"), "--keyword", "张年照片"]);
    assert.notEqual(traversal.exitCode, 0);

    const relative = await runCli(["--artifact", "search.jsonl", "--keyword", "张年照片"]);
    assert.notEqual(relative.exitCode, 0);

    const realTarget = path.join(workDir, "real.jsonl");
    await writeFile(realTarget, JSON.stringify(photoItem()));
    const symlinkPath = path.join(workDir, "link.jsonl");
    try {
      await symlink(realTarget, symlinkPath, "file");
    } catch {
      return; // symlink creation is unavailable in this sandbox (e.g. Windows without developer mode)
    }
    const symlinked = await runCli(["--artifact", symlinkPath, "--keyword", "张年照片"]);
    assert.notEqual(symlinked.exitCode, 0);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("ingest-artifact CLI dry-run performs zero writes", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "nian-quark-cli-dryrun-"));
  const artifactPath = path.join(workDir, "search.jsonl");
  await writeFile(artifactPath, JSON.stringify(photoItem({ fid: "fid-dry-run-only" })));
  try {
    const before = await getStore();
    const result = await runCli(["--artifact", artifactPath, "--keyword", "张年照片", "--dry-run"]);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("\"wouldImport\":1"));
    const after = await getStore();
    assert.equal(after.mediaAssets.length, before.mediaAssets.length);
    assert.equal(after.mediaLocations.length, before.mediaLocations.length);
    assert.equal(after.connectorStates.length, before.connectorStates.length);
    assert.equal(result.stdout.includes("INGESTION_TOKEN"), false);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
});

test("ingest-artifact CLI finalizes an artifact with no import candidates", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "nian-quark-cli-empty-"));
  const artifactPath = path.join(workDir, "search.jsonl");
  await writeFile(artifactPath, JSON.stringify(photoItem({ fid: "fid-folder-only", category: 0, file: false })));
  const receivedBatches = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      receivedBatches.push(JSON.parse(body));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ imported: 0, updated: 0, failed: 0, results: [] }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await runCli(
      ["--artifact", artifactPath, "--keyword", "张年照片", "--commit", "--profile-id", "profile-quark-cli-empty-test"],
      { NIANLIFE_INGESTION_URL: `http://127.0.0.1:${port}/ingest`, INGESTION_TOKEN: "test-empty-ingestion-token" },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(receivedBatches.length, 1);
    assert.deepEqual(receivedBatches[0].items, []);
    assert.equal(receivedBatches[0].artifactItemCount, 1);
    assert.equal(receivedBatches[0].batchIndex, 0);
    assert.equal(receivedBatches[0].batchCount, 1);
    assert.equal(receivedBatches[0].invalidCount, 0);
    assert.match(result.stdout, /"imported":0/);
    assert.match(result.stdout, /"failed":0/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(workDir, { recursive: true, force: true });
  }
});

test("ingestion route persists connector state for an empty artifact batch", async () => {
  const previousToken = process.env.INGESTION_TOKEN;
  process.env.INGESTION_TOKEN = "route-empty-batch-token";
  try {
    const response = await ingestPost(new Request("http://localhost/api/internal/ingest", {
      method: "POST",
      headers: { authorization: "Bearer route-empty-batch-token", "content-type": "application/json" },
      body: JSON.stringify({ profileId: "profile-quark-route-empty-test", keyword: "张年照片", artifactItemCount: 1, batchIndex: 0, batchCount: 1, invalidCount: 0, items: [] }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { imported: 0, updated: 0, failed: 0, results: [] });
    const state = (await getStore()).connectorStates.find((entry) => entry.profileId === "profile-quark-route-empty-test");
    assert.equal(state?.status, "connected");
    assert.equal(state?.artifactItemCount, 1);
    assert.equal(state?.importedCount, 0);
    assert.equal(state?.failedCount, 0);
    assert.equal(state?.lastKeyword, "张年照片");
  } finally {
    if (previousToken === undefined) delete process.env.INGESTION_TOKEN;
    else process.env.INGESTION_TOKEN = previousToken;
  }
});

test("ingest-artifact CLI --commit batches submissions and returns a non-zero exit code on partial network failure", async () => {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "nian-quark-cli-commit-"));
  const artifactPath = path.join(workDir, "search.jsonl");
  await writeFile(artifactPath, [photoItem({ fid: "fid-batch-1" }), photoItem({ fid: "fid-batch-2" })].map((item) => JSON.stringify(item)).join("\n"));
  const receivedAuthHeaders = [];
  const receivedBatches = [];
  let callCount = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      receivedAuthHeaders.push(request.headers.authorization);
      callCount += 1;
      receivedBatches.push(JSON.parse(body));
      if (callCount === 1) {
        const items = JSON.parse(body).items;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ imported: items.length, updated: 0, failed: 0, results: items.map((item) => ({ providerRef: item.providerRef, status: "imported" })) }));
      } else {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ imported: 0, updated: 0, failed: 0, results: [] }));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const secretToken = "test-ingestion-token-should-not-leak";
    const result = await runCli(
      ["--artifact", artifactPath, "--keyword", "张年照片", "--commit", "--batch-size", "1", "--profile-id", "profile-quark-cli-commit-test"],
      { NIANLIFE_INGESTION_URL: `http://127.0.0.1:${port}/ingest`, INGESTION_TOKEN: secretToken },
    );
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout.includes(secretToken), false);
    assert.equal(result.stderr.includes(secretToken), false);
    assert.equal(receivedAuthHeaders.length, 2);
    assert.equal(receivedAuthHeaders[0], `Bearer ${secretToken}`);
    assert.equal(receivedBatches[0].keyword, "张年照片");
    assert.equal(receivedBatches[0].artifactItemCount, 2);
    assert.equal(receivedBatches[0].batchIndex, 0);
    assert.equal(receivedBatches[0].batchCount, 2);
    assert.equal(receivedBatches[1].batchIndex, 1);
    assert.equal(receivedBatches[1].batchCount, 2);
    assert.match(result.stdout, /"lastErrorCode":"HTTP_500"/);
    assert.match(result.stdout, /"failed":1/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(workDir, { recursive: true, force: true });
  }
});
