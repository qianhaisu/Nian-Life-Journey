import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveNav } from "@/components/archive-nav";
import { MonthChapter } from "@/components/month-chapter";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildMemoryIndex } from "@/lib/memory-index";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "记忆" };

// The archive read as a publication: years, then months, then a few curated memories inside them.
// Ordinary days are folded under each month. Recent months open; older ones are an index that
// links to the month chapter. How much opens is lib/memory-ia-policy.ts, applied once in
// lib/memory-index.ts — this page only lays the result out.
export default async function MemoryPage() {
  const { chapters } = await loadFamilyArchive();
  const index = buildMemoryIndex(chapters);

  return <div className="memory-page">
    <header className="page-masthead reading-wrap"><span className="section-mark">记忆</span><h1 className="serif">往回翻翻，<br /><em>张年。</em></h1><p>那些已经过去、但还想再看一次的日子。</p></header>
    <ArchiveNav nav={index.nav} />
    {index.years.length === 0 ? <section className="reading-wrap archive-empty"><p className="serif">档案还是空的。等时间再走一会儿。</p></section> : null}
    {index.years.map((year) => {
      const openHere = year.months.filter((month) => month.mode === "open");
      const indexHere = year.months.filter((month) => month.mode === "index");
      return <section className="year-chapter reading-wrap" key={year.year} aria-labelledby={`year-${year.year}`}>
        <header className="year-anchor">
          <h2 id={`year-${year.year}`} className="serif"><Link href={year.href}>{year.year}</Link></h2>
          {year.ageSpan ? <p>{year.ageSpan}</p> : null}
        </header>
        {openHere.map((month) => <MonthChapter entry={month} key={month.chapter.month} />)}
        {indexHere.length > 0 ? <ol className="month-index">{indexHere.map((month) => <MonthChapter entry={month} key={month.chapter.month} />)}</ol> : null}
      </section>;
    })}
  </div>;
}
