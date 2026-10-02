import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { readLifeArchive } from "@/lib/life-reading-load";
import { READING_PEOPLE, personMatches, selectReadingPhotos } from "@/lib/life-reading";
import { renderOnDemand } from "@/lib/render-on-demand";
import { ReadingPassage } from "@/components/life-reading";
import "../../reading.css";

export async function generateMetadata({ params }: { params: Promise<{ person: string }> }): Promise<Metadata> {
  const key = (await params).person;
  return { title: `${READING_PEOPLE.find(person => person.id === key)?.label ?? "人物"}的日子` };
}

export default async function PersonPage({ params, searchParams }: { params: Promise<{ person: string }>; searchParams: Promise<{ year?: string; page?: string }> }) {
  const [route, query] = await Promise.all([params, searchParams]);
  const person = READING_PEOPLE.find(person => person.id === route.person);
  if (!person) notFound();
  await renderOnDemand();
  const { entries, topics } = await readLifeArchive();
  const all = personMatches(entries, person);
  const years = [...new Set(all.map(match => match.entry.day.slice(0, 4)))].sort();
  const year = years.includes(query.year ?? "") ? query.year : undefined;
  const matches = all.filter(match => !year || match.entry.day.startsWith(year));
  const totalPages = Math.max(1, Math.ceil(matches.length / 15));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(query.page) || 1)));
  const shown = matches.slice((page - 1) * 15, page * 15);
  const photographs = selectReadingPhotos(shown.filter((_, index) => index % 5 === 0).map(match => match.entry), media => topics(media.id)?.carousel?.sceneKey);
  const href = (page: number, year?: string) => `/memory/people/${person.id}?${new URLSearchParams({ ...(year ? { year } : {}), page: String(page) })}`;
  return <div className="life-reading reading-wrap">
    <header className="life-masthead"><Link className="back-link" href="/memory/people">← 一起长大的人</Link><h1>关于{person.label}的日子</h1>
      <p>文字里提到的相处、惦念和当时的话，都从这些日子里读起。</p>
    </header>
    <nav className="life-tabs" aria-label="按年份读人物记忆"><Link href={href(1)} aria-current={!year ? "page" : undefined}>所有年份</Link>{years.map(item => <Link href={href(1, item)} key={item} aria-current={year === item ? "page" : undefined}>{item} 年</Link>)}</nav>
    <div className="person-days">{shown.map((match, index) => <ReadingPassage key={match.entry.day} match={match} photo={index % 5 === 0 ? photographs[index / 5] : undefined} />)}</div>
    {!matches.length && <p className="life-empty">还没有关于{person.label}的明确记录。<Link href="/memory/people">翻翻其他人的日子 →</Link></p>}
    {totalPages > 1 && <nav className="life-pagination" aria-label="人物记忆翻页">{page > 1 && <Link href={href(page - 1, year)}>← 前面的日子</Link>}{page < totalPages && <Link href={href(page + 1, year)}>后来的日子 →</Link>}</nav>}
  </div>;
}
