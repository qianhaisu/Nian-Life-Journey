import type { Metadata } from "next";
import Link from "next/link";
import { readLifeArchive } from "@/lib/life-reading-load";
import { READING_PEOPLE, personMatches } from "@/lib/life-reading";
import { PEOPLE_PROSE, resolveReadingProse } from "@/lib/life-reading-narratives";
import { renderOnDemand } from "@/lib/render-on-demand";
import { MemoryReadingMode } from "@/components/memory-reading-mode";
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
    <nav className="reading-route-grid people-route-grid" aria-label="读身边的人">{people.map(({ person, prose }) => <Link className="reading-route-card" href={`/memory/people/${person.id}`} prefetch={false} key={person.id}>
      <span>{person.label}</span><strong>{prose.title}</strong><small>{prose.opening}</small><span className="reading-route-arrow" aria-hidden="true">读这段记忆 →</span>
    </Link>)}</nav>
    {people.length === 0 && <p className="life-empty">还没有足够明确的人物记录。<Link href="/memory">回到记忆 →</Link></p>}
  </div>;
}
