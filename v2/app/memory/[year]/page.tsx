import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { loadFamilyArchive } from "@/lib/family-archive";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  return { title: `${year} 年` };
}

// One year as a chapter: the age it covered, then every month with its photos and the titles of
// its memories. Counts are a line of metadata, not the headline.
export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const { chapters } = await loadFamilyArchive();
  const chapter = chapters.find((item) => item.year === year);
  if (!chapter) notFound();

  const memoryCount = chapter.months.reduce((sum, month) => sum + month.memories.length, 0);
  const traceDayCount = chapter.months.reduce((sum, month) => sum + month.traceDays.length, 0);
  const otherYears = chapters.filter((item) => item.year !== year);

  return <div className="year-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href="/memory">← 回到记忆</Link>
      <span className="section-mark">年度篇章</span>
      <h1 className="serif">{year}</h1>
      {chapter.ageSpan ? <p className="chapter-age">这一年，张年 {chapter.ageSpan}。</p> : null}
      <p className="chapter-meta">{memoryCount} 段记忆 · {traceDayCount} 天留下了生活痕迹</p>
    </header>
    {chapter.months.map((month) => <section className="year-month" key={month.month} aria-labelledby={`month-${month.month}`}>
      <header className="month-anchor">
        <h2 id={`month-${month.month}`} className="serif"><Link href={`/memory/${year}/${month.month.slice(5, 7)}`}>{month.shortLabel}</Link></h2>
        {month.ageLabel ? <p>当时 {month.ageLabel}</p> : null}
      </header>
      <PhotoStrip photos={month.photos.slice(0, 3)} />
      {month.memories.length > 0 ? <ul className="memory-lines">{month.memories.map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {month.traceDays.length > 0 ? <p className="chapter-meta">{month.memories.length > 0 ? "还有" : ""} {month.traceDays.length} 天留下了生活痕迹</p> : null}
    </section>)}
    {otherYears.length > 0 ? <footer className="other-years"><span className="section-mark">其他年份</span><p className="serif">{otherYears.map((item) => <Link key={item.year} href={`/memory/${item.year}`}>{item.year}</Link>).flatMap((node, index) => index ? [" · ", node] : [node])}</p></footer> : null}
  </div>;
}
