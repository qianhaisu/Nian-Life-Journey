import type { Metadata } from "next";
import Link from "next/link";
import { readLifeArchive } from "@/lib/life-reading-load";
import { GROWTH_CATEGORIES, growthThreads, selectReadingPhotos, type GrowthCategory } from "@/lib/life-reading";
import { renderOnDemand } from "@/lib/render-on-demand";
import { MemoryReadingMode } from "@/components/memory-reading-mode";
import { ReadingPassage } from "@/components/life-reading";
import "../reading.css";

export const metadata: Metadata = { title: "怎样慢慢长大" };

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  await renderOnDemand();
  const [{ archive, entries, topics }, params] = await Promise.all([readLifeArchive(), searchParams]);
  const kind: GrowthCategory = GROWTH_CATEGORIES.find(category => category.id === params.kind)?.id ?? "language";
  const threads = growthThreads(entries, archive.birthDay).filter(thread => thread.category === kind);
  const photos = selectReadingPhotos(threads.map(thread => thread.anchors.at(-1)!.entry), media => topics(media.id)?.carousel?.sceneKey);
  return <div className="life-reading reading-wrap">
    <header className="life-masthead">
      <Link className="back-link" href="/memory">← 回到记忆</Link>
      <div className="life-heading"><h1>怎样慢慢长大</h1><MemoryReadingMode current="看成长" /></div>
      <p>把前后留下的日子，放在一起读。</p>
    </header>
    <nav className="life-tabs" aria-label="成长主题">{GROWTH_CATEGORIES.map(category => <Link prefetch={false} href={`/memory/growth?kind=${category.id}`} key={category.id} aria-current={category.id === kind ? "page" : undefined}>{category.label}</Link>)}</nav>
    <p className="life-note">最早留下的记录，未必就是第一次。这里保留当时的说法，也保留尚在尝试的样子。</p>
    {threads.length === 0 && <p className="life-empty">这条变化线还没有足够的记录可读。<Link href="/memory">先翻翻留下的日子 →</Link></p>}
    {threads.map((thread, threadIndex) => <section key={thread.id} id={thread.id} className="growth-thread" aria-labelledby={`heading-${thread.id}`}>
      <h2 id={`heading-${thread.id}`}>{thread.title}</h2>
      <div className="growth-line">{thread.anchors.map((match, index) => <ReadingPassage key={match.entry.day} match={match} photo={index === thread.anchors.length - 1 ? photos[threadIndex] : undefined}
        label={thread.anchors.length === 1 ? "留下的一次记录" : index === 0 ? "最早留下的记录" : index === thread.anchors.length - 1 ? "后来留下的样子" : "中间的变化"} />)}</div>
      {thread.matches.length > thread.anchors.length && <details className="life-more"><summary>继续读这条变化线</summary>{thread.matches.filter(match => !thread.anchors.includes(match)).map(match => <ReadingPassage key={match.entry.day} match={match} />)}</details>}
    </section>)}
  </div>;
}
