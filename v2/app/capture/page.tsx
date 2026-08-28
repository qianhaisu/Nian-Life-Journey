import { MemoryInbox } from "@/components/memory-inbox";
import Link from "next/link";
import { getAllEvents } from "@/lib/db/repository";

export default async function CapturePage() {
  const events = await getAllEvents();
  return <div className="capture-page reading-wrap"><header className="page-masthead capture-masthead"><span className="section-mark">＋ 留下点什么</span><h1 className="serif">今天想留下<br /><em>些什么？</em></h1><p>先放进来，系统会自动按日期和上下文整理。</p></header><MemoryInbox /><section className="recent-moments capture-recent-moments" aria-labelledby="moments-title"><div className="section-heading"><span className="section-mark">最近留下</span><h2 id="moments-title" className="serif">还有几个时刻</h2></div><div className="moment-lines">{events.slice(4, 7).map((event) => <Link href={`/events/${event.id}`} key={event.id}><time>{event.occurredAt.slice(5).replace("-", ".")}</time><span className="serif">{event.title}</span><i aria-hidden="true">↗</i></Link>)}</div></section></div>;
}
