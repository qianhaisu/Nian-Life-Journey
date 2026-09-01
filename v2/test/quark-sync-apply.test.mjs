import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyQuarkPhotoArtifact } from "../scripts/quark-photo-apply.mjs";

function sha256Of(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function taskItem(overrides = {}) {
  return {
    kind: "photo",
    download_status: "success",
    checksum_duplicate: false,
    date_label: "in_window",
    capture_time: { text: "2026-08-28 17:40:27", reliable: true },
    format_type: "image/jpeg",
    ext: ".jpg",
    filename: "微信图片_20260828174027_6453_721.jpg",
    size: 1024,
    local_path: "unused.jpg",
    sha256: sha256Of(Buffer.from("default")),
    ...overrides,
  };
}

async function buildArtifact(items) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quark-apply-"));
  const artifactsDir = path.join(dir, "artifacts");
  await mkdir(artifactsDir, { recursive: true });
  const lines = items.map((item) => JSON.stringify(item)).join("\n") + "\n";
  await writeFile(path.join(artifactsDir, "task-items.jsonl"), lines);
  return dir;
}

function fakeDeps(overrides = {}) {
  const calls = { appendUpload: [], put: [], enqueue: [] };
  const repo = {
    async findMediaAssetByChecksum(checksum) {
      return (overrides.checksums ?? {})[checksum] ?? null;
    },
    async appendUpload(input) {
      calls.appendUpload.push(input);
      return input.source;
    },
    async enqueueOrganizerJob(input) {
      calls.enqueue.push(input);
      return { id: "job-1", status: "pending", ...input };
    },
  };
  const hotStorage = {
    async put(input) {
      calls.put.push(input);
      return { providerRef: input.key };
    },
  };
  const processing = {
    async sourceImageMetadata() { return { width: 100, height: 100 }; },
    async createDerivatives() { return []; },
  };
  const paths = {
    mediaDeliveryUrl: (mediaId, variant) => `/api/media/${mediaId}?variant=${variant}`,
  };
  const worker = {
    async runOrganizerWorker() { return []; },
  };
  return { deps: { repo, hotStorage, processing, paths, worker }, calls, repo, hotStorage, processing, worker };
}

test("dry-run reports new=0 when every candidate is already ingested or permanently skipped", async () => {
  const ingestedA = sha256Of(Buffer.from("photo-a"));
  const ingestedB = sha256Of(Buffer.from("photo-b"));
  const skipC = sha256Of(Buffer.from("corrupted-heic"));

  const dir = await buildArtifact([
    taskItem({ filename: "a.jpg", sha256: ingestedA, capture_time: { text: "2026-08-27 10:00:00", reliable: true } }),
    taskItem({ filename: "b.jpg", sha256: ingestedB, capture_time: { text: "2026-08-28 11:00:00", reliable: true } }),
    taskItem({ filename: "c.heic", sha256: skipC, ext: ".heic", format_type: "image/heic" }),
  ]);

  const { deps } = fakeDeps({
    checksums: {
      [ingestedA]: { id: "asset-a", rawSourceId: "source-a" },
      [ingestedB]: { id: "asset-b", rawSourceId: "source-b" },
    },
  });

  const permanentSkip = new Map([[skipC, { filename: "c.heic", skip_reason: "source_corrupted_or_incomplete", size: 1024 }]]);

  const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "dry-run", permanentSkip, deps });

  assert.equal(result.summary.eligible, 3);
  assert.equal(result.summary.newCount, 0);
  assert.equal(result.summary.reusedCount, 2);
  assert.equal(result.summary.skippedCount, 1);
  assert.equal(result.summary.failedCount, 0);
  assert.deepEqual(result.dates.map((d) => d.wouldEnqueue), [true, true]);

  await rm(dir, { recursive: true, force: true });
});

test("dry-run reports new=1 for a synthetic new JPEG", async () => {
  const newSha = sha256Of(Buffer.from("brand-new-jpeg"));
  const dir = await buildArtifact([taskItem({ filename: "new.jpg", sha256: newSha })]);
  const { deps } = fakeDeps({ checksums: {} });

  const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "dry-run", permanentSkip: new Map(), deps });

  assert.equal(result.summary.newCount, 1);
  assert.equal(result.summary.reusedCount, 0);
  assert.equal(result.created[0].status, "would_create");
  assert.equal(result.created[0].sha256, newSha);

  await rm(dir, { recursive: true, force: true });
});

test("apply mode writes storage and DB for a new JPEG and is idempotent on rerun", async () => {
  const bytes = Buffer.from("real-jpeg-bytes-for-apply");
  const newSha = sha256Of(bytes);
  const dir = await mkdtemp(path.join(os.tmpdir(), "quark-apply-write-"));
  const artifactsDir = path.join(dir, "artifacts");
  const originalsDir = path.join(dir, "originals");
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(originalsDir, { recursive: true });
  const filename = "new.jpg";
  const localPath = path.join(originalsDir, filename);
  await writeFile(localPath, bytes);
  await writeFile(path.join(artifactsDir, "task-items.jsonl"), JSON.stringify(taskItem({ filename, sha256: newSha, size: bytes.byteLength, local_path: localPath })) + "\n");

  const { deps, calls } = fakeDeps({ checksums: {} });

  const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip: new Map(), deps });

  assert.equal(result.summary.newCount, 1);
  assert.equal(result.created[0].status, "created");
  assert.equal(calls.appendUpload.length, 1);
  assert.ok(calls.put.some((p) => p.key.startsWith("media/originals/")));
  assert.equal(calls.enqueue.length, 1);

  // Idempotent rerun: the checksum now resolves to an existing asset.
  const asset = calls.appendUpload[0].assets[0];
  const { deps: deps2, calls: calls2 } = fakeDeps({ checksums: { [newSha]: { id: asset.id, rawSourceId: asset.rawSourceId } } });
  const rerun = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip: new Map(), deps: deps2 });
  assert.equal(rerun.summary.newCount, 0);
  assert.equal(rerun.summary.reusedCount, 1);
  assert.equal(calls2.appendUpload.length, 0);

  await rm(dir, { recursive: true, force: true });
});

test("permanent skip is ignored when the recorded size changed (re-examine)", async () => {
  const changedSha = sha256Of(Buffer.from("changed-heic"));
  const dir = await buildArtifact([taskItem({ filename: "c.heic", sha256: changedSha, ext: ".heic", size: 9999 })]);
  const { deps } = fakeDeps({ checksums: {} });

  const permanentSkip = new Map([[changedSha, { filename: "c.heic", skip_reason: "source_corrupted_or_incomplete", size: 1024 }]]);

  const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "dry-run", permanentSkip, deps });

  assert.equal(result.summary.skippedCount, 0);
  assert.equal(result.summary.newCount, 1);

  await rm(dir, { recursive: true, force: true });
});

test("eligible filter excludes duplicates, failed downloads, out-of-window and unreliable times", async () => {
  const s1 = sha256Of(Buffer.from("k1"));
  const dir = await buildArtifact([
    taskItem({ filename: "ok.jpg", sha256: s1 }),
    taskItem({ filename: "dup.jpg", sha256: s1, checksum_duplicate: true }),
    taskItem({ filename: "failed.jpg", sha256: sha256Of(Buffer.from("k2")), download_status: "failed" }),
    taskItem({ filename: "out.jpg", sha256: sha256Of(Buffer.from("k3")), date_label: "out_window" }),
    taskItem({ filename: "unreliable.jpg", sha256: sha256Of(Buffer.from("k4")), capture_time: { text: "x", reliable: false } }),
  ]);
  const { deps } = fakeDeps({ checksums: { [s1]: { id: "asset-1", rawSourceId: "source-1" } } });

  const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "dry-run", permanentSkip: new Map(), deps });

  assert.equal(result.summary.total, 5);
  assert.equal(result.summary.eligible, 1);
  assert.equal(result.summary.reusedCount, 1);

  await rm(dir, { recursive: true, force: true });
});
