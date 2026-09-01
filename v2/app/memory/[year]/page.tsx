import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllEvents, getStore } from "@/lib/db/repository";
import { availableMonths, availableYears, inMonth, inYear, monthLabel } from "@/lib/timeline-dates";

export const dynamic = "force-dynamic";

// Replaces the former literal app/memory/2026 directory, which rendered lib/mock-data and could
// only ever answer for 2026 — /memory/2025 returned 404 even though every LifeEvent is from 2025.
export default async function YearPage({ params }: { params: Promise<{ year: string }> }) {
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const [events, store] = await Promise.all([getAllEvents(), getStore()]);
  const years = availableYears([events, store.dailyTraces]);
  if (!years.includes(year)) notFound();

  const yearEvents = inYear(events, year);
  const yearTraces = inYear(store.dailyTraces, year);
  const months = availableMonths([events, store.dailyTraces], year);
  const mediaIds = new Set(yearEvents.flatMap((event) => event.mediaIds));
  const photoCount = store.media.filter((item) => mediaIds.has(item.id) && item.type === "photo").length;
  const videoCount = store.media.filter((item) => mediaIds.has(item.id) && item.type === "video").length;

  return <div className="review-page wide-wrap">
    <header className="review-masthead">
      <Link className="back-link" href="/memory">← 回到连续时间流</Link>
      <span>年度回顾</span>
      <h1 className="serif">{year}</h1>
      <p className="serif">这一年留下来的日子。</p>
      <small>{yearEvents.length} 段记忆 · {yearTraces.length} 天生活痕迹 · {photoCount} 张照片 · {videoCount} 段视频</small>
    </header>
    <section className="year-months">
      {months.map((month) => {
        const monthEvents = inMonth(yearEvents, month);
        const monthTraces = inMonth(yearTraces, month);
        return <div className="year-month-row" key={month}>
          <div className="year-month-head"><strong className="serif">{monthLabel(month)}</strong><Link className="text-link" href={`/memory/${year}/${month.slice(5, 7)}`}>阅读这个月 <span>↗</span></Link></div>
          <p>{monthEvents.length} 段记忆 · {monthTraces.length} 天生活痕迹</p>
          <ol>{monthEvents.map((event) => <li key={event.id}><Link href={`/events/${event.id}`}>{event.title}</Link></li>)}</ol>
        </div>;
      })}
    </section>
    <footer className="future-years">
      <span>其他年份</span>
      <p className="serif">{years.filter((item) => item !== year).map((item) => <Link key={item} href={`/memory/${item}`}>{item}</Link>).flatMap((node, index) => index ? [" · ", node] : [node])}</p>
    </footer>
  </div>;
}
