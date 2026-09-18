import { loadFamilyArchive } from "@/lib/family-archive";
import { getSourcesByIds } from "@/lib/db/repository";
import { deliverableMediaIds } from "@/lib/media/deliverability";
import { toMediaRef } from "@/lib/memory-chapters";
import type { MediaRef } from "@/lib/memory-chapters";
import { dayForDate, gateMaterialMedia, loadMonthContent, resolveMonthContentMedia, type MonthContent, type MonthContentDay } from "@/lib/month-content";
import { formatMonth } from "@/lib/time-signature";
import type { Media, RawSource } from "@/lib/types";

export type DayReading = {
  content: MonthContent;
  day: MonthContentDay;
  title: string;
  dateLabel: string;
  ageLabel?: string;
  photos: MediaRef[];
  sources: RawSource[];
  sourceMedia: Media[];
  sourceDeliverable: ReadonlySet<string>;
  monthHref: string;
  monthLabel: string;
};

const dateLabelOf = (day: string) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;

function ageLabelOn(day: string, birthDay?: string): string | undefined {
  if (!birthDay) return undefined;
  const [by, bm, bd] = birthDay.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  if ([by, bm, bd, y, m, d].some((value) => Number.isNaN(value))) return undefined;
  let months = (y - by) * 12 + (m - bm);
  if (d < bd) months -= 1;
  if (months < 0) return undefined;
  return `${Math.floor(months / 12)}岁${months % 12}个月`;
}

/**
 * Everything one edited day needs to be read in full, or null when the day has no edited content.
 *
 * Two reads, both bounded: the archive load the pages already share, and the day's own cited
 * sources by id (lib/db/repository.getSourcesByIds — an explicit list of a few dozen ids, never a
 * date range or a scan). Both entrances to a day go through here so neither can drift from the
 * other, and so the gating happens in exactly one place.
 */
export async function readDay(dayKey: string): Promise<DayReading | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const month = dayKey.slice(0, 7);
  const content = await loadMonthContent(month);
  const day = dayForDate(content, dayKey);
  if (!content || !day) return null;

  const { media, privilege, birthDay } = await loadFamilyArchive();
  const available = new Map(media.map((item) => [item.id, item]));
  const title = day.title ?? dateLabelOf(dayKey);
  // The curated order is a proposal; deliverability and the latest store_only decide, on every
  // render. A withdrawn picture leaves the page even though the curated list still names it.
  const photos = resolveMonthContentMedia(day.expandedMediaIds, available, privilege.excluded)
    .map((item) => toMediaRef(item, title));

  const wanted = day.sourceIds ?? [];
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
    ageLabel: ageLabelOn(dayKey, birthDay) ?? day.ageLabel,
    photos,
    sources,
    sourceMedia: gateMaterialMedia(material.media.filter((item) => item.visibility !== "private"), privilege.excluded),
    sourceDeliverable,
    monthHref: `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}`,
    monthLabel: formatMonth(month),
  };
}
