// The read model behind /memory, /memory/[year] and /memory/[year]/[month]: chapters (already
// ordered by life time in lib/memory-chapters.ts) narrowed to what each layer shows under
// lib/memory-ia-policy.ts. Pure and deterministic; pages lay it out and never re-sort or re-count.
import type { EditorialMemory, MonthChapter, TraceDay, YearChapter } from "@/lib/memory-chapters";
import { DEFAULT_MEMORY_IA_POLICY, type MemoryIaPolicy } from "@/lib/memory-ia-policy";

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
// page; months after that are index rows. Months with only traces count as open while inside the
// window so the fold appears naturally, and never push the window forward by themselves.
export function buildMemoryIndex(chapters: YearChapter[], policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY): MemoryIndex {
  let shown = 0;
  const years = chapters.map((year) => {
    const months = year.months.map((chapter): MonthIndexEntry => {
      const open = shown < policy.openMemoriesTarget;
      const featured = open ? curateMemories(chapter.memories, policy.curatedPerMonth) : [];
      if (open) shown += featured.length;
      return {
        chapter,
        mode: open ? "open" : "index",
        featured,
        memoryCount: chapter.memories.length,
        hiddenMemoryCount: chapter.memories.length - featured.length,
        traces: foldTraces(chapter.traceDays, policy),
        href: monthHref(chapter.month),
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
export type YearMonthEntry = { chapter: MonthChapter; titles: EditorialMemory[]; hiddenMemoryCount: number; traceDayCount: number; href: string };

export function buildYearView(year: YearChapter, policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY): { months: YearMonthEntry[]; memoryCount: number; traceDayCount: number } {
  const months = year.months.map((chapter): YearMonthEntry => {
    const titles = curateMemories(chapter.memories, policy.yearTitlesPerMonth);
    return { chapter, titles, hiddenMemoryCount: chapter.memories.length - titles.length, traceDayCount: chapter.traceDays.length, href: monthHref(chapter.month) };
  });
  return { months, memoryCount: months.reduce((sum, month) => sum + month.chapter.memories.length, 0), traceDayCount: months.reduce((sum, month) => sum + month.traceDayCount, 0) };
}

// /memory/[year]/[month]: the chapter whole — every memory (a month bounds it), traces folded with
// every day present but entries per day capped.
export function buildMonthView(chapter: MonthChapter, policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY): { memories: EditorialMemory[]; traces: TraceFold } {
  return { memories: chapter.memories, traces: foldTraces(chapter.traceDays, policy, chapter.traceDays.length) };
}
