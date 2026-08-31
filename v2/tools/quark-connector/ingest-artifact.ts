// Local ingestion CLI for official Quark search-artifact JSONL files.
//
// This script never spawns the quark CLI, never calls login/get-user-info/search, and never
// reads a WorkBuddy config file. WorkBuddy is the only real CLI executor; this script only
// consumes the JSONL artifact path it produces and submits mapped metadata to the Nianlife
// ingestion API. Defaults to --dry-run; a real write requires the explicit --commit flag.
import { toQuarkStructuredError } from "../../lib/ingest/quark";
import { processQuarkArtifactLines, readQuarkArtifactLines, type QuarkArtifactMediaInput } from "../../lib/ingest/quark-artifact";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;
const BATCH_TIMEOUT_MS = 15_000;

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

function clampBatchSize(raw?: string) {
  if (!raw) return DEFAULT_BATCH_SIZE;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new CliUsageError("--batch-size must be a positive integer");
  return Math.min(value, MAX_BATCH_SIZE);
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function summarizeReasons(entries: readonly { reason: string }[]) {
  const counts: Record<string, number> = {};
  for (const entry of entries) counts[entry.reason] = (counts[entry.reason] ?? 0) + 1;
  return counts;
}

type BatchOutcome = { imported: number; updated: number; failed: number; lastErrorCode?: string };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseBatchOutcome(value: unknown, expectedItemCount: number): BatchOutcome | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as { imported?: unknown; updated?: unknown; failed?: unknown; results?: unknown };
  if (!isCount(body.imported) || !isCount(body.updated) || !isCount(body.failed) || !Array.isArray(body.results) || body.results.length !== expectedItemCount) return null;
  const statuses = body.results.map((result) => result && typeof result === "object" && !Array.isArray(result) ? (result as { status?: unknown }).status : undefined);
  if (statuses.some((status) => status !== "imported" && status !== "updated" && status !== "failed")) return null;
  if (body.imported + body.updated + body.failed !== expectedItemCount) return null;
  const failedResult = body.results.find((result) => result && typeof result === "object" && !Array.isArray(result) && (result as { status?: unknown }).status === "failed") as { error?: { code?: unknown } } | undefined;
  const errorCode = typeof failedResult?.error?.code === "string" ? failedResult.error.code : undefined;
  return { imported: body.imported, updated: body.updated, failed: body.failed, lastErrorCode: errorCode };
}

// A network failure or timeout never counts as success; the whole batch is marked failed.
async function submitBatch(url: string, token: string, profileId: string, keyword: string, artifactItemCount: number, batchIndex: number, batchCount: number, invalidCount: number, items: readonly QuarkArtifactMediaInput[]): Promise<BatchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BATCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ profileId, keyword, artifactItemCount, batchIndex, batchCount, invalidCount, items }),
      signal: controller.signal,
    });
    if (!response.ok) return { imported: 0, updated: 0, failed: items.length || 1, lastErrorCode: `HTTP_${response.status}` };
    const body = await response.json().catch(() => null);
    return parseBatchOutcome(body, items.length) ?? { imported: 0, updated: 0, failed: items.length || 1, lastErrorCode: "INVALID_RESPONSE" };
  } catch {
    return { imported: 0, updated: 0, failed: items.length || 1, lastErrorCode: "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const artifactPath = requiredOption("--artifact");
  const keyword = requiredOption("--keyword");
  if (keyword.length > 50) throw new CliUsageError("--keyword must be at most 50 characters");
  const commit = process.argv.includes("--commit");
  if (commit && process.argv.includes("--dry-run")) throw new CliUsageError("--commit and --dry-run cannot be combined");
  const profileId = option("--profile-id")?.trim() || "profile-zhangnian";
  const batchSize = clampBatchSize(option("--batch-size"));

  const lines = await readQuarkArtifactLines(artifactPath);
  const result = processQuarkArtifactLines(lines);
  const skippedByReason = summarizeReasons(result.skipped);
  const invalidCount = result.invalid.length;

  const invalidRows = result.invalid.map(({ line, reason }) => ({ line, reason }));
  process.stdout.write(JSON.stringify({ mode: commit ? "commit" : "dry-run", keyword, total: result.total, candidates: result.imported.length, imported: 0, updated: 0, skipped: result.skipped.length, skippedByReason, invalid: invalidCount, invalidRows, failed: invalidCount }) + "\n");

  if (!commit) {
    process.stdout.write(JSON.stringify({ ok: true, mode: "dry-run", wouldImport: result.imported.length }) + "\n");
    return;
  }

  const ingestionUrl = process.env.NIANLIFE_INGESTION_URL;
  const token = process.env.INGESTION_TOKEN;
  if (!ingestionUrl || !token) throw new CliUsageError("NIANLIFE_INGESTION_URL and INGESTION_TOKEN must be set for --commit");

  let imported = 0, updated = 0, failed = result.invalid.length;
  let lastErrorCode: string | undefined;
  const batches = chunk(result.imported, batchSize);
  if (batches.length === 0) batches.push([]);
  for (const [batchIndex, batch] of batches.entries()) {
    const outcome = await submitBatch(ingestionUrl, token, profileId, keyword, result.total, batchIndex, batches.length, result.invalid.length, batch);
    imported += outcome.imported;
    updated += outcome.updated;
    failed += outcome.failed;
    if (outcome.lastErrorCode) lastErrorCode = outcome.lastErrorCode;
  }

  process.stdout.write(JSON.stringify({ ok: failed === 0, mode: "commit", imported, updated, skipped: result.skipped.length, invalid: result.invalid.length, invalidRows, failed, ...(lastErrorCode ? { lastErrorCode } : {}) }) + "\n");
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  const structured = error instanceof CliUsageError ? { code: "QUARK_ARTIFACT_CLI_USAGE", officialMessage: error.message } : toQuarkStructuredError(error, "ingest-artifact");
  process.stderr.write(JSON.stringify({ ok: false, error: structured }) + "\n");
  process.exitCode = 1;
});
