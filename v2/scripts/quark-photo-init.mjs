#!/usr/bin/env node
// One-time closed-loop ingestion of the quark-photo-prep-20260831 WorkBuddy artifact:
// verified local originals -> re-verified SHA-256 identity -> permanent object storage (R2) ->
// RawSource/Media -> one Organizer job per captured date -> worker drain -> DailyTrace/LifeEvent.
//
// Idempotent by construction: every id (asset/source/media/location) is derived from the file's
// SHA-256, and the checksum/providerRef unique constraints in postgres-repository.ts make re-running
// this script a no-op for already-ingested photos (see persistUpload). Never trusts the local
// WorkBuddy artifact's own checksum claim without recomputing it from the bytes on disk.
//
// The import logic itself lives in scripts/quark-photo-apply.mjs (single implementation shared with
// the `quark:sync:apply` CLI); this script is only the baseline entry point + production guards.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { applyQuarkPhotoArtifact } from "./quark-photo-apply.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

function fail(message) {
  console.error(message);
  process.exit(1);
}

const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(name);

// The baseline artifact this script was written for. Any later WorkBuddy artifact is passed with
// --artifact-dir; hardcoding one directory meant every run after the first quietly did nothing,
// because every photo in it was already ingested.
const DEFAULT_ARTIFACT_DIR = path.resolve(__dirname, "../../.github/skills/quarkclouddrive/workbuddy/storage/quark-photo-prep-20260831");
const artifactDir = path.resolve(option("--artifact-dir") ?? DEFAULT_ARTIFACT_DIR);
const sourceLabel = option("--source-label") ?? "Quark 照片初始化";
// Off by default. Ingestion alone gives a photo its `family_photo` source identity, which is the
// whole of `trusted` in mediaPrivilegeOf and the only condition for it to enter a month's body.
// Deciding what the pictures mean is a later, separate step; with this off the run costs nothing
// and calls no model. Teddy, 2026-09-04.
const organize = hasFlag("--organize");

process.env.REPOSITORY_BACKEND = "postgres";
if (!process.env.DATABASE_URL) fail("DATABASE_URL is required (postgres backend)");
if (process.env.MEDIA_STORAGE_PROVIDER !== "r2") fail("MEDIA_STORAGE_PROVIDER must be r2 so originals/derivatives land in permanent storage, not local disk");
if (organize) {
  // Production runs one provider (DeepSeek, see CLAUDE.md). This no longer forces `gemini` on the
  // process; whatever AI_PROVIDER/AI_MODEL the environment configures is what the drain uses.
  if (!process.env.AI_MODEL) fail("AI_MODEL is required with --organize");
  process.env.MEMORY_ORGANIZER = "ai";
  process.env.AI_ORGANIZER_ENABLED = "true";
}

console.log(`artifact: ${artifactDir}
organize: ${organize ? "yes — Organizer jobs will be enqueued and drained" : "no — ingest only, zero AI calls"}`);

const result = await applyQuarkPhotoArtifact({
  artifactDir,
  mode: "apply",
  sourceLabel,
  organize,
  maxGeminiJobs: Number(option("--max-jobs") ?? 20),
});

console.log(JSON.stringify({
  created: result.created.length,
  reused: result.reused.length,
  skipped: result.permanentlySkipped.length,
  failed: result.failed,
  dates: result.dates,
  workerOutcomes: result.workerOutcomes,
}, null, 2));
