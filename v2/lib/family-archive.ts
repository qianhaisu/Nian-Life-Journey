// Server-side entry point for every family-facing page. One read of the store, one chapter build;
// pages take the slice they need. Repository and schema are untouched — this only decides what is
// shown, using the same publication rules the pages already applied individually.
import { getAllEvents, getStore, type Store } from "@/lib/db/repository";
import { buildChapters, type YearChapter } from "@/lib/memory-chapters";
import { calendarMonthOf } from "@/lib/timeline-dates";
import { isSnapshotPublishable } from "@/lib/organizer/quality-review";
import type { LifeEvent, MonthlySnapshot } from "@/lib/types";

export type FamilyArchive = {
  store: Store;
  events: LifeEvent[];
  chapters: YearChapter[];
  birthDay?: string;
  // Only when real published memories stand behind it (see quality-review.ts).
  snapshot?: MonthlySnapshot;
};

export async function loadFamilyArchive(): Promise<FamilyArchive> {
  const [events, store] = await Promise.all([getAllEvents(), getStore()]);
  const traces = store.dailyTraces.filter((trace) => trace.visibility !== "private");
  const birthDay = store.profile?.birthDate || undefined;
  const chapters = buildChapters({ events, traces, media: store.media, birthDay });
  const publishedMonths = new Set(events.map((event) => calendarMonthOf(event.occurredAt)).filter((value): value is string => Boolean(value)));
  const snapshot = store.monthlySnapshot && isSnapshotPublishable(store.monthlySnapshot.month, publishedMonths) ? store.monthlySnapshot : undefined;
  return { store, events, chapters, birthDay, snapshot };
}
