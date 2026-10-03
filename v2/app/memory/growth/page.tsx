import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
// Illustrate only passages with a reviewed, visibly relevant scene. A dated photo
// can be authentic yet still misrepresent speech, eating or another activity.
const illustratedDays: Record<string, string> = {
  sleeping: "2025-01-05",
  books: "2026-09-22",
  play: "2026-07-27",
};

export default async function GrowthPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind } = await searchParams;
  // Old category links still open the same section of the new continuous reading page.
  if (kind && GROWTH_CATEGORIES.some(category => category.id === kind)) redirect(`/memory/growth#growth-${kind}`);
  await renderOnDemand();
  const { archive, entries, topics } = await readLifeArchive();
  const threads = growthThreads(entries, archive.birthDay).map(thread => ({ thread, prose: resolveReadingProse(GROWTH_PROSE[thread.id], thread.matches) }))
    .filter(item => item.prose.paragraphs.length);
  const photos = selectReadingPhotos(threads.map(({ thread, prose }) => {
    const day = illustratedDays[thread.id];
    const entry = day && prose.paragraphs.some(paragraph => paragraph.sources.some(source => source.entry.day === day))
      ? entries.find(entry => entry.day === day) : undefined;
    return entry ?? { ...thread.anchors[0].entry, photos: [] };
  }), media => topics(media.id)?.carousel?.sceneKey);
  return <div className="life-reading reading-wrap growth-reading">
    <header className="life-masthead">
      <Link className="back-link" href="/memory">← 回到记忆</Link>
      <div className="life-heading"><h1>怎样慢慢长大</h1><MemoryReadingMode current="看成长" /></div>
      <p>从留下的日子里，读他怎样慢慢有了自己的本领和喜欢。</p>
    </header>
    <nav className="reading-index" aria-label="成长主题">{GROWTH_CATEGORIES.map(category => <a key={category.id} href={`#growth-${category.id}`}>{category.label}</a>)}</nav>
    {GROWTH_CATEGORIES.map(category => {
      const current = threads.map(({ thread, prose }, index) => ({ thread, prose, photo: photos[index] })).filter(item => item.thread.category === category.id);
      if (!current.length) return null;
      return <section className="growth-chapter" id={`growth-${category.id}`} key={category.id} aria-labelledby={`growth-heading-${category.id}`}>
        <header><p className="reading-chapter-kind">{category.label}</p><h2 id={`growth-heading-${category.id}`}>{chapterTitles[category.id]}</h2></header>
        {current.map(({ thread, prose, photo }) => <article className={photo ? "growth-essay" : "growth-essay growth-essay--text"} id={thread.id} key={thread.id} aria-labelledby={`growth-title-${thread.id}`}>
            <div className="growth-essay-body"><h3 id={`growth-title-${thread.id}`}>{prose.title}</h3><p className="reading-opening">{prose.opening}</p>
              <ReadingEssay paragraphs={prose.paragraphs} /></div>
            {photo && <div className="growth-essay-photo"><Photo media={photo} sizes="(max-width: 700px) 90vw, 340px" variant="thumbnail" loading="eager" /><p>那一天留下的画面</p></div>}
          </article>)}
      </section>;
    })}
  </div>;
}
