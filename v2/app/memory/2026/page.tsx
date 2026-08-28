import Image from "next/image";
import Link from "next/link";
import { monthArchives, media, yearArchive } from "@/lib/mock-data";

export default function YearPage() {
  const month = monthArchives[0];
  const cover = media.find((item) => item.id === month.coverMediaId);
  return <div className="review-page wide-wrap"><header className="review-masthead"><Link className="back-link" href="/memory">← 回到连续时间流</Link><span>年度回顾</span><h1 className="serif">{yearArchive.year}</h1><p className="serif">{yearArchive.title}</p><small>{yearArchive.intro}</small></header><section className="year-spread"><div className="year-cover">{cover ? <Image src={cover.src} alt={cover.alt} fill priority sizes="(max-width: 700px) 100vw, 65vw" /> : null}</div><div className="year-copy"><span>08 / 12</span><h2 className="serif">八月<br />开始说更多话</h2><p>{month.summary}</p><ul>{month.highlights.map((item) => <li key={item}>{item}</li>)}</ul><Link className="text-link" href="/memory/2026/08">阅读这个月 <span>↗</span></Link></div></section><footer className="future-years"><span>还没有到来的章节</span><p className="serif">2027 · 2028 · 继续发生</p></footer></div>;
}
