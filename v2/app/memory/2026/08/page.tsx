import Image from "next/image";
import Link from "next/link";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { getStore } from "@/lib/db/repository";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { monthArchives } from "@/lib/mock-data";

export default async function MonthPage() {
  const store = await getStore();
  const month = monthArchives[0];
  const cover = store.media.find((item) => item.id === month.coverMediaId);
  const focusGoals = focusGoalsForSnapshot(store.monthlyFocusGoals, month.month);
  return <div className="review-page wide-wrap"><header className="month-masthead"><Link className="back-link" href="/memory">← 回到连续时间流</Link><div><span>2026 / 08</span><h1 className="serif">八月</h1></div><p className="serif">“{month.summary}”</p></header><div className="month-cover">{cover ? <Image src={cover.src} alt={cover.alt} fill priority sizes="100vw" /> : null}</div><section className="month-review-grid"><div><span className="section-mark">这个月留下</span><strong>{month.photoCount}</strong><p>张照片 · {month.videoCount} 段视频<br />{month.momentCount} 个值得记住的时刻</p></div><ol>{store.events.filter((event) => event.occurredAt.startsWith(month.month) && event.keptInYearbook).map((event) => <li key={event.id}><time>{event.occurredAt.slice(8)}</time><Link href={`/events/${event.id}`}>{event.title}</Link></li>)}</ol></section><MonthlyFocusGoals goals={focusGoals} snapshotMonth={month.month} variant="review" /></div>;
}
