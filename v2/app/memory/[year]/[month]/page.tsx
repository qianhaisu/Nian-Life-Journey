import Link from "next/link";
import { notFound } from "next/navigation";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { getAllEvents, getStore } from "@/lib/db/repository";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { isSnapshotPublishable } from "@/lib/organizer/quality-review";
import { availableMonths, availableYears, calendarMonthOf, dayOfMonth, inMonth, monthLabel } from "@/lib/timeline-dates";

export const dynamic = "force-dynamic";

// Replaces the former literal app/memory/2026/08 directory, which read counts and a summary from
// lib/mock-data (186 photos, 23 moments) regardless of what the month actually contained.
export default async function MonthPage({ params }: { params: Promise<{ year: string; month: string }> }) {
  const { year, month: monthSegment } = await params;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(monthSegment)) notFound();
  const month = `${year}-${monthSegment}`;
  const [events, store] = await Promise.all([getAllEvents(), getStore()]);
  if (!availableMonths([events, store.dailyTraces], year).includes(month)) notFound();

  const monthEvents = inMonth(events, month);
  const monthTraces = inMonth(store.dailyTraces, month);
  const mediaIds = new Set(monthEvents.flatMap((event) => event.mediaIds));
  const monthMedia = store.media.filter((item) => mediaIds.has(item.id));
  const photoCount = monthMedia.filter((item) => item.type === "photo").length;
  const videoCount = monthMedia.filter((item) => item.type === "video").length;

  // The summary is only shown when this month has published memories behind it, so a seeded
  // snapshot can never act as a container for another month's content.
  const publishedMonths = new Set(events.map((event) => calendarMonthOf(event.occurredAt)).filter((value): value is string => Boolean(value)));
  const snapshot = store.monthlySnapshot?.month === month && isSnapshotPublishable(month, publishedMonths) ? store.monthlySnapshot : undefined;
  const focusGoals = snapshot ? focusGoalsForSnapshot(store.monthlyFocusGoals, month) : [];
  const years = availableYears([events, store.dailyTraces]);

  return <div className="review-page wide-wrap">
    <header className="month-masthead">
      <Link className="back-link" href="/memory">← 回到连续时间流</Link>
      <div><span>{year} / {monthSegment}</span><h1 className="serif">{monthLabel(month)}</h1></div>
      {snapshot ? <p className="serif">&ldquo;{snapshot.summary}&rdquo;</p> : null}
    </header>
    <section className="month-review-grid">
      <div><span className="section-mark">这个月留下</span><strong>{photoCount}</strong><p>张照片 · {videoCount} 段视频<br />{monthEvents.length} 个值得记住的时刻 · {monthTraces.length} 天生活痕迹</p></div>
      <ol>{monthEvents.map((event) => <li key={event.id}><time>{dayOfMonth(event.occurredAt)}</time><Link href={`/events/${event.id}`}>{event.title}</Link></li>)}</ol>
    </section>
    {snapshot ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
    <footer className="future-years">
      <span>其他年份</span>
      <p className="serif">{years.map((item) => <Link key={item} href={`/memory/${item}`}>{item}</Link>).flatMap((node, index) => index ? [" · ", node] : [node])}</p>
    </footer>
  </div>;
}
