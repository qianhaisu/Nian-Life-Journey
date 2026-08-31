import { extname } from "node:path";
import { QuarkAdapterError, type QuarkAuthStatus, type QuarkClient, type QuarkFile, type QuarkListPage, type QuarkScope } from "../../lib/ingest/quark";

export type QuarkCliOutputType = "result" | "progress" | "list" | "artifact";

export type QuarkCliOutput = {
  code?: number;
  msg?: string;
  action?: string;
  type: QuarkCliOutputType;
  data: unknown;
};

type ObjectRecord = Record<string, unknown>;

function asRecord(value: unknown): ObjectRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectRecord : undefined;
}

function stringValue(record: ObjectRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function numberValue(record: ObjectRecord, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(number)) return number;
  }
  return undefined;
}

function inferMimeType(filename: string, category: number | undefined) {
  const extension = extname(filename).toLowerCase();
  const byExtension: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic",
    ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".pdf": "application/pdf", ".txt": "text/plain",
  };
  return byExtension[extension] ?? (category === 1 ? "video/*" : category === 3 ? "image/*" : "application/octet-stream");
}

function categoryValue(record: ObjectRecord) {
  const value = record.category ?? record.obj_category;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isInteger(numeric)) return numeric;
    const categoryNames: Record<string, number> = { 文件夹: 0, 视频: 1, 音频: 2, 图片: 3, 文档: 4, 种子: 5, 其他: 6, 压缩包: 7, 应用: 8 };
    return categoryNames[value];
  }
  return undefined;
}

function mediaTypeFor(mimeType: string, category: number | undefined): QuarkFile["mediaType"] {
  if (mimeType.startsWith("video/") || category === 1) return "video";
  if (mimeType === "application/pdf" || category === 4) return "document";
  return "photo";
}

export function parseQuarkNdjson(stdout: string): QuarkCliOutput[] {
  const records: QuarkCliOutput[] = [];
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try { value = JSON.parse(trimmed); }
    catch { throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", `Quark CLI returned invalid NDJSON at line ${index + 1}`, { action: "parse", retryable: false }); }
    const record = asRecord(value);
    const type = record?.type;
    if (!record || (type !== undefined && type !== "result" && type !== "progress" && type !== "list" && type !== "artifact")) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", `Quark CLI returned an invalid record at line ${index + 1}`, { action: "parse", retryable: false });
    records.push({ code: typeof record.code === "number" ? record.code : undefined, msg: typeof record.msg === "string" ? record.msg : undefined, action: typeof record.action === "string" ? record.action : undefined, type: (type as QuarkCliOutputType | undefined) ?? "result", data: record.data ?? {} });
  }
  return records;
}

export function mapQuarkSearchItem(value: unknown): QuarkFile | null {
  const record = asRecord(value);
  if (!record) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search returned a non-object file item", { action: "search", retryable: false });
  if (categoryValue(record) === 0) return null;
  const providerRef = stringValue(record, "fid", "fileId", "file_id", "providerRef", "id");
  const filename = stringValue(record, "filename", "fileName", "name");
  if (!providerRef || !filename) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search returned incomplete file metadata", { action: "search", retryable: false });
  const category = categoryValue(record);
  const mimeType = stringValue(record, "mimeType", "mime_type", "contentType", "content_type") ?? inferMimeType(filename, category);
  return { providerRef, filename, mimeType, mediaType: mediaTypeFor(mimeType, category), path: stringValue(record, "path", "full_path", "file_path", "fullPath"), size: numberValue(record, "size", "fileSize", "file_size") };
}

export type QuarkCliAdapterOptions = { sessionInput?: string; sessionId?: string };

const UNSUPPORTED_MESSAGE = "The official Quark CLI is executed by WorkBuddy only; use search-artifact ingestion for private-drive imports";

export class QuarkCliAdapter implements QuarkClient {
  constructor(_options: QuarkCliAdapterOptions = {}) {}

  async list(scope: QuarkScope): Promise<QuarkListPage> {
    const requestedCapability = scope.folder ? "folder browsing" : scope.cursor ? "cursor pagination" : "CLI search/list execution";
    throw new QuarkAdapterError("QUARK_CAPABILITY_UNSUPPORTED", `Quark ${requestedCapability} is unsupported in the project runtime. ${UNSUPPORTED_MESSAGE}`, { action: "search", retryable: false });
  }

  async download(_providerRef: string): Promise<Uint8Array> {
    throw new QuarkAdapterError("QUARK_CAPABILITY_UNSUPPORTED", `Quark file download is outside the WorkBuddy artifact ingestion boundary. ${UNSUPPORTED_MESSAGE}`, { action: "read-file", retryable: false });
  }

  async checkAuth(): Promise<QuarkAuthStatus> {
    return { status: "unsupported", code: "QUARK_CAPABILITY_UNSUPPORTED", message: UNSUPPORTED_MESSAGE };
  }
}
