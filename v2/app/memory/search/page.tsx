import type { Metadata } from "next";
import Link from "next/link";
import { readLifeArchive } from "@/lib/life-reading-load";
import { searchArchive } from "@/lib/life-reading";
import { renderOnDemand } from "@/lib/render-on-demand";
import { ReadingDate } from "@/components/life-reading";
import "../reading.css";

export const metadata: Metadata = { title: "找一段往事" };
const suggestions = ["什么时候开始自己吃饭", "第一次说打开", "和外公去过哪里"];

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await renderOnDemand();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  // No archive read at all until a family member asks a question.
  const results = query ? searchArchive((await readLifeArchive()).entries, query) : [];
  const totalPages = Math.max(1, Math.ceil(results.length / 15));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(params.page) || 1)));
  const href = (page: number) => `/memory/search?${new URLSearchParams({ q: query, page: String(page) })}`;
  return <div className="life-reading reading-wrap">
    <header className="life-masthead"><Link className="back-link" href="/memory">← 回到记忆</Link><h1>找一段往事</h1></header>
    <form action="/memory/search" className="archive-search" method="get">
      <label htmlFor="archive-query">想起哪件事，或哪句话？</label>
      <div><input id="archive-query" name="q" type="search" maxLength={100} defaultValue={query} placeholder="比如：第一次说打开" /><button type="submit">找找</button></div>
    </form>
    {!query ? <div className="search-suggestions"><p>也可以从这些往事找起</p>{suggestions.map(text => <Link href={`/memory/search?${new URLSearchParams({ q: text })}`} prefetch={false} key={text}>{text} →</Link>)}</div> : <>
      <p className="life-note">按留下的文字寻找。最早匹配的记录不一定是人生第一次；当时的原话和资料可在日页继续核对。</p>
      {results.length === 0 && <div className="life-empty"><p>还没找到与“{query}”相合的文字。试试一句短一点的原话，或一个人物、地点。</p><Link href="/memory/growth">看看成长里的变化 →</Link></div>}
      <div className="search-results">{results.slice((page - 1) * 15, page * 15).map(({ entry, excerpt, quotes }) => <article className="search-result" key={entry.day}>
        <ReadingDate entry={entry} /><h2><Link href={entry.href} prefetch={false}>{entry.title || "这一天"}</Link></h2>
        <p>{excerpt}</p>{quotes.length > 0 && <blockquote>{quotes.slice(0, 2).map(quote => <p key={quote}>「{quote}」</p>)}</blockquote>}
        <Link className="text-link" href={entry.href} prefetch={false}>读这一天与当时的话 →</Link>
      </article>)}</div>
      {totalPages > 1 && <nav className="life-pagination" aria-label="检索翻页">{page > 1 && <Link href={href(page - 1)}>← 上一页</Link>}{page < totalPages && <Link href={href(page + 1)}>继续找 →</Link>}</nav>}
    </>}
  </div>;
}
