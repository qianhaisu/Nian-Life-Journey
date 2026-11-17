#!/usr/bin/env node
// Uploads the 14 verified real weekend planner images to Alibaba Cloud OSS
// (both originals/ and web/ prefixes), verifies every uploaded object with
// oss.verify(key, sha256), and writes v2/lib/weekend/media-manifest.json.
//
// Permanent OSS-only storage rule: never reads or writes R2.
// Usage (cwd = v2):
//   node .data/t20-run-env.mjs -- scripts/weekend/upload-weekend-assets-oss.mjs

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getOssConfig, OssStorage } from "../../lib/storage/oss-storage.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const V2_DIR = path.resolve(__dirname, "../..");
const REPO_DIR = path.resolve(V2_DIR, "..");
const ASSETS_DIR = path.join(REPO_DIR, "docs", "weekend-planner", "prototype-v3", "assets");
const SOURCES_MD_PATH = path.join(ASSETS_DIR, "SOURCES.md");
const MANIFEST_PATH = path.join(V2_DIR, "lib", "weekend", "media-manifest.json");

function stripBackticks(value) {
  return value.trim().replace(/^`+|`+$/g, "").trim();
}

function parseSourcePage(rawCell) {
  const cleaned = rawCell.trim();
  const urlMatch = cleaned.match(/https?:\/\/[^\s`)]+/);
  if (urlMatch) {
    return urlMatch[0];
  }
  return cleaned.replace(/`/g, "").trim();
}

function parseSourcesMarkdown(markdown) {
  const entries = new Map();
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .slice(1, line.endsWith("|") ? -1 : undefined)
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 5) continue;
    const filename = stripBackticks(cells[0]);
    if (!filename.endsWith(".jpg")) continue;
    const alt = cells[1].trim();
    const dimensions = cells[2].trim();
    const sourcePage = parseSourcePage(cells[3]);
    const attribution = cells[4].trim();
    if (!alt || !sourcePage) {
      throw new Error(`SOURCES.md row for ${filename} is missing alt or sourcePage`);
    }
    entries.set(filename, { filename, alt, dimensions, sourcePage, attribution });
  }
  return entries;
}

async function ensureUploadedAndVerified(oss, key, body, sha256, mimeType) {
  const existing = await oss.verify(key, sha256);
  if (!(existing.exists && existing.checksumVerified && existing.fileSize === body.byteLength)) {
    await oss.put({
      key,
      body,
      mimeType,
      fileSize: body.byteLength,
      checksum: `sha256:${sha256}`,
    });
  }
  const verified = await oss.verify(key, sha256);
  if (!verified.exists || !verified.checksumVerified || verified.fileSize !== body.byteLength) {
    throw new Error(
      `OSS verification failed for ${key}: exists=${verified.exists} checksumVerified=${verified.checksumVerified} fileSize=${verified.fileSize} expected=${body.byteLength}`
    );
  }
  return verified;
}

async function main() {
  const ossConfig = getOssConfig();
  const oss = new OssStorage(ossConfig);

  const sourcesMd = await readFile(SOURCES_MD_PATH, "utf8");
  const sourcesByFile = parseSourcesMarkdown(sourcesMd);

  const dirEntries = await readdir(ASSETS_DIR, { withFileTypes: true });
  const jpgFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jpg"))
    .map((entry) => entry.name)
    .sort();

  if (jpgFiles.length !== 14) {
    throw new Error(`Expected 14 .jpg assets in ${ASSETS_DIR}, found ${jpgFiles.length}`);
  }

  const assets = [];
  for (const filename of jpgFiles) {
    const meta = sourcesByFile.get(filename);
    if (!meta) {
      throw new Error(`Missing SOURCES.md entry for ${filename}`);
    }
    const filePath = path.join(ASSETS_DIR, filename);
    const body = await readFile(filePath);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const bytes = body.byteLength;
    const mimeType = "image/jpeg";
    const originalKey = `media/weekend/assets/originals/${filename}`;
    const webKey = `media/weekend/assets/web/${filename}`;

    const origVerify = await ensureUploadedAndVerified(oss, originalKey, body, sha256, mimeType);
    const webVerify = await ensureUploadedAndVerified(oss, webKey, body, sha256, mimeType);

    console.log(
      `[oss-verify] ${filename} bytes=${bytes} sha256=${sha256.slice(0, 12)}... orig=${origVerify.checksumVerified} web=${webVerify.checksumVerified}`
    );

    assets.push({
      filename,
      originalKey,
      webKey,
      sha256,
      bytes,
      mimeType,
      sourcePage: meta.sourcePage,
      alt: meta.alt,
    });
  }

  const manifest = {
    schema: "nianlife.weekend-media-manifest/1",
    generatedAt: new Date().toISOString(),
    provider: "oss",
    count: assets.length,
    assets,
  };

  await mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[done] uploaded & verified ${assets.length} assets (28 OSS keys), wrote ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error("[error]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
