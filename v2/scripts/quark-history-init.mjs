#!/usr/bin/env node
// One-time closed-loop ingestion of the 2026-09-03 Quark historical-coverage batch: 2,279 files
// staged OUTSIDE the repo under C:\Users\teddy\NianlifeOps\quark-history\2026-09-03\ by a separate,
// read-only WorkBuddy/Quark session (see reports/final-report.md in that directory).
//
// That batch's own manifest (manifests/quark-history-manifest.jsonl) uses a different schema than
// the task-items.jsonl shape scripts/quark-photo-apply.mjs expects. This script adapts one to the
// other -- it does NOT duplicate the import logic itself (applyQuarkPhotoArtifact remains the only
// implementation; see the comment at the top of quark-photo-apply.mjs).
//
// Scope of this pass, deliberately narrow:
//   - PHOTOS ONLY. The shared apply core (sourceImageMetadata/createDerivatives) has no video
//     handling (no duration/poster/codec logic) -- ingesting a video through it would silently
//     mistreat it as a still image. Quark video playback is a separate, not-yet-built P1 item.
//   - A photo is ingested only when the manifest itself recorded a real, parseable `takenAt`. A
//     photo the manifest could not date is written to --undated-out instead of being ingested with
//     a fabricated date (nianlife-product-principles.md 二: no invented timestamps). This is a
//     STRICTER count than the manifest's own "307 date-uncertain" folder: 31 more photos have a
//     folder-guessed `month` (from the filename) but no `takenAt` the manifest itself trusted enough
//     to parse, so they are undated here too -- see this script's own printed counts, not the
//     report's 307, for the true split.
//   - --organize is not offered here (ingest-only): a photo's ingestion alone is what gives it
//     `family_photo` source identity, the whole of `trusted` in mediaPrivilegeOf. Judging what any
//     of them mean is a separate, later, model-driven step (Teddy, 2026-09-04).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { applyQuarkPhotoArtifact } from "./quark-photo-apply.mjs";
import { closePool } from "../lib/db/client.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

function fail(message) {
  console.error(message);
  throw new Error(message);
}

async function main() {

const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(name);

// The one batch this script was written for. A later batch is a different task with its own
// manifest shape and should get its own adapter rather than this default silently applying to it.
const DEFAULT_BATCH_ROOT = "C:/Users/teddy/NianlifeOps/quark-history/2026-09-03";
const batchRoot = path.resolve(option("--batch-root") ?? DEFAULT_BATCH_ROOT);
const manifestPath = option("--manifest") ?? path.join(batchRoot, "manifests/quark-history-manifest.jsonl");
const originalsDir = option("--originals-dir") ?? path.join(batchRoot, "downloads");
const undatedOut = option("--undated-out") ?? path.join(batchRoot, "manifests/undated-photos.jsonl");
const taskItemsOut = path.join(batchRoot, "manifests/quark-history-task-items.jsonl");
const sourceLabel = option("--source-label") ?? "Quark 历史素材 2026-09-03";
const mode = hasFlag("--apply") ? "apply" : "dry-run";

process.env.REPOSITORY_BACKEND = "postgres";
if (mode === "apply" && !process.env.DATABASE_URL) fail("DATABASE_URL is required (postgres backend)");
if (mode === "apply" && process.env.MEDIA_STORAGE_PROVIDER !== "r2") fail("MEDIA_STORAGE_PROVIDER must be r2 so originals/derivatives land in permanent storage, not local disk");

function reliableTakenAtText(row) {
  if (typeof row.takenAt !== "string") return undefined;
  // capturedAtIso() in quark-photo-apply.mjs does the exact same parse; validate here up front so
  // an unparseable (e.g. EXIF-corrupted) string is treated as undated rather than throwing mid-run.
  const parsed = Date.parse(`${row.takenAt.replace(" ", "T")}+08:00`);
  return Number.isNaN(parsed) ? undefined : row.takenAt;
}

const raw = await readFile(manifestPath, "utf8");
const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const photos = rows.filter((row) => row.media_type === "photo");
const videos = rows.filter((row) => row.media_type === "video");

const dated = [];
const undated = [];
for (const row of photos) {
  const takenAtText = reliableTakenAtText(row);
  if (takenAtText) dated.push({ row, takenAtText });
  else undated.push(row);
}

const taskItems = dated.map(({ row, takenAtText }) => ({
  kind: "photo",
  download_status: "success",
  checksum_duplicate: false,
  date_label: "in_window",
  capture_time: { text: takenAtText, reliable: true },
  local_path: row.download_path,
  sha256: row.sha256,
  filename: path.basename(row.download_path),
  format_type: row.mime,
  ext: path.extname(row.download_path),
  size: row.byte_size,
}));

await mkdir(path.dirname(undatedOut), { recursive: true });
await writeFile(undatedOut, undated.map((row) => JSON.stringify(row)).join("\n") + (undated.length ? "\n" : ""), "utf8");
await writeFile(taskItemsOut, taskItems.map((item) => JSON.stringify(item)).join("\n") + (taskItems.length ? "\n" : ""), "utf8");

console.log(`manifest: ${manifestPath}`);
console.log(`photos: ${photos.length} total -> ${dated.length} dated (will attempt ingestion), ${undated.length} undated (written to ${undatedOut}, not ingested)`);
console.log(`videos: ${videos.length} (out of scope for this script; no ingestion path yet)`);
console.log(`mode: ${mode}`);

const result = await applyQuarkPhotoArtifact({
  taskItemsPath: taskItemsOut,
  originalsDir,
  mode,
  sourceLabel,
  organize: false,
});

console.log(JSON.stringify({
  eligible: result.eligible,
  created: result.created.length,
  reused: result.reused.length,
  skipped: result.permanentlySkipped.length,
  failedCount: result.failed.length,
  dateCount: result.dates.length,
}, null, 2));
if (result.failed.length) {
  const failedOut = path.join(batchRoot, "manifests", mode === "apply" ? "apply-failed.jsonl" : "dry-run-failed.jsonl");
  await writeFile(failedOut, result.failed.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  console.log(`${result.failed.length} item(s) failed -- written to ${failedOut}`);
}

}

let completed = false;
process.on("exit", (code) => {
  if (!completed) {
    // This catches an otherwise clean early process exit (for example, an unsettled top-level
    // operation with no live handles). SIGKILL/native aborts cannot run JavaScript handlers.
    console.error(JSON.stringify({ ok: false, error: { code: "QUARK_HISTORY_INIT_EARLY_EXIT", message: `process exited before importer summary (exit ${code})` } }));
    if (code === 0) process.exitCode = 1;
  }
});

try {
  await main();
  completed = true;
} catch (error) {
  // This is intentionally outside the per-item boundary in the shared core.  It makes every
  // adapter/preflight/pool failure observable and non-zero instead of leaving a background job
  // with only its startup banner.
  console.error(JSON.stringify({ ok: false, error: { code: "QUARK_HISTORY_INIT_FAILED", message: error instanceof Error ? error.stack ?? error.message : String(error) } }));
  process.exitCode = 1;
} finally {
  try {
    await closePool();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: { code: "QUARK_HISTORY_POOL_CLOSE_FAILED", message: error instanceof Error ? error.message : String(error) } }));
    process.exitCode = 1;
  }
}
