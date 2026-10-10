import Link from "next/link";
import { Photo } from "./photo";
import { ReadingDate } from "./life-reading";
import { quotesIn, type YearBook } from "@/lib/life-reading";
import { formatMonth } from "@/lib/time-signature";

export function YearBookReading({ book }: { book: YearBook }) {
  return <article className="life-reading year-book reading-wrap">
    <header className="book-opening">
      <Link className="back-link" href="/memory">← 回到记忆</Link>
      <p className="book-kind">张年 · 年度人生书{book.ongoing ? " · 正在写下的这一年" : ""}</p>
      <h1>{book.year}<span>把日子，读成一年。</span></h1>
      {book.ageLabel && <p className="book-age">{book.ageLabel === "出生前" ? "还在等待与张年见面的这一年。" : book.ageLabel.startsWith("出生前 到") ? `从等待见面，读到 ${book.ageLabel.replace("出生前 到", "").trim()}。` : `这一年，张年 ${book.ageLabel}。`}</p>}
      {book.intro && <p className="book-intro">{book.intro}</p>}
      {book.chapters[0] && <Link href={`#${book.chapters[0].id}`} className="text-link">从第一章开始 →</Link>}
    </header>
    <details className="book-contents"><summary>翻到某一章</summary><nav aria-label="年度书章节">{book.chapters.map((chapter, index) => <Link href={`#${chapter.id}`} key={chapter.id}>
      <span>{String(index + 1).padStart(2, "0")}</span><span>{formatMonth(chapter.month)}<strong>{chapter.title}</strong></span>
    </Link>)}</nav></details>
    {book.changes.length > 0 && <details className="book-changes"><summary>这一年慢慢发生的变化</summary>
      {book.changes.slice(0, 4).map(thread => <section key={thread.id}><h2>{thread.title}</h2>
        {[thread.matches[0], thread.matches.at(-1)!].map((match, index) => <div key={match.entry.day}><p className="life-node-label">{index === 0 ? "年内较早的记录" : "年内后来的记录"}</p><ReadingDate entry={match.entry} /><p>{match.excerpt}</p><Link className="text-link" href={match.entry.href} prefetch={false}>读当时的日子 →</Link></div>)}
        <Link className="text-link" href={`/memory/growth?kind=${thread.category}#${thread.id}`} prefetch={false}>接着看整条变化线 →</Link>
      </section>)}
    </details>}
    {book.chapters.map((chapter, index) => {
      const quoteEntry = chapter.selected.find(entry => entry.paragraphs.some(text => quotesIn(text).length));
      const quote = quoteEntry?.paragraphs.flatMap(quotesIn)[0];
      return <section className="book-chapter" id={chapter.id} aria-labelledby={`${chapter.id}-heading`} key={chapter.id}>
        {/* Preserve old annual-page month anchors for existing links. */}
        <span id={`month-${chapter.month}`} />
        <header><p className="book-chapter-mark">第 {index + 1} 章 · {formatMonth(chapter.month)}</p><h2 id={`${chapter.id}-heading`}>{chapter.title}</h2></header>
        {chapter.intro && <div className="book-chapter-intro"><p>{chapter.intro}</p><Link href={`/memory/${book.year}/${chapter.month.slice(5)}`} prefetch={false}>读这个月的回顾 →</Link></div>}
        <div className="book-prose">{chapter.selected.map(entry => <div className="book-passage" key={entry.day}>
          {entry.paragraphs.slice(0, 2).map((paragraph, p) => <p key={p}>{paragraph}</p>)}
          <Link className="book-citation" href={entry.href} prefetch={false}><ReadingDate entry={entry} /><span>回到那一天 →</span></Link>
        </div>)}</div>
        {chapter.photos.length > 0 && <div className="book-photographs">{chapter.photos.map(({ media, entry }) => <figure key={media.id}>
          <Photo media={media} sizes="(max-width: 700px) 90vw, 430px" variant="thumbnail" /><figcaption><Link href={entry.href} prefetch={false}><ReadingDate entry={entry} /></Link></figcaption>
        </figure>)}</div>}
        {quote && quoteEntry && <aside className="book-quote" aria-label="记忆里留下的话"><blockquote>「{quote}」</blockquote><Link href={quoteEntry.href} prefetch={false}>这句话留下的那天 →</Link></aside>}
        <footer><Link className="text-link" href={`/memory/${book.year}/${chapter.month.slice(5)}`} prefetch={false}>翻看整个月 →</Link>{book.chapters[index + 1] && <Link className="text-link" href={`#${book.chapters[index + 1].id}`}>读下一章 ↓</Link>}</footer>
      </section>;
    })}
    <p className="book-last-line">{book.ongoing ? "这一年还在继续。后来留下的日子，也会来到这里。" : "这一年的日子，先读到这里。"}</p>
    <Link className="text-link" href="/memory">再翻翻别的年份 →</Link>
  </article>;
}
