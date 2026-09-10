import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveExpander } from "@/components/archive-expander";
import { PhotoGallery } from "@/components/photo-viewer";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { DayHead, MonthMoment, dayLabel } from "@/components/month-moment";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { loadFamilyArchive } from "@/lib/family-archive";
import { listArchiveMonths } from "@/lib/db/repository";
import { buildTimeArchiveEnumerationAllowed } from "@/lib/db/config";
import { findMonth } from "@/lib/memory-chapters";
import { buildMonthComposition, monthStandfirst } from "@/lib/publication-moments";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { formatMonth } from "@/lib/time-signature";

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
  const { chapters, store, snapshots, privilege, traceEvents, birthDay } = await loadFamilyArchive();
  const chapter = findMonth(chapters, month);
  if (!chapter) notFound();

  const composition = buildMonthComposition(chapter, privilege, traceEvents, birthDay);
  const standfirst = monthStandfirst(composition.daysWithWords);
  const summary = snapshots.find((item) => item.month === month);
  const focusGoals = summary ? focusGoalsForSnapshot(store.monthlyFocusGoals, month) : [];
  const yearChapter = chapters.find((item) => item.year === year);
  const siblings = yearChapter?.months.filter((item) => item.month !== month) ?? [];
  const archivePhotoCount = composition.archiveDays.reduce((sum, day) => sum + day.photos.length, 0);
  // The section is named for what is actually in it. A month with a playable clip says so; a month
  // without one is not promised a video it does not have.
  const albumHasVideo = composition.archiveDays.some((day) => day.photos.some((item) => item.type === "video"));
  const albumLabel = albumHasVideo ? "这个月的照片与视频" : "这个月的照片";
  const empty = composition.chapter.length === 0 && composition.chronicle.length === 0 && composition.quietDays.length === 0 && archivePhotoCount === 0;

  return <div className="month-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href={`/memory/${year}`}>← {year} 年</Link>
      <span className="section-mark">月份章节</span>
      <h1 className="serif">{chapter.label}</h1>
      {chapter.ageLabel ? <p className="chapter-age">当时 {chapter.ageLabel}</p> : null}
      {summary?.summary ? <SnapshotSummary text={summary.summary} className="chapter-summary serif" /> : null}
      {!summary && composition.narration ? <p className="chapter-narration serif">{composition.narration}</p> : null}
      {!summary && !composition.narration && standfirst ? <p className="chapter-standfirst serif">{standfirst}</p> : null}
      {/* The month's photographs are the archive's largest thing by far, and since stories stopped
          borrowing them (2026-09-10) this is where nearly all of them live. It is the first link in
          the chapter for that reason — on a phone it sits under the title, one tap from the top,
          rather than at the far end of a long scroll. */}
      {archivePhotoCount > 0 ? <p className="chapter-meta"><a className="text-link" href="#month-photos">{albumLabel} →</a></p> : null}
    </header>

    {composition.chapter.length > 0 ? <section className="month-reading" aria-labelledby="reading-title">
      <h2 id="reading-title" className="section-mark">这个月记下来的</h2>
      {composition.chapter.map((moment, index) => <MonthMoment moment={moment} year={year} monthAgeLabel={chapter.ageLabel} priority={index === 0} continued={composition.chapter[index - 1]?.day === moment.day} key={`${moment.day}-${moment.kind}-${moment.memory?.id ?? ""}`} />)}
    </section> : null}

    {composition.chronicle.length > 0 ? <section className="month-days" aria-labelledby="days-title">
      <h2 id="days-title" className="section-mark">{composition.chapter.length > 0 ? "这个月的日子" : "这个月"}</h2>
      <ol>
        {composition.chronicle.map((moment, index) => <li className="month-day" key={moment.day}>
          <MonthMoment moment={moment} year={year} monthAgeLabel={chapter.ageLabel} priority={index === 0 && composition.chapter.length === 0} />
        </li>)}
      </ol>
    </section> : null}

    {composition.quietDays.length > 0 && (composition.chapter.length > 0 || composition.chronicle.length > 0) ? <p className="month-quiet-days serif">
      {composition.quietDays.length > 8
        ? `这个月还有 ${composition.quietDays.length} 天留下了零散的照片，收在下面「${albumLabel}」里。`
        : `${composition.quietDays.map((day) => dayLabel(day.dateLabel, year)).join("、")}也留下了零散的照片，收在下面「${albumLabel}」里。`}
    </p> : null}

    {/* Open by default and addressable by id: "这个月的照片" is a place the reader is sent to from
        the top of the page, and a link that lands on a collapsed accordion has not taken them
        anywhere. What ships in the first render is still the same screenful the archive layer
        always capped itself to (ARCHIVE_FIRST_SCREEN_MAX); the rest is behind ArchiveExpander. */}
    {archivePhotoCount > 0 ? <details className="month-archive" id="month-photos" open>
      <summary><span className="serif">{albumLabel}</span></summary>
      <ol>
        {composition.archiveDaysVisible.map((day) => <li className="month-day" key={day.day}>
          <DayHead day={day.day} dateLabel={day.dateLabel} ageLabel={day.ageLabel} monthAgeLabel={chapter.ageLabel} year={year} />
          <PhotoGallery photos={day.photos} dateLabel={day.dateLabel} ageLabel={day.ageLabel} stripSizes="(max-width: 700px) 30vw, 200px" />
        </li>)}
      </ol>
      {/* B-3: ArchiveExpander replaces the static "还有 N 天" text; fetches hidden days on demand. */}
      <ArchiveExpander
        year={year}
        month={monthSegment}
        foldedDayCount={composition.archiveFoldedDayCount}
        foldedPhotoCount={composition.archiveFoldedPhotoCount}
        visibleDayKeys={composition.archiveDaysVisible.map((d) => d.day)}
        monthAgeLabel={chapter.ageLabel}
      />
      {composition.smallImageCount > 0 ? <p className="chapter-meta">还有 {composition.smallImageCount} 张过小的图片（表情、缩略图）留在档案记录里，未在此显示。</p> : null}
    </details> : null}

    {empty ? <p className="serif archive-empty">这个月的生活还在档案里，等整理好就能翻看。</p> : null}
    {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
    {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`}>{item.shortLabel}</Link>).flatMap((node, index) => index ? [" · ", node] : [node])}</p></footer> : null}
  </div>;
}
