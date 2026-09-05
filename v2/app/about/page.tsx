import type { Metadata } from "next";
import Link from "next/link";
import { GrowthChart } from "@/components/growth-chart";
import { Photo } from "@/components/photo";
import { loadFamilyArchive } from "@/lib/family-archive";
import { measurements, recentGrowthNotes } from "@/lib/growth-notes";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { latestPortrait, memoryTitle, recentTraceNotes } from "@/lib/memory-chapters";
import { isPrivileged } from "@/lib/publication-moments";
import { calendarDayOf } from "@/lib/timeline-dates";
import { ageOn, formatDay, formatMonth, timeSignatureFor } from "@/lib/time-signature";
import type { LifeEvent } from "@/lib/types";
import { isRecent } from "@/lib/time-truth";

export const revalidate = 300;
export const metadata: Metadata = { title: "张年" };

// Who 张年 is right now — and only then, who he was earlier. The page is split in two eras with
// the same recency contract as every "最近" (lib/time-truth.ts): CURRENT holds what recent
// evidence actually supports (his age, the newest deliverable photo of him, stamped with the day
// it was taken, and any recent notes), and everything older sits under an explicit 更早的时候
// heading with its real dates — a year-old note may be read, but never mistaken for now. When a
// section has no real record behind it, it is not rendered — never filled in.
// Deterministic regex to lift family-member quotes from a life_event story.
// Matches: 妈妈/爸爸/奶奶/雪姨/老师 (+ optional 说/转述) + 「…」 (2–40 chars)
const FAMILY_QUOTE_RE = /(妈妈|爸爸|奶奶|雪姨|老师)(说|转述)?[：:]?「([^」]{2,40})」/g;

type FamilyQuote = { caller: string; quote: string; day: string; dateLabel: string; ageLabel?: string; eventId: string };

function extractFamilyQuotes(events: LifeEvent[], birthDay?: string, max = 3): FamilyQuote[] {
  const results: FamilyQuote[] = [];
  for (const event of events) {
    if (!event.story || results.length >= max) break;
    const day = calendarDayOf(event.occurredAt);
    if (!day) continue;
    const sig = timeSignatureFor(event.occurredAt, birthDay);
    if (!sig) continue;
    FAMILY_QUOTE_RE.lastIndex = 0;
    let match;
    while ((match = FAMILY_QUOTE_RE.exec(event.story)) !== null) {
      results.push({ caller: match[1], quote: match[3], day, dateLabel: sig.dateLabel, ageLabel: sig.ageLabel, eventId: event.id });
      if (results.length >= max) break;
    }
  }
  return results;
}

export default async function AboutPage() {
  const { chapters, store, birthDay, time, privilege, snapshots, events } = await loadFamilyArchive();
  const age = birthDay ? ageOn(birthDay, time.today) : undefined;
  const portrait = latestPortrait(chapters, (photo) => isPrivileged(photo, privilege));
  const portraitRecent = portrait ? isRecent(portrait.day, time) : false;
  const traceNotes = recentTraceNotes(chapters, 4);
  const currentNotes = traceNotes.filter((note) => isRecent(note.day, time));
  const earlierNotes = traceNotes.filter((note) => !isRecent(note.day, time));
  const earlierSpan = earlierNotes.length > 0 ? formatMonth(earlierNotes[0].day.slice(0, 7)) : undefined;
  const notes = recentGrowthNotes(store.growthRecords, birthDay, 4, time);
  const notesHeading = notes.some((note) => note.recent) ? "最近的变化" : "记下来的变化";
  // B-5: link growth notes to their originating life_event where one exists.
  const growthEventMap = new Map(
    store.growthRecords.filter((r) => r.lifeEventId).map((r) => [r.id, r.lifeEventId!])
  );
  // B-5: latest published snapshot summary for "生活节奏" block.
  const latestSnapshot = [...snapshots].sort((a, b) => b.month.localeCompare(a.month)).find((s) => s.summary?.trim());
  // B-10: recent published life_events (last 60 days, max 6) for "最近记下来的".
  const cutoffDay60 = new Date(time.today);
  cutoffDay60.setDate(cutoffDay60.getDate() - 60);
  const cutoff60 = cutoffDay60.toISOString().slice(0, 10);
  const recentEvents = events
    .filter((e) => { const d = calendarDayOf(e.occurredAt); return d && d >= cutoff60; })
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 6);
  // B-10: family quotes from all published events (sorted newest-first, take first 3 matches).
  const sortedEvents = [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  const familyQuotes = extractFamilyQuotes(sortedEvents, birthDay);

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

    <div className="about-timeline">
    {notes.length > 0 ? <section className="about-notes" aria-labelledby="notes-title">
      <h2 id="notes-title" className="section-mark">{notesHeading}</h2>
      <dl>{notes.map((note) => {
        const eventId = growthEventMap.get(note.id);
        return <div key={note.id}>
          <dt>{note.label}</dt>
          <dd>
            <p className="serif">{note.note}</p>
            <p className="note-meta">
              <time dateTime={note.signature.day}>{note.signature.dateLabel}</time>
              {eventId ? <Link className="text-link" href={`/events/${eventId}`}>查看那天</Link> : null}
            </p>
          </dd>
        </div>;
      })}</dl>
    </section> : null}

    {latestSnapshot ? <section className="about-notes" aria-labelledby="snapshot-title">
      <h2 id="snapshot-title" className="section-mark">最近的生活节奏</h2>
      <dl><div>
        <dt><Link className="text-link" href={`/memory/${latestSnapshot.month.slice(0, 4)}/${latestSnapshot.month.slice(5, 7)}`}>{formatMonth(latestSnapshot.month)}</Link></dt>
        <dd><SnapshotSummary text={latestSnapshot.summary!} className="serif" /></dd>
      </div></dl>
    </section> : null}

    {recentEvents.length > 0 ? <section className="about-notes" aria-labelledby="recent-events-title">
      <h2 id="recent-events-title" className="section-mark">最近记下来的</h2>
      <dl>{recentEvents.map((event) => {
        const sig = timeSignatureFor(event.occurredAt, birthDay);
        if (!sig) return null;
        return <div key={event.id}>
          <dt><time dateTime={sig.day}>{sig.dateLabel}</time></dt>
          <dd><p className="serif"><Link className="text-link" href={`/events/${event.id}`}>{memoryTitle(event)}</Link></p></dd>
        </div>;
      })}</dl>
    </section> : null}

    {familyQuotes.length > 0 ? <section className="about-notes" aria-labelledby="family-quotes-title">
      <h2 id="family-quotes-title" className="section-mark">家人这阵子说</h2>
      <dl>{familyQuotes.map((q, i) => <div key={i}>
        <dt>{q.caller} · <time dateTime={q.day}>{q.dateLabel}</time>{q.ageLabel ? <> · {q.ageLabel}</> : null}</dt>
        <dd><p className="serif">「{q.quote}」</p><p className="note-meta"><Link className="text-link" href={`/events/${q.eventId}`}>查看那天</Link></p></dd>
      </div>)}</dl>
    </section> : null}

    {currentNotes.length > 0 ? <section className="about-notes about-traces" aria-labelledby="traces-title">
      <h2 id="traces-title" className="section-mark">档案最近记下的</h2>
      <dl>{currentNotes.map((note, index) => {
        const monthHref = `/memory/${note.day.slice(0, 4)}/${note.day.slice(5, 7)}`;
        return <div key={`${note.day}-${index}`}>
          <dt><time dateTime={note.day}><Link className="text-link" href={monthHref}>{note.dateLabel}</Link></time></dt>
          <dd><p className="serif">{note.entry}</p></dd>
        </div>;
      })}</dl>
    </section> : null}

    {earlierNotes.length > 0 ? <section className="about-notes about-traces about-earlier" aria-labelledby="earlier-title">
      <h2 id="earlier-title" className="section-mark">更早的时候{earlierSpan ? ` · ${earlierSpan}` : ""}</h2>
      <dl>{earlierNotes.map((note, index) => {
        const monthHref = `/memory/${note.day.slice(0, 4)}/${note.day.slice(5, 7)}`;
        return <div key={`${note.day}-${index}`}>
          <dt><time dateTime={note.day}><Link className="text-link" href={monthHref}>{note.dateLabel}</Link></time></dt>
          <dd><p className="serif">{note.entry}</p></dd>
        </div>;
      })}</dl>
    </section> : null}
    </div>

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
