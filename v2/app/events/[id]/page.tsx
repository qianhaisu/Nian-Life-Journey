import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceList } from "@/components/evidence-list";
import { MediaSequence } from "@/components/media-sequence";
import { TimeSignature } from "@/components/time-signature";
import { getAllEvents, getEventDetail, getStore } from "@/lib/db/repository";
import { memoryTitle, toMediaRef } from "@/lib/memory-chapters";
import { sequenceFor } from "@/lib/media/presentation";
import { birthDayOf, timeSignatureFor } from "@/lib/time-signature";

export async function generateStaticParams() { return (await getAllEvents()).map((event) => ({ id: event.id })); }

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const detail = await getEventDetail(id);
  return { title: detail ? memoryTitle(detail.event) : "这一页不在档案里" };
}

const GROWTH_LABEL: Record<string, string> = { language: "那时会说", motor: "那时会做", social: "那时的样子", interest: "那时喜欢", sleep: "那时的睡眠", food: "那时的吃饭", personality: "那时的性格", height: "身高", weight: "体重" };

// Three layers, in reading order: when and what; the photos and the story; and, folded away, the
// material the day actually left behind. The story is the family's; the material is untouched.
export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, store] = await Promise.all([getEventDetail(id), getStore()]);
  // An event that is not 张年's (a fixture profile's row reached by URL) is not a page in this book.
  if (!detail || detail.event.profileId !== store.profile.id) notFound();
  const { event, media: eventMedia, sources: eventSources, contributors, growth, care } = detail;
  const signature = timeSignatureFor(event.occurredAt, birthDayOf(store.profile));
  const title = memoryTitle(event);
  const raw = sequenceFor(eventMedia, event.heroMediaId);
  const sequence = { layout: raw.layout, shown: raw.shown.map((item) => toMediaRef(item, title)), remaining: raw.remaining };
  const paragraphs = [event.story, ...(event.storySections ?? [])].map((text) => text?.trim()).filter((text): text is string => Boolean(text));
  const people = event.people.filter(Boolean);
  const location = event.locationLabel?.trim();
  const materialCount = eventSources.length;

  return <article className="detail-page">
    <header className="reading-wrap detail-head">
      <Link className="back-link" href="/memory">← 回到记忆</Link>
      {signature ? <TimeSignature signature={signature} className="detail-signature" /> : null}
      <h1 className="serif">{title}</h1>
      {people.length > 0 || location ? <p className="detail-context">{[people.join("、"), location].filter(Boolean).join(" · ")}</p> : null}
    </header>
    {sequence.shown.length > 0 ? <div className={sequence.layout === "single" ? "reading-wrap" : "photo-wrap"}><MediaSequence sequence={sequence} title={title} /></div> : null}
    {paragraphs.length > 0 || growth.length > 0 || care.length > 0 ? <section className="story-layer reading-wrap">
      {paragraphs.length > 0 ? <div className="story-column">{paragraphs.map((text, index) => <p key={index} className={index === 0 ? "story-lead" : undefined}>{text}</p>)}</div> : null}
      {growth.length > 0 || care.length > 0 ? <aside className="story-aside">
        {growth.map((record) => <div className="story-note" key={record.id}><span className="section-mark">{GROWTH_LABEL[record.kind] ?? "那时"}</span><p>{record.note}</p></div>)}
        {care.map((record) => <div className="story-note" key={record.id}><span className="section-mark">{record.title}</span><p>{record.note}</p></div>)}
      </aside> : null}
    </section> : null}
    {materialCount > 0 ? <details className="evidence-disclosure reading-wrap">
      <summary><span className="serif">当时留下的资料</span><small>{materialCount} 项</small></summary>
      <EvidenceList sources={eventSources} media={eventMedia} contributors={contributors} />
    </details> : null}
    <footer className="detail-footer reading-wrap"><Link className="text-link" href="/memory">回到记忆</Link></footer>
  </article>;
}
