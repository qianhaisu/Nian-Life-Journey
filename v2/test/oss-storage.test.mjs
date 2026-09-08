import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getOssConfig, OssStorage } from "../lib/storage/oss-storage.ts";
import { activeMediaProvider, createHotStorage, getStorageForProvider, hotStorage, LocalHotStorage, R2HotStorage, resolveHotBackend, selectLocation, __setOssStorageForTests } from "../lib/storage/hot-storage.ts";
import { ingestQuarkFile } from "../lib/ingest/quark.ts";
import { getStore } from "../lib/db/repository.ts";

const FULL_ENV = { OSS_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com", OSS_REGION: "oss-cn-hangzhou", OSS_ACCESS_KEY_ID: "id", OSS_ACCESS_KEY_SECRET: "secret", OSS_BUCKET: "nianlife-media" };
const FULL_R2_ENV = { R2_ACCOUNT_ID: "account", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "nianlife-hot" };

// The two tests below persist through the real JSON-file repository (lib/db/json-repository.ts),
// which is NOT reset between separate `npm test` invocations — unlike an in-memory/transactional
// DB. A fixed providerRef would collide with a prior run's already-persisted row and hit
// ingestQuarkFile's own dedup ("existing" short-circuit), silently skipping the very derivative
// writes these tests exist to check (this is exactly how the write-path test below first failed:
// it passed alone, then failed on a second `npm test` run because its fixed providerRef had
// already been ingested). Following storage-phase-2.test.mjs's own pattern: snapshot the JSON
// store before this file's tests and restore it verbatim after, so this file leaves no residue
// regardless of how many times it runs.
const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
let originalStore;
try { originalStore = await readFile(dataFile); } catch { originalStore = null; }
const touchedKeys = new Set();
test.after(async () => {
  if (originalStore) await writeFile(dataFile, originalStore);
  else await rm(dataFile, { force: true });
  const local = new LocalHotStorage();
  for (const key of touchedKeys) await local.delete(key);
});

// The repository dedups a MediaAsset by content checksum (lib/db/chat-import-persistence.ts),
// independently of ingestQuarkFile's own providerRef dedup — a solid-color JPEG built with a
// fixed background encodes to byte-identical output every call, so two tests (or two runs of the
// same test) using the same color would collide on checksum and silently reuse a stale asset
// instead of creating a fresh one, orphaning the freshly-generated assetId the test asserts
// against. A random background makes every call's content, and therefore checksum, unique.
async function uniqueJpegBytes() {
  const background = { r: Math.floor(Math.random() * 256), g: Math.floor(Math.random() * 256), b: Math.floor(Math.random() * 256) };
  return sharp({ create: { width: 800, height: 600, channels: 3, background } }).jpeg().toBuffer();
}

// Phase 3B1 scope note (see the task's own final report): this suite verifies the routing
// primitives (activeMediaProvider/getStorageForProvider/selectLocation) and the OSS adapter's
// wire-level commands against a fake client. It does NOT run a live/network-mocked
// MEDIA_STORAGE_PROVIDER=oss pass through ingestQuarkFile end-to-end — doing that without either
// hitting real network or adding a client-injection seam to the ingest functions themselves is
// out of scope for this round. What IS covered below is a regression guard: with no
// MEDIA_STORAGE_PROVIDER set (today's default, unaffected by this round's change), a real
// ingestQuarkFile call still tags its derivative locations "hot", exactly as before.
test("ingestQuarkFile still tags derivative locations \"hot\" when MEDIA_STORAGE_PROVIDER is unset (default path unaffected by Phase 3B1)", async () => {
  assert.equal(process.env.MEDIA_STORAGE_PROVIDER, undefined, "this test only asserts the default; it does not itself flip the env var");
  const bytes = await uniqueJpegBytes();
  // A fresh providerRef every run — see the file-level comment above on why a fixed one would
  // silently hit ingestQuarkFile's own dedup on a second `npm test` invocation.
  const file = { providerRef: `quark://oss-regression-test-${randomUUID()}`, filename: "regress.jpg", mimeType: "image/jpeg", size: bytes.byteLength, takenAt: "2026-08-28T10:00:00.000Z" };
  const options = { profileId: "profile-oss-regression-test", contributorId: "contributor-dad", visibility: "family" };
  const result = await ingestQuarkFile(file, options, { download: async () => bytes });
  const store = await getStore();
  const derivativeLocations = store.mediaLocations.filter((location) => location.mediaAssetId === result.assetId && location.variant !== "original");
  assert.ok(derivativeLocations.length > 0, "expected at least one derivative location to have been created");
  assert.ok(derivativeLocations.every((location) => location.provider === "hot"), "derivative locations must stay \"hot\" when MEDIA_STORAGE_PROVIDER is unset");
  for (const location of derivativeLocations) touchedKeys.add(location.providerRef);
});

test("getOssConfig fails closed when any OSS_* variable is missing, naming the missing ones", () => {
  assert.throws(() => getOssConfig({}), /OSS storage is selected but missing.*OSS_ENDPOINT.*OSS_REGION.*OSS_ACCESS_KEY_ID.*OSS_ACCESS_KEY_SECRET.*OSS_BUCKET/s);
  const { OSS_BUCKET, ...withoutBucket } = FULL_ENV;
  assert.throws(() => getOssConfig(withoutBucket), /OSS_BUCKET/);
  assert.doesNotThrow(() => getOssConfig(FULL_ENV));
});

function fakeClient() {
  const sent = [];
  const client = { send: async (command) => { sent.push(command); return command.__result ?? {}; } };
  return { client, sent };
}

// Injects a fake `{ send }` client so these tests never touch the network — every Command
// object below (PutObjectCommand etc.) is still the real @aws-sdk/client-s3 class OssStorage
// itself constructs, so asserting on `command.input` asserts on the real request shape.
function ossStorageWithFakeClient() {
  const { client, sent } = fakeClient();
  return { storage: new OssStorage(getOssConfig(FULL_ENV), Promise.resolve(client)), sent };
}

test("OssStorage.put sends a PutObjectCommand with the bucket, key, size and content type", async () => {
  const { storage, sent } = ossStorageWithFakeClient();
  const body = Buffer.from("hello oss");
  const result = await storage.put({ key: "media/derivatives/asset-1/web.webp", body, mimeType: "image/webp" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].constructor.name, "PutObjectCommand");
  assert.equal(sent[0].input.Bucket, "nianlife-media");
  assert.equal(sent[0].input.Key, "media/derivatives/asset-1/web.webp");
  assert.equal(sent[0].input.ContentType, "image/webp");
  assert.equal(sent[0].input.ContentLength, body.byteLength);
  assert.equal(result.providerRef, "media/derivatives/asset-1/web.webp");
});

test("OssStorage.put rejects a key outside media/ or containing a traversal segment", async () => {
  const { storage } = ossStorageWithFakeClient();
  await assert.rejects(() => storage.put({ key: "other/asset-1/web.webp", body: Buffer.from("x"), mimeType: "image/webp" }), /Unsafe storage key/);
  await assert.rejects(() => storage.put({ key: "media/../secrets", body: Buffer.from("x"), mimeType: "image/webp" }), /Unsafe storage key/);
});

test("OssStorage.get sends a GetObjectCommand for the bucket/key and returns the byte array", async () => {
  const sent = [];
  const bytes = new Uint8Array([1, 2, 3]);
  const storage = new OssStorage(getOssConfig(FULL_ENV), Promise.resolve({ send: async (command) => { sent.push(command); return { Body: { transformToByteArray: async () => bytes } }; } }));
  const result = await storage.get("media/derivatives/asset-1/web.webp");
  assert.equal(sent[0].constructor.name, "GetObjectCommand");
  assert.equal(sent[0].input.Bucket, "nianlife-media");
  assert.equal(sent[0].input.Key, "media/derivatives/asset-1/web.webp");
  assert.deepEqual(result, bytes);
});

test("OssStorage.get returns null when the object is missing instead of throwing", async () => {
  const storage = new OssStorage(getOssConfig(FULL_ENV), Promise.resolve({ send: async () => { throw new Error("NoSuchKey"); } }));
  assert.equal(await storage.get("media/derivatives/asset-1/web.webp"), null);
});

test("OssStorage.getStream sends a GetObjectCommand and returns the web stream", async () => {
  const sent = [];
  const webStream = new ReadableStream();
  const storage = new OssStorage(getOssConfig(FULL_ENV), Promise.resolve({ send: async (command) => { sent.push(command); return { Body: { transformToWebStream: () => webStream } }; } }));
  const result = await storage.getStream("media/derivatives/asset-1/web.webp");
  assert.equal(sent[0].constructor.name, "GetObjectCommand");
  assert.equal(result, webStream);
});

test("OssStorage.delete sends a DeleteObjectCommand for the bucket/key", async () => {
  const { storage, sent } = ossStorageWithFakeClient();
  await storage.delete("media/derivatives/asset-1/web.webp");
  assert.equal(sent[0].constructor.name, "DeleteObjectCommand");
  assert.equal(sent[0].input.Bucket, "nianlife-media");
  assert.equal(sent[0].input.Key, "media/derivatives/asset-1/web.webp");
});

test("OssStorage.verify hashes the retrieved bytes and reports whether the checksum matches", async () => {
  const chunks = [Buffer.from("hello "), Buffer.from("oss")];
  const storage = new OssStorage(getOssConfig(FULL_ENV), Promise.resolve({ send: async () => ({ Body: (async function* () { for (const c of chunks) yield c; })() }) }));
  const expected = createHash("sha256").update(Buffer.concat(chunks)).digest("hex");
  const verified = await storage.verify("media/derivatives/asset-1/web.webp", expected);
  assert.equal(verified.exists, true);
  assert.equal(verified.checksumVerified, true);
  assert.equal(verified.fileSize, Buffer.concat(chunks).byteLength);
  const mismatched = await storage.verify("media/derivatives/asset-1/web.webp", "0".repeat(64));
  assert.equal(mismatched.checksumVerified, false);
});

test("OssStorage.verify reports non-existence rather than throwing when the object is absent", async () => {
  const storage = new OssStorage(getOssConfig(FULL_ENV), Promise.resolve({ send: async () => { throw new Error("NoSuchKey"); } }));
  assert.deepEqual(await storage.verify("media/derivatives/asset-1/web.webp", "abc"), { exists: false, checksumVerified: false });
});

test("OssStorage.url never returns a page-facing URL, for any location shape", () => {
  const storage = new OssStorage(getOssConfig(FULL_ENV), Promise.resolve({ send: async () => ({}) }));
  const readyDerivative = { id: "loc", mediaAssetId: "asset", provider: "oss", variant: "web", providerRef: "media/derivatives/asset-1/web.webp", status: "ready", createdAt: "", updatedAt: "" };
  assert.equal(storage.url(readyDerivative), null);
  assert.equal(storage.url({ ...readyDerivative, variant: "original", status: "archived" }), null);
});

test("selectLocation prefers a ready OSS derivative over a ready hot/R2 one, per variant", () => {
  const asset = { id: "asset", profileId: "profile-test", mediaType: "photo", mimeType: "image/jpeg", createdAt: "" };
  const locations = [
    { id: "hot-web", mediaAssetId: "asset", provider: "hot", variant: "web", providerRef: "media/derivatives/asset/web-hot.webp", status: "ready", createdAt: "", updatedAt: "" },
    { id: "oss-web", mediaAssetId: "asset", provider: "oss", variant: "web", providerRef: "media/derivatives/asset/web-oss.webp", status: "ready", createdAt: "", updatedAt: "" },
  ];
  const selected = selectLocation(locations, asset, "web");
  assert.equal(selected?.id, "oss-web");
  assert.equal(selected?.provider, "oss");
});

test("selectLocation falls back to the ready hot/R2 derivative when no OSS copy exists yet", () => {
  const asset = { id: "asset", profileId: "profile-test", mediaType: "photo", mimeType: "image/jpeg", createdAt: "" };
  const locations = [
    { id: "hot-web", mediaAssetId: "asset", provider: "hot", variant: "web", providerRef: "media/derivatives/asset/web-hot.webp", status: "ready", createdAt: "", updatedAt: "" },
  ];
  const selected = selectLocation(locations, asset, "web");
  assert.equal(selected?.id, "hot-web");
});

test("selectLocation never returns an original from oss or hot — only the archived Quark copy", () => {
  const asset = { id: "asset", profileId: "profile-test", mediaType: "photo", mimeType: "image/jpeg", createdAt: "" };
  const locations = [
    { id: "oss-original", mediaAssetId: "asset", provider: "oss", variant: "original", providerRef: "media/original/asset/photo.jpg", status: "ready", createdAt: "", updatedAt: "" },
    { id: "hot-original", mediaAssetId: "asset", provider: "hot", variant: "original", providerRef: "media/original/asset/photo.jpg", status: "awaiting_archive", createdAt: "", updatedAt: "" },
    { id: "quark-original", mediaAssetId: "asset", provider: "quark", variant: "original", providerRef: "quark://a", status: "archived", createdAt: "", updatedAt: "" },
  ];
  assert.equal(selectLocation(locations, asset, "original")?.id, "quark-original");
});

test("getStorageForProvider routes \"hot\" to the existing hotStorage singleton and \"oss\" to an OssStorage instance", () => {
  assert.equal(getStorageForProvider("hot"), hotStorage);
  const ossBacked = getStorageForProvider("oss", FULL_ENV);
  assert.ok(ossBacked instanceof OssStorage);
});

test("getStorageForProvider throws for a provider with no object-storage backend (quark, wechat)", () => {
  assert.throws(() => getStorageForProvider("quark"), /no object storage backend for provider "quark"/);
  assert.throws(() => getStorageForProvider("wechat"), /no object storage backend for provider "wechat"/);
});

test("activeMediaProvider defaults new writes to \"hot\" and only switches to \"oss\" on an explicit opt-in", () => {
  assert.equal(activeMediaProvider({}), "hot");
  assert.equal(activeMediaProvider({ MEDIA_STORAGE_PROVIDER: "r2" }), "hot");
  assert.equal(activeMediaProvider({ MEDIA_STORAGE_PROVIDER: "oss" }), "oss");
});

// --- Environment matrix (2026-09-08 fix): resolveHotBackend()/createHotStorage() must decide the
// PHYSICAL backend behind provider "hot" independently of activeMediaProvider()'s write-target
// decision. The bug this fixes: MEDIA_STORAGE_PROVIDER=oss used to also flip createHotStorage()'s
// `=== "r2"` check to false, silently downgrading every existing "hot" (real R2) row to local disk
// the moment OSS writes were turned on — a 404 for every pre-existing photo, R2 credentials or
// not. Each case below checks BOTH halves: which physical backend "hot" reads through
// (resolveHotBackend/createHotStorage) and which provider a new write targets
// (activeMediaProvider) — the two must be independently correct, not coupled through one flag.
test("env matrix: MEDIA_STORAGE_PROVIDER=r2, HOT_STORAGE_BACKEND unset → hot reads through R2 (legacy behavior preserved)", () => {
  const env = { MEDIA_STORAGE_PROVIDER: "r2", ...FULL_R2_ENV };
  assert.equal(resolveHotBackend(env), "r2");
  assert.ok(createHotStorage(env) instanceof R2HotStorage);
  assert.equal(activeMediaProvider(env), "hot");
});

test("env matrix: MEDIA_STORAGE_PROVIDER=oss, HOT_STORAGE_BACKEND=r2 → new writes target oss, existing hot rows still read through R2", () => {
  const env = { MEDIA_STORAGE_PROVIDER: "oss", HOT_STORAGE_BACKEND: "r2", ...FULL_R2_ENV, ...FULL_ENV };
  assert.equal(resolveHotBackend(env), "r2");
  assert.ok(createHotStorage(env) instanceof R2HotStorage, "existing \"hot\" rows must NOT be silently downgraded to local disk once oss is the write target");
  assert.equal(activeMediaProvider(env), "oss");
});

test("env matrix: MEDIA_STORAGE_PROVIDER=oss, HOT_STORAGE_BACKEND=local → new writes target oss, hot reads through local disk", () => {
  const env = { MEDIA_STORAGE_PROVIDER: "oss", HOT_STORAGE_BACKEND: "local", ...FULL_ENV };
  assert.equal(resolveHotBackend(env), "local");
  assert.ok(createHotStorage(env) instanceof LocalHotStorage);
  assert.equal(activeMediaProvider(env), "oss");
});

test("env matrix: nothing set → local-dev default preserved (hot is local, new writes still tag hot)", () => {
  assert.equal(resolveHotBackend({}), "local");
  assert.ok(createHotStorage({}) instanceof LocalHotStorage);
  assert.equal(activeMediaProvider({}), "hot");
});

test("env matrix: HOT_STORAGE_BACKEND is an explicit override — it wins even when MEDIA_STORAGE_PROVIDER would otherwise imply the other backend", () => {
  assert.equal(resolveHotBackend({ MEDIA_STORAGE_PROVIDER: "r2", HOT_STORAGE_BACKEND: "local" }), "local");
  assert.equal(resolveHotBackend({ HOT_STORAGE_BACKEND: "r2" }), "r2");
});

// --- Requirement: a real write-path test, not just activeMediaProvider()'s return value. This
// drives the actual ingestQuarkFile call chain (activeMediaProvider → getStorageForProvider →
// getOssStorage) with MEDIA_STORAGE_PROVIDER=oss really set, only substituting a fake `{ put }`
// client for the OSS singleton via __setOssStorageForTests so no network call happens. If the
// write path ever stops threading the resolved provider through to both the storage-selection
// call and the location's own `provider` field, this fails.
test("ingestQuarkFile, with MEDIA_STORAGE_PROVIDER=oss really set, writes derivatives through the OSS backend and persists location.provider === \"oss\"", async () => {
  const previousEnv = process.env.MEDIA_STORAGE_PROVIDER;
  const puts = [];
  const fakeOss = {
    put: async (input) => { puts.push(input); return { providerRef: input.key, mimeType: input.mimeType, fileSize: input.body.byteLength }; },
    get: async () => null,
    getStream: async () => null,
    delete: async () => {},
    verify: async () => ({ exists: false, checksumVerified: false }),
    url: () => null,
  };
  __setOssStorageForTests(fakeOss);
  process.env.MEDIA_STORAGE_PROVIDER = "oss";
  try {
    const bytes = await uniqueJpegBytes();
    const file = { providerRef: `quark://oss-write-path-test-${randomUUID()}`, filename: "oss-write.jpg", mimeType: "image/jpeg", size: bytes.byteLength, takenAt: "2026-08-28T10:00:00.000Z" };
    const options = { profileId: "profile-oss-write-path-test", contributorId: "contributor-dad", visibility: "family" };
    const result = await ingestQuarkFile(file, options, { download: async () => bytes });
    assert.ok(puts.length > 0, "expected the fake OSS client to receive at least one derivative put()");
    assert.ok(puts.every((input) => input.key.startsWith("media/derivatives/")), "every derivative must still be written under media/derivatives/");
    const store = await getStore();
    const derivativeLocations = store.mediaLocations.filter((location) => location.mediaAssetId === result.assetId && location.variant !== "original");
    assert.equal(derivativeLocations.length, puts.length, "one location row per fake-OSS put()");
    assert.ok(derivativeLocations.every((location) => location.provider === "oss"), "every derivative location must be tagged \"oss\", not \"hot\", once MEDIA_STORAGE_PROVIDER=oss");
    const originalLocation = store.mediaLocations.find((location) => location.mediaAssetId === result.assetId && location.variant === "original");
    assert.equal(originalLocation?.provider, "quark", "the original is unaffected by MEDIA_STORAGE_PROVIDER — Quark imports always tag their original \"quark\"");
  } finally {
    __setOssStorageForTests(undefined);
    if (previousEnv === undefined) delete process.env.MEDIA_STORAGE_PROVIDER;
    else process.env.MEDIA_STORAGE_PROVIDER = previousEnv;
  }
});
