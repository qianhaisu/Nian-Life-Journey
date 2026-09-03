import Link from "next/link";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildHomeView } from "@/lib/home-view";

export const dynamic = "force-dynamic";

// The front page is a quiet cover with two possible voices: recent photographed days when life is
// newer than any organized memory, otherwise the newest memory worth the cover — then at most one
// recent change and the latest month. Nothing rotates, nothing counts at the reader, nothing asks
// them to upload. What counts as "最近" is decided in lib/home-view.ts against the archive's real
// clocks, not here.
export default async function HomePage() {
  const archive = await loadFamilyArchive();
  const { lead, recentLife, mark, leadHeading, laterLifeNote, change, thisMonth, summary, monthHref } = buildHomeView(archive);
  const alternates = lead && !recentLife ? lead.month.memories.filter((memory) => memory.id !== lead.memory.id).slice(0, 2) : [];
  // When recent days carry the cover for the same month, a second month block would repeat them.
  const showThisMonth = thisMonth && recentLife?.month.month !== thisMonth.month;

  return <div className="home-page">
    <header className="home-masthead reading-wrap reveal">
      <span className="section-mark">{mark}</span>
      <h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1>
    </header>

    {recentLife ? <section className="home-lead home-life reading-wrap" aria-labelledby="life-title">
      <h2 id="life-title" className="section-mark">最近的日子</h2>
      <ol className="home-days">
        {recentLife.days.map((day, index) => <li className="home-day" key={day.day}>
          <p className="home-day-date"><time dateTime={day.day}>{day.dateLabel}</time>{day.ageLabel ? <span>{day.ageLabel}</span> : null}</p>
          <PhotoStrip photos={day.photos} priority={index === 0} />
        </li>)}
      </ol>
      {recentLife.month.memories.length > 0 ? <ul className="memory-lines">{recentLife.month.memories.slice(0, 3).map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      <p className="chapter-meta"><Link className="text-link" href={recentLife.monthHref}>{recentLife.moreDayCount > 0 ? `这个月还有 ${recentLife.moreDayCount} 天 · 翻看整个月` : "翻看整个月"}</Link></p>
    </section> : null}

    {recentLife && lead ? <section className="home-past reading-wrap" aria-labelledby="past-title">
      <h2 id="past-title" className="section-mark">上一段记下来的生活</h2>
      <EditorialMemory memory={lead.memory} />
    </section> : null}

    {!recentLife && lead ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">{leadHeading}</h2>
      <EditorialMemory memory={lead.memory} size="lead" priority />
      {alternates.length > 0 ? <ul className="memory-lines home-alternates">{alternates.map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {laterLifeNote ? <p className="chapter-meta">{laterLifeNote}</p> : null}
    </section> : null}

    {!recentLife && !lead ? <section className="home-lead reading-wrap"><p className="serif archive-empty">{archive.chapters.length > 0 ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p></section> : null}

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
      <PhotoStrip photos={thisMonth.photos} />
      {summary ? <p className="chapter-summary serif">{summary}</p> : null}
      {thisMonth.memories.length > 0 ? <ul className="memory-lines">{thisMonth.memories.slice(0, 3).map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {thisMonth.traceDays.length > 0 ? <p className="chapter-meta">{thisMonth.memories.length > 0 ? "还有 " : ""}{thisMonth.traceDays.length} 天留下了生活痕迹</p> : null}
      <Link className="text-link" href={monthHref}>翻看整个月</Link>
    </section> : null}
  </div>;
}
