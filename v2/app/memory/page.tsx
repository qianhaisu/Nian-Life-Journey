import type { Metadata } from "next";
import Link from "next/link";
import { ArchiveNav } from "@/components/archive-nav";
import { MonthChapter } from "@/components/month-chapter";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildMemoryIndex, monthRuns } from "@/lib/memory-index";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "记忆" };

// The archive read as a publication: years, then months, then a few curated memories inside them.
// Ordinary days are folded under each month. Recent months open; older ones are an index that
// links to the month chapter. How much opens is lib/memory-ia-policy.ts, applied once in
// lib/memory-index.ts — this page only lays the result out.
export default async function MemoryPage() {
  const { chapters, privilege } = await loadFamilyArchive();
  const index = buildMemoryIndex(chapters, undefined, privilege);

  return <div className="memory-page">
    <header className="page-masthead reading-wrap"><span className="section-mark">记忆</span><h1 className="serif">往回翻翻，<br /><em>张年。</em></h1><p>那些已经过去、但还想再看一次的日子。</p></header>
    <ArchiveNav nav={index.nav} />
    {index.years.length === 0 ? <section className="reading-wrap archive-empty"><p className="serif">档案还是空的。等时间再走一会儿。</p></section> : null}
    {index.years.map((year) => {
      // A year reads backwards through its months — 9, 8, 7 — and nothing reorders that. `mode`
      // decides how a month is shown, never where it sits: rendering every open month first put
      // 2026-08 above 2026-09, and 2025-05 above 2025-12, which is simply not how anyone looks
      // back through a year. Consecutive index months still share one list, so the folded run
      // still reads as a list rather than as a stack of separate ones.
      const runs = monthRuns(year.months);
      return <section className="year-chapter reading-wrap" key={year.year} aria-labelledby={`year-${year.year}`}>
        <header className="year-anchor">
          <h2 id={`year-${year.year}`} className="serif"><Link href={year.href}>{year.year}</Link></h2>
          {year.ageSpan ? <p>{year.ageSpan}</p> : null}
        </header>
        {runs.map((run) => run.mode === "index"
          ? <ol className="month-index" key={run.months[0].chapter.month}>{run.months.map((month) => <MonthChapter entry={month} key={month.chapter.month} />)}</ol>
          : run.months.map((month) => <MonthChapter entry={month} key={month.chapter.month} />))}
      </section>;
    })}
  </div>;
}
