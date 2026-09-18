import { readFile } from "node:fs/promises";
import path from "node:path";

// An edited month — the words a family actually reads — loaded from outside the repository.
//
// Why it lives outside: the text is this child's life (quoted messages, names, what he ate, when he
// was ill), and the media lists name specific pictures. None of that belongs in git, and none of it
// may sit under `public/`, where the web server would hand it to anyone who guessed the path. So the
// file is read at request time from a directory the operator points at with MONTH_CONTENT_DIR, and
// nothing about it reaches the client except the rendered page. What keeps it server-side is the
// `node:fs` import: pulling this module into a client component fails the build, which is the same
// guard the rest of lib/ relies on (this repo has no `server-only` dependency).
//
// Absent directory, absent file, or a file that fails validation all mean the same thing: this month
// has no edited content, and the page renders exactly as it did before. That fallback is the whole
// safety story, so validation has to be real — see isUsableDay. A file that is merely *shaped* like
// content (`{schema, month, days: [null]}`) used to pass and then throw inside the page.
//
// This does NOT decide what may be shown. The ids below are a reading ORDER, chosen when the file
// was written; whether each picture may still appear is re-decided on every render against the live
// review ledger (see resolveMonthContentMedia). A curated list can never outvote a `store_only`
// written after it.

export type MonthContentDay = {
  day: string;
  ageLabel?: string;
  kind: "story" | "visual-description" | "text-only";
  title: string | null;
  paragraphs: string[];
  firstScreenMediaIds: string[];
  expandedMediaIds: string[];
  storyBoundMediaIds?: string[];
  eventId?: string | null;
  /** Every original life_event merged into this day. An old /events/<id> link resolves through it. */
  eventIds?: string[];
  /** The raw sources this day's material section shows, already in time order. */
  sourceIds?: string[];
};

export type MonthContent = {
  schema: string;
  month: string;
  cardLine?: string;
  intro?: string;
  coverMediaId?: string;
  coverFocal?: { mobilePercent: number; desktopPercent: number };
  /**
   * How to name the person behind each source, keyed by source id.
   *
   * Keyed by SOURCE rather than by sender so the render path never handles a sender digest, and so
   * no mapping table exists in the page at all — a label is looked up for the one row being drawn.
   * Confirmed relations only (Teddy, 2026-09-18); everyone else keeps a stable anonymous label
   * rather than being flattened into 「家庭」, which is what the empty contributors table produced.
   */
  speakerBySourceId?: Record<string, string>;
  days: MonthContentDay[];
};

const SCHEMA = "nianlife.month-content/1";
const KINDS = new Set(["story", "visual-description", "text-only"]);

/**
 * How long a content file is trusted without re-reading it.
 *
 * The same 300s the archive memo uses, and for the same reason: a page render must not pay a disk
 * read per request, but an edit made to a file has to become visible on its own within a window a
 * person would wait through, not only after a restart. `invalidateMonthContent()` is the fast path —
 * the refresh endpoint calls it so a correction shows up on the next request instead of in five
 * minutes.
 */
export const MONTH_CONTENT_TTL_MS = 300_000;

type CacheEntry = { at: number; content: MonthContent | null };
let cache = new Map<string, CacheEntry>();

/** Drops every cached month, including the remembered absences. */
export function invalidateMonthContent(): void {
  cache = new Map();
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => isNonEmptyString(item));

const isPercent = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;

/**
 * The cover's vertical focal point, measured for THIS month's photograph in the real card at both
 * widths. It ends up inside a CSS value, so anything other than two plain percentages is refused.
 */
function isCoverFocal(value: unknown): value is { mobilePercent: number; desktopPercent: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const focal = value as Record<string, unknown>;
  return isPercent(focal.mobilePercent) && isPercent(focal.desktopPercent);
}

/**
 * Is this one day usable as written?
 *
 * Every field the page reads is checked, because the page reads them without guarding: it maps over
 * `paragraphs`, takes `.length` of the media arrays, and slices `day` for the date label. A single
 * malformed day takes the whole month down to the old layout rather than rendering a broken one —
 * a month that half-renders is harder to notice than a month that renders as it did last week.
 */
function isUsableDay(value: unknown, month: string): value is MonthContentDay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const day = value as Record<string, unknown>;
  if (!isNonEmptyString(day.day)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day.day)) return false;
  // A day from another month would sort into this month's timeline and print the wrong date.
  if (!day.day.startsWith(`${month}-`)) return false;
  if (Number.isNaN(Date.parse(`${day.day}T00:00:00Z`))) return false;
  if (!isNonEmptyString(day.kind) || !KINDS.has(day.kind)) return false;
  if (!(day.title === null || isNonEmptyString(day.title))) return false;
  if (!isStringArray(day.paragraphs)) return false;
  if (!isStringArray(day.firstScreenMediaIds)) return false;
  if (!isStringArray(day.expandedMediaIds)) return false;
  if (day.storyBoundMediaIds !== undefined && !isStringArray(day.storyBoundMediaIds)) return false;
  if (day.ageLabel !== undefined && !isNonEmptyString(day.ageLabel)) return false;
  if (day.eventId !== undefined && day.eventId !== null && !isNonEmptyString(day.eventId)) return false;
  if (day.eventIds !== undefined && !isStringArray(day.eventIds) && !(Array.isArray(day.eventIds) && day.eventIds.length === 0)) return false;
  if (day.sourceIds !== undefined && !isStringArray(day.sourceIds) && !(Array.isArray(day.sourceIds) && day.sourceIds.length === 0)) return false;
  // The first screen is meant to be the opening of the expanded set, not a second, different list.
  const expanded = new Set(day.expandedMediaIds);
  if (!day.firstScreenMediaIds.every((id) => expanded.has(id))) return false;
  // A day with neither words nor pictures would render as an empty dated block.
  if (day.title === null && day.paragraphs.length === 0 && day.expandedMediaIds.length === 0) return false;
  return true;
}

/** Is this file usable as a month? Returns the content, or null with nothing half-accepted. */
export function validateMonthContent(parsed: unknown, month: string): MonthContent | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const doc = parsed as Record<string, unknown>;
  if (doc.schema !== SCHEMA) return null;
  if (doc.month !== month) return null;
  if (!Array.isArray(doc.days) || doc.days.length === 0) return null;
  if (!doc.days.every((day) => isUsableDay(day, month))) return null;
  if (new Set((doc.days as MonthContentDay[]).map((day) => day.day)).size !== doc.days.length) return null;
  if (doc.cardLine !== undefined && !isNonEmptyString(doc.cardLine)) return null;
  if (doc.intro !== undefined && !isNonEmptyString(doc.intro)) return null;
  if (doc.coverMediaId !== undefined && !isNonEmptyString(doc.coverMediaId)) return null;
  if (doc.coverFocal !== undefined && !isCoverFocal(doc.coverFocal)) return null;
  if (doc.speakerBySourceId !== undefined) {
    const map = doc.speakerBySourceId as Record<string, unknown>;
    if (!map || typeof map !== "object" || Array.isArray(map)) return null;
    if (!Object.values(map).every((label) => isNonEmptyString(label))) return null;
  }
  return doc as unknown as MonthContent;
}

function isMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

/** The edited content for one month, or null when there is none. Never throws. */
export async function loadMonthContent(month: string, nowMs: number = Date.now()): Promise<MonthContent | null> {
  if (!isMonth(month)) return null;
  const held = cache.get(month);
  if (held && nowMs - held.at < MONTH_CONTENT_TTL_MS) return held.content;
  const dir = process.env.MONTH_CONTENT_DIR?.trim();
  if (!dir) {
    cache.set(month, { at: nowMs, content: null });
    return null;
  }
  let content: MonthContent | null = null;
  try {
    const raw = await readFile(path.join(dir, `${month}.json`), "utf8");
    content = validateMonthContent(JSON.parse(raw), month);
  } catch {
    content = null;
  }
  cache.set(month, { at: nowMs, content });
  return content;
}

/** The edited day an old event id now reads as, if any. Old links keep working through this. */
export function dayForEventId(content: MonthContent | null, eventId: string): MonthContentDay | null {
  if (!content) return null;
  return content.days.find((day) => (day.eventIds ?? []).includes(eventId) || day.eventId === eventId) ?? null;
}

/** The edited day for a calendar date, if any. */
export function dayForDate(content: MonthContent | null, day: string): MonthContentDay | null {
  if (!content) return null;
  return content.days.find((entry) => entry.day === day) ?? null;
}

/**
 * Turns a curated id list into the media a page may actually draw, in the curated order.
 *
 * Two gates, both re-applied here rather than trusted from the file:
 *   - the id must still resolve to deliverable, family-visible media (`available`, which the archive
 *     load already filtered), and
 *   - it must not be in `excluded` — the latest `media_subject_check` of `store_only`. A reviewer who
 *     opened a file after this list was written has the last word; a cached selection does not get to
 *     outlive their decision.
 */
export function resolveMonthContentMedia<T extends { id: string }>(
  ids: readonly string[],
  available: ReadonlyMap<string, T>,
  excluded?: ReadonlySet<string>,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (excluded?.has(id)) continue;
    const media = available.get(id);
    if (media) out.push(media);
  }
  return out;
}

/**
 * The pictures a day's material section may draw, out of those its cited messages carried.
 *
 * They reach the page by a different road from the photo area (raw_sources.media_ids rather than the
 * curated list), so the veto the photo area applies is applied here as well: a reviewer's latest
 * store_only takes a picture off every surface of the day, not only the one the curation fed.
 */
export function gateMaterialMedia<T extends { id: string }>(media: readonly T[], excluded?: ReadonlySet<string>): T[] {
  return excluded?.size ? media.filter((item) => !excluded.has(item.id)) : [...media];
}
