import type { EditorialMemory, MonthChapter, YearChapter } from "@/lib/memory-chapters";

// Which story the front page opens with.
//
// Until 2026-09-10 it was always the same one. selectHomeLead() walks the chapters newest-first and
// returns the first memory of a lead weight — a pure function of the archive, so with the archive
// unchanged the answer never changed either. The page had shown 8 月 28 日 since that story was
// published, and would have gone on showing it until something newer was written. Nothing was
// broken; the page simply answered "what is the newest story" when the question a family opens it
// with is "how is he lately".
//
// So: the last thirty days, one day at a time. A day is picked uniformly among the days that have
// something to read, not weighted by how much happened on it — a day with one line has the same
// claim on the front page as a day with four, which is the point of showing an ordinary life.
//
// Two things this deliberately does not do. It does not prefer stories that have a picture: that
// would quietly reinstate "the photogenic days are the real ones", and after the association rule
// (lib/media/story-binding.ts) almost no story has one anyway. And it does not reach outside the
// window for something better — an empty thirty days is a true answer, and the page says so.
export const RECENT_WINDOW_DAYS = 30;

// The name of the cookie that remembers the day this browser was last shown, so a reader who
// refreshes twice does not see the same day twice while other days are waiting. Per browser, not
// per person, and it holds one date string and nothing else.
export const LAST_SHOWN_DAY_COOKIE = "nl-home-day";

// `today` and everything in `chapters` are already Asia/Shanghai calendar days
// (lib/timeline-dates.ts calendarDayOf, lib/time-truth.ts productToday), so the window is plain
// string arithmetic on that calendar — no second timezone conversion, and none of the drift that
// comes from doing date maths in the server's own zone.
export function recentWindowStart(today: string, days: number = RECENT_WINDOW_DAYS): string {
  const [year, month, day] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - (days - 1)));
  return start.toISOString().slice(0, 10);
}

export type RecentDay = { day: string; month: MonthChapter; memories: EditorialMemory[] };

// Every day in the window that has at least one published, displayable story, oldest first.
// `chapters` only ever holds published memories (lib/family-archive.ts passes the publishable set,
// so a needs_review row is not here to be picked), and a day after today cannot enter the window,
// so a record dated in the future never reaches the front page.
export function recentStoryDays(chapters: YearChapter[], today: string, days: number = RECENT_WINDOW_DAYS): RecentDay[] {
  const start = recentWindowStart(today, days);
  const byDay = new Map<string, RecentDay>();
  for (const year of chapters) {
    for (const month of year.months) {
      for (const memory of month.memories) {
        const day = memory.signature.day;
        if (day < start || day > today) continue;
        const existing = byDay.get(day);
        if (existing) existing.memories.push(memory);
        else byDay.set(day, { day, month, memories: [memory] });
      }
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export type RecentPick = { day: string; memory: EditorialMemory; month: MonthChapter; candidateDayCount: number };

// Pick a day, then a story on it. `excludeDay` is what this browser saw last: it is dropped from
// the draw when other days are available, and ignored when it is the only day there is — a single
// candidate repeating is honest, refusing to show it is not.
export function pickRecentStory(days: RecentDay[], random: () => number = Math.random, excludeDay?: string): RecentPick | undefined {
  if (days.length === 0) return undefined;
  const pool = days.length > 1 && excludeDay ? days.filter((item) => item.day !== excludeDay) : days;
  const candidates = pool.length > 0 ? pool : days;
  const day = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))];
  const memory = day.memories[Math.min(day.memories.length - 1, Math.floor(random() * day.memories.length))];
  return { day: day.day, memory, month: day.month, candidateDayCount: days.length };
}

// The newest published story in the whole archive, for the case where the window is empty: the page
// says the last thirty days have nothing organised yet and offers the way back to what does exist,
// rather than silently widening the window until it finds something and calling that "最近".
export function latestStory(chapters: YearChapter[]): { day: string; memory: EditorialMemory; month: MonthChapter } | undefined {
  for (const year of chapters) {
    for (const month of year.months) {
      const memory = month.memories[0];
      if (memory) return { day: memory.signature.day, memory, month };
    }
  }
  return undefined;
}
