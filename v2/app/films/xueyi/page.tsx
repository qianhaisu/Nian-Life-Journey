import type { Metadata } from "next";
import "../films.css";

export const metadata: Metadata = { title: "给雪姨" };

export default function XueyiFilmPage() {
  return <div className="film-page">
    <h1 className="film-title">给雪姨</h1>
    <video className="film-video" src="/api/films/xueyi-2026-v4.mp4" poster="/api/films/xueyi-2026-poster-v4.jpg"
      controls playsInline preload="metadata" width={1080} height={1920} />
  </div>;
}
