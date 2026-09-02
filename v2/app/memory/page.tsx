import type { Metadata } from "next";
import Link from "next/link";
import { MonthChapter } from "@/components/month-chapter";
import { loadFamilyArchive } from "@/lib/family-archive";
import { splitOpenMonths } from "@/lib/memory-chapters";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "记忆" };

// The archive read as a publication: years, then months, then the memories inside them. Ordinary
// days are folded under each month. Recent months open in full; older ones are an index that
// links to the month page.
export default async function MemoryPage() {
  const { chapters } = await loadFamilyArchive();
  const { open } = splitOpenMonths(chapters);
  const openMonths = new Set(open.flatMap((year) => year.months.map((month) => month.month)));

  return <div className="memory-page">
    <header className="page-masthead reading-wrap"><span className="section-mark">记忆</span><h1 className="serif">往回翻翻，<br /><em>张年。</em></h1><p>那些已经过去、但还想再看一次的日子。</p></header>
    {chapters.length === 0 ? <section className="reading-wrap archive-empty"><p className="serif">档案还是空的。等时间再走一会儿。</p></section> : null}
    {chapters.map((year) => {
      const openHere = year.months.filter((month) => openMonths.has(month.month));
      const indexHere = year.months.filter((month) => !openMonths.has(month.month));
      return <section className="year-chapter reading-wrap" key={year.year} aria-labelledby={`year-${year.year}`}>
        <header className="year-anchor">
          <h2 id={`year-${year.year}`} className="serif"><Link href={`/memory/${year.year}`}>{year.year}</Link></h2>
          {year.ageSpan ? <p>{year.ageSpan}</p> : null}
        </header>
        {openHere.map((month) => <MonthChapter chapter={month} open key={month.month} />)}
        {indexHere.length > 0 ? <ol className="month-index">{indexHere.map((month) => <MonthChapter chapter={month} open={false} key={month.month} />)}</ol> : null}
      </section>;
    })}
  </div>;
}
