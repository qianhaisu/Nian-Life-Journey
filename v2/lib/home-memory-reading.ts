import type { FamilyArchive } from "@/lib/family-archive";
import type { HomeMemory, HomeMemorySlide, MemoryThemeKind } from "@/lib/home-memory";
import { findMonth } from "@/lib/memory-chapters";
import { dayForDate, loadMonthContent, type MonthContent } from "@/lib/month-content";
import { calendarDayOf } from "@/lib/timeline-dates";
import { ageOn, formatDay } from "@/lib/time-signature";
import type { Media } from "@/lib/types";

type CachedMonthDays = { content: MonthContent | null; days: ReadonlySet<string> | undefined };
const mediaByIdCache = new WeakMap<FamilyArchive, ReadonlyMap<string, Media>>();
const timelineDaysCache = new WeakMap<FamilyArchive, Map<string, CachedMonthDays>>();

function archiveMediaById(archive: FamilyArchive): ReadonlyMap<string, Media> {
  let map = mediaByIdCache.get(archive);
  if (!map) {
    map = new Map(archive.media.map((item) => [item.id, item]));
    mediaByIdCache.set(archive, map);
  }
  return map;
}

function computeTimelineDaySet(
  archive: FamilyArchive,
  month: string,
  content: MonthContent | null,
  available: ReadonlyMap<string, Media>,
): ReadonlySet<string> | undefined {
  const chapter = findMonth(archive.chapters, month);
  if ((!chapter && !(content && content.days.length > 0)) || !content) return undefined;

  const excluded = archive.privilege?.excluded;
  const days = new Set<string>();
  const represented = new Set<string>();

  for (const entry of content.days) {
    if (entry.eventId) represented.add(entry.eventId);
    if (entry.eventIds) for (const id of entry.eventIds) represented.add(id);
    if (entry.kind === "visual-description" && entry.expandedMediaIds.length > 0
      && entry.expandedMediaIds.every((id) => excluded?.has(id))) continue;
    const hasPhotos = entry.expandedMediaIds.some((id) => !excluded?.has(id) && available.has(id));
    if (!entry.title && entry.paragraphs.length === 0 && !hasPhotos) continue;
    days.add(entry.day);
  }

  for (const memory of chapter?.memories ?? []) {
    if (!represented.has(memory.id)) days.add(memory.signature.day);
  }

  return days;
}

function timelineDaysFor(
  archive: FamilyArchive,
  month: string,
  content: MonthContent | null,
): ReadonlySet<string> | undefined {
  let perArchive = timelineDaysCache.get(archive);
  if (!perArchive) {
    perArchive = new Map();
    timelineDaysCache.set(archive, perArchive);
  }
  const held = perArchive.get(month);
  if (held && held.content === content) return held.days;
  const days = computeTimelineDaySet(archive, month, content, archiveMediaById(archive));
  perArchive.set(month, { content, days });
  return days;
}

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
  const contents = await Promise.all(
    months.map(async (month) => [month, preloadedMap?.get(month) ?? await loadMonthContent(month)] as const),
  ).then((rows) => new Map(rows));
  const timelineDaysByMonth = new Map(
    months.map((month) => [month, timelineDaysFor(archive, month, contents.get(month) ?? null)] as const),
  );
  const knownMonths = new Set(archive.chapters.flatMap((year) => year.months.map((month) => month.month)));
  return memories.map((memory) => ({
    ...memory,
    slides: memory.slides.map((slide) => {
      const day = calendarDayOf(slide.media.takenAt);
      if (!day) return slide;
      const month = day.slice(0, 7);
      const hasDayPage = Boolean(timelineDaysByMonth.get(month)?.has(day));
      const dayHref = hasDayPage ? `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}/${day.slice(8, 10)}` : undefined;
      const contentDay = dayForDate(contents.get(month) ?? null, day);
      const fallback = knownMonths.has(month) ? `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}` : undefined;
      return resolveSlideReading({
        kind: memory.kind,
        slide,
        birthDay: archive.birthDay,
        hasDayPage,
        dayHref,
        monthHref: fallback,
        photoCaptions: contentDay?.photoCaptions,
      });
    }),
  }));
}
