#!/usr/bin/env node
// 2026-09-25 夸克全量批次（6,820 条 manifest，5,776 照片 + 1,044 视频）的入库 adapter。
//
// **本轮仅导入照片**（通过 applyQuarkPhotoArtifact 现有流程）。视频、日期存疑、Live Photo 配对留给后续专项。
//
// 照片分流规则（日期可信度）：
//   · takenAt_source === "exif_datetime_original" → 可靠，入库（含 2024 年孕期/新生儿，不设时间下界）
//   · 其他（takenAt_source=quark_l_shot_at、视频、重复内容）→ 写侧文件，不入库
//
// HEIC 处理：本批 5,652/5,676 张照片是 HEIC 格式。
//   系统 sharp/libvips 在 Windows 上无法解码（heif: Decoder plugin generated an error），
//   统一用纯 JS/WASM 的 heic-convert 先转 JPEG，新 sha256 成为入库身份，
//   原始 sha256 存 source_heic_sha256 供追溯。
//   两段式 apply：原生 JPEG 用 DOWNLOADS 目录、HEIC 转换产物用 CONVERTED 目录，
//   分别调用 applyQuarkPhotoArtifact（readVerified 要求 local_path ∈ originalsDir）。
//
// 用法：
//   node --import tsx scripts/quark-history-init-20260925.mjs                       # 干跑
//   node --import tsx scripts/quark-history-init-20260925.mjs --apply [--limit N]   # 写库
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import convert from "heic-convert";
import { applyQuarkPhotoArtifact } from "./quark-photo-apply.mjs";
import { requireQuarkStorageProvider } from "./quark-storage-guard.mjs";
import { closePool } from "../lib/db/client.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(name);

const BATCH_ROOT = path.resolve(option("--batch-root") ?? "C:/Users/teddy/NianlifeOps/quark-history/2026-09-25");
const MANIFEST = option("--manifest") ?? path.join(BATCH_ROOT, "manifests/quark-history-manifest.jsonl");
const DOWNLOADS = path.join(BATCH_ROOT, "downloads");
const CONVERTED = path.join(BATCH_ROOT, "heic-converted");
const OUT = path.join(BATCH_ROOT, "ingest");
const SOURCE_LABEL = "Quark 历史素材 2026-09-25";
const mode = hasFlag("--apply") ? "apply" : "dry-run";
const limit = option("--limit") ? Number(option("--limit")) : undefined;
const concurrency = Number(option("--concurrency") ?? 6);

process.env.REPOSITORY_BACKEND = "postgres";
if (mode === "apply" && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (mode === "apply") requireQuarkStorageProvider();

const rows = (await readFile(MANIFEST, "utf8")).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

// 分流：仅照片（takenAt_source=exif_datetime_original，不限时间窗口，孕期/新生儿也收录） vs 其他
const photoEligibleRows = rows.filter((r) =>
  r.media_type === "photo" &&
  r.takenAt_source === "exif_datetime_original"
);
const otherRows = rows.filter((r) => !photoEligibleRows.includes(r));

let eligible = photoEligibleRows;
if (limit) eligible = eligible.slice(0, limit);

const isHeic = (row) => /\.(heic|heif)$/i.test(row.download_path ?? "");
const heicRows = eligible.filter(isHeic);
const plainRows = eligible.filter((r) => !isHeic(r));

console.log(JSON.stringify({
  mode,
  manifestRows: rows.length,
  photoEligible: photoEligibleRows.length,
  other: otherRows.length,
  thisRun: eligible.length,
  heicNeedsConvert: heicRows.length,
  plainJpeg: plainRows.length,
  limit: limit ?? "无",
}, null, 1));

await mkdir(OUT, { recursive: true });
const write = (name, list) => writeFile(
  path.join(OUT, name),
  list.map((r) => JSON.stringify(r)).join("\n") + (list.length ? "\n" : ""),
  "utf8"
);

// 写侧文件（不入库的）
await write("excluded-manifest.jsonl", otherRows);

// task-item 构造
const taskItemFor = (row, localPath, sha256, mime, ext, size, extra = {}) => ({
  kind: "photo",
  download_status: "success",
  checksum_duplicate: false,
  date_label: "in_window",
  capture_time: { text: row.takenAt, reliable: true },
  local_path: localPath,
  sha256,
  filename: path.basename(localPath),
  format_type: mime,
  ext,
  size,
  subject_confidence: row.subject_confidence,
  ...extra,
});

// 原生 JPEG/PNG
const plainItems = plainRows.map((row) =>
  taskItemFor(row, row.download_path, row.sha256, row.mime, path.extname(row.download_path), row.byte_size)
);

const plainOut = path.join(OUT, "task-items-plain.jsonl");
const convertedOut = path.join(OUT, "task-items-heic-converted.jsonl");

await writeFile(
  plainOut,
  plainItems.map((i) => JSON.stringify(i)).join("\n") + (plainItems.length ? "\n" : ""),
  "utf8"
);

if (mode !== "apply") {
  // 预演：HEIC 未转换，只列出数量
  await writeFile(convertedOut, "", "utf8");
  console.log("干跑：已写出分流清单；HEIC 转换只在 --apply 时执行");
  console.log(`  plain: ${plainOut}`);
  console.log(`  excluded: ${path.join(OUT, "excluded-manifest.jsonl")}`);
  await closePool().catch(() => {});
  process.exit(0);
}

// Apply 模式：转换 HEIC
const convertOne = async (row) => {
  const buf = await readFile(row.download_path);
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== row.sha256) throw new Error(`sha256 不符: ${row.remote_path_name}`);
  const out = await convert({ buffer: buf, format: "JPEG", quality: 0.92 });
  const newSha = createHash("sha256").update(out).digest("hex");
  const base = path.basename(row.download_path).replace(/\.(heic|heif)$/i, "");
  const outPath = path.join(CONVERTED, row.month ?? "unknown", `${base}-${newSha.slice(0, 12)}.jpg`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, out);
  return taskItemFor(row, outPath, newSha, "image/jpeg", ".jpg", out.byteLength, {
    source_heic_sha256: row.sha256,
    source_heic_path: row.download_path,
  });
};

const convertFailures = [];
const convertedItems = [];

if (heicRows.length) {
  let next = 0, done = 0;
  const lane = async () => {
    while (true) {
      const i = next++;
      if (i >= heicRows.length) return;
      try { convertedItems.push(await convertOne(heicRows[i])); }
      catch (e) {
        convertFailures.push({ name: heicRows[i].remote_path_name, sha256: heicRows[i].sha256, error: String(e.message ?? e) });
      }
      done += 1;
      if (done % 100 === 0 || done === heicRows.length)
        console.log(`  HEIC 转换 ${done}/${heicRows.length}（失败 ${convertFailures.length}）`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, heicRows.length) }, lane));
  await write("heic-convert-failed.jsonl", convertFailures);
}

await writeFile(
  convertedOut,
  convertedItems.map((i) => JSON.stringify(i)).join("\n") + (convertedItems.length ? "\n" : ""),
  "utf8"
);

// 两段式 apply
const summary = {};
for (const [name, items, originalsDir, taskItemsPath] of [
  ["原生JPEG", plainItems, DOWNLOADS, plainOut],
  ["HEIC转JPEG", convertedItems, CONVERTED, convertedOut],
]) {
  if (!items.length) { summary[name] = { eligible: 0 }; continue; }
  const result = await applyQuarkPhotoArtifact({
    taskItemsPath,
    originalsDir,
    mode: "apply",
    sourceLabel: SOURCE_LABEL,
    organize: false,
  });
  summary[name] = {
    eligible: result.eligible,
    created: result.created.length,
    reused: result.reused.length,
    permanentlySkipped: result.permanentlySkipped.length,
    failed: result.failed.length,
  };
  if (result.failed.length) await write(`apply-failed-${name}.jsonl`, result.failed);
}

console.log(JSON.stringify({
  summary,
  heicConvertFailed: convertFailures.length,
  note: "Videos, date-uncertain (100 photos), Live Photo pairing deferred to follow-up",
  out: OUT,
}, null, 1));
await closePool().catch(() => {});
