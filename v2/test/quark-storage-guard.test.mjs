import test from "node:test";
import assert from "node:assert/strict";
import { requireQuarkStorageProvider } from "../scripts/quark-storage-guard.mjs";

const FULL_R2_ENV = { MEDIA_STORAGE_PROVIDER: "r2", R2_ACCOUNT_ID: "account", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret", R2_BUCKET: "nianlife-hot" };
const FULL_OSS_ENV = { MEDIA_STORAGE_PROVIDER: "oss", OSS_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com", OSS_REGION: "oss-cn-hangzhou", OSS_ACCESS_KEY_ID: "id", OSS_ACCESS_KEY_SECRET: "secret", OSS_BUCKET: "nianlife-media" };

// Phase 3B2b: this is the single shared preflight all four real Quark CLI entry points
// (quark-heic-ingest.mjs, quark-history-init.mjs, quark-photo-init.mjs,
// tools/quark-connector/apply-artifact.ts) now call instead of hand-rolling their own R2_-only
// check. Covers every case the task asked for: r2 passes, oss passes, an unknown value fails
// before any write, and each backend's missing-variable case fails without requiring the OTHER
// backend's credentials.
test("r2 configuration passes and the run is tagged \"hot\"", () => {
  assert.equal(requireQuarkStorageProvider(FULL_R2_ENV), "hot");
});

test("oss configuration passes and the run is tagged \"oss\"", () => {
  assert.equal(requireQuarkStorageProvider(FULL_OSS_ENV), "oss");
});

test("an unrecognized MEDIA_STORAGE_PROVIDER value fails before any write is possible", () => {
  assert.throws(() => requireQuarkStorageProvider({ MEDIA_STORAGE_PROVIDER: "local" }), /MEDIA_STORAGE_PROVIDER must be "r2" or "oss"/);
  assert.throws(() => requireQuarkStorageProvider({ MEDIA_STORAGE_PROVIDER: "R2" }), /MEDIA_STORAGE_PROVIDER must be "r2" or "oss"/, "case-sensitive — a typo must not silently pass");
  assert.throws(() => requireQuarkStorageProvider({}), /got unset/, "unset must fail exactly like an unrecognized value, never silently default to local disk");
});

test("oss with missing OSS_* variables fails, naming what is missing, and never requires R2_* instead", () => {
  const { OSS_BUCKET, ...withoutBucket } = FULL_OSS_ENV;
  assert.throws(() => requireQuarkStorageProvider(withoutBucket), /OSS_BUCKET/);
  assert.throws(() => requireQuarkStorageProvider({ MEDIA_STORAGE_PROVIDER: "oss" }), /OSS storage is selected but missing/);
});

test("r2 with missing R2_* variables fails, naming what is missing, and never requires OSS_* instead", () => {
  const { R2_BUCKET, ...withoutBucket } = FULL_R2_ENV;
  assert.throws(() => requireQuarkStorageProvider(withoutBucket), /R2_BUCKET/);
  assert.throws(() => requireQuarkStorageProvider({ MEDIA_STORAGE_PROVIDER: "r2" }), /R2 storage is selected but missing/);
});
