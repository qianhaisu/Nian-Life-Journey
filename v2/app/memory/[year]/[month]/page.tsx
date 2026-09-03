import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { loadFamilyArchive } from "@/lib/family-archive";
import { findMonth } from "@/lib/memory-chapters";
import { buildMonthView } from "@/lib/memory-index";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { formatMonth } from "@/lib/time-signature";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ year: string; month: string }> }): Promise<Metadata> {
  const { year, month } = await params;
  return { title: formatMonth(`${year}-${month}`) };
}

// The month chapter — the primary reading unit inside 记忆 and the only page that shows a month
// whole: its anchor, the month's own words when a summary exists, every memory, then the month's
// days newest first — each day with its photographs (capped per day by lib/memory-ia-policy.ts;
// the chapter is an edited publication, not a dump) and whatever the archive wrote about the day.
export default async function MonthPage({ params }: { params: Promise<{ year: string; month: string }> }) {
  const { year, month: monthSegment } = await params;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(monthSegment)) notFound();
  const month = `${year}-${monthSegment}`;
  const { chapters, store, snapshot } = await loadFamilyArchive();
  const chapter = findMonth(chapters, month);
  if (!chapter) notFound();

  const view = buildMonthView(chapter);
  const summary = snapshot?.month === month ? snapshot : undefined;
  const focusGoals = summary ? focusGoalsForSnapshot(store.monthlyFocusGoals, month) : [];
  const yearChapter = chapters.find((item) => item.year === year);
  const siblings = yearChapter?.months.filter((item) => item.month !== month) ?? [];

  return <div className="month-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href={`/memory/${year}`}>← {year} 年</Link>
      <span className="section-mark">月份章节</span>
      <h1 className="serif">{chapter.label}</h1>
      {chapter.ageLabel ? <p className="chapter-age">当时 {chapter.ageLabel}</p> : null}
      {summary ? <p className="chapter-summary serif">{summary.summary}</p> : null}
    </header>
    {view.memories.length > 0 ? <div className="month-memories">{view.memories.map((memory, index) => <EditorialMemory memory={memory} priority={index === 0} key={memory.id} />)}</div> : null}
    {view.days.length > 0 ? <section className="month-days" aria-labelledby="days-title">
      <h2 id="days-title" className="section-mark">{view.memories.length > 0 ? "这个月的日子" : "这个月"}</h2>
      <ol>
        {view.days.map((day, index) => <li className="month-day" key={day.day}>
          <p className="month-day-date"><time dateTime={day.day}>{day.dateLabel}</time>{day.ageLabel ? <span>{day.ageLabel}</span> : null}</p>
          <PhotoStrip photos={day.photos} priority={index === 0 && view.memories.length === 0} />
          {day.entries.length > 0 ? <ul className="month-day-notes">{day.entries.map((entry, i) => <li key={i}>{entry}</li>)}{day.hiddenEntryCount > 0 ? <li className="trace-more">还有 {day.hiddenEntryCount} 条</li> : null}</ul> : null}
          {day.morePhotoCount > 0 ? <p className="chapter-meta">这一天还有 {day.morePhotoCount} 张照片</p> : null}
        </li>)}
      </ol>
    </section> : null}
    {view.memories.length === 0 && view.days.length === 0 ? <p className="serif archive-empty">这个月的生活还在档案里，等整理好就能翻看。</p> : null}
    {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
    {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`}>{item.shortLabel}</Link>).flatMap((node, index) => index ? [" · ", node] : [node])}</p></footer> : null}
  </div>;
}
