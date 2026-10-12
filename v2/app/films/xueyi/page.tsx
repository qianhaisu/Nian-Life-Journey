import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "../films.css";

// 微信里点开后"发送给朋友"会读标题、描述和页面里第一张大图做卡片；没有公众号 JS-SDK，所以靠这三样。
const SHARE_IMAGE = "/films/xueyi-share.jpg";
const DESCRIPTION = "《还认识我吗》——雪姨和张小年的一支短片，6 分 12 秒。";
export const metadata: Metadata = {
  title: { absolute: "给雪姨" },
  description: DESCRIPTION,
  openGraph: { title: "给雪姨", description: DESCRIPTION, type: "video.other", images: [{ url: SHARE_IMAGE, width: 600, height: 600 }] },
};

export default function XueyiFilmPage() {
  return <div className="film-page">
    <span className="film-share-image" aria-hidden="true"><Image src={SHARE_IMAGE} alt="" width={600} height={600} unoptimized priority /></span>
    <Link className="film-home" href="/" aria-label="回到张年的人生档案首页"><span className="film-home-mark">年</span></Link>
    <h1 className="film-title">给雪姨</h1>
    <video className="film-video" src="/api/films/xueyi-2026-v5.mp4" poster="/api/films/xueyi-2026-poster-v6.jpg"
      controls playsInline preload="metadata" width={1080} height={1920} />
  </div>;
}
