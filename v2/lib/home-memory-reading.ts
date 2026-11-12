import type { FamilyArchive } from "@/lib/family-archive";
import type { HomeMemory, HomeMemorySlide, MemoryThemeKind } from "@/lib/home-memory";
import { dayForDate, loadMonthContent, type MonthContent } from "@/lib/month-content";
import { buildMonthTimeline } from "@/lib/month-timeline";
import { calendarDayOf } from "@/lib/timeline-dates";
import { ageOn, formatDay } from "@/lib/time-signature";

/**
 * 纯函数：为单张幻灯片补齐真实「日期 · 当时年龄」与日页链接。
 * 字幕（caption）优先取当前照片自身的 photoCaptions?.[mediaId]；
 * 跨日回忆在没有该张专属图注时保持 undefined，绝不拿当天日页标题冒充这张照片的字幕。
 */
export function resolveSlideReading(input: {
  kind: MemoryThemeKind;
  slide: HomeMemorySlide;
  birthDay?: string;
  hasDayPage: boolean;
  dayHref?: string;
  monthHref?: string;
  photoCaptions?: Readonly<Record<string, string>>;
}): HomeMemorySlide {
  const { kind, slide, birthDay, hasDayPage, dayHref, monthHref, photoCaptions } = input;
  const day = calendarDayOf(slide.media.takenAt);
  if (!day) return slide;
  const ownCaption = photoCaptions?.[slide.media.id]?.trim() || undefined;
  const caption = kind === "day" ? (ownCaption ?? slide.caption) : ownCaption;
  const href = dayHref ?? monthHref;
  const linkLabel = hasDayPage ? "读这一天" : monthHref ? "翻到那个月" : undefined;
  return {
    ...slide,
    day,
    dateLabel: formatDay(day),
    ageLabel: ageOn(birthDay, day),
    caption,
    href,
    linkLabel,
  };
}

/** Selected slides only, using the home page's cached archive and published content files. */
export async function attachMemoryReading(
  memories: HomeMemory[],
  archive: FamilyArchive,
  preloadedMonths?: readonly MonthContent[],
): Promise<HomeMemory[]> {
  const months = [...new Set(memories.flatMap((memory) => memory.slides.map((slide) => calendarDayOf(slide.media.takenAt)?.slice(0, 7)).filter((month): month is string => !!month)))];
  const preloadedMap = preloadedMonths ? new Map(preloadedMonths.map((item) => [item.month, item])) : undefined;
  const [timelines, contents] = await Promise.all([
    Promise.all(months.map(async (month) => [month, await buildMonthTimeline(archive, month.slice(0, 4), month.slice(5, 7))] as const))
      .then((rows) => new Map(rows)),
    Promise.all(months.map(async (month) => [month, preloadedMap?.get(month) ?? await loadMonthContent(month)] as const))
      .then((rows) => new Map(rows)),
  ]);
  const knownMonths = new Set(archive.chapters.flatMap((year) => year.months.map((month) => month.month)));
  return memories.map((memory) => ({
    ...memory,
    slides: memory.slides.map((slide) => {
      const day = calendarDayOf(slide.media.takenAt);
      if (!day) return slide;
      const month = day.slice(0, 7);
      const entry = timelines.get(month)?.byDay.get(day);
      const contentDay = dayForDate(contents.get(month) ?? null, day);
      const fallback = knownMonths.has(month) ? `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}` : undefined;
      return resolveSlideReading({
        kind: memory.kind,
        slide,
        birthDay: archive.birthDay,
        hasDayPage: Boolean(entry),
        dayHref: entry?.href,
        monthHref: fallback,
        photoCaptions: contentDay?.photoCaptions,
      });
    }),
  }));
}
