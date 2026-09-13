import type { Metadata } from "next";
import Link from "next/link";
import { GrowthChart } from "@/components/growth-chart";
import { Photo } from "@/components/photo";
import { buildAboutView } from "@/lib/about-view";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { renderOnDemand } from "@/lib/render-on-demand";

// No `export const revalidate` here on purpose: this page is rendered on demand
// (lib/render-on-demand.ts), so there is no Next route cache for a revalidate window to
// govern — leaving the export would state a caching promise the route no longer makes. The
// same 300s lives one layer down, on the archive read itself
// (ON_DEMAND_ARCHIVE_TTL_MS in lib/family-archive.ts).
export const metadata: Metadata = { title: "张年" };

// 张年 as a growth record, in the four parts Teddy set out on 2026-09-12: 基本信息,
// 家人关注的健康问题, 学会了什么, 解锁的体验. Which rows each part may be built from, and the two
// rules about not overstating (no recovery inferred from silence; no 「第一次」 the archive did not
// itself write), are lib/about-view.ts — this file only lays them out.
//
// The four modules that used to be here are gone: 最近的生活节奏, 最近记下来的, 家人这阵子说 and
// 档案最近记下的 were four presentations of the same thing — the archive's recent memories, which
// is already the whole front page and the whole of /memory — on the one page that should answer
// 这孩子长成什么样了 instead.
//
// A part with nothing behind it does not render, and never as an empty card. On 2026-09-13 the
// data track filled two of the four: 量过的身高体重 (2 heights, 4 precise weights across five
// measurement days) and 学会了什么 (7 rows, each hanging off an approved story). 家人关注的健康问题
// is still empty — care_records and care_episodes hold no rows — so that part is simply absent, and
// its absence is NOT a statement that there is nothing to watch or that anything recovered.
export default async function AboutPage() {
  // Never prerender this page from the build's mock store — see lib/render-on-demand.ts. Found in
  // the same 2026-09-10 check as / and /memory: about.html was baked from the seed fixture too.
  await renderOnDemand();
  const archive = await loadFamilyArchiveOnDemand();
  const { basics, measures, health, learned, unlocked } = buildAboutView(archive);
  const { portrait } = basics;

  return <div className="about-page reading-wrap">
    <header className="page-masthead">
      <span className="section-mark">现在</span>
      <h1 className="serif">张年</h1>
      {basics.age ? <p className="about-age">现在 {basics.age}{basics.birthLabel ? `，${basics.birthLabel}出生` : ""}。</p> : null}
    </header>

    {portrait ? <figure className="about-portrait">
      <Photo media={portrait.photo} priority sizes="(max-width: 700px) 100vw, 760px" />
      {/* The day it was taken, always — and when that day is not recent, the page says so rather
          than letting an undated portrait stand for what he looks like now. */}
      <figcaption className="about-portrait-date"><time dateTime={portrait.day}>摄于 {portrait.dateLabel}</time>{portrait.recent ? null : <span> · 档案里最新的一张</span>}</figcaption>
    </figure> : null}

    {measures.length > 0 ? <section className="about-block" aria-labelledby="measures-title">
      <h2 id="measures-title" className="section-mark">量过的身高体重</h2>
      {/* The newest number of each kind, each with the day IT was measured — the two are taken on
          different days and a shared date line would be wrong for one of them. */}
      <ul className="measure-latest">{measures.map((track) => <li key={track.kind}>
        <span className="measure-kind">{track.title}</span>
        <strong className="measure-value">{track.latest.value} {track.latest.unit}</strong>
        <span className="measure-when">
          <time dateTime={track.latest.signature.day}>{track.latest.signature.dateLabel}</time>
          {track.latest.signature.ageLabel ? <span> · 当时 {track.latest.signature.ageLabel}</span> : null}
        </span>
      </li>)}</ul>
      {/* The curve, not just the latest point: a growth record is the shape over time. The chart is
          handed `track.history` — the same measurements the number above it came from — so a row
          the reading layer refused (an approximate figure with no value, since 2026-09-13) cannot
          reach the axis through a second, looser filter. */}
      {measures.some((track) => track.history.length > 1) ? <div className="chart-pair">
        {measures.filter((track) => track.history.length > 1).map((track) => <GrowthChart key={track.kind} points={track.history} title={track.title} />)}
      </div> : null}
    </section> : null}

    {health.length > 0 ? <section className="about-block" aria-labelledby="health-title">
      <h2 id="health-title" className="section-mark">家人关注的健康问题</h2>
      {/* One group per issue as it was recorded, and inside it every record with its own date and
          the status IT carried that day. The page states no current status and no recovery: a
          record that stopped arriving is not a problem that ended (lib/about-view.ts). */}
      {health.map((group) => <article className="health-group" key={group.key}>
        <h3 className="serif health-title">{group.title}</h3>
        <ol className="health-lines">{group.lines.map((line) => <li key={line.id}>
          <p className="health-when">
            <time dateTime={line.day}>{line.dateLabel}</time>
            {line.ageLabel ? <span className="health-age">当时 {line.ageLabel}</span> : null}
            <span className="health-status">当时记为「{line.status}」</span>
          </p>
          <p className="serif health-note">{line.note}</p>
          {line.nextStep ? <p className="health-next">当时写下的下一步：{line.nextStep}</p> : null}
          {line.eventHref ? <p className="note-meta"><Link className="text-link" href={line.eventHref}>看那一天</Link></p> : null}
        </li>)}</ol>
      </article>)}
    </section> : null}

    {learned.length > 0 ? <section className="about-block" aria-labelledby="learned-title">
      <h2 id="learned-title" className="section-mark">学会了什么</h2>
      {learned.map((group) => <article className="learned-group" key={group.kind}>
        <h3 className="learned-kind">{group.title}</h3>
        <ul className="learned-notes">{group.notes.map((note) => <li key={note.id}>
          <p className="serif">{note.note}</p>
          <p className="note-meta">
            <time dateTime={note.day}>{note.dateLabel}</time>
            {note.ageLabel ? <span> · 当时 {note.ageLabel}</span> : null}
            {note.eventHref ? <Link className="text-link" href={note.eventHref}>看那一天</Link> : null}
          </p>
        </li>)}</ul>
      </article>)}
    </section> : null}

    {unlocked.length > 0 ? <section className="about-block" aria-labelledby="unlocked-title">
      <h2 id="unlocked-title" className="section-mark">解锁的体验</h2>
      {/* Oldest first, because a list of firsts is only a growth record in the order they happened.
          Every line is a published story whose own approved title says it was a first, and it links
          to that story — the evidence for the claim is the sentence being read (原则八). */}
      <ol className="unlocked-list">{unlocked.map((item) => <li key={item.id}>
        <Link href={`/events/${item.id}`}>
          <time dateTime={item.day}>{item.dateLabel}</time>
          {item.ageLabel ? <span className="unlocked-age">当时 {item.ageLabel}</span> : null}
          <span className="serif unlocked-title">{item.title}</span>
        </Link>
      </li>)}</ol>
    </section> : null}

    <nav className="about-entries" aria-label="进入档案">
      <Link className="text-link" href="/memory">全部记忆</Link>
    </nav>
  </div>;
}
