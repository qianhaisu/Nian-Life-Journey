import Link from "next/link";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { RecentMemoryCanvas } from "@/components/recent-memory-canvas";
import { getHomeEvents, getStore } from "@/lib/db/repository";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [events, store] = await Promise.all([getHomeEvents(), getStore()]); const canvasEvents = events.slice(0, 4);
  const snapshot = store.monthlySnapshot;
  const snapshotMonth = snapshot ? snapshot.month : "";
  const snapshotSummary = snapshot ? snapshot.summary : "";
  const focusGoals = snapshot ? focusGoalsForSnapshot(store.monthlyFocusGoals, snapshot.month) : [];
  // Derived from real GrowthRecords only. This block used to be a hardcoded demo array plus a lookup
  // for two seed ids that no longer exist, which is what rendered "undefined cm · undefined kg" and
  // two growth claims that no evidence in the archive supports. With no records, the section is
  // simply not rendered — an empty section is honest, an invented one is not.
  const recentChanges = store.growthRecords
    .toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))
    .slice(0, 3)
    .map((record) => ({
      date: record.observedAt.slice(5, 10).replace("-", "."),
      label: record.kind,
      title: [record.value, record.unit].filter(Boolean).join(" "),
      note: record.note ?? "",
    }))
    .filter((change) => change.title.trim().length > 0);
  return <div className="home-page">
    <header className="home-masthead wide-wrap reveal"><span className="section-mark">2026 年 8 月 · 最近</span><h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1></header>
    <div className="wide-wrap"><RecentMemoryCanvas events={canvasEvents} media={store.media} /></div>
    {recentChanges.length > 0 && <section className="home-changes reading-wrap" aria-labelledby="changes-title"><div className="section-heading"><span className="section-mark">最近</span><h2 id="changes-title" className="serif">有什么新变化</h2></div><ol>{recentChanges.map((change) => <li key={change.title}><time>{change.date}</time><div><span>{change.label}</span><h3 className="serif">{change.title}</h3><p>{change.note}</p></div></li>)}</ol><Link className="text-link" href="/about">去看看最近的变化 <span>↗</span></Link></section>}
    <MonthlyFocusGoals goals={focusGoals} snapshotMonth={snapshotMonth} />
    <section className="month-encounter wide-wrap"><div><span className="section-mark">这个月</span><p className="serif">&ldquo;{snapshotSummary}&rdquo;</p><Link className="text-link" href="/memory/2026/08">翻回八月 <span>↗</span></Link></div><aside><span className="section-mark">一年前的今天</span><h2 className="serif">回头看看那一天。</h2><p>不是每天提醒，只在有想再看一次的日子时出现。</p><Link href="/memory">去以前看看</Link></aside></section>
  </div>;
}
