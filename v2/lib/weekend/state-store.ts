// Atomic, lock-protected file store for Nianlife V2 Weekend Planner state.
// Pattern matches HealthFileStore:
//   repository-containment guard -> acquire directory lock (weekend-state.lock/owner.json) ->
//   cleanup orphan temps -> read latest -> pure update -> temp write + fsync -> re-verify lock ownership ->
//   atomic rename -> release lock.

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertOutsideRepository, ContainmentError } from "@/lib/review/repo-path";
import { DEFAULT_WEEKEND_CONTENT_DIR, isValidWeekId } from "./content";
import type {
  DepartureKey,
  ExcludedExperienceTypeItem,
  SundayOutcome,
  WeekendExcludedTypesFile,
  WeekendStateFile,
} from "./types";

export const WEEKEND_STATE_SCHEMA = "nianlife.weekend-state/1";
export const WEEKEND_EXCLUDED_TYPES_SCHEMA = "nianlife.weekend-excluded-types/1";
const WEEKEND_STATE_CACHE_TTL_MS = 300_000;

let weekStateCache = new Map<string, { at: number; promise: Promise<WeekendStateFile> }>();
let excludedTypesCache = new Map<string, { at: number; promise: Promise<ExcludedExperienceTypeItem[]> }>();

export function invalidateWeekendStateCache(dir?: string, weekId?: string): void {
  if (!dir) {
    weekStateCache = new Map();
    excludedTypesCache = new Map();
    return;
  }
  const resolved = path.resolve(dir);
  if (weekId) {
    weekStateCache.delete(`${resolved}::${weekId}`);
    return;
  }
  for (const key of weekStateCache.keys()) {
    if (key.startsWith(`${resolved}::`)) weekStateCache.delete(key);
  }
  excludedTypesCache.delete(resolved);
}

export const DEFAULT_EXCLUDED_EXPERIENCE_TYPES: readonly ExcludedExperienceTypeItem[] = [
  {
    experienceType: "art_museum_exhibition",
    label: "美术馆/艺术展",
    excludedAt: "2026-11-17T00:10:00.000Z",
    addedBy: "family_rule",
  },
];

export class WeekendStateError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "WeekendStateError";
    this.status = status;
    this.code = code;
  }
}

export interface WeekendStateStoreOptions {
  lockTimeoutMs?: number;
  staleLockMs?: number;
  failBeforeRename?: boolean;
  beforeCommit?: () => Promise<void>;
  afterAcquire?: () => Promise<void>;
}

interface LockOwner {
  token: string;
  pid: number;
  host: string;
  startedAt: number;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function cloneDefaultExcludedTypes(): ExcludedExperienceTypeItem[] {
  return DEFAULT_EXCLUDED_EXPERIENCE_TYPES.map((item) => ({ ...item }));
}

export function resolveWeekendStateDir(): string {
  const explicit = process.env.WEEKEND_STATE_DIR?.trim();
  if (explicit) return explicit;
  const contentDir = process.env.WEEKEND_CONTENT_DIR?.trim() || DEFAULT_WEEKEND_CONTENT_DIR;
  return path.join(contentDir, "state");
}

export function emptyWeekendState(weekId: string): WeekendStateFile {
  return {
    schema: WEEKEND_STATE_SCHEMA,
    weekId,
    updatedAt: null,
    selectedProposalId: null,
    selectedDeparture: null,
    fridayAlertAck: {
      adoptedSwap: false,
      updatedAt: null,
    },
    sundayFeedback: {
      outcome: null,
      tags: [],
      submittedAt: null,
      proposalId: null,
    },
    feedbackReceiptKeys: [],
  };
}

function resolveContainmentBoundary(): { literal: string; real: string } {
  const candidates: string[] = [process.cwd()];
  try {
    candidates.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    // Bundled server environments may not have a file:// URL.
  }

  for (const start of candidates) {
    let current = path.resolve(start);
    for (;;) {
      if (existsSync(path.join(current, ".git"))) {
        return { literal: current, real: realpathSync.native(current) };
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  // Standalone Docker image (/app) has no .git directory: guard against writing inside the app root.
  const fallback = path.resolve(process.cwd());
  return { literal: fallback, real: realpathSync.native(fallback) };
}

function assertValidWeekIdOrThrow(weekId: string): void {
  if (!isValidWeekId(weekId)) {
    throw new WeekendStateError(400, "INVALID_WEEK_ID", "weekId must match YYYY-MM-DD (valid calendar date in 2020-2099)");
  }
}

function normalizeWeekState(parsed: unknown, weekId: string): WeekendStateFile {
  const base = emptyWeekendState(weekId);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return base;
  const doc = parsed as Record<string, unknown>;
  const fridayAck =
    doc.fridayAlertAck && typeof doc.fridayAlertAck === "object" && !Array.isArray(doc.fridayAlertAck)
      ? (doc.fridayAlertAck as Record<string, unknown>)
      : null;
  const feedback =
    doc.sundayFeedback && typeof doc.sundayFeedback === "object" && !Array.isArray(doc.sundayFeedback)
      ? (doc.sundayFeedback as Record<string, unknown>)
      : null;

  const selectedDeparture =
    doc.selectedDeparture === "sat_morning" || doc.selectedDeparture === "sat_afternoon"
      ? doc.selectedDeparture
      : null;

  const validOutcomes = new Set<SundayOutcome>([
    "went_loved",
    "went_adult_meh",
    "went_tired",
    "went_pitfall",
    "stayed_home",
  ]);
  const outcome =
    typeof feedback?.outcome === "string" && validOutcomes.has(feedback.outcome as SundayOutcome)
      ? (feedback.outcome as SundayOutcome)
      : null;

  const feedbackReceiptKeys = Array.isArray(doc.feedbackReceiptKeys)
    ? doc.feedbackReceiptKeys.filter((k): k is string => typeof k === "string" && k.length > 0)
    : [];

  return {
    schema: WEEKEND_STATE_SCHEMA,
    weekId,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
    selectedProposalId: typeof doc.selectedProposalId === "string" ? doc.selectedProposalId : null,
    selectedDeparture,
    ...(doc.checklist && typeof doc.checklist === "object" && !Array.isArray(doc.checklist)
      ? { checklist: doc.checklist as Record<string, boolean> }
      : {}),
    fridayAlertAck: {
      adoptedSwap: Boolean(fridayAck?.adoptedSwap),
      updatedAt: typeof fridayAck?.updatedAt === "string" ? fridayAck.updatedAt : null,
    },
    sundayFeedback: {
      outcome,
      tags: Array.isArray(feedback?.tags)
        ? feedback.tags.filter((t): t is string => typeof t === "string" && t.length > 0)
        : [],
      submittedAt: typeof feedback?.submittedAt === "string" ? feedback.submittedAt : null,
      proposalId: typeof feedback?.proposalId === "string" ? feedback.proposalId : null,
    },
    feedbackReceiptKeys,
  };
}

function normalizeExcludedItem(value: unknown): ExcludedExperienceTypeItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.experienceType !== "string" || item.experienceType.trim().length === 0) return null;
  const experienceType = item.experienceType.trim();
  const label = typeof item.label === "string" && item.label.trim().length > 0 ? item.label.trim() : experienceType;
  const excludedAt =
    typeof item.excludedAt === "string" && item.excludedAt.trim().length > 0
      ? item.excludedAt
      : new Date(0).toISOString();
  return {
    experienceType,
    label,
    excludedAt,
    ...(typeof item.addedBy === "string" && item.addedBy.trim().length > 0 ? { addedBy: item.addedBy.trim() } : {}),
    ...(typeof item.note === "string" && item.note.trim().length > 0 ? { note: item.note.trim() } : {}),
  };
}

function parseExcludedTypesFile(parsed: unknown): ExcludedExperienceTypeItem[] {
  let rawList: unknown[] | null = null;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.excludedExperienceTypes)) rawList = obj.excludedExperienceTypes;
    else if (Array.isArray(obj.items)) rawList = obj.items;
  }
  if (!rawList) throw new Error("excluded-types.json has invalid format");

  const seen = new Set<string>();
  const out: ExcludedExperienceTypeItem[] = [];
  for (const entry of rawList) {
    const normalized = normalizeExcludedItem(entry);
    if (!normalized || seen.has(normalized.experienceType)) continue;
    seen.add(normalized.experienceType);
    out.push(normalized);
  }
  return out;
}

export class WeekendStateStore {
  readonly dir: string;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;
  private readonly hooks: Pick<WeekendStateStoreOptions, "failBeforeRename" | "beforeCommit" | "afterAcquire">;

  constructor(dir: string = resolveWeekendStateDir(), opts: WeekendStateStoreOptions = {}) {
    this.dir = path.resolve(dir);
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 30_000;
    this.staleLockMs = opts.staleLockMs ?? 60_000;
    this.hooks = {
      failBeforeRename: opts.failBeforeRename,
      beforeCommit: opts.beforeCommit,
      afterAcquire: opts.afterAcquire,
    };
  }

  private get lockDir(): string {
    return path.join(this.dir, "weekend-state.lock");
  }

  private get ownerFile(): string {
    return path.join(this.lockDir, "owner.json");
  }

  private get excludedTypesFile(): string {
    return path.join(this.dir, "excluded-types.json");
  }

  private weekStateFile(weekId: string): string {
    assertValidWeekIdOrThrow(weekId);
    const resolved = path.resolve(this.dir, `${weekId}.json`);
    if (path.dirname(resolved) !== this.dir) {
      throw new WeekendStateError(400, "INVALID_WEEK_ID", "weekId path resolution mismatch");
    }
    return resolved;
  }

  private assertSafePreLockTargets(targetPath: string): void {
    const boundary = resolveContainmentBoundary();
    assertOutsideRepository(this.dir, boundary);
    assertOutsideRepository(targetPath, boundary);
    try {
      const lockStat = lstatSync(this.lockDir);
      if (lockStat.isSymbolicLink()) {
        throw new ContainmentError("INSIDE_REPOSITORY_THROUGH_LINK", `${this.lockDir} must not be a symlink`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private assertSafeLockedTargets(targetPath: string): void {
    const boundary = resolveContainmentBoundary();
    assertOutsideRepository(this.dir, boundary);
    assertOutsideRepository(this.lockDir, boundary);
    assertOutsideRepository(targetPath, boundary);
  }

  private async readOwner(): Promise<LockOwner | null> {
    try {
      const parsed = JSON.parse(await readFile(this.ownerFile, "utf8")) as LockOwner;
      return parsed && typeof parsed.token === "string" && typeof parsed.pid === "number" ? parsed : null;
    } catch {
      return null;
    }
  }

  private async removeDir(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true, maxRetries: 50, retryDelay: 10 });
  }

  private async reclaim(expectedToken: string | null): Promise<void> {
    const mutex = `${this.lockDir}.reclaim`;
    try {
      await mkdir(mutex);
    } catch {
      try {
        const s = await stat(mutex);
        if (Date.now() - s.mtimeMs > Math.max(5000, this.staleLockMs)) await this.removeDir(mutex);
      } catch {
        // Released meanwhile.
      }
      return;
    }
    try {
      const owner = await this.readOwner();
      let stale = false;
      if (owner) {
        if (owner.token === expectedToken) {
          if (owner.host === os.hostname()) {
            stale = !pidAlive(owner.pid);
          } else {
            const s = await stat(this.ownerFile).catch(() => null);
            stale = Boolean(s) && Date.now() - s!.mtimeMs > this.staleLockMs;
          }
        }
      } else if (expectedToken === null) {
        const s = await stat(this.lockDir).catch(() => null);
        stale = Boolean(s) && Date.now() - s!.mtimeMs > this.staleLockMs;
      }
      if (!stale) return;
      await this.removeDir(this.lockDir);
    } finally {
      await this.removeDir(mutex);
    }
  }

  private async acquire(): Promise<{ token: string; stop: () => void }> {
    assertOutsideRepository(this.dir, resolveContainmentBoundary());
    await mkdir(this.dir, { recursive: true });
    const deadline = Date.now() + this.lockTimeoutMs;
    const token = randomUUID();
    for (let attempt = 0; ; attempt++) {
      try {
        await mkdir(this.lockDir);
        const owner: LockOwner = { token, pid: process.pid, host: os.hostname(), startedAt: Date.now() };
        await writeFile(this.ownerFile, JSON.stringify(owner));
        try {
          assertOutsideRepository(this.lockDir, resolveContainmentBoundary());
        } catch (error) {
          await this.removeDir(this.lockDir).catch(() => {});
          throw error;
        }
        const beat = setInterval(() => {
          const t = new Date();
          utimes(this.ownerFile, t, t).catch(() => {});
        }, Math.max(50, this.staleLockMs / 4));
        beat.unref();
        return { token, stop: () => clearInterval(beat) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }

      const owner = await this.readOwner();
      if (owner) {
        if (owner.host === os.hostname()) {
          if (!pidAlive(owner.pid)) {
            await this.reclaim(owner.token);
            continue;
          }
        } else {
          try {
            const s = await stat(this.ownerFile);
            if (Date.now() - s.mtimeMs > this.staleLockMs) {
              await this.reclaim(owner.token);
              continue;
            }
          } catch {
            // Raced while reading owner file.
          }
        }
      } else {
        try {
          const s = await stat(this.lockDir);
          if (Date.now() - s.mtimeMs > this.staleLockMs) {
            await this.reclaim(null);
            continue;
          }
        } catch {
          continue;
        }
      }

      if (Date.now() > deadline) {
        throw new WeekendStateError(503, "LOCK_TIMEOUT", "weekend state lock timeout");
      }
      await new Promise((resolve) => setTimeout(resolve, 5 + Math.min(attempt, 20) * 3));
    }
  }

  private async ownsLock(token: string): Promise<boolean> {
    return (await this.readOwner())?.token === token;
  }

  private async release(token: string): Promise<void> {
    if (!(await this.ownsLock(token))) return;
    await this.removeDir(this.lockDir);
  }

  private async renameWithRetry(tmp: string, targetFile: string, token: string): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!(await this.ownsLock(token))) {
        await rm(tmp, { force: true });
        throw new Error("weekend state lock was lost before commit; nothing written");
      }
      try {
        await rename(tmp, targetFile);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code === "EPERM" || code === "EACCES" || code === "EBUSY") && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
          continue;
        }
        await rm(tmp, { force: true }).catch(() => {});
        throw error;
      }
    }
  }

  private async withWriteLock<T>(
    targetFile: string,
    fn: () => Promise<{ payloadToWrite?: unknown; result: T }>,
  ): Promise<T> {
    this.assertSafePreLockTargets(targetFile);
    const { token, stop } = await this.acquire();
    try {
      if (this.hooks.afterAcquire) await this.hooks.afterAcquire();

      const base = path.basename(targetFile);
      for (const entry of await readdir(this.dir)) {
        if (entry.startsWith(`${base}.`) && entry.endsWith(".tmp")) {
          await rm(path.join(this.dir, entry), { force: true });
        }
      }

      const { payloadToWrite, result } = await fn();
      if (payloadToWrite !== undefined) {
        this.assertSafeLockedTargets(targetFile);
        const tmp = `${targetFile}.${process.pid}.${randomUUID()}.tmp`;
        const fh = await open(tmp, "w");
        try {
          await fh.writeFile(JSON.stringify(payloadToWrite, null, 2));
          await fh.sync();
        } finally {
          await fh.close();
        }
        if (this.hooks.failBeforeRename) {
          throw new Error("injected failure before rename");
        }
        if (this.hooks.beforeCommit) await this.hooks.beforeCommit();
        await this.renameWithRetry(tmp, targetFile, token);
        try {
          const dirHandle = await open(this.dir, "r");
          try {
            await dirHandle.sync();
          } finally {
            await dirHandle.close();
          }
        } catch {
          // Directory fsync is unsupported on Windows.
        }
      }
      return result;
    } finally {
      stop();
      await this.release(token);
    }
  }

  private async readWeekStateFromDisk(weekId: string): Promise<WeekendStateFile> {
    const file = this.weekStateFile(weekId);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyWeekendState(weekId);
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new WeekendStateError(500, "CORRUPT_STATE_FILE", `${weekId}.json is not valid JSON`);
    }
    return normalizeWeekState(parsed, weekId);
  }

  async readWeekState(weekId: string): Promise<WeekendStateFile> {
    const file = this.weekStateFile(weekId);
    void file;
    const key = `${this.dir}::${weekId}`;
    const now = Date.now();
    const held = weekStateCache.get(key);
    if (held && now - held.at < WEEKEND_STATE_CACHE_TTL_MS) {
      return structuredClone(await held.promise);
    }
    const promise = this.readWeekStateFromDisk(weekId);
    weekStateCache.set(key, { at: now, promise });
    promise.catch(() => {
      if (weekStateCache.get(key)?.promise === promise) weekStateCache.delete(key);
    });
    return structuredClone(await promise);
  }

  private async readExcludedTypesFromDisk(): Promise<ExcludedExperienceTypeItem[]> {
    let text: string;
    try {
      text = await readFile(this.excludedTypesFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return cloneDefaultExcludedTypes();
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new WeekendStateError(500, "CORRUPT_EXCLUDED_TYPES", "excluded-types.json is not valid JSON");
    }
    return parseExcludedTypesFile(parsed);
  }

  async readExcludedTypes(): Promise<ExcludedExperienceTypeItem[]> {
    const now = Date.now();
    const held = excludedTypesCache.get(this.dir);
    if (held && now - held.at < WEEKEND_STATE_CACHE_TTL_MS) {
      return (await held.promise).map((item) => ({ ...item }));
    }
    const promise = this.readExcludedTypesFromDisk();
    excludedTypesCache.set(this.dir, { at: now, promise });
    promise.catch(() => {
      if (excludedTypesCache.get(this.dir)?.promise === promise) excludedTypesCache.delete(this.dir);
    });
    return (await promise).map((item) => ({ ...item }));
  }

  async selectProposal(input: {
    weekId: string;
    proposalId: string | null;
    departure?: DepartureKey;
    now?: Date;
  }): Promise<WeekendStateFile> {
    const file = this.weekStateFile(input.weekId);
    const nowIso = (input.now ?? new Date()).toISOString();
    const result = await this.withWriteLock<WeekendStateFile>(file, async () => {
      const current = await this.readWeekStateFromDisk(input.weekId);
      const next: WeekendStateFile = {
        ...current,
        updatedAt: nowIso,
        selectedProposalId: input.proposalId,
        selectedDeparture: input.departure !== undefined ? input.departure : current.selectedDeparture,
      };
      return { payloadToWrite: next, result: next };
    });
    invalidateWeekendStateCache(this.dir, input.weekId);
    return result;
  }

  async ackFridayAlert(input: {
    weekId: string;
    adoptedSwap: boolean;
    now?: Date;
  }): Promise<WeekendStateFile> {
    const file = this.weekStateFile(input.weekId);
    const nowIso = (input.now ?? new Date()).toISOString();
    const result = await this.withWriteLock<WeekendStateFile>(file, async () => {
      const current = await this.readWeekStateFromDisk(input.weekId);
      const next: WeekendStateFile = {
        ...current,
        updatedAt: nowIso,
        fridayAlertAck: {
          adoptedSwap: input.adoptedSwap,
          updatedAt: nowIso,
        },
      };
      return { payloadToWrite: next, result: next };
    });
    invalidateWeekendStateCache(this.dir, input.weekId);
    return result;
  }

  async submitSundayFeedback(input: {
    weekId: string;
    outcome: SundayOutcome;
    tags?: string[];
    proposalId?: string | null;
    receiptKey?: string;
    now?: Date;
  }): Promise<{ state: WeekendStateFile; deduplicated: boolean }> {
    const file = this.weekStateFile(input.weekId);
    const nowIso = (input.now ?? new Date()).toISOString();
    const outcome = await this.withWriteLock<{ state: WeekendStateFile; deduplicated: boolean }>(file, async () => {
      const current = await this.readWeekStateFromDisk(input.weekId);
      if (input.receiptKey && current.feedbackReceiptKeys.includes(input.receiptKey)) {
        return { result: { state: current, deduplicated: true } };
      }

      const cleanTags = Array.from(
        new Set((input.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0)),
      );
      const generatedKey = input.receiptKey ?? `feedback:${nowIso}:${input.outcome}`;
      const keys = current.feedbackReceiptKeys.includes(generatedKey)
        ? current.feedbackReceiptKeys
        : [...current.feedbackReceiptKeys, generatedKey].slice(-100);

      const next: WeekendStateFile = {
        ...current,
        updatedAt: nowIso,
        sundayFeedback: {
          outcome: input.outcome,
          tags: cleanTags,
          submittedAt: nowIso,
          proposalId: input.proposalId !== undefined ? input.proposalId : current.selectedProposalId,
        },
        feedbackReceiptKeys: keys,
      };
      return { payloadToWrite: next, result: { state: next, deduplicated: false } };
    });
    invalidateWeekendStateCache(this.dir, input.weekId);
    return outcome;
  }

  async updateExcludedType(input: {
    mode: "add" | "remove";
    experienceType: string;
    label?: string;
    addedBy?: string;
    note?: string;
    now?: Date;
  }): Promise<ExcludedExperienceTypeItem[]> {
    const nowIso = (input.now ?? new Date()).toISOString();
    const experienceType = input.experienceType.trim();
    const result = await this.withWriteLock(this.excludedTypesFile, async () => {
      const current = await this.readExcludedTypesFromDisk();
      let nextList: ExcludedExperienceTypeItem[];

      if (input.mode === "add") {
        if (current.some((item) => item.experienceType === experienceType)) {
          return { result: current };
        }
        const entry: ExcludedExperienceTypeItem = {
          experienceType,
          label: input.label?.trim() || experienceType,
          excludedAt: nowIso,
          ...(input.addedBy?.trim() ? { addedBy: input.addedBy.trim() } : {}),
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        };
        nextList = [...current, entry];
      } else {
        nextList = current.filter((item) => item.experienceType !== experienceType);
      }

      const payload: WeekendExcludedTypesFile = {
        schema: WEEKEND_EXCLUDED_TYPES_SCHEMA,
        updatedAt: nowIso,
        excludedExperienceTypes: nextList,
      };
      return { payloadToWrite: payload, result: nextList };
    });
    excludedTypesCache.delete(this.dir);
    return result;
  }
}
