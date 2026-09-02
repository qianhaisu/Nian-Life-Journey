import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { TraceDisclosure } from "@/components/trace-disclosure";
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

// The month chapter — the primary archive unit and the only page that shows a month whole: its
// anchor, the month's own words when a summary exists, a few photos, then every memory and the
// folded ordinary days (every day present, entries per day capped by lib/memory-ia-policy.ts).
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
    <PhotoStrip photos={chapter.photos} sizes="(max-width: 700px) 46vw, 300px" />
    {view.memories.length > 0 ? <div className="month-memories">{view.memories.map((memory, index) => <EditorialMemory memory={memory} priority={index === 0} key={memory.id} />)}</div> : null}
    <TraceDisclosure traces={view.traces} hasMemories={view.memories.length > 0} />
    {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
    {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`}>{item.shortLabel}</Link>).flatMap((node, index) => index ? [" · ", node] : [node])}</p></footer> : null}
  </div>;
}
