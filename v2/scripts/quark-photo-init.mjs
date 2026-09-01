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

process.env.REPOSITORY_BACKEND = "postgres";
if (!process.env.DATABASE_URL) fail("DATABASE_URL is required (postgres backend)");
if (process.env.MEDIA_STORAGE_PROVIDER !== "r2") fail("MEDIA_STORAGE_PROVIDER must be r2 so originals/derivatives land in permanent storage, not local disk");
if (!process.env.GEMINI_API_KEY || !process.env.AI_MODEL) fail("GEMINI_API_KEY and AI_MODEL are required for the real Gemini V2 Organizer path");
process.env.MEMORY_ORGANIZER = "ai";
process.env.AI_ORGANIZER_ENABLED = "true";
process.env.AI_PROVIDER = "gemini";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const ARTIFACT_DIR = path.resolve(__dirname, "../../.github/skills/quarkclouddrive/workbuddy/storage/quark-photo-prep-20260831");

const result = await applyQuarkPhotoArtifact({
  artifactDir: ARTIFACT_DIR,
  mode: "apply",
  sourceLabel: "Quark 照片初始化",
  maxGeminiJobs: 20,
});

console.log(JSON.stringify({
  created: result.created.length,
  reused: result.reused.length,
  skipped: result.permanentlySkipped.length,
  failed: result.failed,
  dates: result.dates,
  workerOutcomes: result.workerOutcomes,
}, null, 2));
