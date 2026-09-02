import Link from "next/link";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { loadFamilyArchive } from "@/lib/family-archive";
import { latestGrowthNote } from "@/lib/growth-notes";
import { findMonth, latestMemory } from "@/lib/memory-chapters";

export const dynamic = "force-dynamic";

// The front page is a quiet cover: the most recent memory, at most one recent change, and this
// month's chapter. Nothing rotates, nothing counts, nothing asks the reader to upload.
export default async function HomePage() {
  const { chapters, store, birthDay, snapshot } = await loadFamilyArchive();
  const lead = latestMemory(chapters);
  const leadMonth = lead ? findMonth(chapters, lead.signature.day.slice(0, 7)) : undefined;
  const alternates = leadMonth ? leadMonth.memories.filter((memory) => memory.id !== lead?.id).slice(0, 2) : [];
  const change = latestGrowthNote(store.growthRecords, birthDay);
  // "This month" is the most recent month that has anything at all; when a summary was written for
  // it, it is quoted in the month's own words.
  const thisMonth = chapters[0]?.months[0];
  const summary = thisMonth && snapshot?.month === thisMonth.month ? snapshot.summary : undefined;
  const monthHref = thisMonth ? `/memory/${thisMonth.month.slice(0, 4)}/${thisMonth.month.slice(5, 7)}` : "/memory";

  return <div className="home-page">
    <header className="home-masthead reading-wrap reveal">
      <span className="section-mark">{leadMonth ? `${leadMonth.label} · 最近` : "最近"}</span>
      <h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1>
    </header>

    {lead ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">最近的一段生活</h2>
      <EditorialMemory memory={lead} size="lead" priority />
      {alternates.length > 0 ? <ul className="memory-lines home-alternates">{alternates.map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
    </section> : <section className="home-lead reading-wrap"><p className="serif archive-empty">档案还是空的。等时间再走一会儿。</p></section>}

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
      <Link className="text-link" href={monthHref}>翻看这个月</Link>
    </section> : null}
  </div>;
}
