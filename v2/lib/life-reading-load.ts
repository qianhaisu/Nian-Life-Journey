import { cache } from "react";
import { loadFamilyArchiveOnDemand, type FamilyArchive } from "./family-archive";
import { buildMonthTimeline } from "./month-timeline";
import { loadMonthContent } from "./month-content";
import { buildYearBook, readingSentences, readingAge, type ReadingDay, type YearBook } from "./life-reading";
import { loadTopicCache } from "./home-memory-topics-load";
import { topicLookupFrom, type PhotoTopicLookup } from "./home-memory-topics";
import { buildYearView } from "./memory-index";
import { calendarDayOf } from "./timeline-dates";

/** Shared archive memo + cached local monthly files. No new database or raw-source reads. */
export const readLifeArchive = cache(async () => {
  const archive = await loadFamilyArchiveOnDemand();
  const topics = topicLookupFrom(await loadTopicCache());
  const entries = await readPublishedDays(archive, undefined, topics);
  return { archive, entries, topics };
});

export async function readPublishedDays(archive: FamilyArchive, year?: string, photoTopics?: PhotoTopicLookup): Promise<ReadingDay[]> {
  const months = archive.chapters.filter(chapter => !year || chapter.year === year).flatMap(chapter => chapter.months);
  const topics = photoTopics ?? topicLookupFrom(await loadTopicCache());
  const results = await Promise.all(months.map(async month => {
    const timeline = await buildMonthTimeline(archive, month.month.slice(0, 4), month.month.slice(5));
    if (timeline) return [...timeline.byDay.values()].map(day => ({ ...day,
      ageLabel: readingAge(archive.birthDay, day.day, day.ageLabel),
      paragraphs: [...day.paragraphs, ...day.stories.flatMap(story => story.paragraphs)],
      // A photo is a view of this day, not evidence of a named person's presence or an ability.
      photos: day.photos.filter(photo => photo.type === "photo" && topics(photo.id)?.carousel?.sensitive !== true),
    }));
    // Old published stories with no edited day retain their working event address.
    return month.memories.map(memory => ({ day: memory.signature.day, ageLabel: readingAge(archive.birthDay, memory.signature.day, memory.signature.ageLabel),
      href: `/events/${memory.id}`, title: memory.title, paragraphs: memory.excerpt ? [memory.excerpt] : [],
      photos: (memory.storyPhotos ?? (memory.lead ? [memory.lead] : [])).filter(photo => !archive.privilege.excluded?.has(photo.id) && topics(photo.id)?.carousel?.sensitive !== true),
      milestone: null, lead: memory.weight === "highlight" }));
  }));
  return results.flat().sort((a, b) => a.day.localeCompare(b.day));
}

export async function readYearBook(archive: FamilyArchive, year: string): Promise<YearBook> {
  const topics = topicLookupFrom(await loadTopicCache());
  const entries = await readPublishedDays(archive, year, topics);
  const chapter = archive.chapters.find(chapter => chapter.year === year);
  const months = await Promise.all((chapter?.months ?? []).map(async month => {
    const content = await loadMonthContent(month.month);
    const monthEntries = entries.filter(entry => entry.day.startsWith(month.month));
    // A photographed month without edited prose remains an honest photo chapter, not a made-up
    // story or a link to a nonexistent day page. Reuse the annual preview's existing review gates.
    if (!content && !monthEntries.length && chapter) {
      const preview = buildYearView({ ...chapter, months: [month] }, undefined, archive.privilege, undefined, archive.birthDay).months[0]?.preview ?? [];
      const byDay = new Map<string, typeof preview>();
      for (const media of preview) {
        const day = calendarDayOf(media.takenAt);
        if (day && topics(media.id)?.carousel?.sensitive !== true) byDay.set(day, [...(byDay.get(day) ?? []), media]);
      }
      for (const [day, photos] of byDay) monthEntries.push({ day, href: `/memory/${year}/${month.month.slice(5)}`, ageLabel: readingAge(archive.birthDay, day),
        title: null, paragraphs: [], photos, milestone: null, lead: false });
    }
    return { month: month.month, title: content?.cardLine, pinnedPhotoId: content?.coverMediaId,
      intro: content?.intro?.trim() || archive.snapshots.find(snapshot => snapshot.month === month.month)?.summary?.trim(),
      entries: monthEntries };
  }));
  // Existing reviewed scene annotations are authoritative; don't guess that nearby photos match.
  return buildYearBook(year, months, archive.birthDay, archive.time.today, {
    sceneKey: media => topics(media.id)?.carousel?.sceneKey,
    value: media => { const score = topics(media.id)?.carousel; return score ? score.clarity + score.expression : 0; },
  });
}

/** Homepage bookmark: only local text reads, never builds all day timelines on the homepage. */
export async function readBookTeaser(archive: FamilyArchive) {
  const years = [...archive.chapters].sort((a, b) => b.year.localeCompare(a.year));
  const ordered = [...years.filter(year => year.year < archive.time.today.slice(0, 4)), ...years.filter(year => year.year >= archive.time.today.slice(0, 4))];
  for (const year of ordered) {
    const contents = await Promise.all([...year.months].sort((a, b) => a.month.localeCompare(b.month)).map(month => loadMonthContent(month.month)));
    const opening = contents.find(content => !!content?.intro?.trim() || !!content?.cardLine?.trim());
    const snapshot = archive.snapshots.find(snapshot => snapshot.month.startsWith(`${year.year}-`) && snapshot.summary?.trim());
    const intro = opening?.intro?.trim() || opening?.cardLine?.trim() || snapshot?.summary?.trim();
    if (!intro || !contents.some(content => content?.days.length)) continue;
    const days = contents.flatMap(content => content?.days.map(day => day.day) ?? []).sort();
    const firstAge = days[0] ? readingAge(archive.birthDay, days[0]) : undefined;
    const lastAge = days.at(-1) ? readingAge(archive.birthDay, days.at(-1)!) : undefined;
    const ageLabel = firstAge && lastAge ? firstAge === lastAge ? firstAge : `${firstAge} 到 ${lastAge}` : year.ageSpan;
    return { year: year.year, ageLabel, intro: readingSentences(intro.replace(/^-\s*/, ""))[0],
      ongoing: year.year === archive.time.today.slice(0, 4), href: `/memory/${year.year}` };
  }
  return undefined;
}
