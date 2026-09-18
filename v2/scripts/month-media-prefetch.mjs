#!/usr/bin/env node
// Downloads the `web` derivative of every media row in a month's curation ledger into a local
// cache, so visual analysis runs on real bytes instead of filenames.
//
// It reads the ledger produced by month-curation-ledger.mjs and writes files named by media id.
// Resumable: a file already on disk is skipped, so an interrupted run costs nothing to repeat.
//
// What the fetched file is, stated plainly because it matters for every checksum downstream: it is
// the SAME derivative the family's browser receives from app/api/media/[id] (max 1280px, webp), not
// the archived original. Its bytes therefore do NOT hash to media_assets.checksum. Both identities
// are recorded — `originalChecksum` from the ledger and `derivativeSha256` computed here — and the
// two must never be conflated when reporting "the file matches".
//
// Usage: node scripts/month-media-prefetch.mjs --ledger=<ledger.json> --cache=<dir> [--variant=web] [--concurrency=6]
//        [--admitted-only]
//
// --admitted-only fetches only candidates that pass the admission gates (month-admission.mjs): the
// others will never be shown or sent to the model, so their bytes are not needed.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { admissionGate } from "./month-admission.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const ledgerPath = arg("ledger");
const cacheDir = arg("cache");
const variant = arg("variant", "web");
const concurrency = Number(arg("concurrency", "6"));
const origin = arg("origin", "https://nianlife.cn");
if (!ledgerPath || !cacheDir) {
  console.error("--ledger=<ledger.json> and --cache=<dir> are required");
  process.exit(1);
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
fs.mkdirSync(cacheDir, { recursive: true });

const safeName = (mediaId) => mediaId.replace(/[^a-zA-Z0-9]+/g, "_");
const manifestPath = path.join(cacheDir, "_manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};

const admittedOnly = process.argv.includes("--admitted-only");
const todo = ledger.candidates.filter((c) => {
  if (admittedOnly && admissionGate(c) !== "admissible") return false;
  const entry = manifest[c.mediaId];
  return !(entry && fs.existsSync(path.join(cacheDir, entry.file)));
});
console.log(`${ledger.candidates.length} in ledger, ${todo.length} to fetch (variant=${variant})`);

let done = 0;
let failed = 0;
const failures = [];

async function fetchOne(candidate) {
  const url = `${origin}/api/media/${encodeURIComponent(candidate.mediaId)}?variant=${variant}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        if (attempt === 3) throw new Error(`HTTP ${response.status}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const type = response.headers.get("content-type") ?? "";
      const ext = type.includes("webp") ? "webp" : type.includes("png") ? "png" : type.includes("jpeg") ? "jpg" : "bin";
      const file = `${safeName(candidate.mediaId)}.${ext}`;
      fs.writeFileSync(path.join(cacheDir, file), buffer);
      manifest[candidate.mediaId] = {
        file,
        variant,
        contentType: type,
        bytes: buffer.length,
        derivativeSha256: createHash("sha256").update(buffer).digest("hex"),
        originalChecksum: candidate.checksum ?? null,
        day: candidate.day,
        fetchedAt: new Date().toISOString(),
      };
      done += 1;
      return;
    } catch (error) {
      if (attempt === 3) {
        failed += 1;
        failures.push({ mediaId: candidate.mediaId, day: candidate.day, error: String(error.message ?? error) });
      }
    }
  }
}

for (let i = 0; i < todo.length; i += concurrency) {
  await Promise.all(todo.slice(i, i + concurrency).map(fetchOne));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  if ((i / concurrency) % 5 === 0) console.log(`  ${done + failed}/${todo.length} (${failed} failed)`);
  if (failed >= 30) {
    console.error("STOP: 30 failures, aborting rather than half-filling the cache");
    break;
  }
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
if (failures.length) fs.writeFileSync(path.join(cacheDir, "_failures.json"), JSON.stringify(failures, null, 1));
console.log(`fetched ${done}, failed ${failed}, cache now holds ${Object.keys(manifest).length} files`);
