import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getConnectorState, upsertConnectorState } from "@/lib/db/repository";
import { ingestQuarkArtifactAsset } from "@/lib/ingest/quark-artifact-asset";
import { ingestQuarkFile, toQuarkStructuredError, type QuarkFile } from "@/lib/ingest/quark";
import type { QuarkArtifactMediaInput } from "@/lib/ingest/quark-artifact";
import { kickOrganizerWorker } from "@/lib/organizer/kick";

const ARTIFACT_CONNECTOR_VERSION = "quark-artifact-ingest/0.1";
const MAX_ARTIFACT_BATCH_ITEMS = 200;

function authorized(request: Request) {
  const expected = process.env.INGESTION_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isArtifactItem(value: unknown): value is QuarkArtifactMediaInput {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.provider === "quark" && typeof item.providerRef === "string" && item.providerRef.length > 0 && item.providerRef.length <= 512 && typeof item.filename === "string" && item.filename.length > 0 && typeof item.mimeType === "string" && item.mimeType.length > 0 && (item.mediaType === "photo" || item.mediaType === "video") && item.capturedAt === null && item.checksum === null;
}

type ArtifactBatchMetadata = { keyword?: string; artifactItemCount?: number; batchIndex?: number; batchCount?: number; invalidCount?: number };

function validBatchMetadata(value: ArtifactBatchMetadata | undefined): value is Required<Pick<ArtifactBatchMetadata, "keyword" | "artifactItemCount" | "batchIndex" | "batchCount">> & Pick<ArtifactBatchMetadata, "invalidCount"> {
  if (!value) return false;
  return typeof value.keyword === "string" && value.keyword.trim().length > 0 && value.keyword.length <= 50 && typeof value.artifactItemCount === "number" && Number.isSafeInteger(value.artifactItemCount) && value.artifactItemCount >= 0 && typeof value.batchIndex === "number" && Number.isSafeInteger(value.batchIndex) && value.batchIndex >= 0 && typeof value.batchCount === "number" && Number.isSafeInteger(value.batchCount) && value.batchCount > 0 && value.batchIndex < value.batchCount && (value.invalidCount === undefined || (Number.isSafeInteger(value.invalidCount) && value.invalidCount >= 0));
}

function errorCodeFromResults(results: readonly { status: "imported" | "updated" | "failed"; error?: unknown }[]) {
  const failed = results.find((item) => item.status === "failed");
  if (!failed?.error || typeof failed.error !== "object" || Array.isArray(failed.error)) return undefined;
  const code = (failed.error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function persistArtifactState(profileId: string, metadata: ArtifactBatchMetadata, outcome: { imported: number; updated: number; failed: number; errorCode?: string }) {
  if (!validBatchMetadata(metadata)) return;
  const previous = await getConnectorState("quark", profileId);
  const firstBatch = metadata.batchIndex === 0;
  const importedCount = (firstBatch ? 0 : previous?.importedCount ?? 0) + outcome.imported + outcome.updated;
  const failedCount = (firstBatch ? metadata.invalidCount ?? 0 : previous?.failedCount ?? 0) + outcome.failed;
  const finalBatch = metadata.batchIndex === metadata.batchCount - 1;
  const now = new Date().toISOString();
  await upsertConnectorState({
    id: previous?.id ?? `connector-quark-${profileId}`,
    provider: "quark",
    profileId,
    cursor: previous?.cursor,
    lastSuccessfulSync: finalBatch && failedCount === 0 ? now : previous?.lastSuccessfulSync,
    lastError: failedCount > 0 ? `${failedCount} item(s) failed during quark artifact ingestion` : undefined,
    pendingArchiveCount: previous?.pendingArchiveCount ?? 0,
    scope: { query: metadata.keyword },
    connectorVersion: ARTIFACT_CONNECTOR_VERSION,
    status: finalBatch ? (failedCount > 0 ? "failed" : "connected") : "syncing",
    updatedAt: now,
    lastKeyword: metadata.keyword,
    lastAttemptAt: now,
    lastSuccessfulAt: finalBatch && failedCount === 0 ? now : previous?.lastSuccessfulAt,
    artifactItemCount: metadata.artifactItemCount,
    importedCount,
    failedCount,
    lastErrorCode: outcome.errorCode ?? (failedCount > 0 ? previous?.lastErrorCode : undefined),
  });
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { file?: QuarkFile; items?: unknown[]; profileId?: string; contributorId?: string; visibility?: "private" | "family" | "public"; keyword?: string; artifactItemCount?: number; batchIndex?: number; batchCount?: number; invalidCount?: number };
  try { body = await request.json() as typeof body; }
  catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.profileId) return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  if (Array.isArray(body.items)) {
    if (body.items.length > MAX_ARTIFACT_BATCH_ITEMS) return NextResponse.json({ error: `Artifact batch exceeds the maximum of ${MAX_ARTIFACT_BATCH_ITEMS} items` }, { status: 400 });
    const metadata = { keyword: body.keyword, artifactItemCount: body.artifactItemCount, batchIndex: body.batchIndex, batchCount: body.batchCount, invalidCount: body.invalidCount };
    if (!validBatchMetadata(metadata)) return NextResponse.json({ error: "keyword, artifactItemCount, batchIndex and batchCount are required for artifact ingestion" }, { status: 400 });
    if (body.items.length === 0 && (metadata.batchIndex !== 0 || metadata.batchCount !== 1)) return NextResponse.json({ error: "Empty artifact batches are only valid as a single finalization batch" }, { status: 400 });
    const results: { providerRef?: string; status: "imported" | "updated" | "failed"; error?: unknown }[] = [];
    for (const raw of body.items) {
      if (!isArtifactItem(raw)) { results.push({ status: "failed", error: { code: "QUARK_METADATA_INVALID", officialMessage: "Invalid Quark artifact item metadata" } }); continue; }
      try {
        const result = await ingestQuarkArtifactAsset(raw, { profileId: body.profileId });
        results.push({ providerRef: result.providerRef, status: result.created ? "imported" : "updated" });
      } catch (error) {
        results.push({ providerRef: raw.providerRef, status: "failed", error: toQuarkStructuredError(error, "ingest-artifact") });
      }
    }
    const imported = results.filter((item) => item.status === "imported").length;
    const updated = results.filter((item) => item.status === "updated").length;
    const failed = results.filter((item) => item.status === "failed").length;
    const errorCode = errorCodeFromResults(results);
    try { await persistArtifactState(body.profileId, metadata, { imported, updated, failed, errorCode }); }
    catch { return NextResponse.json({ error: { code: "QUARK_COMMAND_FAILED", officialMessage: "Quark artifact connector state could not be persisted" } }, { status: 502 }); }
    return NextResponse.json({ imported, updated, failed, results }, { status: 200 });
  }
  if (!body.file || !body.contributorId) return NextResponse.json({ error: "file and contributorId are required" }, { status: 400 });
  if (typeof body.file.providerRef !== "string" || typeof body.file.filename !== "string" || typeof body.file.mimeType !== "string") return NextResponse.json({ error: "Invalid Quark file metadata" }, { status: 400 });
  try {
    const result = await ingestQuarkFile(body.file, { profileId: body.profileId, contributorId: body.contributorId, visibility: body.visibility ?? "family" });
    if (result.jobId) kickOrganizerWorker();
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const structured = toQuarkStructuredError(error, "ingest");
    const status = structured.code === "QUARK_METADATA_INVALID" ? 400 : 502;
    return NextResponse.json({ error: structured }, { status });
  }
}
