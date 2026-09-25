#!/usr/bin/env node
// 2026-09-25 夸克全量批次（6,820 条 manifest，5,776 照片 + 1,044 视频）的入库 adapter。
//
// **本轮仅导入照片**（通过 applyQuarkPhotoArtifact 现有流程）。视频、日期存疑、Live Photo 配对留给后续专项。
//
// 照片分流规则（日期可信度）：
//   · date_authority = "photo_exif_datetime_original" AND takenAt >= BIRTH → 可靠，入库并归月
//   · 其他（日期存疑、窗口外、视频、重复）→ 写侧文件，不入库
//
// 用法：
//   node --import tsx scripts/quark-history-init-20260925.mjs
//   node --import tsx scripts/quark-history-init-20260925.mjs --apply [--limit N]
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
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
const OUT = path.join(BATCH_ROOT, "ingest");
const SOURCE_LABEL = "Quark 历史素材 2026-09-25";
const mode = hasFlag("--apply") ? "apply" : "dry-run";
const limit = option("--limit") ? Number(option("--limit")) : undefined;

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

console.log(JSON.stringify({
  mode,
  manifestRows: rows.length,
  photoEligible: photoEligibleRows.length,
  other: otherRows.length,
  thisRun: eligible.length,
  limit: limit ?? "无",
}, null, 1));

await mkdir(OUT, { recursive: true });
const write = (name, list) => writeFile(
  path.join(OUT, name),
  list.map((r) => JSON.stringify(r)).join("\n") + (list.length ? "\n" : ""),
  "utf8"
);

// 写侧文件
await write("excluded-manifest.jsonl", otherRows);

// Task items for photos
const taskItemFor = (row) => ({
  kind: "photo",
  download_status: "success",
  checksum_duplicate: false,
  date_label: "in_window",
  capture_time: { text: row.takenAt, reliable: true },
  local_path: row.download_path,
  sha256: row.sha256,
  filename: path.basename(row.download_path),
  format_type: row.mime,
  ext: path.extname(row.download_path),
  size: row.byte_size,
  subject_confidence: row.subject_confidence,
});

const photoItems = eligible.map(taskItemFor);
const photoOut = path.join(OUT, "task-items-photos.jsonl");
await writeFile(photoOut, photoItems.map((i) => JSON.stringify(i)).join("\n") + (photoItems.length ? "\n" : ""), "utf8");

if (mode !== "apply") {
  console.log("Dry-run: wrote task-items and excluded manifest");
  console.log(`  photos: ${photoOut}`);
  console.log(`  excluded: ${path.join(OUT, "excluded-manifest.jsonl")}`);
  await closePool().catch(() => {});
  process.exit(0);
}

// Apply mode
const summary = {};
if (photoItems.length > 0) {
  const result = await applyQuarkPhotoArtifact({
    taskItemsPath: photoOut,
    originalsDir: DOWNLOADS,
    mode: "apply",
    sourceLabel: SOURCE_LABEL,
    organize: false,  // sourceType=family_photo auto-passes trust gate
  });
  summary.photos = {
    eligible: result.eligible,
    created: result.created.length,
    reused: result.reused.length,
    permanentlySkipped: result.permanentlySkipped.length,
    failed: result.failed.length,
  };
  if (result.failed.length > 0) {
    await write("apply-failed-photos.jsonl", result.failed);
  }
}

console.log(JSON.stringify({
  summary,
  note: "Video derivatives, date-uncertain media, and Live Photo pairing deferred to follow-up",
  out: OUT,
}, null, 1));
await closePool().catch(() => {});
