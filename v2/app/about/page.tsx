import type { Metadata } from "next";
import Link from "next/link";
import { GrowthChart } from "@/components/growth-chart";
import { Photo } from "@/components/photo";
import { loadFamilyArchive } from "@/lib/family-archive";
import { measurements, recentGrowthNotes } from "@/lib/growth-notes";
import { latestPortrait, recentTraceNotes } from "@/lib/memory-chapters";
import { ageOn, formatDay, formatMonth } from "@/lib/time-signature";
import { isRecent } from "@/lib/time-truth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "张年" };

// Who 张年 is right now — and only then, who he was earlier. The page is split in two eras with
// the same recency contract as every "最近" (lib/time-truth.ts): CURRENT holds what recent
// evidence actually supports (his age, the newest deliverable photo of him, stamped with the day
// it was taken, and any recent notes), and everything older sits under an explicit 更早的时候
// heading with its real dates — a year-old note may be read, but never mistaken for now. When a
// section has no real record behind it, it is not rendered — never filled in.
export default async function AboutPage() {
  const { chapters, store, birthDay, time } = await loadFamilyArchive();
  const age = birthDay ? ageOn(birthDay, time.today) : undefined;
  const portrait = latestPortrait(chapters);
  const portraitRecent = portrait ? isRecent(portrait.day, time) : false;
  const traceNotes = recentTraceNotes(chapters, 4);
  const currentNotes = traceNotes.filter((note) => isRecent(note.day, time));
  const earlierNotes = traceNotes.filter((note) => !isRecent(note.day, time));
  const earlierSpan = earlierNotes.length > 0 ? formatMonth(earlierNotes[0].day.slice(0, 7)) : undefined;
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

    {portrait ? <div className="about-portrait">
      <Photo media={portrait.photo} priority sizes="(max-width: 700px) 100vw, 760px" />
      <p className="about-portrait-date"><time dateTime={portrait.day}>摄于 {portrait.dateLabel}</time>{portraitRecent ? null : <span> · 档案里最新的一张</span>}</p>
    </div> : null}

    {notes.length > 0 ? <section className="about-notes" aria-labelledby="notes-title">
      <h2 id="notes-title" className="section-mark">{notesHeading}</h2>
      <dl>{notes.map((note) => <div key={note.id}><dt>{note.label}</dt><dd><p className="serif">{note.note}</p><time dateTime={note.signature.day}>{note.signature.dateLabel}</time></dd></div>)}</dl>
    </section> : null}

    {currentNotes.length > 0 ? <section className="about-notes about-traces" aria-labelledby="traces-title">
      <h2 id="traces-title" className="section-mark">档案最近记下的</h2>
      <dl>{currentNotes.map((note, index) => <div key={`${note.day}-${index}`}><dt><time dateTime={note.day}>{note.dateLabel}</time></dt><dd><p className="serif">{note.entry}</p></dd></div>)}</dl>
    </section> : null}

    {earlierNotes.length > 0 ? <section className="about-notes about-traces about-earlier" aria-labelledby="earlier-title">
      <h2 id="earlier-title" className="section-mark">更早的时候{earlierSpan ? ` · ${earlierSpan}` : ""}</h2>
      <dl>{earlierNotes.map((note, index) => <div key={`${note.day}-${index}`}><dt><time dateTime={note.day}>{note.dateLabel}</time></dt><dd><p className="serif">{note.entry}</p></dd></div>)}</dl>
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
