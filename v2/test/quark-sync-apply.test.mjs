import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyQuarkPhotoArtifact } from "../scripts/quark-photo-apply.mjs";
import { __setOssStorageForTests } from "../lib/storage/hot-storage.ts";

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
  const calls = { appendUpload: [], put: [], enqueue: [], workerRuns: 0 };
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
    async runOrganizerWorker() { calls.workerRuns += 1; return []; },
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
  assert.deepEqual(result.dates, []);

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

  const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip: new Map(), organize: true, requireGemini: false, deps });

  assert.equal(result.summary.newCount, 1);
  assert.equal(result.created[0].status, "created");
  assert.equal(calls.appendUpload.length, 1);
  assert.ok(calls.put.some((p) => p.key.startsWith("media/originals/")));
  assert.equal(calls.enqueue.length, 1);

  // Idempotent rerun: the checksum now resolves to an existing asset.
  const asset = calls.appendUpload[0].assets[0];
  const { deps: deps2, calls: calls2 } = fakeDeps({ checksums: { [newSha]: { id: asset.id, rawSourceId: asset.rawSourceId } } });
  const rerun = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip: new Map(), organize: true, requireGemini: false, deps: deps2 });
  assert.equal(rerun.summary.newCount, 0);
  assert.equal(rerun.summary.reusedCount, 1);
  assert.equal(calls2.appendUpload.length, 0);
  assert.equal(calls2.enqueue.length, 0);

  await rm(dir, { recursive: true, force: true });
});

// Phase 3B2: unlike wechat-worker.ts, THIS module's original is a permanent copy (status
// "archived" set once, no later Quark-archive step), so with MEDIA_STORAGE_PROVIDER=oss BOTH the
// original and its derivatives must follow activeMediaProvider(). This drives the real call chain
// (deps.hotStorage intentionally omitted, so applyQuarkPhotoArtifact resolves the real
// lib/storage/hot-storage.ts module) with process.env.MEDIA_STORAGE_PROVIDER genuinely set to
// "oss", substituting only the OSS singleton via __setOssStorageForTests so no network call
// happens — proving location.provider === "oss" for the original AND the derivatives, not just
// activeMediaProvider()'s return value.
test("with MEDIA_STORAGE_PROVIDER=oss really set, an apply writes both original and derivatives through OSS and tags every location \"oss\"", async () => {
  const bytes = Buffer.from("real-jpeg-bytes-for-oss-apply");
  const newSha = sha256Of(bytes);
  const dir = await mkdtemp(path.join(os.tmpdir(), "quark-apply-oss-"));
  const artifactsDir = path.join(dir, "artifacts");
  const originalsDir = path.join(dir, "originals");
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(originalsDir, { recursive: true });
  const filename = "oss-new.jpg";
  const localPath = path.join(originalsDir, filename);
  await writeFile(localPath, bytes);
  await writeFile(path.join(artifactsDir, "task-items.jsonl"), JSON.stringify(taskItem({ filename, sha256: newSha, size: bytes.byteLength, local_path: localPath })) + "\n");

  const previousEnv = process.env.MEDIA_STORAGE_PROVIDER;
  const puts = [];
  const fakeOss = {
    put: async (input) => { puts.push(input); return { providerRef: input.key }; },
    get: async () => null,
    getStream: async () => null,
    delete: async () => {},
    verify: async () => ({ exists: false, checksumVerified: false }),
    url: () => null,
  };
  __setOssStorageForTests(fakeOss);
  process.env.MEDIA_STORAGE_PROVIDER = "oss";
  try {
    const repo = { async findMediaAssetByChecksum() { return null; }, appended: [], async appendUpload(input) { this.appended.push(input); return input.source; }, async enqueueOrganizerJob() { return { id: "job-oss", status: "pending" }; } };
    const processing = { async sourceImageMetadata() { return { width: 100, height: 100 }; }, async createDerivatives() { return [{ variant: "web", body: Buffer.from("web-bytes"), mimeType: "image/webp", width: 50, height: 50 }]; } };
    const paths = { mediaDeliveryUrl: (mediaId, variant) => `/api/media/${mediaId}?variant=${variant}` };
    const deps = { repo, processing, paths };

    const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip: new Map(), organize: false, deps });

    assert.equal(result.summary.newCount, 1);
    assert.equal(puts.length, 2, "one original + one derivative, both through the fake OSS client");
    assert.ok(puts.every((p) => p.key.startsWith("media/originals/") || p.key.startsWith("media/derivatives/")));
    const locations = repo.appended[0].locations;
    assert.equal(locations.length, 2);
    assert.ok(locations.every((location) => location.provider === "oss"), "both the original and the derivative must be tagged \"oss\"");
    assert.equal(locations.find((l) => l.variant === "original")?.status, "archived");
  } finally {
    __setOssStorageForTests(undefined);
    if (previousEnv === undefined) delete process.env.MEDIA_STORAGE_PROVIDER;
    else process.env.MEDIA_STORAGE_PROVIDER = previousEnv;
    await rm(dir, { recursive: true, force: true });
  }
});

test("by default an apply ingests the photos and enqueues nothing, with no key present", async () => {
  // The whole point of the ingest-only default: a photograph reaches the archive with its
  // `family_photo` source identity — which is all `trusted` means in mediaPrivilegeOf, and the only
  // condition for it to enter a month's body — without one model call being made or one key being
  // required. 2,279 Quark files would otherwise enqueue hundreds of jobs against a judge whose
  // recall is near zero. Teddy, 2026-09-04.
  const newSha = sha256Of(Buffer.from("ingest-only-photo"));
  const bytes = Buffer.from("ingest-only-photo");
  const dir = await mkdtemp(path.join(os.tmpdir(), "quark-ingest-only-"));
  const artifactsDir = path.join(dir, "artifacts");
  const originalsDir = path.join(dir, "originals");
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(originalsDir, { recursive: true });
  const localPath = path.join(originalsDir, "new.jpg");
  await writeFile(localPath, bytes);
  await writeFile(path.join(artifactsDir, "task-items.jsonl"), JSON.stringify(taskItem({ filename: "new.jpg", sha256: newSha, size: bytes.byteLength, local_path: localPath })) + "\n");

  const { deps, calls } = fakeDeps({ checksums: {} });
  const savedGemini = process.env.GEMINI_API_KEY;
  const savedModel = process.env.AI_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_MODEL;
  try {
    const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip: new Map(), deps });
    assert.equal(result.summary.organize, false, "ingest-only is the default");
    assert.equal(result.summary.newCount, 1, "the photograph is ingested");
    assert.equal(calls.appendUpload.length, 1, "…and its bytes are persisted");
    assert.equal(calls.enqueue.length, 0, "…but no Organizer job is enqueued");
    assert.equal(calls.workerRuns, 0, "…and the worker never runs");
    assert.deepEqual(result.dates.map((d) => d.enqueued), [false], "the day is still reported, not silently dropped");
    assert.deepEqual(result.workerOutcomes, []);
  } finally {
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGemini;
    if (savedModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedModel;
  }

  await rm(dir, { recursive: true, force: true });
});

test("apply no-op succeeds without Gemini and enqueues nothing", async () => {
  const ingestedA = sha256Of(Buffer.from("photo-a"));
  const skipC = sha256Of(Buffer.from("corrupted-heic"));
  const dir = await buildArtifact([
    taskItem({ filename: "a.jpg", sha256: ingestedA, capture_time: { text: "2026-08-27 10:00:00", reliable: true } }),
    taskItem({ filename: "c.heic", sha256: skipC, ext: ".heic", format_type: "image/heic" }),
  ]);
  const { deps, calls } = fakeDeps({ checksums: { [ingestedA]: { id: "asset-a", rawSourceId: "source-a" } } });
  const permanentSkip = new Map([[skipC, { filename: "c.heic", skip_reason: "source_corrupted_or_incomplete", size: 1024 }]]);

  const savedGemini = process.env.GEMINI_API_KEY;
  const savedModel = process.env.AI_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.AI_MODEL;
  try {
    const result = await applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip, deps });
    assert.equal(result.summary.newCount, 0);
    assert.equal(result.summary.reusedCount, 1);
    assert.equal(result.summary.skippedCount, 1);
    assert.equal(calls.enqueue.length, 0);
    assert.equal(calls.appendUpload.length, 0);
    assert.equal(calls.put.length, 0);
  } finally {
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGemini;
    if (savedModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedModel;
  }

  await rm(dir, { recursive: true, force: true });
});

test("apply fails closed when a new photo needs organizing but Gemini is missing", async () => {
  const newSha = sha256Of(Buffer.from("brand-new-jpeg-needs-organizing"));
  const dir = await buildArtifact([taskItem({ filename: "new.jpg", sha256: newSha })]);
  const { deps } = fakeDeps({ checksums: {} });

  const savedGemini = process.env.GEMINI_API_KEY;
  const savedModel = process.env.AI_MODEL;
  delete process.env.GEMINI_API_KEY;
  process.env.AI_MODEL = "test-model";
  try {
    await assert.rejects(
      () => applyQuarkPhotoArtifact({ artifactDir: dir, mode: "apply", permanentSkip: new Map(), organize: true, deps }),
      /GEMINI_API_KEY is required/,
    );
  } finally {
    if (savedGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedGemini;
    if (savedModel === undefined) delete process.env.AI_MODEL; else process.env.AI_MODEL = savedModel;
  }

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
