import Link from "next/link";
import { MemoryInbox } from "@/components/memory-inbox";
import { candidateMemories, inboxSources, media, profile } from "@/lib/mock-data";

export default function InboxPage() {
  const candidate = candidateMemories[0];
  if (!candidate) return null;
  return <div className="inbox-page wrap">
    <div className="page-heading inbox-heading"><Link className="back-link" href="/">← 回到首页</Link><span className="eyebrow">{profile.displayName} 的原材料 · 仅家庭可见</span><h1 className="serif">今天留下的<br /><em>东西</em></h1><p>照片、几句话、一段视频。它们现在还不需要成为完整的故事。</p></div>
    <MemoryInbox sources={inboxSources} media={media} candidate={candidate} />
  </div>;
}
