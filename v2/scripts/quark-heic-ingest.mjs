#!/usr/bin/env node
// P1-2b (phase 2): ingest the 1,468 HEIC->JPEG converted photos into
// raw_sources + media_assets + R2. Conversion already done by quark-heic-convert.mjs.
//
// Idempotent via sha256 dedup in applyQuarkPhotoArtifact — safe to re-run after interruption.
// source_label kept as "Quark 历史素材 2026-09-03" to match the 224 non-HEIC rows already in DB.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { writeFile, mkdir } from "node:fs/promises";
import { applyQuarkPhotoArtifact } from "./quark-photo-apply.mjs";
import { closePool } from "../lib/db/client.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }
if (process.env.MEDIA_STORAGE_PROVIDER !== "r2") { console.error("MEDIA_STORAGE_PROVIDER must be r2"); process.exit(1); }

const BATCH_ROOT = "C:/Users/teddy/NianlifeOps/quark-history/2026-09-03";
const TASK_ITEMS = path.join(BATCH_ROOT, "manifests/quark-heic-converted-task-items.jsonl");
const ORIGINALS_DIR = path.join(BATCH_ROOT, "heic-converted");
const FAILED_OUT = path.join(BATCH_ROOT, "manifests/apply-failed-heic-jpeg.jsonl");
const SOURCE_LABEL = "Quark 历史素材 2026-09-03";

let completed = false;
process.on("exit", (code) => {
  if (!completed) {
    console.error(JSON.stringify({ ok: false, error: "QUARK_HEIC_INGEST_EARLY_EXIT", exitCode: code }));
    if (code === 0) process.exitCode = 1;
  }
});

try {
  console.log(`[quark-heic-ingest] starting apply — ${SOURCE_LABEL}`);
  console.log(`  taskItems: ${TASK_ITEMS}`);
  console.log(`  originalsDir: ${ORIGINALS_DIR}`);

  const result = await applyQuarkPhotoArtifact({
    taskItemsPath: TASK_ITEMS,
    originalsDir: ORIGINALS_DIR,
    mode: "apply",
    sourceLabel: SOURCE_LABEL,
    organize: false,
  });

  completed = true;
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify({
    eligible: result.eligible,
    created: result.created.length,
    reused: result.reused.length,
    permanentlySkipped: result.permanentlySkipped.length,
    failed: result.failed.length,
    dates: result.dates.length,
  }, null, 2));

  if (result.failed.length > 0) {
    await mkdir(path.dirname(FAILED_OUT), { recursive: true });
    await writeFile(FAILED_OUT, result.failed.map((f) => JSON.stringify(f)).join("\n") + "\n", "utf8");
    console.log(`${result.failed.length} failed — written to ${FAILED_OUT}`);
  }
} finally {
  await closePool().catch(() => {});
}
