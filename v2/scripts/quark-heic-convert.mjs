#!/usr/bin/env node
// P1-2b: batch-convert the HEIC files this machine's sharp/libvips (vips 8.18.6, libheif 1.23.2)
// cannot decode (see manifests/heic-decode-unsupported.jsonl, produced by quark-history-init.mjs)
// into JPEG using `heic-convert` (a pure-JS/WASM libheif build, independent of the system sharp
// install), so they can go through the existing quark-photo-apply.mjs ingestion path unchanged.
//
// Windows' own decoder (WIC, via .NET BitmapDecoder) opens every sampled file fine, and
// heic-convert (also libheif-based, but a different build/binding) round-trips them correctly too
// -- this confirms the files are NOT corrupted, only this project's sharp binary can't read them.
//
// Converted bytes get a NEW sha256 (they are different bytes: HEIC container -> JPEG container).
// That new sha256 becomes the photo's ingested identity going forward; the original HEIC's sha256
// is preserved in the output manifest as `source_heic_sha256` purely for traceability, never used
// for dedup.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import convert from "heic-convert";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };

const DEFAULT_BATCH_ROOT = "C:/Users/teddy/NianlifeOps/quark-history/2026-09-03";
const batchRoot = path.resolve(option("--batch-root") ?? DEFAULT_BATCH_ROOT);
const inputManifest = option("--input") ?? path.join(batchRoot, "manifests/heic-decode-unsupported.jsonl");
const outDir = option("--out-dir") ?? path.join(batchRoot, "heic-converted");
const outManifest = option("--out-manifest") ?? path.join(batchRoot, "manifests/quark-heic-converted-task-items.jsonl");
const failedOut = option("--failed-out") ?? path.join(batchRoot, "manifests/heic-convert-failed.jsonl");
const concurrency = Number(option("--concurrency") ?? 6);
const quality = Number(option("--quality") ?? 0.92);
const limit = option("--limit") ? Number(option("--limit")) : undefined;

function reliableTakenAtText(row) {
  if (typeof row.takenAt !== "string") return undefined;
  const parsed = Date.parse(`${row.takenAt.replace(" ", "T")}+08:00`);
  return Number.isNaN(parsed) ? undefined : row.takenAt;
}

async function convertOne(row) {
  const takenAtText = reliableTakenAtText(row);
  if (!takenAtText) return { status: "skipped_undated", row };

  const inputBuffer = await readFile(row.download_path);
  const actualSha256 = createHash("sha256").update(inputBuffer).digest("hex");
  if (actualSha256 !== row.sha256) throw new Error(`sha256 mismatch reading source: manifest=${row.sha256} actual=${actualSha256}`);

  const outputBuffer = await convert({ buffer: inputBuffer, format: "JPEG", quality });
  const newSha256 = createHash("sha256").update(outputBuffer).digest("hex");

  const month = row.month ?? takenAtText.slice(0, 7);
  const baseName = path.basename(row.download_path).replace(/\.(heic|heif)$/i, "");
  const outPath = path.join(outDir, month, `${baseName}-${newSha256.slice(0, 12)}.jpg`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, outputBuffer);

  return {
    status: "converted",
    taskItem: {
      kind: "photo",
      download_status: "success",
      checksum_duplicate: false,
      date_label: "in_window",
      capture_time: { text: takenAtText, reliable: true },
      local_path: outPath,
      sha256: newSha256,
      filename: path.basename(outPath),
      format_type: "image/jpeg",
      ext: ".jpg",
      size: outputBuffer.byteLength,
      source_heic_sha256: row.sha256,
      source_heic_path: row.download_path,
    },
  };
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  async function lane() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = { ok: true, value: await worker(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error, item: items[i] };
      }
      done += 1;
      if (done % 50 === 0 || done === items.length) {
        const converted = results.slice(0, i + 1).filter((r) => r?.ok && r.value.status === "converted").length;
        const failed = results.slice(0, i + 1).filter((r) => r && !r.ok).length;
        console.log(`[${done}/${items.length}] 转换成功 ${converted} / 失败 ${failed}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}

async function main() {
  const raw = await readFile(inputManifest, "utf8");
  let rows = raw.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (limit) rows = rows.slice(0, limit);
  console.log(`input: ${inputManifest} (${rows.length} HEIC rows${limit ? `, limited to ${limit}` : ""})`);
  console.log(`concurrency=${concurrency} quality=${quality} outDir=${outDir}`);

  const t0 = Date.now();
  const results = await runPool(rows, convertOne, concurrency);
  const elapsedS = ((Date.now() - t0) / 1000).toFixed(1);

  const converted = results.filter((r) => r.ok && r.value.status === "converted");
  const skippedUndated = results.filter((r) => r.ok && r.value.status === "skipped_undated");
  const failed = results.filter((r) => !r.ok);

  await mkdir(path.dirname(outManifest), { recursive: true });
  await writeFile(outManifest, converted.map((r) => JSON.stringify(r.value.taskItem)).join("\n") + (converted.length ? "\n" : ""), "utf8");

  if (failed.length) {
    await writeFile(failedOut, failed.map((r) => JSON.stringify({
      filename: path.basename(r.item.download_path ?? "unknown"),
      sha256: r.item.sha256,
      download_path: r.item.download_path,
      reason: r.error instanceof Error ? r.error.message : String(r.error),
    })).join("\n") + "\n", "utf8");
  }

  console.log(JSON.stringify({
    total: rows.length,
    converted: converted.length,
    skippedUndated: skippedUndated.length,
    failed: failed.length,
    elapsedSeconds: Number(elapsedS),
    outManifest,
    failedOut: failed.length ? failedOut : undefined,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: { code: "QUARK_HEIC_CONVERT_FAILED", message: error instanceof Error ? error.stack ?? error.message : String(error) } }));
  process.exitCode = 1;
});
