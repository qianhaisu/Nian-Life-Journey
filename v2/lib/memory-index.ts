// The read model behind /memory, /memory/[year] and /memory/[year]/[month]: chapters (already
// ordered by life time in lib/memory-chapters.ts) narrowed to what each layer shows under
// lib/memory-ia-policy.ts. Pure and deterministic; pages lay it out and never re-sort or re-count.
import { isArchiveCountNote, type EditorialMemory, type MediaRef, type MonthChapter, type PhotoDay, type TraceDay, type YearChapter } from "@/lib/memory-chapters";
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
// page or `openMonthsMax` months are open, whichever comes first — in a photograph-heavy archive
// the memory target alone would never close the window. Months after that are index rows. Months
// with only traces count as open while inside the window so the fold appears naturally, and never
// push the memory window forward by themselves.
export function buildMemoryIndex(chapters: YearChapter[], policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY): MemoryIndex {
  let shown = 0;
  let opened = 0;
  const years = chapters.map((year) => {
    const months = year.months.map((chapter): MonthIndexEntry => {
      // A month with nothing it can currently show (every photo withheld, nothing written) is an
      // index row even inside the open window: the month exists and keeps its page, but /memory
      // does not print an empty section — and it does not consume the window.
      const bare = chapter.memories.length === 0 && chapter.photos.length === 0 && chapter.traceDays.length === 0;
      const open = !bare && shown < policy.openMemoriesTarget && opened < policy.openMonthsMax;
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

export function buildYearView(year: YearChapter, policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY): { months: YearMonthEntry[]; memoryCount: number; traceDayCount: number; photoCount: number } {
  const months = year.months.map((chapter): YearMonthEntry => {
    const titles = curateMemories(chapter.memories, policy.yearTitlesPerMonth);
    return { chapter, titles, hiddenMemoryCount: chapter.memories.length - titles.length, traceDayCount: chapter.traceDays.length, href: monthHref(chapter.month) };
  });
  return { months, memoryCount: months.reduce((sum, month) => sum + month.chapter.memories.length, 0), traceDayCount: months.reduce((sum, month) => sum + month.traceDayCount, 0), photoCount: months.reduce((sum, month) => sum + month.chapter.photoCount, 0) };
}

// One day as the month chapter prints it: its date and age, the day's photographs (capped by
// policy — the chapter is an edited publication, the rest of the day stays behind it), and
// whatever the archive wrote about the day (trace entries, capped as everywhere else).
export type MonthDayView = {
  day: string;
  dateLabel: string;
  ageLabel?: string;
  photos: MediaRef[];
  morePhotoCount: number;
  entries: string[];
  hiddenEntryCount: number;
};

// /memory/[year]/[month]: the chapter whole — every memory (a month bounds it), then the month's
// days, newest first: every day that was photographed or noticed is present, photographs and the
// day's own words together. This replaces reading "photos" and "traces" as two separate systems;
// a reader turns the pages of a month day by day.
export function buildMonthView(chapter: MonthChapter, policy: MemoryIaPolicy = DEFAULT_MEMORY_IA_POLICY): { memories: EditorialMemory[]; days: MonthDayView[]; traces: TraceFold } {
  const byDay = new Map<string, MonthDayView>();
  const dayOf = (day: string, dateLabel: string, ageLabel?: string) => {
    let entry = byDay.get(day);
    if (!entry) {
      entry = { day, dateLabel, ageLabel, photos: [], morePhotoCount: 0, entries: [], hiddenEntryCount: 0 };
      byDay.set(day, entry);
    }
    return entry;
  };
  for (const photoDay of chapter.photoDays) {
    const entry = dayOf(photoDay.day, photoDay.dateLabel, photoDay.ageLabel);
    entry.photos = photoDay.photos.slice(0, policy.monthPhotosPerDay);
    entry.morePhotoCount = Math.max(0, photoDay.photos.length - entry.photos.length);
  }
  for (const traceDay of chapter.traceDays) {
    const entry = dayOf(traceDay.day, traceDay.dateLabel);
    // A day that shows its photographs does not also say "这一天留下了 N 张照片" — the sentence
    // describes what is already on the page. Days whose pictures are not on the page keep it:
    // there it is the only word of them. Display filter only; the trace rows are untouched.
    const entries = entry.photos.length > 0 ? traceDay.entries.filter((text) => !isArchiveCountNote(text)) : traceDay.entries;
    entry.entries = entries.slice(0, policy.traceEntriesPerDay);
    entry.hiddenEntryCount = Math.max(0, entries.length - entry.entries.length);
  }
  const days = [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
  return { memories: chapter.memories, days, traces: foldTraces(chapter.traceDays, policy, chapter.traceDays.length) };
}
