import Link from "next/link";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { RecentMemoryCanvas } from "@/components/recent-memory-canvas";
import { getHomeEvents, getStore } from "@/lib/db/repository";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { isSnapshotPublishable } from "@/lib/organizer/quality-review";
import { calendarMonthOf, monthLabel } from "@/lib/timeline-dates";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [events, store] = await Promise.all([getHomeEvents(), getStore()]); const canvasEvents = events.slice(0, 4);
  // The masthead month must be the month of the memory actually on screen. It was the hardcoded
  // string "2026 年 8 月", which labelled a 2025-08-11 hero as 2026.
  const leadMonth = calendarMonthOf(canvasEvents[0]?.occurredAt);
  // A seeded snapshot must not act as a container for another month's memories: it is shown only
  // when its own month has published memories behind it.
  const publishedMonths = new Set(events.map((event) => calendarMonthOf(event.occurredAt)).filter((value): value is string => Boolean(value)));
  const snapshot = store.monthlySnapshot && isSnapshotPublishable(store.monthlySnapshot.month, publishedMonths) ? store.monthlySnapshot : undefined;
  const snapshotMonth = snapshot ? snapshot.month : "";
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
    <header className="home-masthead wide-wrap reveal"><span className="section-mark">{leadMonth ? `${leadMonth.slice(0, 4)} 年 ${Number(leadMonth.slice(5, 7))} 月 · 最近` : "最近"}</span><h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1></header>
    <div className="wide-wrap"><RecentMemoryCanvas events={canvasEvents} media={store.media} /></div>
    {recentChanges.length > 0 && <section className="home-changes reading-wrap" aria-labelledby="changes-title"><div className="section-heading"><span className="section-mark">最近</span><h2 id="changes-title" className="serif">有什么新变化</h2></div><ol>{recentChanges.map((change) => <li key={change.title}><time>{change.date}</time><div><span>{change.label}</span><h3 className="serif">{change.title}</h3><p>{change.note}</p></div></li>)}</ol><Link className="text-link" href="/about">去看看最近的变化 <span>↗</span></Link></section>}
    <MonthlyFocusGoals goals={focusGoals} snapshotMonth={snapshotMonth} />
    <section className="month-encounter wide-wrap"><div><span className="section-mark">这个月</span>{snapshot ? <p className="serif">&ldquo;{snapshot.summary}&rdquo;</p> : null}{leadMonth ? <Link className="text-link" href={`/memory/${leadMonth.slice(0, 4)}/${leadMonth.slice(5, 7)}`}>翻回{monthLabel(leadMonth)} <span>↗</span></Link> : null}</div><aside><span className="section-mark">一年前的今天</span><h2 className="serif">回头看看那一天。</h2><p>不是每天提醒，只在有想再看一次的日子时出现。</p><Link href="/memory">去以前看看</Link></aside></section>
  </div>;
}
