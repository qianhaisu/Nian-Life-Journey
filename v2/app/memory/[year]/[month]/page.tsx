import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveExpander } from "@/components/archive-expander";
import { DayAlbumLink } from "@/components/day-album";
import { DayPhotos } from "@/components/day-photos";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { DayHead, MonthMoment } from "@/components/month-moment";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { MonthTimeline } from "@/components/month-timeline";
import { groupIntoWeeks } from "@/lib/month-day-weight";
import { loadMonthContent } from "@/lib/month-content";
import { buildMonthTimeline, weekEntries } from "@/lib/month-timeline";
import { loadFamilyArchiveForIsr } from "@/lib/family-archive";
import { listArchiveMonths } from "@/lib/db/repository";
import { buildTimeArchiveEnumerationAllowed } from "@/lib/db/config";
import { findMonth, type MonthChapter } from "@/lib/memory-chapters";
import { buildMonthComposition, chronicleAlbumDays, dayAlbumDays } from "@/lib/publication-moments";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { ageAtMonth, formatMonth, monthAgeLine } from "@/lib/time-signature";
import { productToday } from "@/lib/time-truth";

// A month whose content file exists but has no DB chapter (no media, events, or traces).
// The month still has edited content worth reading; we supply a minimal chapter so the page
// renders that content rather than 404ing. The month will not appear in the year index until
// its first DB record arrives — this is intentional.
function contentOnlyChapter(month: string, birthDay: string | undefined): MonthChapter {
  const seg = month.slice(5, 7);
  return {
    month,
    label: formatMonth(month),
    shortLabel: `${Number(seg)} 月`,
    ageLabel: ageAtMonth(birthDay, month),
    memories: [],
    traceDays: [],
    photos: [],
    photoCount: 0,
    videoCount: 0,
    photoDays: [],
    withheldMediaCount: 0,
  };
}

export const revalidate = 300;

// Same reasoning as [year]/page.tsx's generateStaticParams: without params known at build time
// this segment renders fully dynamic on every request. A month absent here still works via
// on-demand ISR — new months don't need to be pre-listed.
//
// 2026-09-10 incident: this used to call listArchiveMonths() unconditionally. The Docker builder
// stage never has DATABASE_URL (by design — see v2/Dockerfile), so resolveRepositoryBackend()
// silently resolved to "json" during that build and listArchiveMonths() enumerated whichever
// months exist in the local mock fixture (lib/mock-data.ts happens to seed 2026-07 and 2026-08).
// Those two months got frozen into the image as static HTML built from mock content and served in
// place of the real archive until each page's own 300s ISR window elapsed on a live request — a
// production diagnostic container served fabricated August entries for roughly five minutes after
// every fresh deploy. buildTimeArchiveEnumerationAllowed() (lib/db/config.ts) keeps this list empty
// unless the build was actually given REPOSITORY_BACKEND=postgres — an empty list here still works,
// on-demand ISR renders every month correctly against the real database at runtime.
export async function generateStaticParams() {
  if (!buildTimeArchiveEnumerationAllowed()) return [];
  const months = await listArchiveMonths();
  return months.map((month) => ({ year: month.slice(0, 4), month: month.slice(5, 7) }));
}

export async function generateMetadata({ params }: { params: Promise<{ year: string; month: string }> }): Promise<Metadata> {
  const { year, month } = await params;
  return { title: formatMonth(`${year}-${month}`) };
}

// The month chapter — the primary reading unit inside 记忆. It reads like a month, start to end,
// in three layers: the CHAPTER (what is worth reading: memories and days with real words), the
// CHRONICLE (the feel of the month's photographed time, weighted, not a wall), and the ARCHIVE
// (every deliverable photograph, folded shut until asked). Composition is lib/publication-moments.ts;
// this page only lays it out.
export default async function MonthPage({ params }: { params: Promise<{ year: string; month: string }> }) {
  const { year, month: monthSegment } = await params;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(monthSegment)) notFound();
  const month = `${year}-${monthSegment}`;
  const archive = await loadFamilyArchiveForIsr();
  const { chapters, store, snapshots, privilege, traceEvents, birthDay } = archive;
  const content = await loadMonthContent(month);
  const chapter = findMonth(chapters, month) ?? (content && content.days.length > 0 ? contentOnlyChapter(month, birthDay) : null);
  if (!chapter) notFound();

  const ageLine = monthAgeLine(month, productToday(), chapter.ageLabel);
  const composition = buildMonthComposition(chapter, privilege, traceEvents, birthDay, content?.coverMediaId);
  const summary = snapshots.find((item) => item.month === month);
  const focusGoals = summary ? focusGoalsForSnapshot(store.monthlyFocusGoals, month) : [];
  const yearChapter = chapters.find((item) => item.year === year);
  const siblings = yearChapter?.months.filter((item) => item.month !== month) ?? [];
  const archivePhotoCount = composition.archiveDays.reduce((sum, day) => sum + day.photos.length, 0);
  const dayGroups = new Map(composition.dayPhotoGroups.map((day) => [day.day, day]));
  const albumDays = dayAlbumDays(composition);
  const chronicleAlbum = chronicleAlbumDays(composition);
  // The section is named for what is actually in it. A month with a playable clip says so; a month
  // without one is not promised a video it does not have.
  const albumHasVideo = composition.archiveDays.some((day) => day.photos.some((item) => item.type === "video"));
  const albumLabel = albumHasVideo ? "这个月的照片与视频" : "这个月的照片";
  // Emptiness is about the whole month, not one section: a month whose photographs all sit in day
  // groups has plenty to read even when 「这个月的照片」 is empty.
  const empty = composition.chapter.length === 0 && composition.chronicle.length === 0 && composition.quietDays.length === 0 && composition.totalPhotoCount === 0;

  // An edited month is ONE timeline of days (lib/month-timeline.ts): month title → summary → days.
  // Stories the content file did not already write are folded into their day there, so there is no
  // second list — no 「这个月的故事」, no 「这个月的日子」 heading. Only the first week is rendered here;
  // components/month-timeline.tsx loads the rest a week at a time. Months without edited content fall
  // through to the original layout below, unchanged.
  if (content) {
    const timeline = await buildMonthTimeline(archive, year, monthSegment);
    const first = timeline?.weeks[0];
    const initial = timeline && first ? weekEntries(timeline, first.id) ?? [] : [];

    return <div className="month-page reading-wrap">
      <header className="chapter-masthead">
        <Link className="back-link" href={`/memory/${year}`}>← {year} 年</Link>
        <h1 className="serif">{chapter.label}</h1>
        {ageLine ? <p className="chapter-age">{ageLine}</p> : null}
        {content.intro ? <p className="chapter-summary serif">{content.intro}</p> : null}
      </header>

      {timeline && first ? <MonthTimeline
        year={year}
        month={monthSegment}
        monthAgeLabel={chapter.ageLabel}
        weeks={timeline.weeks}
        initial={initial}
      /> : null}

      {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
      {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`} prefetch={false}>{item.shortLabel}</Link>)}</p></footer> : null}
    </div>;
  }

  return <div className="month-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href={`/memory/${year}`}>← {year} 年</Link>
      {/* 「月份章节」同上：结构名，不是家人的话，而且下一行就是「2026 年 9 月」。 */}
      <h1 className="serif">{chapter.label}</h1>
      {/* B1：当前月读「现在」，翻回去的历史月份读「当时」（monthAgeQualifier，lib/time-signature.ts）。 */}
      {ageLine ? <p className="chapter-age">{ageLine}</p> : null}
      {summary?.summary ? <SnapshotSummary text={summary.summary} className="chapter-summary serif" /> : null}
      {!summary && composition.narration ? <p className="chapter-narration serif">{composition.narration}</p> : null}
      {/* No standfirst any more: 「这个月记下 N 天。」 was a count standing in for the month (原则三,
          2026-09-13 acceptance). A month without a summary opens with its own first day. */}
      {/* A jump to 「这个月的照片」, which now holds the days that told no story of their own —
          the rest travel with their day, above. Kept at the top because those remaining days are
          still the longest thing on the page on a phone. */}
      {archivePhotoCount > 0 ? <p className="chapter-meta"><a className="text-link" href="#month-photos">{albumLabel} →</a></p> : null}
    </header>

    {/* L-1: Unified date-ordered timeline — chapter (stories) and chronicle (photo days) merged.
        A day is always in one or the other, never both: chapter days carry text; chronicle days
        carry only photos. Merging them gives a single reading column ordered by when things happened.
        Chapter days keep their dayPhotoGroups after the last story; chronicle days keep their
        album link. Week grouping (L-2) is applied on top: the month is split into up to four
        7-day spans with jump anchors. */}
    {(() => {
      // Merge chapter + chronicle into one date-ordered array
      const chapterDaySet = new Set(composition.chapter.map((m) => m.day));
      const timelineMoments = [...composition.chapter, ...composition.chronicle]
        .sort((a, b) => a.day.localeCompare(b.day));
      if (timelineMoments.length === 0) return null;

      const weeks = groupIntoWeeks(timelineMoments);
      const weekCount = weeks.length;

      return <>
        {/* Week jump nav — only when the month has more than one week of content */}
        {weekCount > 1 ? <nav className="month-jump" aria-label="跳到这个月的某一段">
          {weeks.map((wk, wi) => {
            const [yr, mo] = timelineMoments[0].day.split("-");
            const [from, to] = wk.label.split(" – ").map((s) => s.replace(" 日", ""));
            const label = `第 ${wi + 1} 周 · ${Number(mo)} 月 ${from}-${to} 日`;
            return <a key={wk.id} href={`#${wk.id}`}>{label}</a>;
          })}
        </nav> : null}

        <section className="month-reading" aria-labelledby="timeline-title">
          <h2 id="timeline-title" className="section-mark">这个月</h2>
          {weeks.map((wk, wi) => <div className="month-week" id={wk.id} key={wk.id}>
            {weekCount > 1 ? <p className="week-mark">{(() => {
              const [yr, mo] = timelineMoments[0].day.split("-");
              const [from, to] = wk.label.split(" – ").map((s) => s.replace(" 日", ""));
              return `第 ${wi + 1} 周 · ${Number(mo)} 月 ${from}-${to} 日`;
            })()}</p> : null}
            {wk.entries.map((moment, localIndex) => {
              // Find the global index for priority (first of entire timeline = priority)
              const globalIndex = timelineMoments.indexOf(moment);
              const prevMoment = timelineMoments[globalIndex - 1];
              const nextMoment = timelineMoments[globalIndex + 1];
              const isLastOfDay = nextMoment?.day !== moment.day;

              // Chapter day: after last story, show day photo group + album link
              const group = (isLastOfDay && chapterDaySet.has(moment.day)) ? dayGroups.get(moment.day) : undefined;
              const albumEntry = isLastOfDay && albumDays.has(moment.day);
              // Chronicle day: after its moment, show album link
              const chronicleEntry = isLastOfDay && chronicleAlbum.has(moment.day);

              return <Fragment key={`${moment.day}-${moment.kind}-${moment.memory?.id ?? ""}`}>
                <MonthMoment
                  moment={moment}
                  year={year}
                  monthAgeLabel={chapter.ageLabel}
                  priority={globalIndex === 0}
                  continued={prevMoment?.day === moment.day}
                />
                {group ? <DayPhotos photos={group.photos} dateLabel={group.dateLabel} ageLabel={group.ageLabel} /> : null}
                {albumEntry ? <DayAlbumLink year={year} month={monthSegment} day={moment.day} dateLabel={moment.dateLabel} ageLabel={moment.ageLabel} afterDayPhotos={Boolean(group)} /> : null}
                {chronicleEntry && !albumEntry ? <DayAlbumLink year={year} month={monthSegment} day={moment.day} dateLabel={moment.dateLabel} ageLabel={moment.ageLabel} /> : null}
              </Fragment>;
            })}
          </div>)}
        </section>
      </>;
    })()}

    {/* Folded by default: this section is deliverable photos with no story of their own, not
        something every reader needs pushed open. Addressable by id so the top-of-page link
        (chapter-meta, above) can still send a reader here — the browser opens a <details> its
        target anchor lives inside even when it starts closed. */}
    {archivePhotoCount > 0 ? <details className="month-archive" id="month-photos">
      <summary><span className="serif">{albumLabel}</span></summary>
      {/* B-3: ArchiveExpander owns the whole list, not just the folded tail. The first screen's days
          are a SELECTION (recency, and days that already carry words), so appending the rest after
          them ran the album 12 日, 15 日, 18 日, 21 日, 2 日 — expanding has to merge into one
          chronological list, and only the component holding both sides can do that. */}
      <ArchiveExpander
        year={year}
        month={monthSegment}
        foldedDayCount={composition.archiveFoldedDayCount}
        foldedPhotoCount={composition.archiveFoldedPhotoCount}
        visibleDays={composition.archiveDaysVisible}
        monthAgeLabel={chapter.ageLabel}
      />
    </details> : null}

    {empty ? <p className="serif archive-empty">这个月的生活还在档案里，等整理好就能翻看。</p> : null}
    {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
    {/* No 「·」 between the months: the separator is the space around each link now (.other-years in
        globals.css), which is also what keeps a wrapped second row from beginning with a stranded
        one. */}
    {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`} prefetch={false}>{item.shortLabel}</Link>)}</p></footer> : null}
  </div>;
}
