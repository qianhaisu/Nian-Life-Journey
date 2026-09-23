import type { FamilyArchive } from "@/lib/family-archive";
import { findMonth, toMediaRef, type MediaRef } from "@/lib/memory-chapters";
import { pickLeadDays, pickLeadPhoto } from "@/lib/month-day-weight";
import { loadMonthContent, resolveMonthContentMedia } from "@/lib/month-content";
import { buildMonthComposition } from "@/lib/publication-moments";

// An edited month as ONE timeline of days (2026-09-23, Teddy: 「故事和日子只能存在一个」).
//
// Before this the month page had two lists: 「这个月的日子」 from the content file, and under it
// 「这个月的故事」 — every published memory the file did not already represent, as separate cards.
// The same date could therefore appear twice on one page. Here each such memory is folded into the
// day it happened on: into that day's entry when the file has one, or as a day of its own when it
// does not. Nothing is dropped — `stats` counts both sides so the merge can be checked month by month
// (scripts/check-month-merge.mjs; .data/merge-count-check.json).
//
// Order: the newest month with content reads newest day first — a family opening it wants this week,
// not the 1st. Every older month reads 1st to last, like a month. Weeks are seven-day runs in that
// direction: an older month's are 1–7, 8–14, …; the newest month's count back from its latest day.
// The page renders the first week and the rest arrive a week at a time (components/month-timeline.tsx
// via app/api/memory/[year]/[month]/timeline — a GET, because the public entry refuses POST).
//
// Server-only: loadMonthContent reads the content file with node:fs.

export type TimelineStory = { id: string; title?: string; paragraphs: string[]; href: string };

export type TimelineDay = {
  day: string;
  dateLabel: string;
  ageLabel?: string;
  title: string | null;
  paragraphs: string[];
  /** Published memories folded into this day that the content file had not already written. */
  stories: TimelineStory[];
  photos: MediaRef[];
  href: string;
  lead: boolean;
};

export type TimelineWeek = { id: string; label: string; days: string[] };

export type MonthTimeline = {
  month: string;
  order: "desc" | "asc";
  weeks: TimelineWeek[];
  byDay: Map<string, TimelineDay>;
  stats: {
    /** Content-file days that survive the page's own filter (something to show). */
    contentDays: number;
    /** Published memories not represented by the content file — what 「这个月的故事」 used to list. */
    remainingStories: number;
    remainingStoryIds: string[];
    /** Day entries after merging, and how many of them exist only because of a story. */
    timelineDays: number;
    daysFromStoriesOnly: number;
    /** Memory ids that ended up inside some day (must equal remainingStoryIds). */
    mergedStoryIds: string[];
  };
};

const dateLabelOf = (day: string) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;
const norm = (text: string) => text.replace(/\s+/g, "");

/** The latest month that has a chapter — the one read newest-first. */
export function latestChapterMonth(archive: Pick<FamilyArchive, "chapters">): string | undefined {
  return archive.chapters.flatMap((year) => year.months.map((month) => month.month)).sort().at(-1);
}

/** Seven-day runs in reading order. Exported for tests. */
export function cutWeeks(days: readonly string[], order: "desc" | "asc"): TimelineWeek[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort();
  if (order === "desc") sorted.reverse();
  const anchor = Number(sorted[0].slice(8, 10));
  const month = Number(sorted[0].slice(5, 7));
  const weeks = new Map<number, string[]>();
  for (const day of sorted) {
    const dom = Number(day.slice(8, 10));
    const index = order === "asc" ? Math.floor((dom - 1) / 7) : Math.floor((anchor - dom) / 7);
    weeks.set(index, [...(weeks.get(index) ?? []), day]);
  }
  const lastDom = new Date(Date.UTC(Number(sorted[0].slice(0, 4)), month, 0)).getUTCDate();
  return [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([index, list]) => {
    const to = order === "asc" ? Math.min(index * 7 + 7, lastDom) : anchor - index * 7;
    const from = order === "asc" ? index * 7 + 1 : Math.max(1, to - 6);
    return { id: `week-${index + 1}`, label: from === to ? `${month} 月 ${from} 日` : `${month} 月 ${from}–${to} 日`, days: list };
  });
}

export async function buildMonthTimeline(archive: FamilyArchive, year: string, monthSegment: string): Promise<MonthTimeline | null> {
  const month = `${year}-${monthSegment}`;
  const chapter = findMonth(archive.chapters, month);
  const content = await loadMonthContent(month);
  if (!chapter || !content) return null;

  const { media, eventIdentities, privilege, traceEvents, birthDay } = archive;
  const composition = buildMonthComposition(chapter, privilege, traceEvents, birthDay);
  const available = new Map(media.map((item) => [item.id, item]));
  const eventIds = new Set(eventIdentities.map((item) => item.id));

  const days = new Map<string, TimelineDay>();
  for (const entry of content.days) {
    // The curated order is a proposal; deliverability and the latest store_only decide.
    const photos = resolveMonthContentMedia(entry.expandedMediaIds, available, privilege.excluded)
      .map((item) => toMediaRef(item, entry.title ?? undefined));
    if (!entry.title && entry.paragraphs.length === 0 && photos.length === 0) continue;
    const eventId = entry.eventId ?? null;
    days.set(entry.day, {
      day: entry.day,
      dateLabel: dateLabelOf(entry.day),
      ageLabel: entry.ageLabel,
      title: entry.title,
      paragraphs: entry.paragraphs,
      stories: [],
      photos,
      // A day that kept one original event keeps that URL; every other day has its own page.
      href: eventId && eventIds.has(eventId) ? `/events/${eventId}` : `/memory/${year}/${monthSegment}/${entry.day.slice(8, 10)}`,
      lead: false,
    });
  }
  const contentDays = days.size;

  // Every published memory the content file does not already represent (what 「这个月的故事」 showed).
  const represented = new Set(content.days.flatMap((entry) => [...(entry.eventIds ?? []), ...(entry.eventId ? [entry.eventId] : [])]));
  const remaining = composition.chapter.filter((moment) => moment.kind === "memory_led" && moment.memory && !represented.has(moment.memory.id));
  const merged: string[] = [];
  let daysFromStoriesOnly = 0;
  for (const moment of remaining) {
    const memory = moment.memory!;
    const storyMedia = [...(memory.storyPhotos ?? (memory.lead ? [memory.lead] : [])), ...(memory.storyVideos ?? [])];
    let target = days.get(moment.day);
    if (!target) {
      // A day the file never wrote: the memory becomes that day, under its own title.
      target = {
        day: moment.day, dateLabel: dateLabelOf(moment.day), ageLabel: moment.ageLabel,
        title: memory.title, paragraphs: memory.excerpt ? [memory.excerpt] : [], stories: [], photos: [],
        href: `/events/${memory.id}`, lead: false,
      };
      days.set(moment.day, target);
      daysFromStoriesOnly += 1;
    } else {
      // Same day, already written: add only what the day does not already say.
      const said = norm([target.title ?? "", ...target.paragraphs, ...target.stories.flatMap((s) => [s.title ?? "", ...s.paragraphs])].join("\n"));
      const title = memory.title && !said.includes(norm(memory.title)) ? memory.title : undefined;
      const paragraphs = memory.excerpt && !said.includes(norm(memory.excerpt)) ? [memory.excerpt] : [];
      if (title || paragraphs.length) target.stories.push({ id: memory.id, title, paragraphs, href: `/events/${memory.id}` });
    }
    const have = new Set(target.photos.map((item) => item.id));
    for (const item of storyMedia) if (!have.has(item.id)) { target.photos.push(item); have.add(item.id); }
    merged.push(memory.id);
  }

  const order: "desc" | "asc" = month === latestChapterMonth(archive) ? "desc" : "asc";
  const leadDays = pickLeadDays([...days.values()].map((entry) => ({
    day: entry.day,
    paragraphs: [...entry.paragraphs, ...entry.stories.flatMap((s) => s.paragraphs)],
    photoCount: entry.photos.length,
    storyBound: false,
    emphasis: content.days.find((d) => d.day === entry.day)?.emphasis,
    leadable: Boolean(pickLeadPhoto(entry.photos)),
  })));
  for (const entry of days.values()) entry.lead = leadDays.has(entry.day);

  return {
    month,
    order,
    weeks: cutWeeks([...days.keys()], order),
    byDay: days,
    stats: {
      contentDays,
      remainingStories: remaining.length,
      remainingStoryIds: remaining.map((m) => m.memory!.id),
      timelineDays: days.size,
      daysFromStoriesOnly,
      mergedStoryIds: merged,
    },
  };
}

/** The entries of one week, in reading order. */
export function weekEntries(timeline: MonthTimeline, weekId: string): TimelineDay[] | undefined {
  const week = timeline.weeks.find((item) => item.id === weekId);
  return week?.days.map((day) => timeline.byDay.get(day)!);
}
