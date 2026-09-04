// `npm run quark:sync:apply` — apply (or dry-run) a WorkBuddy Quark photo artifact to Nianlife
// storage via the single closed-loop import implementation (scripts/quark-photo-apply.mjs).
//
// This script never spawns the quark CLI and never reads a WorkBuddy config file. It only consumes
// the artifact directory WorkBuddy produces (artifacts/task-items.jsonl + originals/) and, for the
// permanent-skip set, an optional sync-state.json. The QuarkCliAdapter intentionally throws
// QUARK_CAPABILITY_UNSUPPORTED and is left untouched.
//
// Usage:
//   npm run quark:sync:apply -- --artifact <abs-dir> [--dry-run]            # default, never writes
//   npm run quark:sync:apply -- --artifact <abs-dir> --apply                 # real write (postgres + r2 + organizer)
//   npm run quark:sync:apply -- --artifact <abs-dir> --apply --state <sync-state.json> --resume
//
// Idempotency is by SHA-256 (findMediaAssetByChecksum), so --resume is a safe re-run of the same
// artifact after a partial failure — no separate checkpoint is required. Defaults to dry-run; a
// real write requires the explicit --apply flag.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { config as loadDotenv } from "dotenv";

class CliUsageError extends Error {}

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredOption(name: string) {
  const value = option(name)?.trim();
  if (!value) throw new CliUsageError(`Missing required option ${name}`);
  return value;
}

type PermanentSkipRecord = { filename?: string; skip_reason?: string; size?: number };

function asRecord(value: unknown): PermanentSkipRecord {
  const obj = (value ?? {}) as Record<string, unknown>;
  return {
    filename: typeof obj.filename === "string" ? obj.filename : undefined,
    skip_reason: typeof obj.skip_reason === "string" ? obj.skip_reason : undefined,
    size: typeof obj.size === "number" ? obj.size : undefined,
  };
}

// Accepts either a map keyed by sha256 ({ "<sha256>": {skip_reason,size} }) or an array of
// { sha256, skip_reason, size } entries. Returns a Map<sha256, PermanentSkipRecord>.
function parsePermanentSkip(raw: unknown): Map<string, PermanentSkipRecord> {
  const map = new Map<string, PermanentSkipRecord>();
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const item = (entry ?? {}) as { sha256?: unknown; skip_reason?: unknown; size?: unknown; filename?: unknown };
      if (typeof item.sha256 === "string") map.set(item.sha256.toLowerCase(), asRecord(item));
    }
    return map;
  }
  if (raw && typeof raw === "object") {
    for (const [sha256, value] of Object.entries(raw as Record<string, unknown>)) {
      if (/^[0-9a-f]{64}$/i.test(sha256)) map.set(sha256.toLowerCase(), asRecord(value));
    }
    return map;
  }
  throw new CliUsageError("Permanent-skip file must be a JSON object keyed by sha256, or a JSON array of { sha256, ... } entries");
}

async function loadPermanentSkip(statePath?: string, skipPath?: string): Promise<Map<string, PermanentSkipRecord>> {
  const map = new Map<string, PermanentSkipRecord>();
  if (statePath) {
    const state = JSON.parse(await readFile(statePath, "utf8")) as { permanently_skipped?: unknown };
    if (state.permanently_skipped) for (const [sha256, value] of parsePermanentSkip(state.permanently_skipped)) map.set(sha256, value);
  }
  if (skipPath) {
    const direct = JSON.parse(await readFile(skipPath, "utf8"));
    for (const [sha256, value] of parsePermanentSkip(direct)) map.set(sha256, value);
  }
  return map;
}

function requireEnv(name: string) {
  if (!process.env[name]) throw new CliUsageError(`${name} is required for --apply (postgres + r2 + Gemini Organizer)`);
}

async function main() {
  loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

  const artifactDir = requiredOption("--artifact");
  const statePath = option("--state")?.trim() || undefined;
  const skipPath = option("--permanent-skip")?.trim() || undefined;
  const apply = process.argv.includes("--apply");
  const dryRun = process.argv.includes("--dry-run");
  if (apply && dryRun) throw new CliUsageError("--apply and --dry-run cannot be combined");
  const resume = process.argv.includes("--resume");
  const profileId = option("--profile-id")?.trim() || undefined;
  const sourceLabel = option("--source-label")?.trim() || undefined;
  // Off by default, matching the shared core. Ingestion alone gives a photo the `family_photo`
  // source identity that lets it into a month's body; judging the pictures is a separate decision.
  // Without this flag the run enqueues nothing, drains nothing and calls no model.
  const organize = process.argv.includes("--organize");
  const maxGeminiJobsRaw = option("--max-gemini-jobs");
  const maxGeminiJobs = maxGeminiJobsRaw ? Number(maxGeminiJobsRaw) : undefined;
  if (maxGeminiJobs !== undefined && (!Number.isInteger(maxGeminiJobs) || maxGeminiJobs < 1)) throw new CliUsageError("--max-gemini-jobs must be a positive integer");

  // Production guards mirror scripts/quark-photo-init.mjs. The repository backend is resolved at
  // module load, so set REPOSITORY_BACKEND before the shared core imports it.
  process.env.REPOSITORY_BACKEND = "postgres";
  requireEnv("DATABASE_URL");
  if (apply) {
    if (process.env.MEDIA_STORAGE_PROVIDER !== "r2") throw new CliUsageError("MEDIA_STORAGE_PROVIDER must be r2 so originals/derivatives land in permanent storage, not local disk");
    // Configure the AI Organizer only when this run will organize. GEMINI_API_KEY/AI_MODEL are
    // intentionally NOT hard-required here: the shared core (scripts/quark-photo-apply.mjs) fails
    // closed BEFORE any write only if the run would ingest NEW photos that need organizing. A pure
    // no-op apply (all reused/skipped) legitimately needs no key and must be allowed to complete.
    // The provider is no longer pinned to gemini — production runs one provider, configured by the
    // environment (see CLAUDE.md).
    if (organize) {
      process.env.MEMORY_ORGANIZER = "ai";
      process.env.AI_ORGANIZER_ENABLED = "true";
    }
  }

  const permanentSkip = await loadPermanentSkip(statePath, skipPath);

  const { applyQuarkPhotoArtifact } = await import("../../scripts/quark-photo-apply.mjs");
  const result = await applyQuarkPhotoArtifact({
    artifactDir,
    mode: apply ? "apply" : "dry-run",
    permanentSkip,
    ...(profileId ? { profileId } : {}),
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(maxGeminiJobs !== undefined ? { maxGeminiJobs } : {}),
    organize,
  });

  const payload = {
    ok: result.failed.length === 0 && result.workerOutcomes.every((o) => o.ok),
    mode: result.mode,
    organize: result.organize,
    resume,
    total: result.total,
    eligible: result.eligible,
    newCount: result.newCount,
    reusedCount: result.reusedCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    created: result.created.map((r) => ({ filename: r.filename, sha256: r.sha256 })),
    reused: result.reused.map((r) => ({ filename: r.filename, sha256: r.sha256 })),
    permanentlySkipped: result.permanentlySkipped.map((r) => ({ filename: r.filename, sha256: r.sha256, skip_reason: r.skip_reason })),
    failed: result.failed,
    dates: result.dates,
    workerOutcomes: result.workerOutcomes,
  };

  process.stdout.write(JSON.stringify(payload) + "\n");
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const structured = error instanceof CliUsageError ? { code: "QUARK_SYNC_APPLY_USAGE", officialMessage: message } : { code: "QUARK_SYNC_APPLY_FAILED", officialMessage: message };
  process.stderr.write(JSON.stringify({ ok: false, error: structured }) + "\n");
  process.exitCode = 1;
});
