import { MemoryInbox } from "@/components/memory-inbox";
import { candidateMemories, contributors, inboxSources, media } from "@/lib/mock-data";

export default function CapturePage() {
  const candidate = candidateMemories[0];
  return <div className="capture-page reading-wrap"><header className="page-masthead capture-masthead"><span className="section-mark">＋ 留下点什么</span><h1 className="serif">今天想留下<br /><em>些什么？</em></h1><p>先放进来，故事可以晚一点再整理。</p></header><MemoryInbox sources={inboxSources} media={media} candidate={candidate} contributors={contributors} /></div>;
}
