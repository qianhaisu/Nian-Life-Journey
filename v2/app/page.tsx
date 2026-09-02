import Link from "next/link";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildHomeView } from "@/lib/home-view";

export const dynamic = "force-dynamic";

// The front page is a quiet cover: the newest memory worth the cover, at most one recent change,
// and the latest month. Nothing rotates, nothing counts, nothing asks the reader to upload. What
// counts as "最近" is decided in lib/home-view.ts against the archive's real clocks, not here.
export default async function HomePage() {
  const archive = await loadFamilyArchive();
  const { lead, mark, leadHeading, laterLifeNote, change, thisMonth, summary, monthHref } = buildHomeView(archive);
  const alternates = lead ? lead.month.memories.filter((memory) => memory.id !== lead.memory.id).slice(0, 2) : [];

  return <div className="home-page">
    <header className="home-masthead reading-wrap reveal">
      <span className="section-mark">{mark}</span>
      <h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1>
    </header>

    {lead ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">{leadHeading}</h2>
      <EditorialMemory memory={lead.memory} size="lead" priority />
      {alternates.length > 0 ? <ul className="memory-lines home-alternates">{alternates.map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {laterLifeNote ? <p className="chapter-meta">{laterLifeNote}</p> : null}
    </section> : <section className="home-lead reading-wrap"><p className="serif archive-empty">{archive.chapters.length > 0 ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p></section>}

    {change ? <section className="home-change reading-wrap" aria-labelledby="change-title">
      <h2 id="change-title" className="section-mark">最近长大的一点</h2>
      <p className="home-change-note serif">{change.note}</p>
      <p className="home-change-meta"><span>{change.label}</span><time dateTime={change.signature.day}>{change.signature.dateLabel}</time></p>
    </section> : null}

    {thisMonth ? <section className="home-month reading-wrap" aria-labelledby="month-title">
      <header className="month-anchor">
        <h2 id="month-title" className="serif"><Link href={monthHref}>{thisMonth.label}</Link></h2>
        {thisMonth.ageLabel ? <p>当时 {thisMonth.ageLabel}</p> : null}
      </header>
      <PhotoStrip photos={thisMonth.photos} />
      {summary ? <p className="chapter-summary serif">{summary}</p> : null}
      {thisMonth.memories.length > 0 ? <ul className="memory-lines">{thisMonth.memories.slice(0, 3).map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {thisMonth.traceDays.length > 0 ? <p className="chapter-meta">{thisMonth.memories.length > 0 ? "还有 " : ""}{thisMonth.traceDays.length} 天留下了生活痕迹</p> : null}
      <Link className="text-link" href={monthHref}>翻看整个月</Link>
    </section> : null}
  </div>;
}
