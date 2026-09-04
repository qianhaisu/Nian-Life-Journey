import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PhotoStrip } from "@/components/media-sequence";
import { DayHead, MonthMoment, dayLabel } from "@/components/month-moment";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { loadFamilyArchive } from "@/lib/family-archive";
import { findMonth } from "@/lib/memory-chapters";
import { buildMonthComposition, monthStandfirst } from "@/lib/publication-moments";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { formatMonth } from "@/lib/time-signature";

export const dynamic = "force-dynamic";

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
  const { chapters, store, snapshots, privilege } = await loadFamilyArchive();
  const chapter = findMonth(chapters, month);
  if (!chapter) notFound();

  const composition = buildMonthComposition(chapter, privilege);
  const standfirst = monthStandfirst(composition.daysWithWords);
  const summary = snapshots.find((item) => item.month === month);
  const focusGoals = summary ? focusGoalsForSnapshot(store.monthlyFocusGoals, month) : [];
  const yearChapter = chapters.find((item) => item.year === year);
  const siblings = yearChapter?.months.filter((item) => item.month !== month) ?? [];
  const archivePhotoCount = composition.archiveDays.reduce((sum, day) => sum + day.photos.length, 0);
  const empty = composition.chapter.length === 0 && composition.chronicle.length === 0 && composition.quietDays.length === 0 && archivePhotoCount === 0;

  return <div className="month-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href={`/memory/${year}`}>← {year} 年</Link>
      <span className="section-mark">月份章节</span>
      <h1 className="serif">{chapter.label}</h1>
      {chapter.ageLabel ? <p className="chapter-age">当时 {chapter.ageLabel}</p> : null}
      {summary ? <p className="chapter-summary serif">{summary.summary}</p> : null}
      {!summary && composition.narration ? <p className="chapter-narration serif">{composition.narration}</p> : null}
      {!summary && !composition.narration && standfirst ? <p className="chapter-standfirst serif">{standfirst}</p> : null}
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
        ? `这个月还有 ${composition.quietDays.length} 天留下了零散的照片，收在下面的档案里。`
        : `${composition.quietDays.map((day) => dayLabel(day.dateLabel, year)).join("、")}也留下了零散的照片，收在下面的档案里。`}
    </p> : null}

    {archivePhotoCount > 0 ? <details className="month-archive">
      <summary><span className="serif">整月照片档案</span><small>{archivePhotoCount} 张</small></summary>
      <ol>
        {composition.archiveDays.map((day) => <li className="month-day" key={day.day}>
          <DayHead day={day.day} dateLabel={day.dateLabel} ageLabel={day.ageLabel} monthAgeLabel={chapter.ageLabel} year={year} />
          <PhotoStrip photos={day.photos} />
        </li>)}
      </ol>
      {composition.smallImageCount > 0 ? <p className="chapter-meta">还有 {composition.smallImageCount} 张过小的图片（表情、缩略图）留在档案记录里，未在此显示。</p> : null}
    </details> : null}

    {empty ? <p className="serif archive-empty">这个月的生活还在档案里，等整理好就能翻看。</p> : null}
    {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
    {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`}>{item.shortLabel}</Link>).flatMap((node, index) => index ? [" · ", node] : [node])}</p></footer> : null}
  </div>;
}
