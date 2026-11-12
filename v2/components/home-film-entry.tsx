import React from "react";
import Image from "next/image";
import Link from "next/link";
import "@/app/films/film-entry.css";

// 首页 Bento 短片卡（Tile 5）：家庭短片《给雪姨》（2026 年 10 月 · 当时 1 岁 9 个月）。
export function HomeFilmEntry({ className }: { className?: string } = {}) {
  return (
    <Link
      className={className ? `home-film bento-tile tile-film ${className}` : "home-film bento-tile tile-film"}
      href="/films/xueyi"
      aria-label="看家庭短片：《给雪姨》（2026 年 10 月，当时 1 岁 9 个月，时长 6 分 12 秒）"
    >
      <span className="home-film-poster">
        <Image
          src="/api/films/xueyi-2026-poster-v6.jpg"
          alt="家庭短片《给雪姨》封面"
          width={1080}
          height={1920}
          sizes="(max-width: 899px) 92vw, 320px"
          unoptimized
        />
        <span className="home-film-scrim" aria-hidden="true" />
        <span className="home-film-duration" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="12" height="12">
            <path d="M8 5v14l11-7z" fill="currentColor" />
          </svg>
          <span>06:12</span>
        </span>
      </span>
      <span className="home-film-copy">
        <span className="home-film-head">
          <span className="home-film-kicker">
            <time dateTime="2026-10">2026 年 10 月</time>
            <span> · 当时 1 岁 9 个月</span>
          </span>
          <span className="home-film-arrow" aria-hidden="true">↗</span>
        </span>
        <span className="home-film-title">《给雪姨》</span>
        <span className="home-film-sub">《还认识我吗》 · 家庭短片</span>
      </span>
    </Link>
  );
}
