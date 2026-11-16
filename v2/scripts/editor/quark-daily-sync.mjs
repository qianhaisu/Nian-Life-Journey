import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import exifr from "exifr";
import heicConvert from "heic-convert";
import sharp from "sharp";
import { applyQuarkPhotoArtifact } from "../quark-photo-apply.mjs";
import { requireQuarkStorageProvider } from "../quark-storage-guard.mjs";

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const QUARK_CLI = path.join(REPO_ROOT, ".github", "skills", "quarkclouddrive", "scripts", "quark-drive.cjs");

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".avif"]);
const HEIF_EXTS = new Set([".heic", ".heif"]);
const PHONE_SCREEN_RESOLUTIONS = new Set([
  "1320x2868",
  "2868x1320",
  "1179x2556",
  "2556x1179",
  "1290x2796",
  "2796x1290",
  "1170x2532",
  "2532x1170",
  "1284x2778",
  "2778x1284",
  "1206x2622",
  "2622x1206",
]);

function shanghaiToday() {
  return new Date(Date.now() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(day, deltaDays) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

function dayToRangeMs(sinceDay, untilDay) {
  const startMs = Date.parse(`${sinceDay}T00:00:00+08:00`);
  const endMs = Date.parse(`${untilDay}T23:59:59.999+08:00`);
  return { startMs, endMs };
}

export function formatShanghaiMs(ms) {
  return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ");
}

function listMonthsInWindow(sinceDay, untilDay) {
  const out = [];
  let cursor = sinceDay.slice(0, 7);
  const endMonth = untilDay.slice(0, 7);
  while (cursor <= endMonth) {
    out.push(cursor.replace("-", ""));
    const [y, m] = cursor.split("-").map(Number);
    const nextDate = new Date(Date.UTC(y, m, 1));
    cursor = nextDate.toISOString().slice(0, 7);
  }
  return out;
}

function random6() {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

function defaultSessionId() {
  return `${Math.floor(Date.now() / 1000)}-${random6()}`;
}

function assertOutsideRepository(targetPath, label = "--out") {
  const resolved = path.resolve(targetPath);
  const rel = path.relative(REPO_ROOT, resolved);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    throw new Error(`${label} (${resolved}) must be outside the repository (${REPO_ROOT}) to keep staging data and downloads out of git.`);
  }
  return resolved;
}

export function parseQuarkCliArgs(argv) {
  const args = argv.slice();
  const getOpt = (name) => {
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0) {
      const val = args[idx + 1];
      if (!val || val.startsWith("--")) throw new Error(`Missing value for --${name}`);
      return val;
    }
    const prefix = `--${name}=`;
    const eq = args.find((a) => a.startsWith(prefix));
    return eq ? eq.slice(prefix.length) : null;
  };
  const hasFlag = (name) => args.includes(`--${name}`);

  if (hasFlag("help") || hasFlag("h")) {
    return { help: true };
  }

  const outRaw = getOpt("out");
  if (!outRaw) {
    throw new Error("Missing required --out <private-dir> argument");
  }
  const outDir = assertOutsideRepository(outRaw, "--out");
  const untilDay = getOpt("until") ?? shanghaiToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilDay)) {
    throw new Error(`Invalid --until date: ${untilDay}`);
  }

  const sinceOpt = getOpt("since");
  const sinceDaysRaw = getOpt("since-days");
  let sinceDay;
  if (sinceOpt) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sinceOpt)) {
      throw new Error(`Invalid --since date: ${sinceOpt}`);
    }
    sinceDay = sinceOpt;
  } else {
    const sinceDays = sinceDaysRaw !== null ? Number(sinceDaysRaw) : 7;
    if (!Number.isInteger(sinceDays) || sinceDays < 0 || sinceDays > 365) {
      throw new Error(`Invalid --since-days value: ${sinceDaysRaw}`);
    }
    sinceDay = addDays(untilDay, -sinceDays);
  }
  if (sinceDay > untilDay) {
    throw new Error(`--since (${sinceDay}) must be <= --until (${untilDay})`);
  }

  const concurrencyRaw = getOpt("concurrency");
  let concurrency = 1;
  if (concurrencyRaw !== null) {
    concurrency = Number(concurrencyRaw);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
      throw new Error(`Invalid --concurrency value: ${concurrencyRaw} (expected integer 1..12)`);
    }
  }

  const downloadsDirRaw = getOpt("downloads-dir");
  const downloadsDir = downloadsDirRaw
    ? assertOutsideRepository(downloadsDirRaw, "--downloads-dir")
    : null;

  return {
    help: false,
    sinceDay,
    untilDay,
    outDir,
    downloadsDir,
    concurrency,
    apply: hasFlag("apply"),
    cleanup: hasFlag("cleanup"),
    sessionId: getOpt("session-id") ?? defaultSessionId(),
    sessionInput: getOpt("session-input") ?? null,
    skipDiscover: hasFlag("skip-discover"),
    skipDownload: hasFlag("skip-download"),
    forceDownload: hasFlag("force-download"),
  };
}

export function ensureOssEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("R2_")) {
      delete process.env[key];
    }
  }
  const needed = ["OSS_ENDPOINT", "OSS_REGION", "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_BUCKET"];
  if (!needed.every((k) => Boolean(process.env[k]?.trim()))) {
    const candidates = [
      process.env.NIANLIFE_OSS_ENV_FILE,
      path.join(os.homedir(), "nianlife-oss.env"),
    ].filter(Boolean);
    for (const filePath of candidates) {
      if (!fs.existsSync(filePath)) continue;
      for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const k = trimmed.slice(0, idx).trim();
        let v = trimmed.slice(idx + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (k === "OSS_ENDPOINT") {
          v = v.replace("-internal.aliyuncs.com", ".aliyuncs.com");
        }
        if (!process.env[k]) process.env[k] = v;
      }
      break;
    }
  }
  if (process.env.OSS_ENDPOINT) {
    process.env.OSS_ENDPOINT = process.env.OSS_ENDPOINT.replace("-internal.aliyuncs.com", ".aliyuncs.com");
  }
  process.env.MEDIA_STORAGE_PROVIDER = "oss";
  process.env.HOT_STORAGE_BACKEND = "local";
  process.env.REPOSITORY_BACKEND = "postgres";
}

function stripR2Env() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("R2_")) {
      delete process.env[key];
    }
  }
  process.env.MEDIA_STORAGE_PROVIDER = "oss";
}

export class QuarkAuthError extends Error {
  constructor(code, message) {
    super(`[quark-auth-error code=${code}] ${message}`);
    this.name = "QuarkAuthError";
    this.code = code;
  }
}

function parseNdjsonLines(text) {
  const out = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // Ignore non-JSON log lines.
    }
  }
  return out;
}

function assertQuarkOk(events, res, commandLabel) {
  for (const ev of events) {
    const code = ev?.code;
    if (code !== undefined && code !== 0) {
      const msg = ev?.msg || ev?.message || JSON.stringify(ev);
      if (code === -103 || code === -1408 || /未登录|cookie|auth|-103|-1408/i.test(String(msg))) {
        throw new QuarkAuthError(code, `${commandLabel}: ${msg}`);
      }
      throw new Error(`Quark CLI error (${commandLabel}, code=${code}): ${msg}`);
    }
    if (ev?.type === "error") {
      const errMsg = ev?.msg || ev?.data?.message || JSON.stringify(ev);
      if (/-103|-1408|未登录|cookie|auth/i.test(String(errMsg))) {
        throw new QuarkAuthError(ev?.data?.code ?? -1408, `${commandLabel}: ${errMsg}`);
      }
      throw new Error(`Quark CLI error (${commandLabel}): ${errMsg}`);
    }
  }
  if (res.status !== 0) {
    const stderr = (res.stderr || "").trim();
    if (/-103|-1408|未登录|cookie/i.test(stderr)) {
      throw new QuarkAuthError(-1408, `${commandLabel}: ${stderr}`);
    }
    throw new Error(`Quark CLI exited ${res.status} (${commandLabel}): ${stderr || res.stdout?.slice(-300) || "unknown error"}`);
  }
}

function buildQuarkCliArgs(subArgs, { sessionId, sessionInput }) {
  if (!fs.existsSync(QUARK_CLI)) {
    throw new Error(`Missing quark-drive.cjs at ${QUARK_CLI}`);
  }
  const fullArgs = [QUARK_CLI, ...subArgs, "--session-id", sessionId];
  if (sessionInput) {
    fullArgs.push("--session-input", sessionInput);
  }
  return fullArgs;
}

function buildQuarkChildEnv() {
  // Windows Task Scheduler runs outside an interactive agent shell, so provide
  // the Antigravity marker expected by quark-drive.cjs (avoids code=-104).
  if (process.env.ANTIGRAVITY_AGENT || process.env.ANTIGRAVITY_AGENTAPI_EXE) {
    return process.env;
  }
  return { ...process.env, ANTIGRAVITY_AGENT: "1" };
}

function runQuarkCli(subArgs, { sessionId, sessionInput, label }) {
  const fullArgs = buildQuarkCliArgs(subArgs, { sessionId, sessionInput });
  const res = spawnSync(process.execPath, fullArgs, {
    cwd: REPO_ROOT,
    env: buildQuarkChildEnv(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  const events = parseNdjsonLines(res.stdout);
  assertQuarkOk(events, res, label ?? subArgs[0]);
  return events;
}

export function runQuarkCliAsync(subArgs, { sessionId, sessionInput, label }) {
  const fullArgs = buildQuarkCliArgs(subArgs, { sessionId, sessionInput });
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, fullArgs, {
      cwd: REPO_ROOT,
      env: buildQuarkChildEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      try {
        const events = parseNdjsonLines(stdout);
        assertQuarkOk(events, { status: code, stdout, stderr }, label ?? subArgs[0]);
        resolve(events);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function readJsonlItems(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf8");
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line if any.
    }
  }
  return out;
}

function browseFolder(fid, taskDir, ctx, label) {
  const events = runQuarkCli(["browse", "--parent-fid", fid, "--all", "--task-dir", taskDir], {
    ...ctx,
    label: `browse(${label})`,
  });
  const resultEv = [...events].reverse().find((e) => e?.action === "browse" && e?.type === "result" && e?.data?.file_path);
  if (resultEv?.data?.file_path) {
    return readJsonlItems(resultEv.data.file_path);
  }
  const fallbackEv = [...events].reverse().find((e) => Array.isArray(e?.data?.file_list));
  return fallbackEv?.data?.file_list ?? [];
}

function searchAlbum(keyword, ctx) {
  const events = runQuarkCli(["search", "--keyword", keyword, "--search-type", "album", "--stdout-only"], {
    ...ctx,
    label: `search(${keyword})`,
  });
  const artifactEv = [...events].reverse().find((e) => e?.action === "search" && e?.type === "artifact" && e?.data?.file_path);
  if (artifactEv?.data?.file_path) {
    return readJsonlItems(artifactEv.data.file_path);
  }
  const resultEv = [...events].reverse().find((e) => Array.isArray(e?.data?.file_list));
  return resultEv?.data?.file_list ?? [];
}

export function fidTail(fid) {
  const str = String(fid ?? "");
  const idx = str.lastIndexOf("|");
  return idx >= 0 ? str.slice(idx + 1) : str;
}

function safeFidSlug(fid) {
  return fidTail(fid).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24) || "item";
}

function isQuarkImageItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.category === 0 || item.category === 20 || item.category === 1) return false;
  const ext = path.extname(String(item.filename ?? "")).toLowerCase();
  if (item.category === 3) {
    return ext === "" || IMAGE_EXTS.has(ext) || String(item.format_type ?? "").startsWith("image/");
  }
  return IMAGE_EXTS.has(ext);
}

export function extractFilenameDate(filename) {
  const name = path.basename(String(filename ?? ""));
  // IMG_20261105_142210 or 微信图片_20261105142210
  let m = name.match(/(?<!\d)(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) {
    const [, y, mo, d, h, mi, s] = m;
    if (isValidYmdHms(y, mo, d, h, mi, s)) {
      return { day: `${y}-${mo}-${d}`, text: `${y}-${mo}-${d} ${h}:${mi}:${s}`, hasTime: true };
    }
  }
  // IMG_XXXX_20261105 or 2026-11-05
  m = name.match(/(?<!\d)(20\d{2})[-_]?(\d{2})[-_]?(\d{2})(?!\d)/);
  if (m) {
    const [, y, mo, d] = m;
    const yr = Number(y);
    if (yr >= 2020 && yr <= 2035 && isValidYmdHms(y, mo, d, "12", "00", "00")) {
      return { day: `${y}-${mo}-${d}`, text: null, hasTime: false };
    }
  }
  return null;
}

function isValidYmdHms(y, mo, d, h, mi, s) {
  const yn = Number(y);
  const mn = Number(mo);
  const dn = Number(d);
  const hn = Number(h);
  const min = Number(mi);
  const sn = Number(s);
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31 || hn > 23 || min > 59 || sn > 59) return false;
  const dt = new Date(Date.UTC(yn, mn - 1, dn));
  return dt.getUTCFullYear() === yn && dt.getUTCMonth() === mn - 1 && dt.getUTCDate() === dn;
}

export function itemMatchesPreWindow(item, sinceDay, untilDay) {
  const bufferStartDay = addDays(sinceDay, -2);
  const bufferEndDay = addDays(untilDay, 2);
  const { startMs, endMs } = dayToRangeMs(bufferStartDay, bufferEndDay);

  const lShot = Number(item.l_shot_at || 0);
  if (Number.isFinite(lShot) && lShot >= startMs && lShot <= endMs) {
    return true;
  }
  const fnameDate = extractFilenameDate(item.filename);
  if (fnameDate && fnameDate.day >= bufferStartDay && fnameDate.day <= bufferEndDay) {
    return true;
  }
  if (!lShot && !fnameDate) {
    const createdAt = Number(item.created_at || 0);
    if (Number.isFinite(createdAt) && createdAt >= startMs && createdAt <= endMs) {
      return true;
    }
  }
  return false;
}

export function deduplicateQuarkCandidates(items) {
  const byFidTail = new Map();
  for (const item of items) {
    const tail = fidTail(item.fid);
    if (!tail) continue;
    const existing = byFidTail.get(tail);
    if (!existing || (!existing.shoot_device && item.shoot_device)) {
      byFidTail.set(tail, { ...item, _sources: new Set([...(existing?._sources ?? []), item._sourceFolder]) });
    } else {
      existing._sources.add(item._sourceFolder);
    }
  }

  // Secondary dedupe across Quark folders (e.g., 夸克上传文件 vs 我的备份/iPhone 17 Pro Max 备份)
  const byContentKey = new Map();
  for (const item of byFidTail.values()) {
    const nameKey = String(item.filename ?? "").trim().toLowerCase();
    const shotSec = item.l_shot_at ? Math.round(Number(item.l_shot_at) / 1000) : 0;
    const key = `${nameKey}|${Number(item.size || 0)}|${shotSec}`;
    const existing = byContentKey.get(key);
    if (!existing) {
      byContentKey.set(key, item);
      continue;
    }
    const existingRank = (existing.shoot_device ? 2 : 0) + (existing._sourceFolder?.startsWith("我的备份/") ? 1 : 0);
    const nextRank = (item.shoot_device ? 2 : 0) + (item._sourceFolder?.startsWith("我的备份/") ? 1 : 0);
    if (nextRank > existingRank) {
      item._sources = new Set([...existing._sources, ...item._sources]);
      byContentKey.set(key, item);
    } else {
      for (const s of item._sources) existing._sources.add(s);
    }
  }

  return [...byContentKey.values()].map((item) => ({
    ...item,
    _sources: [...item._sources].filter(Boolean),
  }));
}

async function discoverCandidates({ sinceDay, untilDay, browseDir, sessionId, sessionInput }) {
  const ctx = { sessionId, sessionInput };
  const rootItems = browseFolder("0", browseDir, ctx, "root");
  const targetNames = new Set(["夸克上传文件", "我的备份", "nianlife"]);
  const foldersToScan = [];

  for (const entry of rootItems) {
    if (!targetNames.has(entry.filename)) continue;
    if (entry.filename === "我的备份") {
      const backupFolders = browseFolder(entry.fid, browseDir, ctx, "我的备份");
      const cutoffMs = Date.parse(`${addDays(sinceDay, -30)}T00:00:00+08:00`);
      for (const sub of backupFolders) {
        const updatedAt = Number(sub.updated_at || sub.created_at || 0);
        const includeItems = Number(sub.includeItems || 0);
        // Browse active or reasonably sized backup folders; multi-10k legacy phone backups are cross-checked via album search below.
        if (updatedAt >= cutoffMs || (includeItems > 0 && includeItems < 10000)) {
          foldersToScan.push({ fid: sub.fid, label: `我的备份/${sub.filename}` });
        }
      }
    } else {
      foldersToScan.push({ fid: entry.fid, label: entry.filename });
    }
  }

  const allItems = [];
  for (const folder of foldersToScan) {
    const rows = browseFolder(folder.fid, browseDir, ctx, folder.label);
    for (const row of rows) {
      allItems.push({ ...row, _sourceFolder: folder.label });
    }
  }

  // Also search by YYYYMM in album mode so no photo in large/nested backup folders is missed.
  for (const ym of listMonthsInWindow(sinceDay, untilDay)) {
    const searchRows = searchAlbum(ym, ctx);
    for (const row of searchRows) {
      allItems.push({ ...row, _sourceFolder: `search:${ym}` });
    }
  }

  const imagesOnly = allItems.filter(isQuarkImageItem);
  const deduped = deduplicateQuarkCandidates(imagesOnly);
  const inWindow = deduped.filter((item) => itemMatchesPreWindow(item, sinceDay, untilDay));
  inWindow.sort((a, b) => Number(a.l_shot_at || a.created_at || 0) - Number(b.l_shot_at || b.created_at || 0));

  return {
    foldersScanned: foldersToScan.map((f) => f.label),
    totalDiscoveredImages: imagesOnly.length,
    dedupedImages: deduped.length,
    candidates: inWindow,
  };
}

const UTC_OFFSETS = new Set(["Z", "+00:00", "-00:00", "+0000", "-0000"]);

export function isUtcOffset(offsetRaw) {
  return typeof offsetRaw === "string" && UTC_OFFSETS.has(offsetRaw.trim().toUpperCase());
}

export function parseExifRawDateString(rawVal, offsetRaw) {
  if (typeof rawVal === "string") {
    const trimmed = rawVal.trim();
    const m = trimmed.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/i);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, inlineOffset] = m;
    if (!isValidYmdHms(y, mo, d, h, mi, s)) return null;
    const effectiveOffset = typeof offsetRaw === "string" && offsetRaw.trim() ? offsetRaw : inlineOffset;
    if (isUtcOffset(effectiveOffset)) {
      const utcMs = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
      if (Number.isFinite(utcMs)) return formatShanghaiMs(utcMs);
    }
    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
  }
  if (rawVal instanceof Date && Number.isFinite(rawVal.getTime())) {
    return formatShanghaiMs(rawVal.getTime());
  }
  return null;
}

export function normalizeImgStem(name) {
  const m = String(name ?? "").match(/\b(IMG_\d{4,})/i);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Parse a YYYY-MM-DD HH:MM:SS wall-clock string in UTC so runner TZ never shifts +/-5s comparisons.
 */
export function parseWallClockEpochSeconds(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (!isValidYmdHms(y, mo, d, h, mi, s)) return null;
  return Math.floor(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) / 1000);
}

export function buildExistingMediaIndex(rows = []) {
  const bySha256 = new Map();
  const byStem = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rawSha = row.sha256 ?? row.asset_checksum ?? row.checksum ?? null;
    const normalizedSha = typeof rawSha === "string" ? rawSha.trim().replace(/^sha256:/i, "").toLowerCase() : null;
    if (normalizedSha) {
      bySha256.set(normalizedSha, row);
    }
    const takenAtStr = typeof row.taken_at_str === "string"
      ? row.taken_at_str
      : (typeof row.taken_at === "string" ? row.taken_at : null);
    const takenEpoch = parseWallClockEpochSeconds(takenAtStr)
      ?? (Number.isFinite(Number(row.taken_epoch)) ? Math.round(Number(row.taken_epoch)) : null);
    const stems = new Set(
      [row.original_filename, row.asset_filename, row.storage_key, row.object_key, row.original_key, row.provider_ref]
        .map(normalizeImgStem)
        .filter(Boolean),
    );
    for (const stem of stems) {
      if (!byStem.has(stem)) byStem.set(stem, []);
      byStem.get(stem).push({ id: row.id, stem, takenEpoch, takenAtStr });
    }
  }
  return { bySha256, byStem };
}

export function findExistingMediaMatch(candidate, index, toleranceSeconds = 5) {
  if (!index) return null;
  for (const rawSha of [candidate?.sha256, candidate?.origSha256]) {
    const sha = typeof rawSha === "string" ? rawSha.trim().replace(/^sha256:/i, "").toLowerCase() : null;
    if (sha && index.bySha256?.has(sha)) {
      return { matchedBy: "sha256", existing: index.bySha256.get(sha) };
    }
  }
  const stem = normalizeImgStem(candidate?.filename);
  const candEpoch = parseWallClockEpochSeconds(candidate?.captureTimeText ?? candidate?.capture_time?.text ?? null);
  if (!stem || candEpoch === null) return null;
  const entries = index.byStem?.get(stem) ?? [];
  for (const entry of entries) {
    if (entry.takenEpoch === null) continue;
    const diffSeconds = Math.abs(candEpoch - entry.takenEpoch);
    if (diffSeconds <= toleranceSeconds) {
      return { matchedBy: "stem_time", stem, existing: entry, diffSeconds };
    }
  }
  return null;
}

const MIN_VALID_SHOT_MS = Date.parse("2015-01-01T00:00:00Z");

export function isValidShotMs(shotMs, nowMs = Date.now()) {
  return Number.isFinite(shotMs) && shotMs >= MIN_VALID_SHOT_MS && shotMs <= nowMs + DAY_MS;
}

function buildExistingStemTimeSkip(existingStemMatch, candidateTakenAt, extra = {}) {
  return {
    status: "skipped",
    category: "existing_stem_time",
    reason: "rds_stem_time_duplicate",
    matchedMediaId: existingStemMatch.existing.id,
    matchedStem: existingStemMatch.stem,
    existingTakenAt: existingStemMatch.existing.takenAtStr,
    candidateTakenAt,
    diffSeconds: existingStemMatch.diffSeconds,
    ...extra,
  };
}

export function matchPreDownloadExistingStemTime(item, existingMediaIndex, { forceDownload = false, nowMs = Date.now() } = {}) {
  if (forceDownload) return null;
  const shotMs = Number(item?.l_shot_at || 0);
  if (!isValidShotMs(shotMs, nowMs)) return null;
  const candidateTakenAt = formatShanghaiMs(shotMs);
  const existingStemMatch = findExistingMediaMatch(
    { filename: item?.filename, captureTimeText: candidateTakenAt },
    existingMediaIndex,
  );
  if (existingStemMatch?.matchedBy !== "stem_time") return null;
  return buildExistingStemTimeSkip(existingStemMatch, candidateTakenAt, { preDownload: true });
}

export async function loadExistingRdsMediaWindow(client, sinceDay, untilDay) {
  const windowStart = addDays(sinceDay, -2);
  const windowEnd = addDays(untilDay, 3);
  const res = await client.query(`
    select m.id,
           m.original_filename,
           m.object_key,
           to_char(m.taken_at, 'YYYY-MM-DD HH24:MI:SS') as taken_at_str,
           a.checksum as asset_checksum,
           a.original_filename as asset_filename,
           l.provider_ref as original_key
      from media m
      left join media_assets a on a.id = m.media_asset_id
      left join lateral (
        select provider_ref
          from media_locations loc
         where loc.media_asset_id = m.media_asset_id
         order by case when loc.variant = 'original' then 0 else 1 end, loc.created_at asc
         limit 1
      ) l on true
     where m.taken_at >= $1::date
       and m.taken_at < $2::date
  `, [windowStart, windowEnd]);
  return res.rows;
}

async function queryExistingRdsMedia(sinceDay, untilDay) {
  if (process.env.DATABASE_URL?.trim()) {
    const { getPool } = await import("../../lib/db/client.ts");
    return loadExistingRdsMediaWindow(getPool(), sinceDay, untilDay);
  }
  const nightRdsUrl = new URL("../../.data/night-rds.mjs", import.meta.url);
  if (!fs.existsSync(nightRdsUrl)) {
    throw new Error("DATABASE_URL is not set and v2/.data/night-rds.mjs is unavailable for RDS deduplication.");
  }
  const { openRds } = await import(nightRdsUrl.href);
  const rds = await openRds({ readOnly: true, localPort: 15820 + Math.floor(Math.random() * 60) });
  try {
    return await loadExistingRdsMediaWindow(rds.client, sinceDay, untilDay);
  } finally {
    await rds.close();
  }
}

export async function extractExifTags(buf, sharpMeta) {
  const opts = { reviveValues: false, tiff: true, exif: true };
  let parsed = await exifr.parse(buf, opts).catch(() => null);
  if ((!parsed || (!parsed.DateTimeOriginal && !parsed.Make && !parsed.Model)) && sharpMeta?.exif?.length) {
    const raw = sharpMeta.exif;
    const offset = raw.subarray(0, 6).toString("ascii") === "Exif\0\0" ? 6 : 0;
    const fromMeta = await exifr.parse(raw.subarray(offset), opts).catch(() => null);
    if (fromMeta) {
      parsed = { ...(parsed ?? {}), ...fromMeta };
    }
  }
  return parsed ?? null;
}

export function resolveCaptureTime({ filename, exif, lShotAt }) {
  const dtoText = parseExifRawDateString(
    exif?.DateTimeOriginal ?? exif?.CreateDate,
    exif?.OffsetTimeOriginal ?? exif?.OffsetTimeDigitized ?? exif?.OffsetTime
  );
  if (dtoText) {
    return { text: dtoText, reliable: true, source: "exif_datetime_original" };
  }

  const fnameDate = extractFilenameDate(filename);
  const shotMs = Number(lShotAt || 0);
  const validShot = isValidShotMs(shotMs);
  const shotText = validShot ? formatShanghaiMs(shotMs) : null;
  const shotDay = shotText ? shotText.slice(0, 10) : null;

  if (fnameDate && shotDay) {
    const diffDays = Math.abs((Date.parse(`${fnameDate.day}T00:00:00Z`) - Date.parse(`${shotDay}T00:00:00Z`)) / DAY_MS);
    if (diffDays <= 1) {
      return { text: shotText, reliable: true, source: "filename_plus_l_shot_at" };
    }
    return {
      text: null,
      reliable: false,
      source: "inconsistent_filename_and_l_shot_at",
      detail: `filename=${fnameDate.day}, l_shot_at=${shotDay}`,
    };
  }

  if (fnameDate?.text) {
    return { text: fnameDate.text, reliable: true, source: "filename_timestamp" };
  }

  if (shotText) {
    return { text: shotText, reliable: true, source: "quark_l_shot_at" };
  }

  if (fnameDate?.day) {
    return { text: `${fnameDate.day} 12:00:00`, reliable: true, source: "filename_date_only" };
  }

  return { text: null, reliable: false, source: "undated" };
}

export function classifyScreenshot({ filename, sharpMeta, exif, quarkShootDevice }) {
  const ext = path.extname(String(filename ?? "")).toLowerCase();
  const actualFormat = sharpMeta?.format ?? "";
  const w = Number(sharpMeta?.width || 0);
  const h = Number(sharpMeta?.height || 0);
  const hasCameraExif = Boolean(
    exif?.Make?.toString().trim() ||
    exif?.Model?.toString().trim() ||
    exif?.LensModel?.toString().trim() ||
    String(quarkShootDevice ?? "").trim()
  );

  if (hasCameraExif) {
    return { isScreenshot: false, reason: null, hasCameraExif: true };
  }

  if (actualFormat === "png" || ext === ".png") {
    return { isScreenshot: true, reason: "ui_screenshot_png_no_camera_exif", hasCameraExif: false };
  }

  if (w > 0 && h > 0) {
    if (PHONE_SCREEN_RESOLUTIONS.has(`${w}x${h}`)) {
      return { isScreenshot: true, reason: "ui_screenshot_device_resolution", hasCameraExif: false };
    }
    const minDim = Math.min(w, h);
    if (minDim === 1320 || minDim === 1179) {
      return { isScreenshot: true, reason: "ui_screenshot_cropped_screen_width", hasCameraExif: false };
    }
    if (Math.max(w / h, h / w) > 2.2) {
      return { isScreenshot: true, reason: "ui_screenshot_extreme_aspect", hasCameraExif: false };
    }
  }

  return { isScreenshot: false, reason: null, hasCameraExif: false };
}

function resolveDownloadTarget(item, downloadsDir) {
  const subDir = path.join(downloadsDir, safeFidSlug(item.fid));
  return {
    subDir,
    expectedPath: path.join(subDir, path.basename(item.filename)),
  };
}

function verifyDownloadedPath(events, item, expectedPath) {
  const resultEv = [...events].reverse().find((e) => e?.action === "download" && e?.type === "result");
  const filePath = resultEv?.data?.filePath ? path.resolve(resultEv.data.filePath) : expectedPath;
  if (!fs.existsSync(filePath)) {
    throw new Error(`Downloaded file missing on disk for ${item.filename} (fid=${item.fid})`);
  }
  return filePath;
}

function downloadQuarkItem(item, downloadsDir, ctx) {
  const { subDir, expectedPath } = resolveDownloadTarget(item, downloadsDir);
  fs.mkdirSync(subDir, { recursive: true });
  const events = runQuarkCli(["download", "--fid", item.fid, "--output-dir", subDir, "--overwrite"], {
    ...ctx,
    label: `download(${item.filename})`,
  });
  return verifyDownloadedPath(events, item, expectedPath);
}

export async function downloadQuarkItemAsync(item, downloadsDir, ctx) {
  const { subDir, expectedPath } = resolveDownloadTarget(item, downloadsDir);
  await mkdir(subDir, { recursive: true });
  const events = await runQuarkCliAsync(["download", "--fid", item.fid, "--output-dir", subDir, "--overwrite"], {
    ...ctx,
    label: `download(${item.filename})`,
  });
  return verifyDownloadedPath(events, item, expectedPath);
}

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function mimeAndExtForSharpFormat(format) {
  if (format === "jpeg") return { ext: ".jpg", formatType: "image/jpeg" };
  if (format === "png") return { ext: ".png", formatType: "image/png" };
  if (format === "webp") return { ext: ".webp", formatType: "image/webp" };
  return { ext: ".jpg", formatType: "image/jpeg" };
}

export async function stageDownloadedItem({
  item,
  localPath,
  convertedDir,
  seenSha256,
  existingMediaIndex = null,
  sinceDay,
  untilDay,
}) {
  const bytes = await readFile(localPath);
  let sharpMeta;
  try {
    sharpMeta = await sharp(bytes).metadata();
  } catch (err) {
    return { status: "skipped", category: "corrupted", reason: `invalid_image:${err?.message ?? err}` };
  }

  const exif = await extractExifTags(bytes, sharpMeta);
  const screen = classifyScreenshot({
    filename: item.filename,
    sharpMeta,
    exif,
    quarkShootDevice: item.shoot_device,
  });
  if (screen.isScreenshot) {
    return {
      status: "skipped",
      category: "screenshot",
      reason: screen.reason,
      width: sharpMeta.width ?? null,
      height: sharpMeta.height ?? null,
    };
  }

  const captureTime = resolveCaptureTime({
    filename: item.filename,
    exif,
    lShotAt: item.l_shot_at,
  });
  if (!captureTime.reliable || !captureTime.text) {
    return { status: "skipped", category: "undated", reason: captureTime.source, detail: captureTime.detail ?? null };
  }

  const captureDay = captureTime.text.slice(0, 10);
  if (captureDay < sinceDay || captureDay > untilDay) {
    return { status: "skipped", category: "out_of_window", reason: `capture_day=${captureDay}` };
  }

  const existingStemMatch = findExistingMediaMatch(
    { filename: item.filename, captureTimeText: captureTime.text },
    existingMediaIndex,
  );
  if (existingStemMatch?.matchedBy === "stem_time") {
    return buildExistingStemTimeSkip(existingStemMatch, captureTime.text);
  }

  // Pre-conversion synchronous deduplication on raw bytes avoids redundant HEIC/WebP work.
  const origPreSha256 = sha256Hex(bytes);
  if (seenSha256.has(origPreSha256)) {
    return { status: "skipped", category: "duplicate", reason: "batch_checksum_duplicate", sha256: origPreSha256 };
  }
  const existingPreShaMatch = findExistingMediaMatch(
    { filename: item.filename, captureTimeText: captureTime.text, sha256: origPreSha256, origSha256: origPreSha256 },
    existingMediaIndex,
  );
  if (existingPreShaMatch?.matchedBy === "sha256") {
    return {
      status: "skipped",
      category: "duplicate",
      reason: "rds_checksum_duplicate",
      matchedMediaId: existingPreShaMatch.existing.id,
      sha256: origPreSha256,
    };
  }

  const extLower = path.extname(String(item.filename ?? "")).toLowerCase();
  const isHeif = sharpMeta.format === "heif" || HEIF_EXTS.has(extLower);
  const needsWebpToJpg = sharpMeta.format === "webp" || sharpMeta.format === "avif";

  let targetPath = localPath;
  let targetBytes = bytes;
  let targetGroup = "plain";
  let ext = mimeAndExtForSharpFormat(sharpMeta.format).ext;
  let formatType = mimeAndExtForSharpFormat(sharpMeta.format).formatType;

  if (isHeif) {
    const jpgBuffer = Buffer.from(await heicConvert({ buffer: bytes, format: "JPEG", quality: 0.92 }));
    await sharp(jpgBuffer).metadata();
    const outSub = path.join(convertedDir, safeFidSlug(item.fid));
    await mkdir(outSub, { recursive: true });
    const stem = path.basename(item.filename, path.extname(item.filename));
    targetPath = path.join(outSub, `${stem}.jpg`);
    await writeFile(targetPath, jpgBuffer);
    targetBytes = jpgBuffer;
    targetGroup = "converted";
    ext = ".jpg";
    formatType = "image/jpeg";
  } else if (needsWebpToJpg) {
    const jpgBuffer = await sharp(bytes).rotate().jpeg({ quality: 92 }).toBuffer();
    const outSub = path.join(convertedDir, safeFidSlug(item.fid));
    await mkdir(outSub, { recursive: true });
    const stem = path.basename(item.filename, path.extname(item.filename));
    targetPath = path.join(outSub, `${stem}.jpg`);
    await writeFile(targetPath, jpgBuffer);
    targetBytes = jpgBuffer;
    targetGroup = "converted";
    ext = ".jpg";
    formatType = "image/jpeg";
  }

  const sha256 = sha256Hex(targetBytes);
  const origSha256 = isHeif || needsWebpToJpg ? sha256Hex(bytes) : sha256;
  if (seenSha256.has(sha256) || seenSha256.has(origSha256)) {
    return { status: "skipped", category: "duplicate", reason: "batch_checksum_duplicate", sha256 };
  }
  const existingShaMatch = findExistingMediaMatch(
    { filename: item.filename, captureTimeText: captureTime.text, sha256, origSha256 },
    existingMediaIndex,
  );
  if (existingShaMatch?.matchedBy === "sha256") {
    return {
      status: "skipped",
      category: "duplicate",
      reason: "rds_checksum_duplicate",
      matchedMediaId: existingShaMatch.existing.id,
      sha256,
    };
  }
  seenSha256.add(sha256);
  seenSha256.add(origSha256);

  const taskItem = {
    kind: "photo",
    download_status: "success",
    checksum_duplicate: false,
    date_label: "in_window",
    capture_time: { text: captureTime.text, reliable: true, source: captureTime.source },
    format_type: formatType,
    ext,
    filename: item.filename,
    size: targetBytes.byteLength,
    local_path: targetPath,
    sha256,
    quark_fid: item.fid,
    quark_sources: item._sources ?? [],
    camera_make: exif?.Make ?? null,
    camera_model: exif?.Model ?? item.shoot_device ?? null,
  };

  return { status: "ready", group: targetGroup, captureDay, taskItem };
}

async function writeJsonl(filePath, rows) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const body = rows.length ? `${rows.map((r) => JSON.stringify(r)).join("\n")}\n` : "";
  await writeFile(filePath, body, "utf8");
}

async function runApplyBatch({ taskItems, artifactDir, originalsDir, apply, applyDeps }) {
  if (!taskItems.length) {
    return {
      summary: { eligible: 0, newCount: 0, reusedCount: 0, skippedCount: 0, failedCount: 0 },
      dates: [],
      created: [],
      reused: [],
      skipped: [],
      failed: [],
    };
  }
  await writeJsonl(path.join(artifactDir, "artifacts", "task-items.jsonl"), taskItems);
  stripR2Env();
  return applyQuarkPhotoArtifact({
    artifactDir,
    originalsDir,
    mode: apply ? "apply" : "dry-run",
    visibility: "private",
    organize: false,
    sourceLabel: "Quark 照片同步",
    ...(applyDeps ? { deps: applyDeps } : {}),
  });
}

function mergeDateCounts(plainItems, convertedItems) {
  const byDate = {};
  for (const item of [...plainItems, ...convertedItems]) {
    const day = item.capture_time.text.slice(0, 10);
    byDate[day] = (byDate[day] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)));
}

export async function mapWithConcurrency(items, concurrency, fn) {
  const limit = Math.max(1, Math.min(12, Number(concurrency) || 1));
  const results = new Array(items.length);
  let nextIndex = 0;
  let fatalError = null;

  async function worker() {
    while (!fatalError) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        if (!fatalError) fatalError = err;
        return;
      }
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (fatalError) throw fatalError;
  return results;
}

export async function runQuarkDailySync(opts) {
  ensureOssEnv();
  stripR2Env();
  const provider = requireQuarkStorageProvider();
  if (provider !== "oss") {
    throw new Error(`Quark daily sync requires MEDIA_STORAGE_PROVIDER="oss", got "${provider}"`);
  }

  const concurrency = opts.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 12) {
    throw new Error(`Invalid --concurrency value: ${opts.concurrency} (expected integer 1..12)`);
  }

  const sharedDownloadsDir = Boolean(opts.downloadsDir);
  const downloadsDir = opts.downloadsDir
    ? assertOutsideRepository(opts.downloadsDir, "--downloads-dir")
    : path.join(opts.outDir, "downloads");
  const browseDir = path.join(opts.outDir, "quark-browse");
  const convertedDir = path.join(opts.outDir, "heic-converted");
  const manifestsDir = path.join(opts.outDir, "manifests");
  const plainArtifactDir = path.join(opts.outDir, "artifacts-plain");
  const convertedArtifactDir = path.join(opts.outDir, "artifacts-converted");

  await mkdir(opts.outDir, { recursive: true });
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(convertedDir, { recursive: true });
  await mkdir(manifestsDir, { recursive: true });

  const existingRdsRows = Array.isArray(opts.existingRdsRows)
    ? opts.existingRdsRows
    : await queryExistingRdsMedia(opts.sinceDay, opts.untilDay);
  const existingMediaIndex = buildExistingMediaIndex(existingRdsRows);

  const discoveredPath = path.join(manifestsDir, "discovered-candidates.json");
  let discovery;
  if (opts.skipDiscover && fs.existsSync(discoveredPath)) {
    discovery = JSON.parse(await readFile(discoveredPath, "utf8"));
  } else {
    await mkdir(browseDir, { recursive: true });
    discovery = await discoverCandidates({
      sinceDay: opts.sinceDay,
      untilDay: opts.untilDay,
      browseDir,
      sessionId: opts.sessionId,
      sessionInput: opts.sessionInput,
    });
    await writeFile(discoveredPath, JSON.stringify(discovery, null, 2) + "\n", "utf8");
  }

  const plainItems = [];
  const convertedItems = [];
  const skippedScreenshots = [];
  const skippedExistingStemTime = [];
  const skippedOther = [];
  const downloadFailures = [];
  const seenSha256 = new Set();
  const downloadFn = opts.downloadItem ?? downloadQuarkItemAsync;

  const slotResults = await mapWithConcurrency(discovery.candidates, concurrency, async (item, index) => {
    const preDownloadMatch = matchPreDownloadExistingStemTime(item, existingMediaIndex, {
      forceDownload: opts.forceDownload,
    });
    if (preDownloadMatch) {
      return {
        kind: "skipped_existing_stem_time",
        row: {
          filename: item.filename,
          fid: item.fid,
          l_shot_at: item.l_shot_at ?? null,
          ...preDownloadMatch,
        },
      };
    }

    let localPath;
    try {
      const candidatePath = path.join(downloadsDir, safeFidSlug(item.fid), path.basename(item.filename));
      const sameSizeOnDisk =
        !opts.forceDownload &&
        Number(item.size) > 0 &&
        fs.existsSync(candidatePath) &&
        fs.statSync(candidatePath).size === Number(item.size);
      if ((opts.skipDownload && fs.existsSync(candidatePath)) || sameSizeOnDisk) {
        localPath = candidatePath;
      } else {
        const itemSessionId = concurrency > 1 ? `${opts.sessionId}-${index}` : opts.sessionId;
        localPath = await downloadFn(item, downloadsDir, {
          sessionId: itemSessionId,
          sessionInput: opts.sessionInput,
        });
      }
    } catch (err) {
      if (err instanceof QuarkAuthError) {
        throw err;
      }
      return {
        kind: "download_failure",
        row: { filename: item.filename, fid: item.fid, error: err?.message ?? String(err) },
      };
    }

    const staged = await stageDownloadedItem({
      item,
      localPath,
      convertedDir,
      seenSha256,
      existingMediaIndex,
      sinceDay: opts.sinceDay,
      untilDay: opts.untilDay,
    });
    return { kind: "staged", item, staged };
  });

  for (const slot of slotResults) {
    if (!slot) continue;
    if (slot.kind === "skipped_existing_stem_time") {
      skippedExistingStemTime.push(slot.row);
    } else if (slot.kind === "download_failure") {
      downloadFailures.push(slot.row);
    } else if (slot.staged.status === "ready") {
      if (slot.staged.group === "converted") convertedItems.push(slot.staged.taskItem);
      else plainItems.push(slot.staged.taskItem);
    } else if (slot.staged.category === "screenshot") {
      skippedScreenshots.push({ filename: slot.item.filename, fid: slot.item.fid, l_shot_at: slot.item.l_shot_at ?? null, ...slot.staged });
    } else if (slot.staged.category === "existing_stem_time") {
      skippedExistingStemTime.push({ filename: slot.item.filename, fid: slot.item.fid, l_shot_at: slot.item.l_shot_at ?? null, ...slot.staged });
    } else {
      skippedOther.push({ filename: slot.item.filename, fid: slot.item.fid, l_shot_at: slot.item.l_shot_at ?? null, ...slot.staged });
    }
  }

  await writeJsonl(path.join(manifestsDir, "skipped-screenshots.jsonl"), skippedScreenshots);
  await writeJsonl(path.join(manifestsDir, "skipped-existing-stem-time.jsonl"), skippedExistingStemTime);
  await writeJsonl(path.join(manifestsDir, "skipped-other.jsonl"), skippedOther);
  await writeJsonl(path.join(manifestsDir, "eligible-items.jsonl"), [...plainItems, ...convertedItems]);

  const plainResult = await runApplyBatch({
    taskItems: plainItems,
    artifactDir: plainArtifactDir,
    originalsDir: downloadsDir,
    apply: opts.apply,
    applyDeps: opts.applyDeps,
  });
  const convertedResult = await runApplyBatch({
    taskItems: convertedItems,
    artifactDir: convertedArtifactDir,
    originalsDir: convertedDir,
    apply: opts.apply,
    applyDeps: opts.applyDeps,
  });

  const combined = {
    eligible: plainResult.summary.eligible + convertedResult.summary.eligible,
    newCount: plainResult.summary.newCount + convertedResult.summary.newCount,
    reusedCount: plainResult.summary.reusedCount + convertedResult.summary.reusedCount,
    skippedCount: plainResult.summary.skippedCount + convertedResult.summary.skippedCount,
    failedCount: plainResult.summary.failedCount + convertedResult.summary.failedCount + downloadFailures.length,
  };

  const cleanedDirs = [];
  if (opts.cleanup && (!opts.apply || combined.failedCount === 0)) {
    const cleanTargets = sharedDownloadsDir ? [convertedDir, browseDir] : [downloadsDir, convertedDir, browseDir];
    for (const dir of cleanTargets) {
      if (fs.existsSync(dir)) {
        await rm(dir, { recursive: true, force: true });
        cleanedDirs.push(dir);
      }
    }
  }

  const summary = {
    schema: "nianlife.quark-daily-sync/1",
    ranAt: new Date().toISOString(),
    mode: opts.apply ? "apply" : "dry-run",
    concurrency,
    downloadsDir,
    sharedDownloadsDir,
    window: { sinceDay: opts.sinceDay, untilDay: opts.untilDay },
    storageProvider: process.env.MEDIA_STORAGE_PROVIDER,
    visibility: "private",
    sourceLabel: "Quark 照片同步",
    discovery: {
      foldersScanned: discovery.foldersScanned,
      totalDiscoveredImages: discovery.totalDiscoveredImages,
      dedupedImages: discovery.dedupedImages,
      windowCandidates: discovery.candidates.length,
      rdsWindowMediaCount: existingRdsRows.length,
    },
    staging: {
      plainCount: plainItems.length,
      convertedHeicCount: convertedItems.length,
      skippedScreenshotsCount: skippedScreenshots.length,
      skippedExistingStemTimeCount: skippedExistingStemTime.length,
      skippedOtherCount: skippedOther.length,
      downloadFailureCount: downloadFailures.length,
      eligibleByDate: mergeDateCounts(plainItems, convertedItems),
    },
    applySummary: combined,
    applyDetails: {
      createdDates: [...new Set([...plainResult.created, ...convertedResult.created].map((c) => c.date).filter(Boolean))].sort(),
      reusedDates: [...new Set([...plainResult.reused, ...convertedResult.reused].map((c) => c.date).filter(Boolean))].sort(),
      failed: [...downloadFailures, ...plainResult.failed, ...convertedResult.failed],
    },
    cleanupRequested: opts.cleanup,
    cleanedDirs,
  };

  await writeFile(path.join(opts.outDir, "sync-summary.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
  return summary;
}

async function cli() {
  const opts = parseQuarkCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      "Usage: node --import tsx scripts/editor/quark-daily-sync.mjs --out <private-dir> [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--since-days N] [--apply] [--cleanup] [--session-id <id>] [--concurrency <1-12>] [--downloads-dir <private-dir>]"
    );
    return;
  }
  const summary = await runQuarkDailySync(opts);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.applySummary.failedCount > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  cli()
    .catch((err) => {
      console.error(err?.stack ?? err?.message ?? String(err));
      process.exitCode = err instanceof QuarkAuthError ? 2 : 1;
    })
    .finally(async () => {
      if (process.env.DATABASE_URL?.trim()) {
        const { closePool } = await import("../../lib/db/client.ts").catch(() => ({ closePool: null }));
        await closePool?.().catch(() => {});
      }
    });
}
