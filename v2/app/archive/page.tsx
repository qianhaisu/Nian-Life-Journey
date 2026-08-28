import Image from "next/image";
import Link from "next/link";
import { monthArchives, media, profile, yearArchive } from "@/lib/mock-data";

export default function ArchivePage() {
  return <div className="archive-page wrap">
    <div className="archive-heading">
      <Link className="back-link" href="/">← 回到首页</Link>
      <span className="eyebrow">{profile.displayName} 的年鉴</span>
      <h1 className="serif">把一年，<br /><em>翻回来看。</em></h1>
      <p>{yearArchive.intro}</p>
    </div>
    <section className="archive-year" aria-labelledby="archive-year-title">
      <h2 id="archive-year-title" className="archive-year-label"><span className="year-number serif">{yearArchive.year}</span><span>{yearArchive.title}</span></h2>
      <div className="archive-months">
        {monthArchives.map((month) => {
          const cover = media.find((item) => item.id === month.coverMediaId);
          return <article className="archive-month" aria-labelledby={`${month.id}-title`} key={month.id}>
            <div className="archive-cover">{cover ? <Image src={cover.src} alt={cover.alt} fill priority={month.id === monthArchives[0]?.id} sizes="(max-width: 700px) 100vw, 52vw" style={{ objectFit: "cover" }} /> : null}<span>{month.label}</span></div>
            <div className="archive-month-copy">
              <p className="archive-month-date">2026 · 08</p>
              <h3 id={`${month.id}-title`} className="serif">这个月的张年</h3>
              <p className="archive-summary">{month.summary}</p>
              <ul className="archive-highlights">{month.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul>
              <div className="archive-counts"><span>{month.momentCount} 个值得记住的时刻</span><span>{month.photoCount} 张照片 · {month.videoCount} 个视频</span></div>
              <Link className="text-link" href="/timeline">重新阅读这个月 <b>↗</b></Link>
            </div>
          </article>;
        })}
      </div>
    </section>
    <div className="archive-next"><span>接下来的年份</span><p className="serif">还没有到来的章节，先留一个位置。</p><span>2027 · 2028 · 继续发生</span></div>
  </div>;
}
