import Link from "next/link";
import { RecentMemoryCanvas } from "@/components/recent-memory-canvas";
import { events, growthRecords, media, monthlySnapshot } from "@/lib/mock-data";

const recentChanges = [
  { date: "08.27", label: "语言", title: "开始一直说“车车”", note: "看到车会主动指给我们看。" },
  { date: "08.28", label: "运动 · 社交", title: "第一次追进了球场", note: "开始主动参与其他孩子的活动。" },
  { date: "08.25", label: "身体", title: `${growthRecords.find((item) => item.id === "height-2026-08")?.value} cm · ${growthRecords.find((item) => item.id === "weight-2026-08")?.value} kg`, note: "八月的家庭测量。" },
];

export default function HomePage() {
  const canvasEvents = events.slice(0, 4);
  return <div className="home-page">
    <header className="home-masthead wide-wrap reveal"><span className="section-mark">2026 年 8 月 · 最近</span><h1 className="serif">最近怎么样，<br /><em>张年。</em></h1></header>
    <div className="wide-wrap"><RecentMemoryCanvas events={canvasEvents} media={media} /></div>
    <section className="home-changes reading-wrap" aria-labelledby="changes-title"><div className="section-heading"><span className="section-mark">最近</span><h2 id="changes-title" className="serif">有什么新变化</h2></div><ol>{recentChanges.map((change) => <li key={change.title}><time>{change.date}</time><div><span>{change.label}</span><h3 className="serif">{change.title}</h3><p>{change.note}</p></div></li>)}</ol><Link className="text-link" href="/about">去看看最近的变化 <span>↗</span></Link></section>
    <section className="recent-moments wide-wrap" aria-labelledby="moments-title"><div className="section-heading"><span className="section-mark">最近留下</span><h2 id="moments-title" className="serif">还有几个时刻</h2></div><div className="moment-lines">{events.slice(4, 7).map((event) => <Link href={`/events/${event.id}`} key={event.id}><time>{event.occurredAt.slice(5).replace("-", ".")}</time><span className="serif">{event.title}</span><i aria-hidden="true">↗</i></Link>)}</div></section>
    <section className="month-encounter wide-wrap"><div><span className="section-mark">这个月</span><p className="serif">“{monthlySnapshot.summary}”</p><Link className="text-link" href="/memory/2026/08">翻回八月 <span>↗</span></Link></div><aside><span className="section-mark">一年前的今天</span><h2 className="serif">一年前，他还不会走。</h2><p>不是每天提醒，只在有想再看一次的日子时出现。</p><Link href="/memory">去以前看看</Link></aside></section>
  </div>;
}
