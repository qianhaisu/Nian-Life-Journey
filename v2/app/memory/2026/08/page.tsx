import Image from "next/image";
import Link from "next/link";
import { events, monthArchives, media } from "@/lib/mock-data";

export default function MonthPage() {
  const month = monthArchives[0];
  const cover = media.find((item) => item.id === month.coverMediaId);
  return <div className="review-page wide-wrap"><header className="month-masthead"><Link className="back-link" href="/memory">← 回到连续时间流</Link><div><span>2026 / 08</span><h1 className="serif">八月</h1></div><p className="serif">“{month.summary}”</p></header><div className="month-cover">{cover ? <Image src={cover.src} alt={cover.alt} fill priority sizes="100vw" /> : null}</div><section className="month-review-grid"><div><span className="section-mark">这个月留下</span><strong>{month.photoCount}</strong><p>张照片 · {month.videoCount} 段视频<br />{month.momentCount} 个值得记住的时刻</p></div><ol>{events.filter((event) => event.occurredAt.startsWith("2026-08") && event.keptInYearbook).map((event) => <li key={event.id}><time>{event.occurredAt.slice(8)}</time><Link href={`/events/${event.id}`}>{event.title}</Link></li>)}</ol></section></div>;
}
