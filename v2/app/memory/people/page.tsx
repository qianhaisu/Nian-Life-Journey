import type { Metadata } from "next";
import Link from "next/link";
import { readLifeArchive } from "@/lib/life-reading-load";
import { READING_PEOPLE, personMatches } from "@/lib/life-reading";
import { PEOPLE_PROSE, resolveReadingProse } from "@/lib/life-reading-narratives";
import { renderOnDemand } from "@/lib/render-on-demand";
import { MemoryReadingMode } from "@/components/memory-reading-mode";
import { ReadingEssay } from "@/components/reading-essays";
import "../reading.css";

export const metadata: Metadata = { title: "一起长大的人" };

export default async function PeoplePage() {
  await renderOnDemand();
  const { entries } = await readLifeArchive();
  const people = READING_PEOPLE.flatMap(person => {
    const matches = personMatches(entries, person);
    if (!matches.length) return [];
    const prose = resolveReadingProse(PEOPLE_PROSE[person.id], matches, person.aliases);
    return prose.paragraphs.length ? [{ person, prose }] : [];
  });
  return <div className="life-reading reading-wrap people-reading">
    <header className="life-masthead"><Link className="back-link" href="/memory">← 回到记忆</Link>
      <div className="life-heading"><h1>一起长大的人</h1><MemoryReadingMode current="看人物" /></div>
      <p>那些抱起他、听他说话、为他高兴的人，都在这些话里。</p>
    </header>
    <nav className="reading-index" aria-label="读身边的人">{people.map(({ person }) => <a href={`#person-${person.id}`} key={person.id}>{person.label}</a>)}</nav>
    <div className="people-stories">{people.map(({ person, prose }) => <article className="person-story" id={`person-${person.id}`} key={person.id} aria-labelledby={`person-title-${person.id}`}>
      <header>
        <h2 id={`person-title-${person.id}`}>{person.label}</h2><p className="person-story-title">{prose.title}</p>
        <p className="person-story-opening">{prose.opening}</p></header>
      <ReadingEssay paragraphs={prose.paragraphs} />
    </article>)}</div>
    {people.length === 0 && <p className="life-empty">还没有足够明确的人物记录。<Link href="/memory">回到记忆 →</Link></p>}
  </div>;
}
