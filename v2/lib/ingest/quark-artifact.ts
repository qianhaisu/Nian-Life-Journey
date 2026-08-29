// Pure mapping/validation for official Quark search-artifact JSONL rows (BrowseFileItem).
// This module never spawns the quark CLI, never downloads bytes, and never computes a checksum.
import { lstat, readFile } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { QuarkAdapterError } from "./quark";
import type { MediaType } from "@/lib/types";

export const QUARK_ARTIFACT_MAX_ITEMS = 3000;

// category per official CLI: 0 folder, 1 video, 2 audio, 3 photo, 4 document, 5 torrent, 6 other, 7 archive, 8 app.
const SUPPORTED_CATEGORIES = new Set([1, 3]);

export type QuarkArtifactItem = {
  fid: string;
  parent_fid: string;
  category: number;
  filename: string;
  size?: number;
  file_type: string;
  format_type: string;
  obj_category: string;
  created_at: number;
  updated_at: number;
  file: boolean;
  path: string;
  big_thumbnail?: string;
  check_link?: string;
  includeItems?: number;
};

export type QuarkArtifactSkipReason = "not_file" | "unsupported_category" | "invalid_fields" | "duplicate_in_artifact";

export type QuarkArtifactMediaInput = {
  provider: "quark";
  providerRef: string;
  filename: string;
  mimeType: string;
  mediaType: Extract<MediaType, "photo" | "video">;
  capturedAt: null;
  checksum: null;
  size?: number;
  sourcePath?: string;
  sourceParentRef?: string;
  sourceCreatedAt?: string;
  sourceUpdatedAt?: string;
};

export type QuarkArtifactProcessResult = {
  total: number;
  imported: QuarkArtifactMediaInput[];
  skipped: { line: number; reason: QuarkArtifactSkipReason; fid?: string }[];
  invalid: { line: number; reason: string }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sourceTimestamp(value: number, field: string, lineNumber: number) {
  const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) return invalidLine(lineNumber, `${field} is not a valid timestamp`);
  return date.toISOString();
}

function invalidLine(lineNumber: number, reason: string): never {
  throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", `Quark artifact line ${lineNumber}: ${reason}`, { action: "ingest-artifact", retryable: false });
}

export function parseQuarkArtifactLine(line: string, lineNumber: number): unknown {
  try { return JSON.parse(line); }
  catch { return invalidLine(lineNumber, "not valid JSON"); }
}

export async function readQuarkArtifactLines(artifactPath: string): Promise<string[]> {
  if (!isAbsolute(artifactPath)) throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", "Quark artifact path must be absolute", { action: "read-artifact", retryable: false });
  if (artifactPath.split(/[\\/]/).includes("..")) throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", "Quark artifact path must not contain traversal segments", { action: "read-artifact", retryable: false });
  if (basename(artifactPath).toLowerCase() === "config.json") throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", "Quark artifact path is not an artifact file", { action: "read-artifact", retryable: false });
  if (extname(artifactPath).toLowerCase() !== ".jsonl") throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", "Quark artifact path must point to a .jsonl file", { action: "read-artifact", retryable: false });
  let stats;
  try { stats = await lstat(artifactPath); }
  catch { throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", "Quark artifact file does not exist", { action: "read-artifact", retryable: false }); }
  if (stats.isSymbolicLink()) throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", "Quark artifact file must not be a symbolic link", { action: "read-artifact", retryable: false });
  if (!stats.isFile()) throw new QuarkAdapterError("QUARK_ARTIFACT_INVALID", "Quark artifact path must be a regular file", { action: "read-artifact", retryable: false });
  return (await readFile(artifactPath, "utf8")).split(/\r?\n/);
}

function validOptionalNumber(value: unknown, field: string, lineNumber: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isSafeInteger(value)) return invalidLine(lineNumber, `${field} is invalid`);
  return value;
}

export function validateQuarkArtifactItem(value: unknown, lineNumber: number): QuarkArtifactItem {
  if (!isRecord(value)) return invalidLine(lineNumber, "is not a JSON object");
  if (!isNonEmptyString(value.fid)) return invalidLine(lineNumber, "missing fid");
  if (/[\u0000\r\n]/.test(value.fid) || /(^|[\\/])\.\.(?:$|[\\/])/.test(value.fid)) return invalidLine(lineNumber, "fid is invalid");
  if (!isNonEmptyString(value.filename)) return invalidLine(lineNumber, "missing filename");
  if (/[\u0000\r\n]/.test(value.filename)) return invalidLine(lineNumber, "filename is invalid");
  if (typeof value.category !== "number" || !Number.isInteger(value.category) || value.category < 0 || value.category > 8) return invalidLine(lineNumber, "category is invalid");
  if (typeof value.parent_fid !== "string") return invalidLine(lineNumber, "parent_fid is invalid");
  if (typeof value.file_type !== "string") return invalidLine(lineNumber, "file_type must be a string");
  if (typeof value.file !== "boolean") return invalidLine(lineNumber, "missing file flag");
  if (!isNonEmptyString(value.format_type)) return invalidLine(lineNumber, "missing format_type");
  if (typeof value.obj_category !== "string") return invalidLine(lineNumber, "obj_category is invalid");
  if (typeof value.created_at !== "number" || !Number.isFinite(value.created_at) || value.created_at < 0 || !Number.isSafeInteger(value.created_at)) return invalidLine(lineNumber, "created_at is invalid");
  if (typeof value.updated_at !== "number" || !Number.isFinite(value.updated_at) || value.updated_at < 0 || !Number.isSafeInteger(value.updated_at)) return invalidLine(lineNumber, "updated_at is invalid");
  if (typeof value.path !== "string") return invalidLine(lineNumber, "path is invalid");
  const size = validOptionalNumber(value.size, "size", lineNumber);
  const includeItems = validOptionalNumber(value.includeItems, "includeItems", lineNumber);
  if (value.big_thumbnail !== undefined && typeof value.big_thumbnail !== "string") return invalidLine(lineNumber, "big_thumbnail is invalid");
  if (value.check_link !== undefined && typeof value.check_link !== "string") return invalidLine(lineNumber, "check_link is invalid");
  return {
    fid: value.fid,
    filename: value.filename,
    category: value.category,
    file: value.file,
    format_type: value.format_type,
    parent_fid: value.parent_fid,
    file_type: value.file_type,
    obj_category: value.obj_category,
    created_at: value.created_at,
    updated_at: value.updated_at,
    path: value.path,
    size,
    big_thumbnail: typeof value.big_thumbnail === "string" ? value.big_thumbnail : undefined,
    check_link: typeof value.check_link === "string" ? value.check_link : undefined,
    includeItems,
  };
}

// Never trust the CLI's own --category filtering; re-check locally.
export function classifyArtifactItem(item: QuarkArtifactItem): QuarkArtifactSkipReason | null {
  if (!item.file) return "not_file";
  if (!SUPPORTED_CATEGORIES.has(item.category)) return "unsupported_category";
  if (!item.fid || !item.filename || !item.format_type) return "invalid_fields";
  return null;
}

// big_thumbnail/check_link are intentionally dropped: they may be temporary URLs and must never
// become a permanent MediaLocation. capturedAt/checksum are never populated here (no EXIF, no bytes read).
export function mapArtifactItemToMediaInput(item: QuarkArtifactItem): QuarkArtifactMediaInput {
  return {
    provider: "quark",
    providerRef: item.fid,
    filename: item.filename,
    mimeType: item.format_type,
    mediaType: item.category === 1 ? "video" : "photo",
    capturedAt: null,
    checksum: null,
    size: item.size,
    sourcePath: item.path || undefined,
    sourceParentRef: item.parent_fid || undefined,
    sourceCreatedAt: sourceTimestamp(item.created_at, "created_at", 0),
    sourceUpdatedAt: sourceTimestamp(item.updated_at, "updated_at", 0),
  };
}

export function processQuarkArtifactLines(rawLines: readonly string[]): QuarkArtifactProcessResult {
  const numbered = rawLines.map((line, index) => ({ line: line.trim(), lineNumber: index + 1 })).filter((entry) => entry.line);
  if (numbered.length > QUARK_ARTIFACT_MAX_ITEMS) {
    throw new QuarkAdapterError("QUARK_ARTIFACT_TOO_LARGE", `Quark artifact has ${numbered.length} items, exceeding the maximum of ${QUARK_ARTIFACT_MAX_ITEMS}`, { action: "ingest-artifact", retryable: false });
  }
  const seen = new Set<string>();
  const imported: QuarkArtifactMediaInput[] = [];
  const skipped: QuarkArtifactProcessResult["skipped"] = [];
  const invalid: QuarkArtifactProcessResult["invalid"] = [];
  for (const { line, lineNumber } of numbered) {
    let item: QuarkArtifactItem;
    try {
      item = validateQuarkArtifactItem(parseQuarkArtifactLine(line, lineNumber), lineNumber);
    } catch (error) {
      invalid.push({ line: lineNumber, reason: error instanceof QuarkAdapterError ? error.message.split(": ").slice(1).join(": ") || error.code : "unknown" });
      continue;
    }
    if (seen.has(item.fid)) { skipped.push({ line: lineNumber, reason: "duplicate_in_artifact", fid: item.fid }); continue; }
    seen.add(item.fid);
    const skipReason = classifyArtifactItem(item);
    if (skipReason) { skipped.push({ line: lineNumber, reason: skipReason, fid: item.fid || undefined }); continue; }
    imported.push(mapArtifactItemToMediaInput(item));
  }
  return { total: numbered.length, imported, skipped, invalid };
}
