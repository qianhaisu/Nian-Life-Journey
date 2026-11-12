import { cache } from "react";
import { loadFamilyArchiveOnDemand, type FamilyArchive } from "./family-archive";
import { buildMonthTimeline } from "./month-timeline";
import { listEditedMonthContents, loadMonthContent, resolveMonthContentMedia } from "./month-content";
import { buildYearBook, readingAge, type ReadingDay, type SearchMonthEntry, type YearBook } from "./life-reading";
import { loadTopicCache } from "./home-memory-topics-load";
import { topicLookupFrom, type PhotoTopicLookup } from "./home-memory-topics";
import { buildYearView } from "./memory-index";
import { toMediaRef } from "./memory-chapters";
import { isSubjectChecked } from "./publication-moments";
import { ageAtMonth, formatMonth } from "./time-signature";
import { calendarDayOf } from "./timeline-dates";

/** Shared archive memo + cached local monthly files. No new database or raw-source reads. */
export const readLifeArchive = cache(async () => {
  const archive = await loadFamilyArchiveOnDemand();
  const topics = topicLookupFrom(await loadTopicCache());
  const [entries, months] = await Promise.all([
    readPublishedDays(archive, undefined, topics),
    readSearchMonths(archive, topics),
  ]);
  return { archive, entries, months, topics };
});

export async function readSearchMonths(archive: FamilyArchive, photoTopics?: PhotoTopicLookup): Promise<SearchMonthEntry[]> {
  const topics = photoTopics ?? topicLookupFrom(await loadTopicCache());
  const editedContents = await listEditedMonthContents();
  const contentByMonth = new Map(editedContents.map((c) => [c.month, c]));
  const snapshotByMonth = new Map(archive.snapshots.map((s) => [s.month, s]));
  const available = new Map(
    archive.media
      .filter((m) => m.type !== "video" && isSubjectChecked(m, archive.privilege) && topics(m.id)?.carousel?.sensitive !== true)
      .map((m) => [m.id, m]),
  );

  const seen = new Set<string>();
  const out: SearchMonthEntry[] = [];

  const preBirthAge = (ym: string): string | undefined => {
    if (!archive.birthDay || ym >= archive.birthDay.slice(0, 7)) return undefined;
    const diff =
      (Number(archive.birthDay.slice(0, 4)) - Number(ym.slice(0, 4))) * 12 +
      Number(archive.birthDay.slice(5, 7)) -
      Number(ym.slice(5, 7));
    return diff > 0 ? `出生前 ${diff} 个月` : "出生前";
  };

  for (const chapter of archive.chapters) {
    const yearView = buildYearView(chapter, undefined, archive.privilege, undefined, archive.birthDay);
    const previewByMonth = new Map(yearView.months.map((m) => [m.chapter.month, m.preview]));
    for (const month of chapter.months) {
      if (month.month === "2024-04" || month.month === "2024-05") continue;
      seen.add(month.month);
      const content = contentByMonth.get(month.month) ?? await loadMonthContent(month.month);
      const snapshot = snapshotByMonth.get(month.month);
      const chosenCover = content?.coverMediaId
        ? resolveMonthContentMedia([content.coverMediaId], available, archive.privilege.excluded)[0]
        : undefined;
      const previewCover = (previewByMonth.get(month.month) ?? []).find(
        (p) => p.type !== "video" && topics(p.id)?.carousel?.sensitive !== true,
      );
      const label = month.label || formatMonth(month.month);
      const preBirth = Boolean(archive.birthDay && month.month < archive.birthDay.slice(0, 7));
      out.push({
        month: month.month,
        href: `/memory/${month.month.slice(0, 4)}/${month.month.slice(5, 7)}`,
        label,
        ageLabel: month.ageLabel ?? preBirthAge(month.month) ?? ageAtMonth(archive.birthDay, month.month),
        preBirth,
        cardLine: content?.cardLine,
        intro: content?.intro,
        summary: snapshot?.summary,
        cover: chosenCover ? toMediaRef(chosenCover, label) : previewCover,
      });
    }
  }

  for (const content of editedContents) {
    if (content.month < "2024-06" || seen.has(content.month) || content.days.length === 0) continue;
    seen.add(content.month);
    const label = formatMonth(content.month);
    const preBirth = Boolean(archive.birthDay && content.month < archive.birthDay.slice(0, 7));
    const chosenCover = content.coverMediaId
      ? resolveMonthContentMedia([content.coverMediaId], available, archive.privilege.excluded)[0]
      : undefined;
    out.push({
      month: content.month,
      href: `/memory/${content.month.slice(0, 4)}/${content.month.slice(5, 7)}`,
      label,
      ageLabel: preBirthAge(content.month) ?? ageAtMonth(archive.birthDay, content.month),
      preBirth,
      cardLine: content.cardLine,
      intro: content.intro,
      summary: snapshotByMonth.get(content.month)?.summary,
      cover: chosenCover ? toMediaRef(chosenCover, label) : undefined,
    });
  }

  return out.sort((a, b) => a.month.localeCompare(b.month));
}

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
