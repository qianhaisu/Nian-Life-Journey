import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cliScript = path.join(process.cwd(), "tools", "quark-connector", "apply-artifact.ts");

// Phase 3B2b: these exercise the REAL npm-script-wired entry point (`npm run quark:sync:apply` →
// tools/quark-connector/apply-artifact.ts), proving the wiring end to end rather than just the
// shared quark-storage-guard.mjs unit (see test/quark-storage-guard.test.mjs for that). None of
// this connects to a real database, R2, or OSS: DATABASE_URL points at 127.0.0.1 on a port nothing
// listens on, which fails fast and deterministically (connection refused) — that failure is itself
// the proof the run got PAST the object-storage provider guard and reached the shared, DB-backed
// apply core (scripts/quark-photo-apply.mjs), without ever making it to an actual query result.
//
// A test asserting the "r2" configuration itself PASSES the guard is intentionally not included
// here: this machine's real .env.local already carries production R2 credentials, and dotenv's
// default (non-overriding) load means an `env` override that OMITS R2_* vars gets them silently
// refilled from .env.local anyway — not a deterministic, portable way to test "missing R2 vars".
// That exact case (r2 configured, r2 missing a variable, oss configured, oss missing a variable,
// unknown provider) is covered precisely and portably by directly unit-testing
// requireQuarkStorageProvider() with an explicit env object in test/quark-storage-guard.test.mjs.
async function buildArtifact() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "quark-cli-entry-"));
  await mkdir(path.join(dir, "artifacts"), { recursive: true });
  await mkdir(path.join(dir, "originals"), { recursive: true });
  await writeFile(path.join(dir, "artifacts", "task-items.jsonl"), "");
  return dir;
}

const UNREACHABLE_DATABASE_URL = "postgres://127.0.0.1:1/nianlife-cli-test-unreachable";

test("dry-run (no --apply) never requires MEDIA_STORAGE_PROVIDER/R2_*/OSS_* — the guard is not on this code path at all", async () => {
  const dir = await buildArtifact();
  try {
    const env = { ...process.env, DATABASE_URL: UNREACHABLE_DATABASE_URL };
    delete env.MEDIA_STORAGE_PROVIDER;
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, "--artifact", dir], { env }).catch((error) => error);
    assert.notEqual(result.code, 0, "expected a failure — but from the unreachable database, not from a missing cloud credential");
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.ok(!combined.includes("MEDIA_STORAGE_PROVIDER"), `dry-run must never mention the object-storage provider guard: ${combined}`);
    assert.ok(/media_assets|ECONNREFUSED|Failed query/.test(combined), `expected a database-shaped failure, got: ${combined}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--apply with MEDIA_STORAGE_PROVIDER=oss and full OSS_* configuration reaches the shared, OSS-aware apply core", async () => {
  const dir = await buildArtifact();
  try {
    const env = {
      ...process.env,
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      MEDIA_STORAGE_PROVIDER: "oss",
      OSS_ENDPOINT: "https://oss-cn-hangzhou.aliyuncs.com",
      OSS_REGION: "oss-cn-hangzhou",
      OSS_ACCESS_KEY_ID: "test-id",
      OSS_ACCESS_KEY_SECRET: "test-secret",
      OSS_BUCKET: "nianlife-media-test",
    };
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, "--artifact", dir, "--apply"], { env }).catch((error) => error);
    assert.notEqual(result.code, 0, "expected a failure — but from the unreachable database, not from the object-storage guard");
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.ok(!combined.includes("MEDIA_STORAGE_PROVIDER must be"), `an oss run with valid OSS_* config must pass the guard: ${combined}`);
    assert.ok(/media_assets|ECONNREFUSED|Failed query/.test(combined), `expected the run to have reached the database-backed apply core, got: ${combined}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--apply with an unrecognized MEDIA_STORAGE_PROVIDER fails immediately, before any database query", async () => {
  const dir = await buildArtifact();
  try {
    const env = { ...process.env, DATABASE_URL: UNREACHABLE_DATABASE_URL, MEDIA_STORAGE_PROVIDER: "local" };
    const result = await execFileAsync(process.execPath, ["--import", "tsx", cliScript, "--artifact", dir, "--apply"], { env }).catch((error) => error);
    assert.notEqual(result.code, 0);
    const combined = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    assert.ok(combined.includes("MEDIA_STORAGE_PROVIDER must be"), `expected the guard's own usage error, got: ${combined}`);
    assert.ok(!/media_assets|Failed query/.test(combined), `must fail BEFORE reaching the database query, got: ${combined}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
