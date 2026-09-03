import Link from "next/link";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { Photo } from "@/components/photo";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildHomeView } from "@/lib/home-view";

export const dynamic = "force-dynamic";

// The front page answers one question — 最近怎么样，张年 — with ONE expression, the strongest the
// archive can honestly make (lib/home-view.ts): a recent memory, a recent moment with real words,
// one recent photographed day with a visual center, or the newest dated memory presented as what
// it is. Nothing rotates, nothing counts at the reader, nothing asks them to upload.
export default async function HomePage() {
  const archive = await loadFamilyArchive();
  const { cover, pastLead, mark, laterLifeNote, change, thisMonth, thisMonthPreview, summary, monthHref } = buildHomeView(archive);
  const alternates = cover.kind === "memory" ? cover.lead.month.memories.filter((memory) => memory.id !== cover.lead.memory.id).slice(0, 2) : [];
  // When the cover already speaks for the latest month, a second month block would repeat it.
  const coverMonth = cover.kind === "moment" ? cover.cover.month.month : undefined;
  const showThisMonth = thisMonth && coverMonth !== thisMonth.month;

  return <div className="home-page">
    <header className="home-masthead reading-wrap reveal">
      <span className="section-mark">{mark}</span>
      <h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1>
    </header>

    {cover.kind === "moment" ? <section className="home-lead home-moment reading-wrap" aria-labelledby="moment-title">
      <h2 id="moment-title" className="section-mark">{cover.cover.moment.text.length > 0 ? "最近记下来的一天" : "最近的一天"}</h2>
      <p className="home-day-date"><time dateTime={cover.cover.moment.day}>{cover.cover.moment.dateLabel}</time>{cover.cover.moment.ageLabel ? <span>{cover.cover.moment.ageLabel}</span> : null}</p>
      {cover.cover.moment.text.length > 0 ? <div className="moment-text serif">{cover.cover.moment.text.map((entry, index) => <p key={index}>{entry}</p>)}</div> : null}
      {cover.cover.moment.hero ? <Photo media={cover.cover.moment.hero} priority sizes="(max-width: 700px) 100vw, 760px" className="moment-hero" /> : null}
      {cover.cover.moment.supporting.length > 0 ? <PhotoStrip photos={cover.cover.moment.supporting} /> : null}
      <p className="chapter-meta"><Link className="text-link" href={cover.cover.monthHref}>{cover.cover.moreDayCount > 0 ? `这个月还有 ${cover.cover.moreDayCount} 天 · 翻看整个月` : "翻看整个月"}</Link></p>
    </section> : null}

    {pastLead ? <section className="home-past reading-wrap" aria-labelledby="past-title">
      <h2 id="past-title" className="section-mark">上一段记下来的生活</h2>
      <EditorialMemory memory={pastLead.memory} />
    </section> : null}

    {cover.kind === "memory" || cover.kind === "dated" ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">{cover.kind === "memory" ? "最近的一段生活" : "上一段记下来的生活"}</h2>
      <EditorialMemory memory={cover.lead.memory} size="lead" priority />
      {alternates.length > 0 ? <ul className="memory-lines home-alternates">{alternates.map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {laterLifeNote ? <p className="chapter-meta">{laterLifeNote}</p> : null}
    </section> : null}

    {cover.kind === "empty" ? <section className="home-lead reading-wrap"><p className="serif archive-empty">{archive.chapters.length > 0 ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p></section> : null}

    {change ? <section className="home-change reading-wrap" aria-labelledby="change-title">
      <h2 id="change-title" className="section-mark">最近长大的一点</h2>
      <p className="home-change-note serif">{change.note}</p>
      <p className="home-change-meta"><span>{change.label}</span><time dateTime={change.signature.day}>{change.signature.dateLabel}</time></p>
    </section> : null}

    {showThisMonth ? <section className="home-month reading-wrap" aria-labelledby="month-title">
      <header className="month-anchor">
        <h2 id="month-title" className="serif"><Link href={monthHref}>{thisMonth.label}</Link></h2>
        {thisMonth.ageLabel ? <p>当时 {thisMonth.ageLabel}</p> : null}
      </header>
      <PhotoStrip photos={thisMonthPreview} />
      {summary ? <p className="chapter-summary serif">{summary}</p> : null}
      {thisMonth.memories.length > 0 ? <ul className="memory-lines">{thisMonth.memories.slice(0, 3).map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      <Link className="text-link" href={monthHref}>翻看整个月</Link>
    </section> : null}
  </div>;
}
