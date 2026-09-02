// Server-side entry point for every family-facing page. One read of the store, one chapter build;
// pages take the slice they need. Repository and schema are untouched — this only decides what is
// shown, using the same publication rules the pages already applied individually.
import { CANONICAL_PROFILE_ID } from "@/lib/db/config";
import { scopeStoreToProfile } from "@/lib/db/profile-scope";
import { getAllEvents, getStore, type Store } from "@/lib/db/repository";
import { buildChapters, type YearChapter } from "@/lib/memory-chapters";
import { calendarMonthOf } from "@/lib/timeline-dates";
import { birthDayOf } from "@/lib/time-signature";
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
  // Pages read the book about 张年 only: rows another profile id owns (contract-test fixtures,
  // debugging profiles) stay in the backend but never reach a chapter or a home page.
  const [events, rawStore] = await Promise.all([getAllEvents(), getStore()]);
  const store = scopeStoreToProfile(rawStore, CANONICAL_PROFILE_ID);
  const traces = store.dailyTraces.filter((trace) => trace.visibility !== "private");
  const birthDay = birthDayOf(store.profile);
  const chapters = buildChapters({ events, traces, media: store.media, birthDay });
  const publishedMonths = new Set(events.map((event) => calendarMonthOf(event.occurredAt)).filter((value): value is string => Boolean(value)));
  const snapshot = store.monthlySnapshot && isSnapshotPublishable(store.monthlySnapshot.month, publishedMonths) ? store.monthlySnapshot : undefined;
  return { store, events, chapters, birthDay, snapshot };
}
