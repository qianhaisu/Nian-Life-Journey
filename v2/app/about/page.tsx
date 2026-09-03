import type { Metadata } from "next";
import Link from "next/link";
import { GrowthChart } from "@/components/growth-chart";
import { Photo } from "@/components/photo";
import { loadFamilyArchive } from "@/lib/family-archive";
import { measurements, recentGrowthNotes } from "@/lib/growth-notes";
import { latestLeadPhoto, recentTraceNotes } from "@/lib/memory-chapters";
import { ageOn, formatDay } from "@/lib/time-signature";
import { isRecent } from "@/lib/time-truth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "张年" };

// Who 张年 is right now, from records that exist: age, the newest photo of him the archive can
// deliver, the handful of things that recently changed, and the last few ordinary-day notes in his
// book. Measurements and care notes are deeper material, folded by default. When a section has no
// real record behind it, it is not rendered — never filled in. "Now" is the archive's product
// today (lib/time-truth.ts); changes are called recent only while they are.
export default async function AboutPage() {
  const { chapters, store, birthDay, time } = await loadFamilyArchive();
  const age = birthDay ? ageOn(birthDay, time.today) : undefined;
  const portrait = latestLeadPhoto(chapters);
  const traceNotes = recentTraceNotes(chapters, 4);
  // "最近" is earned, never assumed: in production the newest child-facing notes are from 2025-08
  // (August 2026 traces only count photographs), and a year-old note must not be called recent.
  const traceHeading = traceNotes.some((note) => isRecent(note.day, time)) ? "档案最近记下的" : "档案里记下的一些小事";
  const notes = recentGrowthNotes(store.growthRecords, birthDay, 4, time);
  const notesHeading = notes.some((note) => note.recent) ? "最近的变化" : "记下来的变化";
  const heights = measurements(store.growthRecords, "height", birthDay);
  const weights = measurements(store.growthRecords, "weight", birthDay);
  const care = store.careRecords.filter((record) => record.visibility !== "private").sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  const hasDeeper = heights.length > 0 || weights.length > 0 || care.length > 0;

  return <div className="about-page reading-wrap">
    <header className="page-masthead">
      <span className="section-mark">现在</span>
      <h1 className="serif">张年</h1>
      {age ? <p className="about-age">现在 {age}{birthDay ? `，${formatDay(birthDay)}出生` : ""}。</p> : null}
    </header>

    {portrait ? <div className="about-portrait"><Photo media={portrait} priority sizes="(max-width: 700px) 100vw, 760px" /></div> : null}

    {notes.length > 0 ? <section className="about-notes" aria-labelledby="notes-title">
      <h2 id="notes-title" className="section-mark">{notesHeading}</h2>
      <dl>{notes.map((note) => <div key={note.id}><dt>{note.label}</dt><dd><p className="serif">{note.note}</p><time dateTime={note.signature.day}>{note.signature.dateLabel}</time></dd></div>)}</dl>
    </section> : null}

    {traceNotes.length > 0 ? <section className="about-notes about-traces" aria-labelledby="traces-title">
      <h2 id="traces-title" className="section-mark">{traceHeading}</h2>
      <dl>{traceNotes.map((note, index) => <div key={`${note.day}-${index}`}><dt><time dateTime={note.day}>{note.dateLabel}</time></dt><dd><p className="serif">{note.entry}</p></dd></div>)}</dl>
    </section> : null}

    {hasDeeper ? <details className="about-deeper">
      <summary><span className="serif">更深的资料</span><small>{[heights.length > 0 ? "身高" : "", weights.length > 0 ? "体重" : "", care.length > 0 ? "照护" : ""].filter(Boolean).join(" · ")}</small></summary>
      {heights.length > 0 || weights.length > 0 ? <div className="chart-pair">
        {heights.length > 1 ? <GrowthChart records={store.growthRecords} kind="height" title="身高" /> : heights[0] ? <p className="single-measure"><span>身高</span><strong>{heights[0].value} {heights[0].unit}</strong><time dateTime={heights[0].signature.day}>{heights[0].signature.dateLabel}</time></p> : null}
        {weights.length > 1 ? <GrowthChart records={store.growthRecords} kind="weight" title="体重" /> : weights[0] ? <p className="single-measure"><span>体重</span><strong>{weights[0].value} {weights[0].unit}</strong><time dateTime={weights[0].signature.day}>{weights[0].signature.dateLabel}</time></p> : null}
      </div> : null}
      {care.length > 0 ? <ol className="care-notes">{care.map((record) => <li key={record.id}><time dateTime={record.observedAt.slice(0, 10)}>{formatDay(record.observedAt.slice(0, 10))}</time><div><strong className="serif">{record.title}</strong><p>{record.note}</p>{record.lifeEventId ? <Link href={`/events/${record.lifeEventId}`}>回到那一天</Link> : null}</div></li>)}</ol> : null}
    </details> : null}
  </div>;
}
