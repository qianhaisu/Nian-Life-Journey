import Link from "next/link";
import type { HomeRecall as HomeRecallEntry } from "@/lib/home-recall";

// PAGE-0915-FULL-REMEDIATION-R1 D3：首页的「回忆浮现」——一句安静的话，不是又一块卡片墙。
// `recall` 是 lib/home-recall.ts 算出来的、真的有关系依据的那一条；没有就不传，这个组件也不猜。
export function HomeRecall({ recall }: { recall?: HomeRecallEntry }) {
  if (!recall) return null;
  return <p className="home-recall">
    <span className="home-recall-label">{recall.contextLabel}：</span>
    <Link href={recall.href}>{recall.title} <span aria-hidden="true">↗</span></Link>
    <span className="home-recall-when"> · <time dateTime={recall.day}>{recall.dateLabel}</time></span>
  </p>;
}
