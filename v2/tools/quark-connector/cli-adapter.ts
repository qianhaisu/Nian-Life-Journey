import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  QuarkAdapterError,
  type QuarkAuthStatus,
  type QuarkClient,
  type QuarkFile,
  type QuarkListPage,
  type QuarkScope,
  toQuarkStructuredError,
} from "../../lib/ingest/quark";

export type QuarkCliOutputType = "result" | "progress" | "list" | "artifact";

export type QuarkCliOutput = {
  code?: number;
  msg?: string;
  action?: string;
  type: QuarkCliOutputType;
  data: unknown;
};

export type QuarkCliExecution = { stdout: string; stderr: string; exitCode: number };
export type QuarkCliRunner = (command: string, args: readonly string[]) => Promise<QuarkCliExecution>;

export type QuarkCliRunnerOptions = {
  nodePath?: string;
  scriptPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
};

export type QuarkCliAdapterOptions = {
  runner?: QuarkCliRunner;
  sessionInput?: string;
  sessionId?: string;
  readRoot?: string;
  artifactRoot?: string;
  searchSize?: number;
};

type ObjectRecord = Record<string, unknown>;
type ParsedCommand = { result: QuarkCliOutput; records: QuarkCliOutput[] };

const AUTH_MESSAGE_PATTERN = /auth|oauth|token|unauthor|forbidden|expired|授权|认证|未授权/i;
const AGENT_UNSUPPORTED_PATTERN = /无法识别当前 Agent 环境|禁止继续使用|unsupported.*agent/i;
const SEARCH_SIZE = 3000;

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

function dateValue(record: ObjectRecord, ...keys: string[]) {
  const value = numberValue(record, ...keys) ?? stringValue(record, ...keys);
  if (value === undefined) return undefined;
  const numeric = typeof value === "number" ? value : /^\d+$/.test(value) ? Number(value) : undefined;
  const date = numeric === undefined ? new Date(value) : new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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

function assertProviderRef(providerRef: string, action: string) {
  if (!providerRef || providerRef.length > 512 || /(^|[\\/])\.\.($|[\\/])|[\u0000\r\n]/.test(providerRef)) throw new QuarkAdapterError("QUARK_METADATA_INVALID", "Quark providerRef is invalid", { action });
}

function defaultScriptPath() {
  const candidate = join(homedir(), ".copilot", "skills", "quarkclouddrive", "scripts", "quark-drive.cjs");
  return existsSync(candidate) ? candidate : undefined;
}

function defaultReadRoot() {
  const configuredRoot = process.env.QUARK_CLI_READ_ROOT;
  if (configuredRoot) return configuredRoot;
  const runtimeRoot = process.env.OPENCLAW_RUNTIME_DIR;
  return runtimeRoot ? join(runtimeRoot, ".quarkclouddrive") : join(process.cwd(), ".quarkclouddrive");
}

function defaultArtifactRoot() {
  return process.env.QUARK_CLI_ARTIFACT_ROOT ?? join(homedir(), ".copilot", "skills", "quarkclouddrive", "scripts", "search-results");
}

function isWithinDirectory(rootPath: string, targetPath: string) {
  const targetRelative = relative(rootPath, targetPath);
  return Boolean(targetRelative) && targetRelative !== ".." && !targetRelative.startsWith(`..${targetRelative.includes("\\") ? "\\" : "/"}`) && !isAbsolute(targetRelative);
}

export function createQuarkSessionId() {
  return `${Math.floor(Date.now() / 1000)}-${randomBytes(3).toString("hex")}`;
}

export function createQuarkCliRunner(options: QuarkCliRunnerOptions = {}): QuarkCliRunner {
  const nodePath = options.nodePath ?? process.env.QUARK_CLI_NODE ?? process.execPath;
  const scriptPath = options.scriptPath ?? process.env.QUARK_CLI_SCRIPT ?? defaultScriptPath();
  const maxOutputBytes = options.maxOutputBytes ?? 8 * 1024 * 1024;

  return async (command, args) => {
    if (!scriptPath) throw new QuarkAdapterError("QUARK_CLI_UNAVAILABLE", "Quark CLI script is not configured", { action: command, retryable: false });
    return await new Promise<QuarkCliExecution>((resolveExecution, rejectExecution) => {
      const child = spawn(nodePath, [scriptPath, command, ...args], { cwd: options.cwd, env: { ...process.env, ...options.env }, shell: false, stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      const rejectOnce = (error: Error) => { if (!settled) { settled = true; rejectExecution(error); } };
      const append = (target: Buffer[], chunk: Buffer) => {
        outputBytes += chunk.byteLength;
        if (outputBytes > maxOutputBytes) {
          child.kill();
          rejectOnce(new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark CLI output exceeded the configured limit", { action: command, retryable: false }));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => append(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => append(stderr, chunk));
      child.once("error", () => rejectOnce(new QuarkAdapterError("QUARK_CLI_UNAVAILABLE", "Quark CLI could not be started", { action: command, retryable: false })));
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        resolveExecution({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode: exitCode ?? 1 });
      });
    });
  };
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

function errorFromCliResult(result: QuarkCliOutput, action: string) {
  const officialMessage = result.msg || "Quark CLI command failed";
  const officialCode = result.code;
  const unsupported = officialCode === -104 || AGENT_UNSUPPORTED_PATTERN.test(officialMessage);
  const authRequired = unsupported || AUTH_MESSAGE_PATTERN.test(officialMessage);
  const code = unsupported ? "QUARK_AGENT_UNSUPPORTED" : authRequired ? "QUARK_AUTH_REQUIRED" : "QUARK_COMMAND_FAILED";
  return new QuarkAdapterError(code, officialMessage, { officialCode, action: result.action || action, retryable: !authRequired });
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
  const file: QuarkFile = {
    providerRef,
    filename,
    mimeType,
    mediaType: mediaTypeFor(mimeType, category),
  };
  const optional = {
    path: stringValue(record, "path", "full_path", "file_path", "fullPath"),
    size: numberValue(record, "size", "fileSize", "file_size"),
    takenAt: dateValue(record, "taken_at", "takenAt", "created_at", "createdAt", "updated_at", "updatedAt"),
    checksum: stringValue(record, "sha256", "checksum", "hash"),
    width: numberValue(record, "width", "image_width"),
    height: numberValue(record, "height", "image_height"),
    durationSeconds: numberValue(record, "durationSeconds", "duration_seconds", "duration"),
  };
  for (const [key, value] of Object.entries(optional)) if (value !== undefined) Object.assign(file, { [key]: value });
  return file;
}

export class QuarkCliAdapter implements QuarkClient {
  private readonly runner: QuarkCliRunner;
  private readonly sessionInput: string;
  private readonly sessionId: string;
  private readonly readRoot: string;
  private readonly artifactRoot: string;
  private readonly searchSize: number;

  constructor(options: QuarkCliAdapterOptions = {}) {
    this.runner = options.runner ?? createQuarkCliRunner();
    this.sessionInput = options.sessionInput ?? "Nian Life V2 Quark connector sync";
    this.sessionId = options.sessionId ?? createQuarkSessionId();
    this.readRoot = options.readRoot ?? defaultReadRoot();
    this.artifactRoot = options.artifactRoot ?? defaultArtifactRoot();
    this.searchSize = options.searchSize ?? SEARCH_SIZE;
    if (!Number.isInteger(this.searchSize) || this.searchSize < 1 || this.searchSize > SEARCH_SIZE) throw new QuarkAdapterError("QUARK_SCOPE_LIMIT", `Quark search size must be between 1 and ${SEARCH_SIZE}`, { action: "search" });
  }

  async list(scope: QuarkScope): Promise<QuarkListPage> {
    if (scope.cursor) throw new QuarkAdapterError("QUARK_PAGINATION_UNSUPPORTED", "The official Quark search command does not support pagination", { action: "search", retryable: false });
    if (scope.folder || scope.from || scope.to) throw new QuarkAdapterError("QUARK_SCOPE_UNSUPPORTED", "The official Quark search command supports keyword scope only", { action: "search", retryable: false });
    const query = scope.query?.trim();
    if (!query) throw new QuarkAdapterError("QUARK_SCOPE_REQUIRED", "Quark sync requires a keyword query", { action: "search", retryable: false });
    if (query.length > 50) throw new QuarkAdapterError("QUARK_SCOPE_LIMIT", "Quark search keywords must be at most 50 characters", { action: "search", retryable: false });
    const response = await this.execute("search", ["--keyword", query, "--size", String(this.searchSize), "--stdout-only"]);
    const data = asRecord(response.result.data);
    const fileList = data?.file_list;
    if (!Array.isArray(fileList)) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search result did not contain file_list", { action: "search", retryable: false });
    const artifact = response.records.find((record) => record.type === "artifact");
    const artifactData = asRecord(artifact?.data);
    const artifactPath = stringValue(artifactData ?? {}, "file_path", "filePath");
    const items = artifactPath ? await this.readSearchArtifact(artifactPath) : response.records.filter((record) => record.type === "list").map((record) => record.data).concat(fileList);
    const files = [...new Map(items.map(mapQuarkSearchItem).filter((file): file is QuarkFile => Boolean(file)).map((file) => [file.providerRef, file])).values()];
    return { files };
  }

  async download(providerRef: string): Promise<Uint8Array> {
    assertProviderRef(providerRef, "read-file");
    const response = await this.execute("read-file", ["--fid", providerRef]);
    const data = asRecord(response.result.data);
    const files = Array.isArray(data?.files) ? data.files : [];
    const listItems = response.records.filter((record) => record.type === "list").map((record) => record.data);
    const item = [...files, ...listItems].map(asRecord).find((record) => record && (stringValue(record, "fid", "fileId", "file_id") === providerRef || files.length === 1));
    const success = item?.success;
    if (success === false || (typeof data?.failCount === "number" && data.failCount > 0)) {
      const failed = response.records.find((record) => record.type === "list" && record.code !== undefined && record.code !== 0);
      throw new QuarkAdapterError("QUARK_DOWNLOAD_FAILED", failed?.msg || "Quark file read failed", { officialCode: failed?.code, action: "read-file", retryable: true });
    }
    const filePath = item ? stringValue(item, "filePath", "file_path") : undefined;
    if (!filePath || !isAbsolute(filePath)) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark read-file returned an unsafe file path", { action: "read-file", retryable: false });
    const rootPath = await realpath(resolve(this.readRoot)).catch(() => { throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark read-file root is unavailable", { action: "read-file", retryable: false }); });
    if (!isWithinDirectory(rootPath, resolve(filePath))) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark read-file returned a path outside its runtime directory", { action: "read-file", retryable: false });
    const targetPath = await realpath(filePath).catch(() => { throw new QuarkAdapterError("QUARK_DOWNLOAD_FAILED", "Quark read-file output is unavailable", { action: "read-file", retryable: true }); });
    if (!isWithinDirectory(rootPath, targetPath)) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark read-file returned a path outside its runtime directory", { action: "read-file", retryable: false });
    try { return new Uint8Array(await readFile(targetPath)); }
    catch (error) { throw new QuarkAdapterError("QUARK_DOWNLOAD_FAILED", error instanceof Error ? error.message : String(error), { action: "read-file", retryable: true }); }
    finally { await rm(targetPath, { force: true }); }
  }

  async checkAuth(): Promise<QuarkAuthStatus> {
    try {
      await this.execute("get-user-info", []);
      return { status: "connected", message: "Quark authorization is available" };
    } catch (error) {
      const structured = toQuarkStructuredError(error, "get-user-info");
      const status = structured.code === "QUARK_AGENT_UNSUPPORTED" ? "unsupported" : structured.code === "QUARK_AUTH_REQUIRED" ? "auth_required" : "unavailable";
      return { status, code: structured.code, officialCode: structured.officialCode, officialMessage: structured.officialMessage, message: structured.officialMessage };
    }
  }

  private async execute(command: string, args: readonly string[]): Promise<ParsedCommand> {
    let execution: QuarkCliExecution;
    try {
      execution = await this.runner(command, [...args, "--session-input", this.sessionInput, "--session-id", this.sessionId]);
    } catch (error) {
      if (error instanceof QuarkAdapterError) throw error;
      throw new QuarkAdapterError("QUARK_CLI_UNAVAILABLE", error instanceof Error ? error.message : String(error), { action: command, retryable: false });
    }
    const records = parseQuarkNdjson(execution.stdout);
    const result = [...records].reverse().find((record) => record.type === "result");
    if (!result) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark CLI did not return a result record", { action: command, retryable: false });
    if (result.code !== 0) throw errorFromCliResult(result, command);
    if (execution.exitCode !== 0) throw new QuarkAdapterError("QUARK_COMMAND_FAILED", result.msg || "Quark CLI command failed", { officialCode: result.code, action: command, retryable: true });
    return { result, records };
  }

  private async readSearchArtifact(filePath: string) {
    if (!isAbsolute(filePath)) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search artifact path is not absolute", { action: "search", retryable: false });
    const rootPath = await realpath(resolve(this.artifactRoot)).catch(() => { throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search artifact root is unavailable", { action: "search", retryable: false }); });
    const targetPath = await realpath(filePath).catch(() => { throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search artifact is unavailable", { action: "search", retryable: false }); });
    if (!isWithinDirectory(rootPath, targetPath)) throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search artifact path is outside its runtime directory", { action: "search", retryable: false });
    const content = await readFile(targetPath, "utf8");
    return content.split(/\r?\n/).filter(Boolean).map((line) => {
      try { return JSON.parse(line) as unknown; }
      catch { throw new QuarkAdapterError("QUARK_INVALID_OUTPUT", "Quark search artifact contains invalid JSONL", { action: "search", retryable: false }); }
    });
  }
}
