import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { Photo } from "@/components/photo";
import { loadFamilyArchive } from "@/lib/family-archive";
import { findMonth } from "@/lib/memory-chapters";
import { buildMonthComposition, type PublicationMoment } from "@/lib/publication-moments";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { formatMonth } from "@/lib/time-signature";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ year: string; month: string }> }): Promise<Metadata> {
  const { year, month } = await params;
  return { title: formatMonth(`${year}-${month}`) };
}

// One moment of the month, read start to finish: its date, its words if the archive wrote any,
// then its photographs. Text and pictures share the day; the text never captions a picture.
function Moment({ moment, priority = false }: { moment: PublicationMoment; priority?: boolean }) {
  if (moment.kind === "memory_led" && moment.memory) {
    return <EditorialMemory memory={moment.memory} priority={priority} />;
  }
  return <article className={`month-moment moment-${moment.kind}${moment.hero ? " moment-with-hero" : ""}`}>
    <p className="month-day-date"><time dateTime={moment.day}>{moment.dateLabel}</time>{moment.ageLabel ? <span>{moment.ageLabel}</span> : null}</p>
    {moment.text.length > 0 ? <div className="moment-text serif">{moment.text.map((entry, index) => <p key={index}>{entry}</p>)}</div> : null}
    {moment.hero ? <Photo media={moment.hero} priority={priority} sizes="(max-width: 700px) 100vw, 760px" className="moment-hero" /> : null}
    {moment.supporting.length > 0 ? <PhotoStrip photos={moment.supporting} /> : null}
    {moment.morePhotoCount > 0 ? <p className="chapter-meta">这一天还有 {moment.morePhotoCount} 张照片在月末的档案里</p> : null}
  </article>;
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
  const { chapters, store, snapshot, privilege } = await loadFamilyArchive();
  const chapter = findMonth(chapters, month);
  if (!chapter) notFound();

  const composition = buildMonthComposition(chapter, privilege);
  const summary = snapshot?.month === month ? snapshot : undefined;
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
    </header>

    {composition.chapter.length > 0 ? <section className="month-reading" aria-labelledby="reading-title">
      <h2 id="reading-title" className="section-mark">这个月记下来的</h2>
      {composition.chapter.map((moment, index) => <Moment moment={moment} priority={index === 0} key={`${moment.day}-${moment.kind}-${moment.memory?.id ?? ""}`} />)}
    </section> : null}

    {composition.chronicle.length > 0 ? <section className="month-days" aria-labelledby="days-title">
      <h2 id="days-title" className="section-mark">{composition.chapter.length > 0 ? "这个月的日子" : "这个月"}</h2>
      <ol>
        {composition.chronicle.map((moment, index) => <li className="month-day" key={moment.day}>
          <Moment moment={moment} priority={index === 0 && composition.chapter.length === 0} />
        </li>)}
      </ol>
    </section> : null}

    {composition.quietDays.length > 0 ? <p className="month-quiet-days serif">
      {composition.quietDays.map((day) => day.dateLabel.replace(`${year} 年 `, "")).join("、")}也留下了零散的照片，收在下面的档案里。
    </p> : null}

    {archivePhotoCount > 0 ? <details className="month-archive">
      <summary><span className="serif">整月照片档案</span><small>{archivePhotoCount} 张</small></summary>
      <ol>
        {composition.archiveDays.map((day) => <li className="month-day" key={day.day}>
          <p className="month-day-date"><time dateTime={day.day}>{day.dateLabel}</time>{day.ageLabel ? <span>{day.ageLabel}</span> : null}</p>
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
