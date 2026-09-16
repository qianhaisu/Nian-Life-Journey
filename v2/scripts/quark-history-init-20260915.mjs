#!/usr/bin/env node
// 2026-09-15 夸克增量批次（WorkBuddy 交付，816 条 / 808 份不同内容）的入库 adapter。
//
// 这里只做「交付方 manifest → task-items.jsonl」的翻译和分流，不复制导入逻辑：
// applyQuarkPhotoArtifact 仍是唯一实现（见 quark-photo-apply.mjs 顶部注释）。
// 沿用 2026-09-03 那批的两段式先例（quark-history-init.mjs + quark-heic-convert.mjs +
// quark-heic-ingest-linux.mjs），因为本机 sharp/libvips（vips 8.18.6 / libheif 1.23.2）
// 读得了 HEIC 元数据却生成不了派生（heif: Decoder plugin generated an error），实测本批仍然如此；
// 而纯 JS/WASM 的 heic-convert 能正常解码。
//
// 日期规则（从严，且不改写交付方的原值）：
//   · 只有 taken_at_confidence === "exif_confirmed" 才算日期可靠，可以归月入库；
//   · 19 条 EXIF 与服务器冲突、109 条完全没有 EXIF 的，一律判 date-uncertain，写侧文件，不入库，
//     不自动归月、不生成 DailyTrace/LifeEvent。服务器时间不作为拍摄时间使用；
//   · 109 条里没有任何一条带有严格匹配的完整文件名时间戳（已核验），所以没有第二来源可依据；
//   · 窗口外 1 条（2014-01-30，早于张年出生）保留在交付批次，不改日期、不删除、不入业务库；
//   · 13 条 duplicate_content_reused 的 download_path 是 null 且交付方未给日期判定，
//     写侧文件保全来源记录；其中 8 条的内容本来就由 downloaded_new 行交付，另 5 条内容只在
//     downloads/_duplicates/ 里（已逐条复算 sha256 核实无误）。
//
// 人物：803 条全是 search_candidate，本脚本不写任何 media_subject_check，不运行 Organizer。
//
// 用法：
//   node --import tsx scripts/quark-history-init-20260915.mjs            预演
//   node --import tsx scripts/quark-history-init-20260915.mjs --apply [--limit N] [--months 2026-09]
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

const BATCH_ROOT = path.resolve(option("--batch-root") ?? "C:/Users/teddy/NianlifeOps/quark-history/2026-09-15");
const MANIFEST = option("--manifest") ?? path.join(BATCH_ROOT, "manifests/quark-history-manifest.jsonl");
const DOWNLOADS = path.join(BATCH_ROOT, "downloads");
const CONVERTED = path.join(BATCH_ROOT, "heic-converted");
const OUT = path.join(BATCH_ROOT, "ingest");
const SOURCE_LABEL = option("--source-label") ?? "Quark 历史素材 2026-09-15";
const BIRTH = "2025-01-03";
const mode = hasFlag("--apply") ? "apply" : "dry-run";
const limit = option("--limit") ? Number(option("--limit")) : undefined;
const monthFilter = option("--months")?.split(",").map((s) => s.trim()).filter(Boolean);
const concurrency = Number(option("--concurrency") ?? 6);

process.env.REPOSITORY_BACKEND = "postgres";
if (mode === "apply" && !process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (postgres backend)");
if (mode === "apply") requireQuarkStorageProvider();

const rows = (await readFile(MANIFEST, "utf8")).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

// 分流
const bucket = { 可靠: [], 日期冲突: [], 无EXIF: [], 窗口外: [], 复用行: [], 非照片: [] };
for (const row of rows) {
  if (row.media_type !== "photo") { bucket.非照片.push(row); continue; }
  if (row.status === "duplicate_content_reused") { bucket.复用行.push(row); continue; }
  if ((row.takenAt ?? "") < BIRTH) { bucket.窗口外.push(row); continue; }
  if (row.taken_at_confidence === "disputed_exif_vs_server") { bucket.日期冲突.push(row); continue; }
  if (row.taken_at_confidence === "exif_confirmed") { bucket.可靠.push(row); continue; }
  bucket.无EXIF.push(row);
}

let eligible = bucket.可靠;
if (monthFilter) eligible = eligible.filter((r) => monthFilter.includes(r.month));
if (limit) eligible = eligible.slice(0, limit);

const isHeic = (row) => /\.(heic|heif)$/i.test(row.download_path ?? "");
const heicRows = eligible.filter(isHeic);
const plainRows = eligible.filter((r) => !isHeic(r));

console.log(JSON.stringify({
  mode, manifest行: rows.length,
  分流: Object.fromEntries(Object.entries(bucket).map(([k, v]) => [k, v.length])),
  本次入库范围: eligible.length, 其中HEIC需转换: heicRows.length, 其中原生JPEG: plainRows.length,
  月份过滤: monthFilter ?? "全部", limit: limit ?? "无",
}, null, 1));

await mkdir(OUT, { recursive: true });
const write = (name, list) => writeFile(path.join(OUT, name), list.map((r) => JSON.stringify(r)).join("\n") + (list.length ? "\n" : ""), "utf8");
await write("date-uncertain-disputed.jsonl", bucket.日期冲突);
await write("date-uncertain-no-exif.jsonl", bucket.无EXIF);
await write("out-of-window.jsonl", bucket.窗口外);
await write("reused-source-records.jsonl", bucket.复用行);

// task-items：原生 JPEG 直接引用交付文件
const taskItemFor = (row, localPath, sha256, mime, ext, size) => ({
  kind: "photo", download_status: "success", checksum_duplicate: false, date_label: "in_window",
  capture_time: { text: row.takenAt, reliable: true },
  local_path: localPath, sha256, filename: path.basename(localPath),
  format_type: mime, ext, size,
  quark_stable_id: row.remote_ref_id_stable,
  subject_confidence: row.subject_confidence,
});

const plainItems = plainRows.map((row) => taskItemFor(row, row.download_path, row.sha256, row.mime, path.extname(row.download_path), row.byte_size));

// HEIC：用 heic-convert（纯 JS/WASM libheif，独立于系统 sharp）转 JPEG。
// 转换产生新的 sha256，它成为这张照片入库后的身份；原 HEIC 与其 sha256 原封不动留在交付批次，
// 仅作追溯记录在 source_heic_sha256 里，绝不用于去重。
const convertOne = async (row) => {
  const buf = await readFile(row.download_path);
  const actual = createHash("sha256").update(buf).digest("hex");
  if (actual !== row.sha256) throw new Error(`原件哈希与 manifest 不符: ${row.remote_path_name}`);
  const out = await convert({ buffer: buf, format: "JPEG", quality: 0.92 });
  const newSha = createHash("sha256").update(out).digest("hex");
  const base = path.basename(row.download_path).replace(/\.(heic|heif)$/i, "");
  const outPath = path.join(CONVERTED, row.month, `${base}-${newSha.slice(0, 12)}.jpg`);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, out);
  return { ...taskItemFor(row, outPath, newSha, "image/jpeg", ".jpg", out.byteLength),
    source_heic_sha256: row.sha256, source_heic_path: row.download_path };
};

const convertFailures = [];
const convertedItems = [];
if (mode === "apply" && heicRows.length) {
  let next = 0, done = 0;
  const lane = async () => {
    while (true) {
      const i = next++;
      if (i >= heicRows.length) return;
      try { convertedItems.push(await convertOne(heicRows[i])); }
      catch (error) { convertFailures.push({ name: heicRows[i].remote_path_name, sha256: heicRows[i].sha256, error: String(error.message ?? error) }); }
      done += 1;
      if (done % 25 === 0 || done === heicRows.length) console.log(`  HEIC 转换 ${done}/${heicRows.length}（失败 ${convertFailures.length}）`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, heicRows.length) }, lane));
  await write("heic-convert-failed.jsonl", convertFailures);
}

const plainOut = path.join(OUT, "task-items-plain.jsonl");
const convertedOut = path.join(OUT, "task-items-heic-converted.jsonl");
await writeFile(plainOut, plainItems.map((i) => JSON.stringify(i)).join("\n") + (plainItems.length ? "\n" : ""), "utf8");
await writeFile(convertedOut, convertedItems.map((i) => JSON.stringify(i)).join("\n") + (convertedItems.length ? "\n" : ""), "utf8");

if (mode !== "apply") {
  console.log("预演：已写出分流清单与原生 JPEG 的 task-items；HEIC 未转换（转换只在 --apply 时进行）。");
  console.log(`  ${plainOut}`);
  await closePool().catch(() => {});
  process.exit(0);
}

// 两次 apply：readVerified 要求 local_path 位于 originalsDir 之内，交付原件与转换产物在不同目录。
const summary = {};
for (const [name, items, originalsDir, taskItemsPath] of [
  ["原生JPEG", plainItems, DOWNLOADS, plainOut],
  ["HEIC转JPEG", convertedItems, CONVERTED, convertedOut],
]) {
  if (!items.length) { summary[name] = { eligible: 0 }; continue; }
  const result = await applyQuarkPhotoArtifact({ taskItemsPath, originalsDir, mode: "apply", sourceLabel: SOURCE_LABEL, organize: false });
  summary[name] = { eligible: result.eligible, created: result.created.length, reused: result.reused.length,
    permanentlySkipped: result.permanentlySkipped.length, failed: result.failed.length };
  if (result.failed.length) await write(`apply-failed-${name}.jsonl`, result.failed);
}
console.log(JSON.stringify({ summary, heicConvertFailed: convertFailures.length, out: OUT }, null, 1));
await closePool().catch(() => {});
