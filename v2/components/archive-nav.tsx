import Link from "next/link";
import type { MemoryIndex } from "@/lib/memory-index";

// Year → age handles for the whole book, newest first. A parent remembers "when he was about one"
// as readily as "2026", so both are printed on every handle. Anchors jump within /memory; the
// year link opens the annual chapter.
export function ArchiveNav({ nav, current }: { nav: MemoryIndex["nav"]; current?: string }) {
  if (nav.length < 2) return null;
  return <nav className="archive-nav reading-wrap" aria-label="按年份和年龄翻看">
    <ol>
      {nav.map((item) => <li key={item.year} aria-current={item.year === current ? "true" : undefined}>
        <Link href={current === undefined ? `#year-${item.year}` : item.href}><span className="serif">{item.year}</span>{item.ageSpan ? <small>{item.ageSpan}</small> : null}</Link>
      </li>)}
    </ol>
  </nav>;
}
