// Server-side reader for Nianlife V2 Weekend Planner snapshots.
// Reads from WEEKEND_CONTENT_DIR (never inside the repository, never runs live network crawls).

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ageOn } from "@/lib/time-signature";
import { productToday } from "@/lib/time-truth";
import type {
  EffectiveWeekendStatus,
  InspirationItem,
  WeekendCurrentBundle,
  WeekendPlannerSnapshot,
  WeekendPlannerStatus,
  WeekendProposal,
  WeekendWeekBundle,
  XhsEvidenceNote,
} from "./types";

export const WEEKEND_CONTENT_TTL_MS = 300_000;
export const DEFAULT_WEEKEND_CONTENT_DIR = "/srv/nianlife-content/weekend";
export const WEEKEND_SNAPSHOT_SCHEMA = "nianlife.weekend-planner/1";
export const WEEK_ID_REGEX = /^20[2-9]\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const VALID_STATUSES = new Set<WeekendPlannerStatus>([
  "collecting",
  "published",
  "unavailable",
  "expired",
  "rest_recommended",
]);

const FORBIDDEN_TOP_KEYS = ["actors", "votes", "consensus", "wechatShareTemplates"] as const;
const FORBIDDEN_PROPOSAL_KEYS = ["actors", "votes", "consensus"] as const;

type SnapshotCacheEntry = {
  at: number;
  snapshot: WeekendPlannerSnapshot | null;
};

type LatestWeekCacheEntry = {
  at: number;
  weekIds: string[];
};

let snapshotCache = new Map<string, SnapshotCacheEntry>();
let weeksIndexCache = new Map<string, LatestWeekCacheEntry>();

export function resolveWeekendContentDir(): string {
  return process.env.WEEKEND_CONTENT_DIR?.trim() || DEFAULT_WEEKEND_CONTENT_DIR;
}

export function invalidateWeekendContent(): void {
  snapshotCache = new Map();
  weeksIndexCache = new Map();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isValidCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY_REGEX.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function isValidWeekId(value: unknown): value is string {
  return typeof value === "string" && WEEK_ID_REGEX.test(value) && isValidCalendarDay(value);
}

/**
 * Computes whether a Xiaohongshu note's `publishedAt` (YYYY-MM-DD) is within [0, 30] days
 * relative to `referenceDay` (typically `snapshot.weekendRange.from`).
 */
export function isWithin30Days(publishedAt: string, referenceDay: string): boolean {
  if (!isValidCalendarDay(publishedAt) || !isValidCalendarDay(referenceDay)) return false;
  const referenceMs = Date.parse(`${referenceDay}T00:00:00Z`);
  const publishedMs = Date.parse(`${publishedAt}T00:00:00Z`);
  const diffDays = (referenceMs - publishedMs) / 86_400_000;
  return Number.isFinite(diffDays) && diffDays >= 0 && diffDays <= 30;
}

function stripForbiddenKeys<T extends Record<string, unknown>>(
  obj: T,
  forbidden: readonly string[],
): T {
  const copy = { ...obj };
  for (const key of forbidden) {
    if (key in copy) delete copy[key];
  }
  return copy;
}

function isUsableProposal(value: unknown): value is WeekendProposal {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.title) || !isNonEmptyString(value.experienceType)) {
    return false;
  }
  if (!isPlainObject(value.xhsEvidence) || !Array.isArray(value.xhsEvidence.notes)) {
    return false;
  }
  return true;
}

function isUsableInspiration(value: unknown): value is InspirationItem {
  if (!isPlainObject(value)) return false;
  if (!isNonEmptyString(value.id) || !isNonEmptyString(value.title)) return false;
  if (!Array.isArray(value.xhsEvidence)) return false;
  return true;
}

export function validateWeekendSnapshot(parsed: unknown): WeekendPlannerSnapshot | null {
  if (!isPlainObject(parsed)) return null;
  if (parsed.schema !== WEEKEND_SNAPSHOT_SCHEMA) return null;
  if (!isValidWeekId(parsed.weekId)) return null;
  if (typeof parsed.status !== "string" || !VALID_STATUSES.has(parsed.status as WeekendPlannerStatus)) {
    return null;
  }
  if (!isPlainObject(parsed.weekendRange)) return null;
  const range = parsed.weekendRange;
  if (
    !isValidCalendarDay(range.from) ||
    !isValidCalendarDay(range.to) ||
    range.from > range.to ||
    !isNonEmptyString(range.label) ||
    !isNonEmptyString(range.satLabel) ||
    !isNonEmptyString(range.sunLabel)
  ) {
    return null;
  }
  if (!isPlainObject(parsed.childProfile) || !isValidCalendarDay(parsed.childProfile.birthDay)) {
    return null;
  }
  if (!isPlainObject(parsed.weatherSummary) || !Array.isArray(parsed.weatherSummary.cities)) {
    return null;
  }
  if (!Array.isArray(parsed.proposals) || !parsed.proposals.every(isUsableProposal)) {
    return null;
  }
  if (!Array.isArray(parsed.inspirationPool) || !parsed.inspirationPool.every(isUsableInspiration)) {
    return null;
  }
  if (!Array.isArray(parsed.noGoAlerts)) return null;

  const cleaned = stripForbiddenKeys(parsed, FORBIDDEN_TOP_KEYS);
  cleaned.proposals = (cleaned.proposals as Record<string, unknown>[]).map((p) =>
    stripForbiddenKeys(p, FORBIDDEN_PROPOSAL_KEYS),
  );
  return cleaned as unknown as WeekendPlannerSnapshot;
}

function enrichNotes(notes: readonly XhsEvidenceNote[], referenceDay: string): XhsEvidenceNote[] {
  return notes.map((note) => ({
    ...note,
    within30Days: isWithin30Days(note.publishedAt, referenceDay),
  }));
}

export function enrichWeekendSnapshot(
  snapshot: WeekendPlannerSnapshot,
  _today?: string,
): WeekendPlannerSnapshot {
  const referenceDay = snapshot.weekendRange.from;
  const computedAge = ageOn(snapshot.childProfile.birthDay, referenceDay);
  return {
    ...snapshot,
    childProfile: computedAge
      ? {
          ...snapshot.childProfile,
          ageOnSaturday: computedAge,
          ageLabel: computedAge,
          ageFormula: `ageOn("${snapshot.childProfile.birthDay}", "${referenceDay}") = ${computedAge}`,
        }
      : { ...snapshot.childProfile },
    proposals: snapshot.proposals.map((proposal) => ({
      ...proposal,
      xhsEvidence: {
        ...proposal.xhsEvidence,
        notes: enrichNotes(proposal.xhsEvidence.notes, referenceDay),
      },
    })),
    inspirationPool: snapshot.inspirationPool.map((item) => ({
      ...item,
      xhsEvidence: enrichNotes(item.xhsEvidence, referenceDay),
    })),
  };
}

function isCacheFresh(at: number, nowMs: number): boolean {
  return nowMs >= at && nowMs - at < WEEKEND_CONTENT_TTL_MS;
}

async function readCachedSnapshotFile(
  cacheKey: string,
  filePath: string,
  nowMs: number,
  expectedWeekId?: string,
): Promise<WeekendPlannerSnapshot | null> {
  const held = snapshotCache.get(cacheKey);
  if (held && isCacheFresh(held.at, nowMs)) {
    return held.snapshot;
  }

  let snapshot: WeekendPlannerSnapshot | null = null;
  try {
    const raw = await readFile(filePath, "utf8");
    const validated = validateWeekendSnapshot(JSON.parse(raw));
    if (validated && (!expectedWeekId || validated.weekId === expectedWeekId)) {
      snapshot = validated;
    }
  } catch {
    snapshot = null;
  }

  snapshotCache.set(cacheKey, { at: nowMs, snapshot });
  return snapshot;
}

async function listWeekIdsDescending(dir: string, nowMs: number): Promise<string[]> {
  const cacheKey = `${dir}::weeks-index`;
  const held = weeksIndexCache.get(cacheKey);
  if (held && isCacheFresh(held.at, nowMs)) {
    return held.weekIds;
  }

  let weekIds: string[] = [];
  try {
    const entries = await readdir(path.join(dir, "weeks"));
    weekIds = entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -5))
      .filter((id) => isValidWeekId(id))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    weekIds = [];
  }

  weeksIndexCache.set(cacheKey, { at: nowMs, weekIds });
  return weekIds;
}

async function readWeekSnapshotRaw(
  dir: string,
  weekId: string,
  nowMs: number,
): Promise<WeekendPlannerSnapshot | null> {
  const filePath = path.join(dir, "weeks", `${weekId}.json`);
  const fromWeeks = await readCachedSnapshotFile(`${dir}::week::${weekId}`, filePath, nowMs, weekId);
  if (fromWeeks) return fromWeeks;

  const current = await readCachedSnapshotFile(`${dir}::current`, path.join(dir, "current.json"), nowMs);
  if (current && current.weekId === weekId) return current;
  return null;
}

async function findFallbackHistoricalSnapshot(
  dir: string,
  today: string,
  nowMs: number,
  options: { preferredWeekId?: string; excludeWeekId?: string } = {},
): Promise<WeekendPlannerSnapshot | null> {
  if (options.preferredWeekId && isValidWeekId(options.preferredWeekId) && options.preferredWeekId !== options.excludeWeekId) {
    const preferred = await readWeekSnapshotRaw(dir, options.preferredWeekId, nowMs);
    if (preferred) {
      const enriched = enrichWeekendSnapshot(preferred, today);
      const isPast = today > enriched.weekendRange.to || enriched.status === "expired";
      return isPast ? { ...enriched, status: "expired" } : enriched;
    }
  }

  const weekIds = await listWeekIdsDescending(dir, nowMs);
  for (const id of weekIds) {
    if (options.excludeWeekId && id === options.excludeWeekId) continue;
    const raw = await readWeekSnapshotRaw(dir, id, nowMs);
    if (!raw) continue;
    const enriched = enrichWeekendSnapshot(raw, today);
    const isPast = today > enriched.weekendRange.to || enriched.status === "expired";
    return isPast ? { ...enriched, status: "expired" } : enriched;
  }
  return null;
}

export async function readCurrentWeekendBundle(now: Date = new Date()): Promise<WeekendCurrentBundle> {
  const dir = resolveWeekendContentDir();
  const nowMs = now.getTime();
  const today = productToday(now);

  const rawCurrent = await readCachedSnapshotFile(`${dir}::current`, path.join(dir, "current.json"), nowMs);

  if (!rawCurrent) {
    const historical = await findFallbackHistoricalSnapshot(dir, today, nowMs);
    return {
      effectiveStatus: "unavailable",
      today,
      isExpired: false,
      weekId: null,
      snapshot: null,
      historicalSnapshot: historical,
      statusHeadline: "本周推荐暂未更新",
      statusDetail: "暂未获取到本周最新方案，可查看常驻灵感或回看最近一期方案。",
    };
  }

  const enriched = enrichWeekendSnapshot(rawCurrent, today);
  const pastWeekend = today > enriched.weekendRange.to || enriched.status === "expired";

  if (pastWeekend) {
    return {
      effectiveStatus: "unavailable",
      today,
      isExpired: true,
      weekId: null,
      snapshot: null,
      historicalSnapshot: { ...enriched, status: "expired" },
      statusHeadline: "本周推荐暂未更新",
      statusDetail: `当前最新一期方案停留在 ${enriched.weekendRange.label}（已过期），本周推荐暂未更新，可只读回看往期方案或查看常驻灵感。`,
    };
  }

  if (enriched.status === "unavailable") {
    const historical = await findFallbackHistoricalSnapshot(dir, today, nowMs, {
      preferredWeekId: enriched.unavailableNotice?.fallbackArchiveWeekId,
      excludeWeekId: enriched.weekId,
    });
    return {
      effectiveStatus: "unavailable",
      today,
      isExpired: false,
      weekId: enriched.weekId,
      snapshot: enriched,
      historicalSnapshot: historical,
      statusHeadline: enriched.unavailableNotice?.headline || "本周推荐暂未更新",
      statusDetail: enriched.unavailableNotice?.summary || "本周暂未拿到足够的小红书近期实拍，推荐暂未更新。",
    };
  }

  if (enriched.status === "collecting") {
    const historical = await findFallbackHistoricalSnapshot(dir, today, nowMs, {
      excludeWeekId: enriched.weekId,
    });
    return {
      effectiveStatus: "collecting",
      today,
      isExpired: false,
      weekId: enriched.weekId,
      snapshot: enriched,
      historicalSnapshot: historical,
      statusHeadline: "本周出行想法整理中",
      statusDetail: enriched.publishCadence?.note || "正在核对周末分段天气与近期实拍，周三晚出炉。",
    };
  }

  if (enriched.status === "rest_recommended") {
    return {
      effectiveStatus: "rest_recommended",
      today,
      isExpired: false,
      weekId: enriched.weekId,
      snapshot: enriched,
      historicalSnapshot: null,
      statusHeadline: "这周末适合在家附近轻松过",
      statusDetail: enriched.restRecommendation?.reason || "本周外围条件一般，优先家门口低负担微活动。",
    };
  }

  return {
    effectiveStatus: "published",
    today,
    isExpired: false,
    weekId: enriched.weekId,
    snapshot: enriched,
    historicalSnapshot: null,
    statusHeadline: "本周推荐已就绪",
    statusDetail: enriched.fridayAlert ? enriched.fridayAlert.headline : enriched.verificationSummaryNote,
  };
}

export async function readWeekendById(
  weekId: string,
  now: Date = new Date(),
): Promise<WeekendWeekBundle | null> {
  if (!isValidWeekId(weekId)) return null;
  const dir = resolveWeekendContentDir();
  const nowMs = now.getTime();
  const today = productToday(now);

  const raw = await readWeekSnapshotRaw(dir, weekId, nowMs);
  if (!raw) return null;

  const enriched = enrichWeekendSnapshot(raw, today);
  const isExpired = today > enriched.weekendRange.to || enriched.status === "expired";
  const effectiveStatus: EffectiveWeekendStatus = isExpired ? "expired" : enriched.status;

  return {
    effectiveStatus,
    today,
    isExpired,
    weekId: enriched.weekId,
    snapshot: isExpired ? { ...enriched, status: "expired" } : enriched,
  };
}
