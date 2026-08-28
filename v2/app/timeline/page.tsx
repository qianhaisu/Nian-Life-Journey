import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { dailyTraces, events, media, profile } from "@/lib/mock-data";
export default function TimelinePage() { return <div className="timeline-page wrap"><div className="page-heading"><Link className="back-link" href="/">← 回到首页</Link><span className="eyebrow">{profile.displayName} 的人生档案</span><h1 className="serif">翻看张年的<br /><em>日子</em></h1><p>这里不是一串日志。<br />是照片、几句话和一些还记得的感觉，按时间重新相遇。</p></div><Timeline events={events} media={media} traces={dailyTraces} /><div className="timeline-end"><span>—</span><p>从 2026 年 7 月开始，<br />我们一起继续往前走。</p><Link className="text-link" href="/inbox">整理今天留下的东西 <b>↗</b></Link></div></div>; }
