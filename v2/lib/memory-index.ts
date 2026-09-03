// The read model behind /memory, /memory/[year] and /memory/[year]/[month]: chapters (already
// ordered by life time in lib/memory-chapters.ts) narrowed to what each layer shows under
// lib/memory-ia-policy.ts. Pure and deterministic; pages lay it out and never re-sort or re-count.
import type { EditorialMemory, MonthChapter, MediaRef, TraceDay, YearChapter } from "@/lib/memory-chapters";
import { DEFAULT_MEMORY_IA_POLICY, type MemoryIaPolicy } from "@/lib/memory-ia-policy";
import { buildMonthComposition, NO_PRIVILEGE, type MediaPrivilege, type MonthComposition } from "@/lib/publication-moments";

const WEIGHT_RANK: Record<EditorialMemory["weight"], number> = { chapter: 0, highlight: 1, memory: 2, trace: 3 };

// The few memories that stand for a month on an index page: heaviest weight first, then the ones
// with a photo, then the newest — and handed back in the chapter's own (newest-first) order so the
// page still reads as time. Same input, same output on every backend.
export function curateMemories(memories: EditorialMemory[], limit: number): EditorialMemory[] {
  if (memories.length <= limit) return memories;
  const ranked = memories.map((memory, position) => ({ memory, position })).sort((a, b) =>
    WEIGHT_RANK[a.memory.weight] - WEIGHT_RANK[b.memory.weight]
    || Number(Boolean(b.memory.lead)) - Number(Boolean(a.memory.lead))
    || a.position - b.position);
  return ranked.slice(0, limit).sort((a, b) => a.position - b.position).map((item) => item.memory);
}

export type TraceFold = {
  dayCount: number;
  // Days shown inline (each with entries capped), newest first.
  days: { day: string; dateLabel: string; entries: string[]; hiddenEntryCount: number }[];
  hiddenDayCount: number;
};

// Ordinary days, folded: the count is the point; the inline list is bounded by policy so a month
// with thirty busy days is still one quiet disclosure, and the month page carries the rest.
export function foldTraces(traceDays: TraceDay[], policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY, inlineDays = policy.traceDaysInline): TraceFold {
  const shown = traceDays.slice(0, inlineDays);
  return {
    dayCount: traceDays.length,
    days: shown.map((day) => ({ day: day.day, dateLabel: day.dateLabel, entries: day.entries.slice(0, policy.traceEntriesPerDay), hiddenEntryCount: Math.max(0, day.entries.length - policy.traceEntriesPerDay) })),
    hiddenDayCount: traceDays.length - shown.length,
  };
}

export type MonthIndexEntry = {
  chapter: MonthChapter;
  // "open": curated memories in full plus the trace fold; "index": one row.
  mode: "open" | "index";
  featured: EditorialMemory[];
  memoryCount: number;
  hiddenMemoryCount: number;
  traces: TraceFold;
  href: string;
  // Open months only: the month's editorial face from lib/publication-moments.ts — vouched
  // pictures or none. The index never slices month.media/photos itself; a month without a vouched
  // picture shows type, and the photo total is quiet metadata, not the visual.
  preview: MediaRef[];
  compositionMode: MonthComposition["mode"];
};

export type YearIndexEntry = { year: string; ageSpan?: string; href: string; months: MonthIndexEntry[]; memoryCount: number; traceDayCount: number };

export type MemoryIndex = {
  years: YearIndexEntry[];
  // Year → age navigation, newest first: the reader finds a stretch of life by either handle.
  nav: { year: string; ageSpan?: string; href: string }[];
};

export function monthHref(month: string): string {
  return `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}`;
}

// /memory: the newest months open until roughly `openMemoriesTarget` curated memories are on the
// page or `openMonthsMax` months are open, whichever comes first — in a photograph-heavy archive
// the memory target alone would never close the window. Months after that are index rows. Months
// with only traces count as open while inside the window so the fold appears naturally, and never
// push the memory window forward by themselves.
export function buildMemoryIndex(chapters: YearChapter[], policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY, privilege: MediaPrivilege = NO_PRIVILEGE): MemoryIndex {
  let shown = 0;
  let opened = 0;
  const years = chapters.map((year) => {
    const months = year.months.map((chapter): MonthIndexEntry => {
      // A month with nothing it can currently show (every photo withheld, nothing written) is an
      // index row even inside the open window: the month exists and keeps its page, but /memory
      // does not print an empty section — and it does not consume the window.
      const bare = chapter.memories.length === 0 && chapter.photos.length === 0 && chapter.traceDays.length === 0;
      let open = !bare && shown < policy.openMemoriesTarget && opened < policy.openMonthsMax;
      let composition = open ? buildMonthComposition(chapter, privilege) : undefined;
      // An open section must have something to say: a memory, a readable moment, or a vouched
      // picture. A month of nothing but unvouched photography is a real month with a real page,
      // but on the directory it is one row — it neither prints an empty section nor consumes the
      // open window.
      if (open && composition && composition.chapter.length === 0 && composition.preview.length === 0) {
        open = false;
        composition = undefined;
      }
      const featured = open ? curateMemories(chapter.memories, policy.curatedPerMonth) : [];
      if (open) { shown += featured.length; opened += 1; }
      return {
        chapter,
        mode: open ? "open" : "index",
        featured,
        memoryCount: chapter.memories.length,
        hiddenMemoryCount: chapter.memories.length - featured.length,
        traces: foldTraces(chapter.traceDays, policy),
        href: monthHref(chapter.month),
        preview: composition?.preview ?? [],
        compositionMode: composition?.mode ?? "typography",
      };
    });
    return {
      year: year.year,
      ageSpan: year.ageSpan,
      href: `/memory/${year.year}`,
      months,
      memoryCount: months.reduce((sum, month) => sum + month.memoryCount, 0),
      traceDayCount: months.reduce((sum, month) => sum + month.traces.dayCount, 0),
    };
  });
  return { years, nav: years.map(({ year, ageSpan, href }) => ({ year, ageSpan, href })) };
}

// /memory/[year]: every month of the year with a few titles each; the month page has the rest.
// Month pictures are the composition's vouched preview, same rule as /memory.
export type YearMonthEntry = { chapter: MonthChapter; titles: EditorialMemory[]; hiddenMemoryCount: number; traceDayCount: number; href: string; preview: MediaRef[] };

export function buildYearView(year: YearChapter, policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY, privilege: MediaPrivilege = NO_PRIVILEGE): { months: YearMonthEntry[]; memoryCount: number; traceDayCount: number; photoCount: number } {
  const months = year.months.map((chapter): YearMonthEntry => {
    const titles = curateMemories(chapter.memories, policy.yearTitlesPerMonth);
    return { chapter, titles, hiddenMemoryCount: chapter.memories.length - titles.length, traceDayCount: chapter.traceDays.length, href: monthHref(chapter.month), preview: buildMonthComposition(chapter, privilege).preview };
  });
  return { months, memoryCount: months.reduce((sum, month) => sum + month.chapter.memories.length, 0), traceDayCount: months.reduce((sum, month) => sum + month.traceDayCount, 0), photoCount: months.reduce((sum, month) => sum + month.chapter.photoCount, 0) };
}

// /memory/[year]/[month] no longer builds its own day view here: the month page reads
// lib/publication-moments.ts (chapter / chronicle / quiet days / archive) so the month is a
// publication with hierarchy rather than an equal-weight walk of every photographed day.
