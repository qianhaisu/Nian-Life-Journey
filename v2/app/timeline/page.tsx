import Link from "next/link";
import { Timeline } from "@/components/timeline";
import { events, media, profile } from "@/lib/mock-data";
export default function TimelinePage() { return <div className="timeline-page wrap"><div className="page-heading"><Link className="back-link" href="/v2">← 回到首页</Link><span className="eyebrow">The archive · {events.length} chapters</span><h1 className="serif">张年的<br /><em>时间线</em></h1><p>把那些看似普通的日子，按发生的顺序放在一起。<br />这里保存的是 {profile.displayName} 如何认识这个世界。</p></div><Timeline events={events} media={media} /><div className="timeline-end"><span>—</span><p>从 2026 年 7 月开始，<br />我们一起继续往前走。</p><Link className="text-link" href="/v2">回到现在 <b>↗</b></Link></div></div>; }
