import Link from "next/link";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { RecentMemoryCanvas } from "@/components/recent-memory-canvas";
import { getHomeEvents, getStore } from "@/lib/db/repository";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [events, store] = await Promise.all([getHomeEvents(), getStore()]); const canvasEvents = events.slice(0, 4);
  const focusGoals = focusGoalsForSnapshot(store.monthlyFocusGoals, store.monthlySnapshot.month);
  const recentChanges = [
    { date: "08.27", label: "语言", title: "开始一直说“车车”", note: "看到车会主动指给我们看。" },
    { date: "08.28", label: "运动 · 社交", title: "第一次追进了球场", note: "开始主动参与其他孩子的活动。" },
    { date: "08.25", label: "身体", title: `${store.growthRecords.find((item) => item.id === "height-2026-08")?.value} cm · ${store.growthRecords.find((item) => item.id === "weight-2026-08")?.value} kg`, note: "八月的家庭测量。" },
  ];
  return <div className="home-page">
    <header className="home-masthead wide-wrap reveal"><span className="section-mark">2026 年 8 月 · 最近</span><h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1></header>
    <div className="wide-wrap"><RecentMemoryCanvas events={canvasEvents} media={store.media} /></div>
    <section className="home-changes reading-wrap" aria-labelledby="changes-title"><div className="section-heading"><span className="section-mark">最近</span><h2 id="changes-title" className="serif">有什么新变化</h2></div><ol>{recentChanges.map((change) => <li key={change.title}><time>{change.date}</time><div><span>{change.label}</span><h3 className="serif">{change.title}</h3><p>{change.note}</p></div></li>)}</ol><Link className="text-link" href="/about">去看看最近的变化 <span>↗</span></Link></section>
    <MonthlyFocusGoals goals={focusGoals} snapshotMonth={store.monthlySnapshot.month} />
    <section className="month-encounter wide-wrap"><div><span className="section-mark">这个月</span><p className="serif">“{store.monthlySnapshot.summary}”</p><Link className="text-link" href="/memory/2026/08">翻回八月 <span>↗</span></Link></div><aside><span className="section-mark">一年前的今天</span><h2 className="serif">一年前，他还不会走。</h2><p>不是每天提醒，只在有想再看一次的日子时出现。</p><Link href="/memory">去以前看看</Link></aside></section>
  </div>;
}
