import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { getAllEvents, getStore } from "@/lib/db/repository";
import { availableMonths, availableYears, monthLabel } from "@/lib/timeline-dates";

export const dynamic = "force-dynamic";

export default async function MemoryPage() {
  const [events, store] = await Promise.all([getAllEvents(), getStore()]);
  // Year/month navigation is derived from the records that actually exist. It used to be a
  // hardcoded "2026 / 八月" divider sitting above a stream of 2025 memories, which is what filed
  // every 2025 event under 2026.
  const years = availableYears([events, store.dailyTraces]);
  const latestYear = years[0];
  const latestMonth = latestYear ? availableMonths([events, store.dailyTraces], latestYear)[0] : undefined;

  return <div className="memory-page reading-wrap">
    <header className="page-masthead"><span className="section-mark">记忆</span><h1 className="serif">往回翻翻，<br /><em>张年。</em></h1><p>那些已经过去、但还想再看一次的日子。</p></header>
    <nav className="time-scales" aria-label="记忆的时间尺度">
      <span aria-current="page">日 / 事件</span>
      {latestMonth ? <Link href={`/memory/${latestMonth.slice(0, 4)}/${latestMonth.slice(5, 7)}`}>月</Link> : null}
      {latestYear ? <Link href={`/memory/${latestYear}`}>年</Link> : null}
    </nav>
    {years.length > 1 ? <nav className="memory-years" aria-label="按年份翻看">
      {years.map((year) => <Link key={year} href={`/memory/${year}`}>{year}</Link>)}
    </nav> : null}
    {latestYear ? <div className="year-divider"><strong className="serif">{latestYear}</strong><Link href={`/memory/${latestYear}`}>年度回顾 ↗</Link></div> : null}
    {latestMonth ? <div className="month-divider"><span>{monthLabel(latestMonth)}</span><Link href={`/memory/${latestMonth.slice(0, 4)}/${latestMonth.slice(5, 7)}`}>月度回顾 ↗</Link></div> : null}
    <Timeline events={events} media={store.media} traces={store.dailyTraces} />
  </div>;
}
