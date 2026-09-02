// Server-side view model for the family-facing archive. Takes the raw store and returns what a page
// prints: years → months → the memories worth reading, with ordinary days folded to a count. Pure
// functions over existing types; no repository or schema changes.
//
// Pages used to hand the whole Media table to a client component and let it pick thumbnails. At
// ~1000 WeChat photos that is a megabyte of HTML per view. Here every memory resolves its one lead
// photo on the server and the client receives only that.
import type { DailyTrace, LifeEvent, Media, MemoryWeight } from "@/lib/types";
import { calendarDayOf, calendarMonthOf } from "@/lib/timeline-dates";
import { heroCandidates, isHeroEligible } from "@/lib/media/hero";
import { presentableAlt } from "@/lib/media/presentation";
import { ageAtMonth, ageSpan, formatDay, formatMonth, timeSignatureFor, type TimeSignature } from "@/lib/time-signature";

export type MediaRef = Pick<Media, "id" | "src" | "thumbnailSrc" | "width" | "height" | "type" | "posterSrc"> & { alt: string };

export type EditorialMemory = {
  id: string;
  title: string;
  excerpt?: string;
  weight: MemoryWeight;
  signature: TimeSignature;
  lead?: MediaRef;
  photoCount: number;
  videoCount: number;
};

export type TraceDay = { day: string; dateLabel: string; entries: string[] };

export type MonthChapter = {
  month: string;
  // "2026 年 8 月" and, inside a year, just "8 月".
  label: string;
  shortLabel: string;
  ageLabel?: string;
  memories: EditorialMemory[];
  traceDays: TraceDay[];
  // Representative photos drawn from this month's memories, lead photos first.
  photos: MediaRef[];
};

export type YearChapter = { year: string; ageSpan?: string; months: MonthChapter[] };

export const EXCERPT_LIMIT = 80;
export const MONTH_PHOTO_LIMIT = 5;

export function toMediaRef(media: Media, context?: string): MediaRef {
  return { id: media.id, src: media.src, thumbnailSrc: media.thumbnailSrc, width: media.width, height: media.height, type: media.type, posterSrc: media.posterSrc, alt: presentableAlt(media, context) };
}

// First paragraph of the story, trimmed to a reading length. Titles are not repeated into it.
export function excerptOf(event: Pick<LifeEvent, "story" | "storySections">, limit = EXCERPT_LIMIT): string | undefined {
  const source = (event.storySections?.[0] ?? event.story ?? "").trim().split(/\n+/)[0]?.trim() ?? "";
  if (!source) return undefined;
  if ([...source].length <= limit) return source;
  const cut = [...source].slice(0, limit).join("").replace(/[，、,。！？；：\s]+$/u, "");
  return `${cut}……`;
}

export function memoryTitle(event: Pick<LifeEvent, "title" | "occurredAt">): string {
  const title = event.title?.trim();
  if (title) return title;
  const day = calendarDayOf(event.occurredAt);
  return day ? `${formatDay(day)}的一天` : "一段生活";
}

export function editorialMemory(event: LifeEvent, mediaById: Map<string, Media>, birthDay?: string): EditorialMemory | undefined {
  const signature = timeSignatureFor(event.occurredAt, birthDay);
  if (!signature) return undefined;
  const media = event.mediaIds.map((id) => mediaById.get(id)).filter((item): item is Media => Boolean(item));
  const title = memoryTitle(event);
  const lead = heroCandidates(event.heroMediaId, media)[0];
  return {
    id: event.id,
    title,
    excerpt: excerptOf(event),
    weight: event.memoryWeight,
    signature,
    lead: lead ? toMediaRef(lead, title) : undefined,
    photoCount: media.filter((item) => item.type === "photo").length,
    videoCount: media.filter((item) => item.type === "video").length,
  };
}

const WEIGHT_RANK: Record<MemoryWeight, number> = { chapter: 0, highlight: 1, memory: 2, trace: 3 };

export type ChapterInput = { events: LifeEvent[]; traces: DailyTrace[]; media: Media[]; birthDay?: string };

export function buildChapters({ events, traces, media, birthDay }: ChapterInput): YearChapter[] {
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const eventById = new Map(events.map((item) => [item.id, item]));
  const months = new Map<string, MonthChapter>();
  const monthOf = (month: string) => {
    let chapter = months.get(month);
    if (!chapter) {
      chapter = { month, label: formatMonth(month), shortLabel: `${Number(month.slice(5, 7))} 月`, ageLabel: ageAtMonth(birthDay, month), memories: [], traceDays: [], photos: [] };
      months.set(month, chapter);
    }
    return chapter;
  };

  const sortedEvents = [...events].sort((a, b) => (calendarDayOf(b.occurredAt) ?? "").localeCompare(calendarDayOf(a.occurredAt) ?? ""));
  for (const event of sortedEvents) {
    const month = calendarMonthOf(event.occurredAt);
    if (!month) continue;
    const memory = editorialMemory(event, mediaById, birthDay);
    if (memory) monthOf(month).memories.push(memory);
  }

  // Several DailyTrace rows can land on one day; the reader only cares that the day was noticed.
  const traceDays = new Map<string, TraceDay>();
  for (const trace of traces) {
    const day = calendarDayOf(trace.occurredAt);
    if (!day) continue;
    const existing = traceDays.get(day);
    if (existing) existing.entries.push(...trace.entries);
    else traceDays.set(day, { day, dateLabel: formatDay(day), entries: [...trace.entries] });
  }
  for (const traceDay of [...traceDays.values()].sort((a, b) => b.day.localeCompare(a.day))) {
    monthOf(traceDay.day.slice(0, 7)).traceDays.push(traceDay);
  }

  for (const chapter of months.values()) {
    const seen = new Set<string>();
    const photos: MediaRef[] = [];
    const push = (item: Media | undefined, context: string) => {
      if (!item || seen.has(item.id) || !isHeroEligible(item)) return;
      seen.add(item.id);
      photos.push(toMediaRef(item, context));
    };
    const byRank = [...chapter.memories].sort((a, b) => WEIGHT_RANK[a.weight] - WEIGHT_RANK[b.weight]);
    for (const memory of byRank) if (memory.lead) push(mediaById.get(memory.lead.id), memory.title);
    for (const memory of byRank) for (const id of eventById.get(memory.id)?.mediaIds ?? []) push(mediaById.get(id), memory.title);
    chapter.photos = photos.slice(0, MONTH_PHOTO_LIMIT);
  }

  const years = new Map<string, MonthChapter[]>();
  for (const month of [...months.keys()].sort((a, b) => b.localeCompare(a))) {
    const year = month.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), months.get(month)!]);
  }
  return [...years.entries()].map(([year, chapters]) => ({ year, ageSpan: ageSpan(birthDay, chapters.map((item) => item.month)), months: chapters }));
}

export const DEFAULT_OPEN_MEMORIES = 16;

// The memory page opens the most recent months in full until roughly DEFAULT_OPEN_MEMORIES memories
// are on screen; older months are listed as an index. Months with only traces count as open when they
// fall inside the open window, so the fold text appears naturally.
export function splitOpenMonths(chapters: YearChapter[], target = DEFAULT_OPEN_MEMORIES): { open: YearChapter[]; index: YearChapter[] } {
  let shown = 0;
  const open: YearChapter[] = [];
  const index: YearChapter[] = [];
  for (const year of chapters) {
    const openMonths: MonthChapter[] = [];
    const indexMonths: MonthChapter[] = [];
    for (const month of year.months) {
      if (shown < target) { openMonths.push(month); shown += month.memories.length; }
      else indexMonths.push(month);
    }
    if (openMonths.length) open.push({ ...year, months: openMonths });
    if (indexMonths.length) index.push({ ...year, months: indexMonths });
  }
  return { open, index };
}

export function latestMemory(chapters: YearChapter[]): EditorialMemory | undefined {
  for (const year of chapters) for (const month of year.months) if (month.memories[0]) return month.memories[0];
  return undefined;
}

export function findMonth(chapters: YearChapter[], month: string): MonthChapter | undefined {
  for (const year of chapters) for (const chapter of year.months) if (chapter.month === month) return chapter;
  return undefined;
}

// The most recent lead photo in the archive — "the photo that looks most like 张年 now".
export function latestLeadPhoto(chapters: YearChapter[]): MediaRef | undefined {
  for (const year of chapters) for (const month of year.months) for (const memory of month.memories) if (memory.lead) return memory.lead;
  return undefined;
}
