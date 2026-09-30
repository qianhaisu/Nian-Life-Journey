import { cache } from "react";
import { loadFamilyArchiveForIsr } from "@/lib/family-archive";
import { getSourcesByIds } from "@/lib/db/repository";
import { deliverableMediaIds } from "@/lib/media/deliverability";
import { identifyDisplayMedia } from "@/lib/media/display-identity";
import type { MediaRef } from "@/lib/memory-chapters";
import { dayForDate, gateMaterialMedia, loadMonthContent, type MonthContent, type MonthContentDay } from "@/lib/month-content";
import { formatMonth } from "@/lib/time-signature";
import { buildMonthTimeline, type TimelineStory } from "@/lib/month-timeline";
import { resolveDaySpeakers } from "@/lib/day-speakers";
import type { Media, RawSource } from "@/lib/types";

export type DayReading = {
  content: MonthContent;
  day: MonthContentDay;
  title: string;
  dateLabel: string;
  ageLabel?: string;
  photos: MediaRef[];
  sources: RawSource[];
  /** source id → registry-resolved name (lib/day-speakers.ts); the content file's table is only a fallback. */
  speakers: Record<string, string>;
  sourceMedia: Media[];
  sourceDeliverable: ReadonlySet<string>;
  monthHref: string;
  monthLabel: string;
  stories: TimelineStory[];
  previous?: { href: string; title: string };
  next?: { href: string; title: string };
};

const dateLabelOf = (day: string) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;

/**
 * Everything one edited day needs to be read in full, or null when the day has no edited content.
 *
 * Two reads, both bounded: the archive load the pages already share, and the day's own cited
 * sources by id (lib/db/repository.getSourcesByIds — an explicit list of a few dozen ids, never a
 * date range or a scan). Both entrances to a day go through here so neither can drift from the
 * other, and so the gating happens in exactly one place.
 */
export const readDay = cache(async function readDay(dayKey: string): Promise<DayReading | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const month = dayKey.slice(0, 7);
  const content = await loadMonthContent(month);
  if (!content) return null;

  const archive = await loadFamilyArchiveForIsr();
  const { privilege } = archive;
  const timeline = await buildMonthTimeline(archive, month.slice(0, 4), month.slice(5, 7));
  const entry = timeline?.byDay.get(dayKey);
  if (!entry) return null;
  const ordered = [...timeline!.byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  const position = ordered.findIndex((item) => item.day === dayKey);
  const neighbor = async (offset: number) => {
    const item = ordered[position + offset];
    if (item) return { href: item.href, title: `${item.dateLabel} · ${item.title ?? "这一天"}` };
    const months = archive.chapters.flatMap((year) => year.months.map((chapter) => chapter.month)).sort();
    const adjacent = months[months.indexOf(month) + offset];
    if (!adjacent) return undefined;
    const other = await buildMonthTimeline(archive, adjacent.slice(0, 4), adjacent.slice(5, 7));
    const days = other ? [...other.byDay.values()].sort((a, b) => a.day.localeCompare(b.day)) : [];
    const edge = offset < 0 ? days.at(-1) : days[0];
    return edge ? { href: edge.href, title: `${formatMonth(adjacent)} · ${edge.dateLabel} · ${edge.title ?? "这一天"}` }
      : { href: `/memory/${adjacent.slice(0, 4)}/${adjacent.slice(5, 7)}`, title: formatMonth(adjacent) };
  };
  const [previous, next] = await Promise.all([neighbor(-1), neighbor(1)]);
  const day: MonthContentDay = dayForDate(content, dayKey) ?? {
    day: dayKey, kind: "story", title: entry.title, paragraphs: entry.paragraphs,
    firstScreenMediaIds: entry.photos.slice(0, 6).map((photo) => photo.id),
    expandedMediaIds: entry.photos.map((photo) => photo.id), eventIds: entry.eventIds,
  };
  const title = entry.title ?? dateLabelOf(dayKey);
  const eventIds = new Set(entry.eventIds);
  const wanted = [...new Set([...(day.sourceIds ?? []), ...archive.events.filter((event) => eventIds.has(event.id)).flatMap((event) => event.sourceIds ?? [])])];
  const material = wanted.length
    ? await getSourcesByIds(wanted)
    : { sources: [], media: [], mediaAssets: [], mediaLocations: [] };
  const sources = material.sources.filter((source) => source.visibility !== "private");
  const sourceDeliverable = deliverableMediaIds({
    media: material.media, mediaAssets: material.mediaAssets, mediaLocations: material.mediaLocations,
  });

  return {
    content, day, title,
    dateLabel: dateLabelOf(dayKey),
    ageLabel: entry.ageLabel,
    photos: entry.photos,
    stories: entry.stories,
    previous, next,
    sources,
    speakers: resolveDaySpeakers(sources, content.speakerBySourceId),
    sourceMedia: identifyDisplayMedia(gateMaterialMedia(material.media.filter((item) => item.visibility !== "private"), privilege.excluded), material.mediaAssets),
    sourceDeliverable,
    monthHref: `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}#day-${dayKey}`,
    monthLabel: formatMonth(month),
  };
});
