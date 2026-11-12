import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SECTIONS } from "@/lib/features";
import { READING_PEOPLE, personMatches } from "@/lib/life-reading";
import { readLifeArchive } from "@/lib/life-reading-load";
import { PEOPLE_PROSE, resolveReadingProse } from "@/lib/life-reading-narratives";
import { renderOnDemand } from "@/lib/render-on-demand";
import { MemoryReadingMode } from "@/components/memory-reading-mode";
import { ReadingEssay } from "@/components/reading-essays";
import "../../reading.css";
import "../../memory-modern.css";

export async function generateMetadata({ params }: { params: Promise<{ person: string }> }): Promise<Metadata> {
  if (!SECTIONS.people) return { title: "人物", robots: { index: false, follow: false } };
  const { person: id } = await params;
  const person = READING_PEOPLE.find(item => item.id === id);
  return { title: person ? `${person.label} · 一起长大的人` : "人物" };
}

/** A complete portrait at its own stable address; nothing to expand or paginate. */
export default async function PersonPage({ params }: { params: Promise<{ person: string }> }) {
  if (!SECTIONS.people) redirect("/memory");
  const { person: id } = await params;
  const person = READING_PEOPLE.find(item => item.id === id);
  if (!person) notFound();
  await renderOnDemand();
  const { entries } = await readLifeArchive();
  const prose = resolveReadingProse(PEOPLE_PROSE[person.id], personMatches(entries, person), person.aliases);
  if (!prose.paragraphs.length) notFound();
  return <div className="life-reading reading-wrap people-reading">
    <header className="life-masthead"><Link className="back-link" href="/memory/people">← 一起长大的人</Link>
      <div className="life-heading"><h1>关于{person.label}的记忆</h1><MemoryReadingMode current="看人物" /></div>
      <p>相处、关心和当时的话，都留在这里。</p>
    </header>
    <article className="person-story person-story--solo" aria-labelledby="person-title">
      <header><h2 id="person-title">{person.label}</h2><p className="person-story-title">{prose.title}</p><p className="person-story-opening">{prose.opening}</p></header>
      <ReadingEssay paragraphs={prose.paragraphs} />
    </article>
    <Link className="reading-next-link" href="/memory/people">再看看其他人 →</Link>
  </div>;
}
