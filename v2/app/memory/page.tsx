import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { dailyTraces, events, media } from "@/lib/mock-data";

export default function MemoryPage() {
  return <div className="memory-page reading-wrap">
    <header className="page-masthead"><span className="section-mark">记忆</span><h1 className="serif">往回翻翻，<br /><em>张年。</em></h1><p>那些已经过去、但还想再看一次的日子。</p></header>
    <nav className="time-scales" aria-label="记忆的时间尺度"><span aria-current="page">日 / 事件</span><Link href="/memory/2026/08">月</Link><Link href="/memory/2026">年</Link></nav>
    <div className="year-divider"><strong className="serif">2026</strong><Link href="/memory/2026">年度回顾 ↗</Link></div>
    <div className="month-divider"><span>八月</span><Link href="/memory/2026/08">月度回顾 ↗</Link></div>
    <Timeline events={events} media={media} traces={dailyTraces} />
  </div>;
}
