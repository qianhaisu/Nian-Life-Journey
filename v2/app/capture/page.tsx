import { MemoryInbox } from "@/components/memory-inbox";
import Link from "next/link";
import { candidateMemories, contributors, events, inboxSources, media } from "@/lib/mock-data";

export default function CapturePage() {
  const candidate = candidateMemories[0];
  return <div className="capture-page reading-wrap"><header className="page-masthead capture-masthead"><span className="section-mark">＋ 留下点什么</span><h1 className="serif">今天想留下<br /><em>些什么？</em></h1><p>先放进来，故事可以晚一点再整理。</p></header><MemoryInbox sources={inboxSources} media={media} candidate={candidate} contributors={contributors} /><section className="recent-moments capture-recent-moments" aria-labelledby="moments-title"><div className="section-heading"><span className="section-mark">最近留下</span><h2 id="moments-title" className="serif">还有几个时刻</h2></div><div className="moment-lines">{events.slice(4, 7).map((event) => <Link href={`/events/${event.id}`} key={event.id}><time>{event.occurredAt.slice(5).replace("-", ".")}</time><span className="serif">{event.title}</span><i aria-hidden="true">↗</i></Link>)}</div></section></div>;
}
