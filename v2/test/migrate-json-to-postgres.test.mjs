import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.join(process.cwd());
const script = path.join(repoRoot, "scripts", "migrate-json-to-postgres.mjs");

async function runDryRun(fixturePath) {
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", script, "--dry-run", `--json=${fixturePath}`], { cwd: repoRoot });
    return { ...result, exitCode: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? 1 };
  }
}

function validStore() {
  return {
    profile: { id: "profile-x", displayName: "X", birthDate: "2025-01-01", timezone: "Asia/Shanghai", bio: "", visibility: "family" },
    contributors: [{ id: "contributor-x", profileId: "profile-x", role: "father", displayName: "Dad" }],
    rawSources: [{ id: "source-x", profileId: "profile-x", sourceType: "parent_note", contentTypes: ["family"], contributorId: "contributor-x", capturedAt: "2026-11-01T00:00:00.000Z", importedAt: "2026-11-01T00:00:00.000Z", mediaIds: [], sourceLabel: "s", visibility: "family", status: "uploaded" }],
    mediaAssets: [], mediaLocations: [], media: [], events: [], links: [], connectorStates: [], organizerRuns: [], dailyTraces: [], growthRecords: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [],
    monthlySnapshot: { id: "snap-x", profileId: "profile-x", month: "2026-11", summary: "s", highlights: [], visibility: "family" },
  };
}

test("migrate-json-to-postgres --dry-run reports counts and exits 0 for a valid fixture, without opening a database connection", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nian-migrate-"));
  const fixturePath = path.join(dir, "store.json");
  await writeFile(fixturePath, JSON.stringify(validStore()));
  try {
    const result = await runDryRun(fixturePath);
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /RawSource\s+1/);
    assert.match(result.stdout, /Dry run only/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("migrate-json-to-postgres --dry-run exits 1 on a duplicate id within the same collection", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nian-migrate-"));
  const fixturePath = path.join(dir, "store.json");
  const store = validStore();
  store.contributors.push({ ...store.contributors[0] });
  await writeFile(fixturePath, JSON.stringify(store));
  try {
    const result = await runDryRun(fixturePath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr + result.stdout, /duplicate id/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("migrate-json-to-postgres --dry-run exits 1 on a dangling MediaLocation.mediaAssetId (hard reference)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nian-migrate-"));
  const fixturePath = path.join(dir, "store.json");
  const store = validStore();
  store.mediaLocations.push({ id: "loc-x", mediaAssetId: "asset-missing", provider: "hot", variant: "web", providerRef: "ref-x", status: "ready", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z" });
  await writeFile(fixturePath, JSON.stringify(store));
  try {
    const result = await runDryRun(fixturePath);
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr + result.stdout, /mediaAssetId "asset-missing" not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("migrate-json-to-postgres --dry-run reports a dangling RawSource.contributorId as a warning, not an error (soft reference)", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nian-migrate-"));
  const fixturePath = path.join(dir, "store.json");
  const store = validStore();
  store.rawSources[0].contributorId = "contributor-missing";
  await writeFile(fixturePath, JSON.stringify(store));
  try {
    const result = await runDryRun(fixturePath);
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Reference warnings/);
    assert.match(result.stdout, /contributorId "contributor-missing" not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("migrate-json-to-postgres without --dry-run and without DATABASE_URL fails with a clear error, never falling back silently", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nian-migrate-"));
  const fixturePath = path.join(dir, "store.json");
  await writeFile(fixturePath, JSON.stringify(validStore()));
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", script, `--json=${fixturePath}`], { cwd: repoRoot, env: { ...process.env, DATABASE_URL: "" } }).catch((error) => ({ stdout: error.stdout ?? "", stderr: error.stderr ?? "", exitCode: error.code ?? 1 }));
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr + result.stdout, /DATABASE_URL/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
