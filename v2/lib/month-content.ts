import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

// An edited month — the words a family actually reads — loaded from outside the repository.
//
// Why it lives outside: the text is this child's life (quoted messages, names, what he ate, when he
// was ill), and the media lists name specific pictures. None of that belongs in git, and none of it
// may sit under `public/`, where the web server would hand it to anyone who guessed the path. So the
// file is read at request time from a directory the operator points at with MONTH_CONTENT_DIR, by
// server-only code, and nothing about it reaches the client except the rendered page.
//
// Absent directory, absent file, or malformed JSON all mean the same thing: this month has no
// edited content, the page renders exactly as it did before. That is the fallback for every month
// except the ones that have been through the curation and story steps — currently 2026-09 only.
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
};

export type MonthContent = {
  schema: string;
  month: string;
  cardLine?: string;
  intro?: string;
  coverMediaId?: string;
  coverFocal?: { mobilePercent: number; desktopPercent: number };
  days: MonthContentDay[];
};

const SCHEMA = "nianlife.month-content/1";
const cache = new Map<string, MonthContent | null>();

function isMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

/** The edited content for one month, or null when there is none. Never throws. */
export async function loadMonthContent(month: string): Promise<MonthContent | null> {
  if (!isMonth(month)) return null;
  if (cache.has(month)) return cache.get(month) ?? null;
  const dir = process.env.MONTH_CONTENT_DIR?.trim();
  if (!dir) {
    cache.set(month, null);
    return null;
  }
  try {
    const raw = await readFile(path.join(dir, `${month}.json`), "utf8");
    const parsed = JSON.parse(raw) as MonthContent;
    // A file whose shape changed under us is treated as absent rather than rendered half-understood.
    const usable = parsed?.schema === SCHEMA && parsed.month === month && Array.isArray(parsed.days)
      ? parsed
      : null;
    cache.set(month, usable);
    return usable;
  } catch {
    cache.set(month, null);
    return null;
  }
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
