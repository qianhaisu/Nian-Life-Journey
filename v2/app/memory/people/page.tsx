import type { Metadata } from "next";
import Link from "next/link";
import { readLifeArchive } from "@/lib/life-reading-load";
import { READING_PEOPLE, personMatches } from "@/lib/life-reading";
import { renderOnDemand } from "@/lib/render-on-demand";
import { MemoryReadingMode } from "@/components/memory-reading-mode";
import { ReadingDate } from "@/components/life-reading";
import "../reading.css";

export const metadata: Metadata = { title: "一起长大的人" };

export default async function PeoplePage() {
  await renderOnDemand();
  const { entries } = await readLifeArchive();
  const people = READING_PEOPLE.map(person => ({ person, matches: personMatches(entries, person) })).filter(row => row.matches.length);
  return <div className="life-reading reading-wrap">
    <header className="life-masthead"><Link className="back-link" href="/memory">← 回到记忆</Link>
      <div className="life-heading"><h1>一起长大的人</h1><MemoryReadingMode current="看人物" /></div>
      <p>许多平常的日子，留下了他们的声音。</p>
    </header>
    <div className="people-directory">{people.map(({ person, matches }) => {
      const recent = matches.at(-1)!;
      return <article className="person-opening" key={person.id}>
        <h2><Link href={`/memory/people/${person.id}`} prefetch={false}>{person.label}<span aria-hidden="true"> →</span></Link></h2>
        <ReadingDate entry={recent.entry} /><p>{recent.excerpt}</p>
        <Link className="text-link" href={`/memory/people/${person.id}`} prefetch={false}>读关于{person.label}的日子 →</Link>
      </article>;
    })}</div>
    {people.length === 0 && <p className="life-empty">留下的日子里，还没有可明确归到人物的文字。<Link href="/memory">回到记忆 →</Link></p>}
  </div>;
}
