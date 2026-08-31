import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { appendUpload, getStore, newId } from "../lib/db/repository.ts";
import { archivePendingOriginals } from "../lib/archive/quark-archive.ts";
import { ingestQuarkFile } from "../lib/ingest/quark.ts";
import { runOrganizerWorker } from "../lib/organizer/worker.ts";
import { createDerivatives } from "../lib/media/processing.ts";
import { LocalHotStorage, selectLocation } from "../lib/storage/hot-storage.ts";

const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
const touchedKeys = new Set();
const storage = new LocalHotStorage();

test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
  for (const key of touchedKeys) await storage.delete(key);
});

function sourceFor(sourceId, profileId, mediaId) {
  return { id: sourceId, profileId, sourceType: "family_photo", contentTypes: ["daily", "family"], contributorId: "contributor-dad", capturedAt: "2026-08-28T10:00:00.000Z", importedAt: new Date().toISOString(), mediaIds: [mediaId], sourceLabel: "test", visibility: "family", status: "uploaded" };
}

test("image derivatives are real WebP files, preserve EXIF orientation, and use distinct sizes", async () => {
  const original = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 132, g: 92, b: 58 } } }).withMetadata({ orientation: 6 }).jpeg({ quality: 92 }).toBuffer();
  const asset = { id: "asset-derivative-test", profileId: "profile-test", mediaType: "photo", mimeType: "image/jpeg", checksum: "test", createdAt: new Date().toISOString() };
  const outputs = await createDerivatives(asset, original);
  assert.equal(outputs.length, 2);
  assert.deepEqual(outputs.map((item) => [item.variant, item.width, item.height]), [["thumbnail", 480, 720], ["web", 1280, 1920]]);
  assert.equal(outputs[0].mimeType, "image/webp");
  assert.notEqual(outputs[0].body.byteLength, outputs[1].body.byteLength);
  assert.deepEqual(await sharp(outputs[0].body).metadata().then(({ width, height }) => [width, height]), [480, 720]);
});

test("web delivery never falls back to a staging or Quark original", () => {
  const locations = [
    { id: "original", mediaAssetId: "asset", provider: "hot", variant: "original", providerRef: "media/original/a", status: "awaiting_archive", createdAt: "", updatedAt: "" },
    { id: "quark", mediaAssetId: "asset", provider: "quark", variant: "original", providerRef: "quark://a", status: "archived", createdAt: "", updatedAt: "" },
    { id: "thumb", mediaAssetId: "asset", provider: "hot", variant: "thumbnail", providerRef: "media/derivatives/a/thumb.webp", status: "ready", createdAt: "", updatedAt: "" },
  ];
  const selected = selectLocation(locations, { id: "asset", profileId: "profile-test", mediaType: "photo", mimeType: "image/jpeg", createdAt: "" }, "web");
  assert.equal(selected?.variant, "thumbnail");
  assert.equal(selectLocation(locations, { id: "asset", profileId: "profile-test", mediaType: "photo", mimeType: "image/jpeg", createdAt: "" }, "original")?.provider, "quark");
});

test("archive verification creates Quark original and only then removes staging", async () => {
  const profileId = "profile-archive-test";
  const assetId = newId("asset-test"); const mediaId = newId("media-test"); const sourceId = newId("source-test"); const key = `media/original/${assetId}/photo.jpg`; touchedKeys.add(key);
  await storage.put({ key, body: Buffer.from("original-bytes"), mimeType: "image/jpeg" });
  await appendUpload({ source: sourceFor(sourceId, profileId, mediaId), media: [{ id: mediaId, profileId, rawSourceId: sourceId, mediaAssetId: assetId, type: "photo", src: "", originalFilename: "photo.jpg", mimeType: "image/jpeg", fileSize: 14, alt: "test", takenAt: "2026-08-28", visibility: "family", width: 1, height: 1 }], assets: [{ id: assetId, profileId, rawSourceId: sourceId, mediaType: "photo", mimeType: "image/jpeg", originalFilename: "photo.jpg", checksum: "checksum-archive-test", archiveStatus: "awaiting_archive", createdAt: new Date().toISOString() }], locations: [{ id: newId("location-test"), mediaAssetId: assetId, provider: "hot", variant: "original", providerRef: key, fileSize: 14, status: "awaiting_archive", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  const result = await archivePendingOriginals({ archive: async () => ({ providerRef: "quark://archived/photo" }), verify: async () => ({ exists: true, size: 14 }) }, profileId);
  const store = await getStore();
  assert.equal(result.archived, 1);
  assert.equal(store.mediaAssets.find((item) => item.id === assetId)?.archiveStatus, "archived");
  assert.equal(store.mediaLocations.find((item) => item.mediaAssetId === assetId && item.provider === "quark")?.status, "archived");
  assert.equal(store.mediaLocations.some((item) => item.mediaAssetId === assetId && item.provider === "hot" && item.variant === "original"), false);
  assert.equal(await storage.get(key), null);
});

test("authorization loss pauses archive without losing staging", async () => {
  const profileId = "profile-auth-test"; const assetId = newId("asset-auth-test"); const mediaId = newId("media-auth-test"); const sourceId = newId("source-auth-test"); const key = `media/original/${assetId}/photo.jpg`; touchedKeys.add(key);
  await storage.put({ key, body: Buffer.from("original-bytes"), mimeType: "image/jpeg" });
  await appendUpload({ source: sourceFor(sourceId, profileId, mediaId), media: [{ id: mediaId, profileId, rawSourceId: sourceId, mediaAssetId: assetId, type: "photo", src: "", originalFilename: "photo.jpg", mimeType: "image/jpeg", fileSize: 14, alt: "test", takenAt: "2026-08-28", visibility: "family", width: 1, height: 1 }], assets: [{ id: assetId, profileId, rawSourceId: sourceId, mediaType: "photo", mimeType: "image/jpeg", originalFilename: "photo.jpg", checksum: "checksum-auth-test", archiveStatus: "awaiting_archive", createdAt: new Date().toISOString() }], locations: [{ id: newId("location-auth-test"), mediaAssetId: assetId, provider: "hot", variant: "original", providerRef: key, fileSize: 14, status: "awaiting_archive", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] });
  const result = await archivePendingOriginals({ archive: async () => { throw new Error("OAuth token expired"); }, verify: async () => ({ exists: false }) }, profileId);
  const store = await getStore();
  assert.equal(result.paused, true);
  assert.equal(store.mediaAssets.find((item) => item.id === assetId)?.archiveStatus, "paused_auth_required");
  assert.equal(store.mediaLocations.find((item) => item.mediaAssetId === assetId)?.status, "awaiting_archive");
  assert.deepEqual(await storage.get(key), Buffer.from("original-bytes"));
});

test("Quark import enqueues an organizer job (async) and the worker organizes it exactly once", async () => {
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#b27b4d" } }).jpeg().toBuffer();
  const file = { providerRef: "quark://idempotent-test", filename: "import.jpg", mimeType: "image/jpeg", size: bytes.byteLength, takenAt: "2026-08-28T10:00:00.000Z" };
  const options = { profileId: "profile-import-test", contributorId: "contributor-dad", visibility: "family" };
  const client = { download: async () => bytes };
  const first = await ingestQuarkFile(file, options, client);
  const second = await ingestQuarkFile(file, options, client);
  assert.ok(first.jobId);
  assert.equal(second.duplicate, true);
  const outcomes = await runOrganizerWorker({ once: true });
  assert.equal(outcomes.filter((o) => o.job.id === first.jobId).length, 1);
  assert.equal(outcomes.find((o) => o.job.id === first.jobId)?.ok, true);
  const store = await getStore();
  assert.equal(store.mediaLocations.filter((item) => item.provider === "quark" && item.providerRef === file.providerRef).length, 1);
  assert.equal(store.rawSources.filter((item) => item.id === first.sourceId).length, 1);
  assert.notEqual(store.rawSources.find((item) => item.id === first.sourceId)?.status, "uploaded");
});
