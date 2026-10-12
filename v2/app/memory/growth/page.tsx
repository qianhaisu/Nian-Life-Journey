import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readLifeArchive } from "@/lib/life-reading-load";
import { GROWTH_CATEGORIES, growthThreads, selectReadingPhotos, type GrowthCategory } from "@/lib/life-reading";
import { GROWTH_PROSE, resolveReadingProse } from "@/lib/life-reading-narratives";
import { renderOnDemand } from "@/lib/render-on-demand";
import { MemoryReadingMode } from "@/components/memory-reading-mode";
import { ReadingEssay } from "@/components/reading-essays";
import { Photo } from "@/components/photo";
import "../reading.css";

export const metadata: Metadata = { title: "怎样慢慢长大" };
const chapterTitles: Record<GrowthCategory, string> = {
  language: "那些慢慢说出来的话", action: "他怎样开始自己做", sleep: "睡着和醒来的日子", interest: "喜欢的东西，逐渐有了形状",
};
const chapterOpenings: Record<GrowthCategory, string> = {
  language: "称呼、模仿，以及慢慢能说清楚的意思。",
  action: "爬、走、吃饭和自己愿意试的事。",
  sleep: "那些家人一起摸索过的夜晚与午后。",
  interest: "车、书、音乐和玩耍里长出来的喜欢。",
};
// Illustrate only passages with a reviewed, visibly relevant scene. A dated photo
// can be authentic yet still misrepresent speech, eating or another activity.
const illustratedDays: Record<string, string> = {
  sleeping: "2025-01-05",
  books: "2026-09-22",
  play: "2026-07-27",
};

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  const category = GROWTH_CATEGORIES.find(item => item.id === kind);
  if (kind && !category) notFound();
  if (!category) return <div className="life-reading reading-wrap growth-reading">
    <header className="life-masthead"><Link className="back-link" href="/memory">← 回到记忆</Link>
      <div className="life-heading"><h1>怎样慢慢长大</h1><MemoryReadingMode current="看成长" /></div>
      <p>从留下的日子里，读他怎样慢慢有了自己的本领和喜欢。</p>
    </header>
    <nav className="reading-route-grid" aria-label="成长主题">{GROWTH_CATEGORIES.map(item => <Link className="reading-route-card" href={`/memory/growth?kind=${item.id}`} prefetch={false} key={item.id}>
      <span>{item.label}</span><strong>{chapterTitles[item.id]}</strong><small>{chapterOpenings[item.id]}</small><span className="reading-route-arrow" aria-hidden="true">读这一章 →</span>
    </Link>)}</nav>
  </div>;
  await renderOnDemand();
  const { archive, entries, topics } = await readLifeArchive();
  const threads = growthThreads(entries, archive.birthDay).filter(thread => thread.category === category.id)
    .map(thread => ({ thread, prose: resolveReadingProse(GROWTH_PROSE[thread.id], thread.matches) }))
    .filter(item => item.prose.paragraphs.length);
  const photos = selectReadingPhotos(threads.map(({ thread, prose }) => {
    const day = illustratedDays[thread.id];
    const entry = day && prose.paragraphs.some(paragraph => paragraph.sources.some(source => source.entry.day === day))
      ? entries.find(entry => entry.day === day) : undefined;
    return entry ?? { ...thread.anchors[0].entry, photos: [] };
  }), media => topics(media.id)?.carousel?.sceneKey);
  return <div className="life-reading reading-wrap growth-reading">
    <header className="life-masthead">
      <Link className="back-link" href="/memory/growth">← 全部成长主题</Link>
      <div className="life-heading"><h1>{chapterTitles[category.id]}</h1><MemoryReadingMode current="看成长" /></div>
      <p>{chapterOpenings[category.id]}</p>
    </header>
    <nav className="reading-index" aria-label="成长主题">{GROWTH_CATEGORIES.map(item => <Link key={item.id} href={`/memory/growth?kind=${item.id}`} aria-current={item.id === category.id ? "page" : undefined} prefetch={false}>{item.label}</Link>)}</nav>
    <section className="growth-chapter" aria-label={category.label}>
        {threads.map(({ thread, prose }, index) => { const photo = photos[index]; return <article className={photo ? "growth-essay" : "growth-essay growth-essay--text"} id={thread.id} key={thread.id} aria-labelledby={`growth-title-${thread.id}`}>
            <div className="growth-essay-body"><h3 id={`growth-title-${thread.id}`}>{prose.title}</h3><p className="reading-opening">{prose.opening}</p>
              <ReadingEssay paragraphs={prose.paragraphs} /></div>
            {photo && <div className="growth-essay-photo"><Photo media={photo} sizes="(max-width: 700px) 90vw, 340px" variant="thumbnail" loading="eager" /><p>那一天留下的画面</p></div>}
          </article>; })}
        {threads.length === 0 && <p className="life-empty">这一章还没有足够明确的已发布记录。<Link href="/memory/growth">看看其他成长主题 →</Link></p>}
    </section>
  </div>;
}
