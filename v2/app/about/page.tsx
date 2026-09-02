import type { Metadata } from "next";
import Link from "next/link";
import { GrowthChart } from "@/components/growth-chart";
import { Photo } from "@/components/photo";
import { loadFamilyArchive } from "@/lib/family-archive";
import { measurements, recentGrowthNotes } from "@/lib/growth-notes";
import { latestLeadPhoto } from "@/lib/memory-chapters";
import { currentAge, formatDay } from "@/lib/time-signature";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "张年" };

// Who 张年 is right now, from records that exist: age, one recent photo, and the handful of things
// that recently changed. Measurements and care notes are deeper material, folded by default. When a
// section has no real record behind it, it is not rendered — never filled in.
export default async function AboutPage() {
  const { chapters, store, birthDay } = await loadFamilyArchive();
  const age = currentAge(birthDay);
  const portrait = latestLeadPhoto(chapters);
  const notes = recentGrowthNotes(store.growthRecords, birthDay);
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
      <h2 id="notes-title" className="section-mark">最近的变化</h2>
      <dl>{notes.map((note) => <div key={note.id}><dt>{note.label}</dt><dd><p className="serif">{note.note}</p><time dateTime={note.signature.day}>{note.signature.dateLabel}</time></dd></div>)}</dl>
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
