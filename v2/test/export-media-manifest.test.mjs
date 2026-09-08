import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = path.join(process.cwd(), "scripts", "export-media-manifest.mjs");
const dataFile = path.join(process.cwd(), ".data", "nian-life.json");
const manifestFile = path.join(process.cwd(), "media-manifest.json");

// Phase 3B2: export-media-manifest.mjs reads/writes real files at fixed, non-parameterized paths
// (.data/nian-life.json, media-manifest.json at process.cwd()) — there is no dependency-injection
// seam to swap in a fixture store. Snapshot both real files (they are .gitignore'd — see
// v2/.gitignore lines 8-9 — so this is local dev state, not something git tracks) and restore them
// verbatim afterward, the same pattern test/storage-phase-2.test.mjs and test/oss-storage.test.mjs
// already use for the same file.
let originalData;
try { originalData = await readFile(dataFile); } catch { originalData = null; }
let originalManifest;
try { originalManifest = await readFile(manifestFile); } catch { originalManifest = null; }
test.after(async () => {
  if (originalData) await writeFile(dataFile, originalData);
  else await rm(dataFile, { force: true });
  if (originalManifest) await writeFile(manifestFile, originalManifest);
  else await rm(manifestFile, { force: true });
});

test("export-media-manifest groups hot AND oss derivatives together, per variant, without one silently overwriting the other", async () => {
  const fixtureStore = {
    mediaAssets: [{ id: "asset-1", checksum: "sha256:abc", archiveStatus: "archived" }],
    mediaLocations: [
      { id: "loc-original", mediaAssetId: "asset-1", provider: "quark", variant: "original", providerRef: "quark://a", status: "archived", createdAt: "", updatedAt: "" },
      // Mid-migration: the SAME variant ("web") exists at both tiers simultaneously.
      { id: "loc-hot-web", mediaAssetId: "asset-1", provider: "hot", variant: "web", providerRef: "media/derivatives/asset-1/web-hot.webp", status: "ready", createdAt: "", updatedAt: "" },
      { id: "loc-oss-web", mediaAssetId: "asset-1", provider: "oss", variant: "web", providerRef: "media/derivatives/asset-1/web-oss.webp", status: "ready", createdAt: "", updatedAt: "" },
      { id: "loc-oss-thumb", mediaAssetId: "asset-1", provider: "oss", variant: "thumbnail", providerRef: "media/derivatives/asset-1/thumb-oss.webp", status: "ready", createdAt: "", updatedAt: "" },
    ],
    events: [],
    media: [],
  };
  await writeFile(dataFile, JSON.stringify(fixtureStore), "utf8");
  await rm(manifestFile, { force: true });

  await execFileAsync(process.execPath, [scriptPath], { cwd: process.cwd() });

  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  assert.equal(manifest.version, 2, "the shape change (single object -> array per variant) is reflected in a bumped version");
  assert.equal(manifest.assets.length, 1);
  const [asset] = manifest.assets;
  assert.equal(asset.mediaAssetId, "asset-1");
  assert.equal(asset.original?.provider, "quark");

  // Neither hot nor oss silently overwrote the other for the shared "web" variant.
  assert.ok(Array.isArray(asset.derivatives.web), "derivatives.web must be an array, not a single overwritten location");
  assert.equal(asset.derivatives.web.length, 2);
  const webProviders = asset.derivatives.web.map((location) => location.provider).sort();
  assert.deepEqual(webProviders, ["hot", "oss"]);

  assert.ok(Array.isArray(asset.derivatives.thumbnail));
  assert.equal(asset.derivatives.thumbnail.length, 1);
  assert.equal(asset.derivatives.thumbnail[0].provider, "oss");
});
