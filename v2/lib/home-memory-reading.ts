import type { FamilyArchive } from "@/lib/family-archive";
import type { HomeMemory } from "@/lib/home-memory";
import { buildMonthTimeline } from "@/lib/month-timeline";
import { calendarDayOf } from "@/lib/timeline-dates";
import { ageOn, formatDay } from "@/lib/time-signature";

/** Selected slides only, using the home page's cached archive and published content files. */
export async function attachMemoryReading(memories: HomeMemory[], archive: FamilyArchive): Promise<HomeMemory[]> {
  const months = [...new Set(memories.flatMap((memory) => memory.slides.map((slide) => calendarDayOf(slide.media.takenAt)?.slice(0, 7)).filter((month): month is string => !!month)))];
  const timelines = new Map(await Promise.all(months.map(async (month) => [month,
    await buildMonthTimeline(archive, month.slice(0, 4), month.slice(5, 7))] as const)));
  const knownMonths = new Set(archive.chapters.flatMap((year) => year.months.map((month) => month.month)));
  return memories.map((memory) => ({ ...memory, slides: memory.slides.map((slide) => {
    const day = calendarDayOf(slide.media.takenAt);
    if (!day) return slide;
    const month = day.slice(0, 7);
    const entry = timelines.get(month)?.byDay.get(day);
    const fallback = knownMonths.has(month) ? `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}` : undefined;
    return { ...slide, day, dateLabel: formatDay(day), ageLabel: ageOn(archive.birthDay, day),
      caption: entry?.title ?? slide.caption, href: entry?.href ?? fallback,
      linkLabel: entry ? "读这一天" : fallback ? "翻到那个月" : undefined };
  }) }));
}
