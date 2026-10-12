import Image from "next/image";
import Link from "next/link";
import "@/app/films/film-entry.css";

// 首页的短片入口（2026-10，给雪姨）。独立组件：首页只引用它一次，样式在自己的 CSS 里。
export function HomeFilmEntry() {
  return <Link className="home-film reveal" href="/films/xueyi" aria-label="看短片：给雪姨">
    <span className="home-film-poster">
      <Image src="/api/films/xueyi-2026-poster-v4.jpg" alt="" width={1080} height={1920} sizes="88px" unoptimized />
      <span className="home-film-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" /></svg></span>
    </span>
    <span className="home-film-copy">
      <span className="home-film-kicker">一支短片 · 6 分 12 秒</span>
      <span className="home-film-title">给雪姨</span>
    </span>
    <span className="home-film-arrow" aria-hidden="true">↗</span>
  </Link>;
}
