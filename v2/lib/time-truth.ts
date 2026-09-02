// Time truth for the archive. At least five different "times" exist and the pages must not blur
// them, because a life archive may be sparse but must never lie about when something happened:
//
//   productToday        the calendar day in Asia/Shanghai right now
//   latestActivityDay   the last day real material about 张年 reached the archive (a WeChat message,
//                       a photo, a trace, a memory) — "when did life last leave something here?"
//   latestTraceDay      the last ordinary day the archive noticed
//   latestMemoryDay     the last day a published memory happened
//   the home lead       the newest memory good enough for the front page, judged against the above
//
// Every one of them is LIFE time — occurredAt / capturedAt — never ingestion time. A 2023 chat
// imported in 2026 has a 2026 createdAt and must not surface as "最近"; conversely a memory that
// happened in 2025 must not be labelled recent just because nothing newer has been written yet.
import type { DailyTrace, LifeEvent, RawSource } from "@/lib/types";
import { calendarDayOf } from "@/lib/timeline-dates";
import type { EditorialMemory, MonthChapter, YearChapter } from "@/lib/memory-chapters";

export function productToday(now: Date = new Date()): string {
  return calendarDayOf(now.toISOString()) ?? now.toISOString().slice(0, 10);
}

// Latest "YYYY-MM-DD" among the given values; undated values are ignored, never guessed.
export function latestDay(values: Iterable<string | undefined | null>): string | undefined {
  let latest: string | undefined;
  for (const value of values) {
    const day = calendarDayOf(value);
    if (day && (!latest || day > latest)) latest = day;
  }
  return latest;
}

export function latestTraceDay(traces: Pick<DailyTrace, "occurredAt">[]): string | undefined {
  return latestDay(traces.map((trace) => trace.occurredAt));
}

export function latestMemoryDay(events: Pick<LifeEvent, "occurredAt">[]): string | undefined {
  return latestDay(events.map((event) => event.occurredAt));
}

export type ActivityInput = { rawSources: Pick<RawSource, "capturedAt" | "deletedAt">[]; dailyTraces: Pick<DailyTrace, "occurredAt">[]; events: Pick<LifeEvent, "occurredAt">[] };

// The day life last reached the archive. Raw sources count by capturedAt (the WeChat sentAt, the
// photo's own time) — never importedAt — so a backfill of old chats does not move this forward.
export function latestActivityDay({ rawSources, dailyTraces, events }: ActivityInput): string | undefined {
  return latestDay([
    ...rawSources.filter((source) => !source.deletedAt).map((source) => source.capturedAt),
    ...dailyTraces.map((trace) => trace.occurredAt),
    ...events.map((event) => event.occurredAt),
  ]);
}

// Whole calendar months from `from` to `to` ("YYYY-MM" or "YYYY-MM-DD" prefixes); negative when
// `to` is earlier.
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  return (ty - fy) * 12 + (tm - fm);
}

// The recency contract behind every "最近" on a family page. A day is recent when it is not left
// behind by newer life: at most RECENT_ACTIVITY_MONTH_GAP calendar months before the latest real
// activity, and at most RECENT_CALENDAR_MONTH_GAP months before today. Both are tunable policy,
// not facts — the current values mean an August memory still answers "最近怎么样" on 2 September
// even when September is empty (the current month being empty is not the archive being stale),
// while a 2025 story never does once 2026 material exists.
export const RECENT_ACTIVITY_MONTH_GAP = 1;
export const RECENT_CALENDAR_MONTH_GAP = 2;

export type RecencyReference = { today: string; activityDay?: string };

export function isRecent(day: string | undefined, reference: RecencyReference): boolean {
  if (!day) return false;
  if (monthsBetween(day, reference.today) > RECENT_CALENDAR_MONTH_GAP) return false;
  if (reference.activityDay && monthsBetween(day, reference.activityDay) > RECENT_ACTIVITY_MONTH_GAP) return false;
  return true;
}

// The inverse, named for what pages guard against: newer real activity exists and this content is
// too far behind it to speak for "now".
export function isStaleRelativeToActivity(day: string | undefined, reference: RecencyReference): boolean {
  return !isRecent(day, reference);
}

export type HomeLead = { memory: EditorialMemory; month: MonthChapter; recent: boolean };

// Which memories may carry the front page. "trace" weight is a folded ordinary day that happened to
// be written as an event; it is not a story to open the book with.
export const HOME_LEAD_WEIGHTS: ReadonlySet<EditorialMemory["weight"]> = new Set(["chapter", "highlight", "memory"]);

// The front-page memory: the newest memory (by life time) that clears the lead threshold. Chapters
// are already newest-first by occurredAt with a deterministic tie-break, so the first hit is the
// answer on both backends. `recent` says whether that memory may be presented as "最近"; when the
// newest worthy memory is older than the archive's recent life, it is still returned — the family's
// best story is not replaced by a worse but newer row — but the page must change its words.
export function selectHomeLead(chapters: YearChapter[], reference: RecencyReference): HomeLead | undefined {
  for (const year of chapters) for (const month of year.months) {
    const memory = month.memories.find((item) => HOME_LEAD_WEIGHTS.has(item.weight));
    if (memory) return { memory, month, recent: isRecent(memory.signature.day, reference) };
  }
  return undefined;
}
