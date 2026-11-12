import type { Metadata } from "next";
import Link from "next/link";
import { SECTIONS } from "@/lib/features";
import { Photo } from "@/components/photo";
import { readLifeArchive } from "@/lib/life-reading-load";
import { highlightSegments, searchArchiveAll } from "@/lib/life-reading";
import { renderOnDemand } from "@/lib/render-on-demand";
import { ReadingDate } from "@/components/life-reading";
import "../reading.css";
import "../memory-modern.css";

export const metadata: Metadata = { title: "找一段往事" };
const suggestions = ["什么时候开始自己吃饭", "第一次说打开", "2024", "2025年3月", "外婆"];

function Highlighted({ text, terms }: { text: string; terms: readonly string[] }) {
  const segments = highlightSegments(text, terms);
  return (
    <>
      {segments.map((seg, i) =>
        seg.hit ? (
          <mark key={i} className="search-hit">
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )}
    </>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await renderOnDemand();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  // No archive read at all until a family member asks a question.
  const search = query
    ? (() => readLifeArchive().then(({ entries, months }) => searchArchiveAll({ entries, months, query })))()
    : null;
  const resolved = search ? await search : { items: [], highlightTerms: [], dateQuery: null };
  const results = resolved.items;
  const highlightTerms = resolved.highlightTerms;
  const totalPages = Math.max(1, Math.ceil(results.length / 15));
  const page = Math.min(totalPages, Math.max(1, Math.floor(Number(params.page) || 1)));
  const href = (page: number) => `/memory/search?${new URLSearchParams({ q: query, page: String(page) })}`;
  return <div className="life-reading reading-wrap">
    <header className="life-masthead"><Link className="back-link" href="/memory">← 回到记忆</Link><h1>找一段往事</h1></header>
    <form action="/memory/search" className="archive-search" method="get">
      <label htmlFor="archive-query">想起哪件事、哪句话，或哪一年哪一月？</label>
      <div><input id="archive-query" name="q" type="search" maxLength={100} defaultValue={query} placeholder="比如：外婆、2024、2025年3月、第一次说打开" /><button type="submit">找找</button></div>
    </form>
    {!query ? <div className="search-suggestions"><p>也可以从这些往事或年月找起</p>{suggestions.map(text => <Link href={`/memory/search?${new URLSearchParams({ q: text })}`} prefetch={false} key={text}>{text} →</Link>)}</div> : <>
      <p className="life-note">
        {resolved.dateQuery
          ? "按年月列出的月份综述与每日记录（含 2024 年出生前的孕期月份段落）。"
          : "按留下的文字寻找（含每月综述与每日记录）。最早匹配的记录不一定是人生第一次；当时的原话和资料可在日页继续核对。"}
      </p>
      {results.length === 0 && <div className="life-empty"><p>还没找到与“{query}”相合的文字。试试一句短一点的原话，或输入年份（如 2024）、年月（如 2025年3月）。</p>{SECTIONS.growth ? <Link href="/memory/growth">看看成长里的变化 →</Link> : <Link href="/memory">翻翻按月整理的记忆 →</Link>}</div>}
      <div className="search-results">{results.slice((page - 1) * 15, page * 15).map((item, index) => {
        const thumbLoading = index < 4 ? "eager" : "lazy";
        if (item.kind === "month") {
          const { month, excerpt, quotes } = item;
          const cover = month.cover;
          return (
            <article
              className={`search-result search-result--month${cover ? " search-result--with-photo" : ""}${month.preBirth ? " search-result--prebirth" : ""}`}
              key={`month-${month.month}`}
            >
              <div className="search-result-body">
                <p className={`life-date${month.preBirth ? " life-date--prebirth" : ""}`}>
                  <time dateTime={month.month}>{month.label}</time>
                  {month.ageLabel ? <span> · {month.ageLabel}</span> : null}
                  <span> · 月份综述</span>
                </p>
                <h2>
                  <Link href={month.href} prefetch={false}>
                    <Highlighted text={month.cardLine || month.label} terms={highlightTerms} />
                  </Link>
                </h2>
                <p><Highlighted text={excerpt} terms={highlightTerms} /></p>
                {quotes.length > 0 && (
                  <blockquote>
                    {quotes.slice(0, 2).map((quote) => (
                      <p key={quote}>「<Highlighted text={quote} terms={highlightTerms} />」</p>
                    ))}
                  </blockquote>
                )}
                <Link className="text-link" href={month.href} prefetch={false}>翻开这一个月 →</Link>
              </div>
              {cover ? (
                <Link className="search-result-thumb" href={month.href} prefetch={false} aria-label={`查看 ${month.label}`}>
                  <Photo media={cover} variant="thumbnail" fit="crop" loading={thumbLoading} sizes="(max-width: 640px) 96px, 136px" />
                </Link>
              ) : null}
            </article>
          );
        }
        const { entry, excerpt, quotes, leadPhoto } = item;
        const thumb = leadPhoto ?? entry.photos[0];
        return (
          <article className={`search-result${thumb ? " search-result--with-photo" : ""}`} key={entry.day}>
            <div className="search-result-body">
              <ReadingDate entry={entry} />
              <h2>
                <Link href={entry.href} prefetch={false}>
                  <Highlighted text={entry.title || "这一天"} terms={highlightTerms} />
                </Link>
              </h2>
              {excerpt ? <p><Highlighted text={excerpt} terms={highlightTerms} /></p> : null}
              {quotes.length > 0 && (
                <blockquote>
                  {quotes.slice(0, 2).map((quote) => (
                    <p key={quote}>「<Highlighted text={quote} terms={highlightTerms} />」</p>
                  ))}
                </blockquote>
              )}
              <Link className="text-link" href={entry.href} prefetch={false}>读这一天与当时的话 →</Link>
            </div>
            {thumb ? (
              <Link className="search-result-thumb" href={entry.href} prefetch={false} aria-label={`查看 ${entry.day} 的照片`}>
                <Photo media={thumb} variant="thumbnail" fit="crop" loading={thumbLoading} sizes="(max-width: 640px) 96px, 136px" />
              </Link>
            ) : null}
          </article>
        );
      })}</div>
      {totalPages > 1 && <nav className="life-pagination" aria-label="检索翻页">{page > 1 && <Link href={href(page - 1)}>← 上一页</Link>}{page < totalPages && <Link href={href(page + 1)}>继续找 →</Link>}</nav>}
    </>}
  </div>;
}
