import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveNav } from "@/components/archive-nav";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildMemoryIndex, buildYearView } from "@/lib/memory-index";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  return { title: `${year} 年` };
}

// The annual chapter: the age the year covered, then every month with its photos and a few of its
// memory titles (lib/memory-ia-policy.ts). Counts are a line of metadata, not the headline; the
// month chapter is where a month is read whole.
export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const { chapters, privilege } = await loadFamilyArchive();
  const chapter = chapters.find((item) => item.year === year);
  if (!chapter) notFound();

  const view = buildYearView(chapter, undefined, privilege);
  const { nav } = buildMemoryIndex(chapters);

  return <div className="year-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href="/memory">← 回到记忆</Link>
      <span className="section-mark">年度篇章</span>
      <h1 className="serif">{year}</h1>
      {chapter.ageSpan ? <p className="chapter-age">这一年，张年 {chapter.ageSpan}。</p> : null}
      <p className="chapter-meta">{[view.memoryCount > 0 ? `${view.memoryCount} 段记忆` : "", view.photoCount > 0 ? `${view.photoCount} 张照片` : "", view.traceDayCount > 0 ? `${view.traceDayCount} 天留下了生活痕迹` : ""].filter(Boolean).join(" · ")}</p>
    </header>
    {view.months.map((month) => <section className="year-month" key={month.chapter.month} aria-labelledby={`month-${month.chapter.month}`}>
      <header className="month-anchor">
        <h2 id={`month-${month.chapter.month}`} className="serif"><Link href={month.href}>{month.chapter.shortLabel}</Link></h2>
        {month.chapter.ageLabel ? <p>当时 {month.chapter.ageLabel}</p> : null}
      </header>
      {month.preview.length > 0 ? <PhotoStrip photos={month.preview} /> : null}
      {month.titles.length > 0 ? <ul className="memory-lines">{month.titles.map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {month.hiddenMemoryCount > 0 ? <p className="chapter-meta"><Link className="text-link" href={month.href}>还有 {month.hiddenMemoryCount} 段记忆 · 翻看整个月</Link></p> : null}
      <p className="chapter-meta"><Link className="text-link" href={month.href}>翻看整个月{month.chapter.photoCount > 0 ? ` · ${month.chapter.photoCount} 张照片` : ""}</Link></p>
    </section>)}
    <ArchiveNav nav={nav} current={year} />
  </div>;
}
