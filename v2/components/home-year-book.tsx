import Link from "next/link";
import type { readBookTeaser } from "@/lib/life-reading-load";

export function HomeYearBook({ book }: { book: NonNullable<Awaited<ReturnType<typeof readBookTeaser>>> }) {
  return <section className="home-year-book" aria-labelledby="home-book-title">
    <Link className="home-book-spine" href={book.href} prefetch={false} aria-label={`开始读 ${book.year} 年度人生书`}><span>张年</span><strong>{book.year}</strong><small>年度人生书</small></Link>
    <div><p className="home-book-kicker">{book.ongoing ? "正在写下的这一年" : "把一年的日子，慢慢读完"}</p>
      <h2 id="home-book-title">{book.year}，张年的一年</h2>
      {book.ageLabel && <p className="home-book-age">{book.ageLabel.startsWith("出生前") ? book.ageLabel.replace("出生前", "见面前") : `当时 ${book.ageLabel}`}</p>}
      <p className="home-book-intro">{book.intro}</p>
      <Link className="home-book-read" href={book.href} prefetch={false}>开始读 →</Link>
    </div>
  </section>;
}
