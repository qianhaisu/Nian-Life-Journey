import { MemoryInbox } from "@/components/memory-inbox";
import { candidateMemories, contributors, inboxSources, media } from "@/lib/mock-data";

export default function CapturePage() {
  const candidate = candidateMemories[0];
  return <div className="capture-page reading-wrap"><header className="page-masthead capture-masthead"><span className="section-mark">＋ 留下点什么</span><h1 className="serif">生活刚刚发生，<br /><em>先把东西留下。</em></h1><p>不必先想好标题、标签或故事。原始资料先完整留下，再慢慢整理。</p></header><MemoryInbox sources={inboxSources} media={media} candidate={candidate} contributors={contributors} /></div>;
}
