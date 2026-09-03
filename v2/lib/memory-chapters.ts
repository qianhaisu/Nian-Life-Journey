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

// A day that was photographed, with the pictures that survive the delivery gate. This is the unit
// the archive actually has most of: 989 publishable pictures against 3 published memories, spread
// over the days they were taken. A day needs no memory and no trace to be here.
export type PhotoDay = { day: string; dateLabel: string; ageLabel?: string; photos: MediaRef[] };

export type MonthChapter = {
  month: string;
  // "2026 年 8 月" and, inside a year, just "8 月".
  label: string;
  shortLabel: string;
  ageLabel?: string;
  memories: EditorialMemory[];
  traceDays: TraceDay[];
  // Representative photos drawn from this month's memories, lead photos first. Bounded by
  // MONTH_PHOTO_LIMIT for index surfaces; the month page reads the month's photography whole
  // through monthPhotoDays().
  photos: MediaRef[];
  // What the month actually holds, however the pictures reached the archive — attached to a
  // memory, noticed as an ordinary day, or standing on their own. Index pages say the number;
  // only the month page shows them all.
  photoCount: number;
  videoCount: number;
  // Every photographed day of the month, newest first, each carrying all of its publishable
  // pictures. This is the month's real spine. Building it is cheap (small objects, server side);
  // what reaches the browser is whatever a page chooses to render, and index surfaces render
  // none of it — they show `photos` and the counts above.
  photoDays: PhotoDay[];
  // Family-visible pictures this month holds that cannot be delivered yet. Never rendered — the
  // family is not shown the state of the derivative pipeline — but it keeps the distinction
  // between "withheld" and "never existed" available to audits and tests.
  withheldMediaCount: number;
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

// `media` is every family-visible picture the month actually holds — archive truth, used to decide
// that a month happened. `deliverable` is the subset that can be shown right now
// (lib/media/deliverability.ts). The two are deliberately separate: a February whose twenty photos
// are still waiting for derivatives is a February that happened, not a February that does not
// exist, and it must keep its chapter and its URL. Eligibility governs what is displayed and
// counted inside a month; it never governs whether the month is in the book.
export type ChapterInput = { events: LifeEvent[]; traces: DailyTrace[]; media: Media[]; deliverable?: ReadonlySet<string>; birthDay?: string };

// Every family-visible picture the archive holds, bucketed by the month it was taken in and
// ordered newest first inside each month.
//
// This is deliberately *all* of them, not only the ones no LifeEvent claimed. A photograph is
// family material in its own right: it is not organizer output, it passes through no quality
// gate, and it does not need to be promoted into a memory to deserve a place in the book. The
// archive's 1153 pictures outnumber its published memories several hundred to one, and four
// months of them — 2025-09, 2025-10, 2025-11, 2026-02 — existed at no URL at all before this,
// because a month used to be born only from a published event or trace.
export function familyMediaByMonth(media: Media[]): Map<string, Media[]> {
  const byMonth = new Map<string, Media[]>();
  for (const item of media) {
    if (item.visibility === "private") continue;
    const month = calendarMonthOf(item.takenAt);
    if (!month) continue;
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(item);
    else byMonth.set(month, [item]);
  }
  for (const bucket of byMonth.values()) {
    bucket.sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? "") || a.id.localeCompare(b.id));
  }
  return byMonth;
}

// One month's pictures as the days they were taken on, newest first. Every day the month holds is
// present; a page decides how many days and how many pictures per day it prints.
export function groupPhotoDays(media: Media[], context: string, birthDay?: string): PhotoDay[] {
  const days = new Map<string, PhotoDay>();
  for (const item of media) {
    const day = calendarDayOf(item.takenAt);
    if (!day) continue;
    let entry = days.get(day);
    if (!entry) {
      entry = { day, dateLabel: formatDay(day), ageLabel: timeSignatureFor(item.takenAt, birthDay)?.ageLabel, photos: [] };
      days.set(day, entry);
    }
    entry.photos.push(toMediaRef(item, context));
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export function buildChapters({ events, traces, media, deliverable, birthDay }: ChapterInput): YearChapter[] {
  // Absent `deliverable`, every family-visible row is treated as showable — the shape callers that
  // build a Store by hand (tests, fixtures) already expect.
  const canShow = (item: Media) => !deliverable || deliverable.has(item.id);
  const shown = media.filter(canShow);
  const mediaById = new Map(shown.map((item) => [item.id, item]));
  const eventById = new Map(events.map((item) => [item.id, item]));
  const mediaByMonth = familyMediaByMonth(media);
  const months = new Map<string, MonthChapter>();
  const monthOf = (month: string) => {
    let chapter = months.get(month);
    if (!chapter) {
      chapter = { month, label: formatMonth(month), shortLabel: `${Number(month.slice(5, 7))} 月`, ageLabel: ageAtMonth(birthDay, month), memories: [], traceDays: [], photos: [], photoCount: 0, videoCount: 0, photoDays: [], withheldMediaCount: 0 };
      months.set(month, chapter);
    }
    return chapter;
  };

  // A month exists if life left anything of it behind: a published memory, a day the archive
  // noticed, or simply pictures — deliverable or not. Photographs come first so that a month which
  // was only ever photographed still gets a chapter and a page.
  for (const month of mediaByMonth.keys()) monthOf(month);

  // Life time only: the day it happened, newest first, never createdAt (a late-imported 2023 chat
  // must sort into 2023). Same-day ties break by weight, then id, so the order — and therefore the
  // front page — is identical whichever backend and row order produced `events`.
  const sortedEvents = [...events].sort((a, b) => {
    const byDay = (calendarDayOf(b.occurredAt) ?? "").localeCompare(calendarDayOf(a.occurredAt) ?? "");
    if (byDay) return byDay;
    const byWeight = WEIGHT_RANK[a.memoryWeight] - WEIGHT_RANK[b.memoryWeight];
    return byWeight || a.id.localeCompare(b.id);
  });
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
    // Then the rest of the month's pictures, newest first. In a month with no published memory
    // these are the whole strip, which is the point: the month is shown by what was photographed.
    const monthMedia = mediaByMonth.get(chapter.month) ?? [];
    const showable = monthMedia.filter(canShow);
    if (photos.length < MONTH_PHOTO_LIMIT) {
      for (const item of showable) {
        if (photos.length >= MONTH_PHOTO_LIMIT) break;
        push(item, chapter.label);
      }
    }
    chapter.photos = photos.slice(0, MONTH_PHOTO_LIMIT);
    // Counts are of what the family can actually open. A number beside pictures that cannot be
    // delivered would be a number the reader can never reconcile with the page.
    chapter.photoCount = showable.filter((item) => item.type === "photo").length;
    chapter.videoCount = showable.filter((item) => item.type === "video").length;
    chapter.photoDays = groupPhotoDays(showable, chapter.label, birthDay);
    chapter.withheldMediaCount = monthMedia.length - showable.length;
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

// The newest memory by life time, whatever its weight. The front page does not use this — it goes
// through lib/time-truth.ts selectHomeLead, which also decides whether "最近" may be said.
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
