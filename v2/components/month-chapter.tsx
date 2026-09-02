import Link from "next/link";
import type { MonthIndexEntry } from "@/lib/memory-index";
import { EditorialMemory } from "@/components/editorial-memory";
import { TraceDisclosure } from "@/components/trace-disclosure";

// A month as it appears on /memory: its anchor (month + age), the few memories curated for the
// index, and the folded ordinary days. In "index" mode the month is one row. The month page itself
// (/memory/[year]/[month]) is the only place a month is shown whole.
export function MonthChapter({ entry }: { entry: MonthIndexEntry }) {
  const { chapter, href } = entry;
  if (entry.mode === "index") {
    return <li className="month-index-row">
      <Link href={href}>
        <span className="month-index-label serif">{chapter.shortLabel}</span>
        {chapter.ageLabel ? <span className="month-index-age">当时 {chapter.ageLabel}</span> : null}
        <span className="month-index-count">{entry.memoryCount > 0 ? `${entry.memoryCount} 段记忆` : `${entry.traces.dayCount} 天生活痕迹`}</span>
      </Link>
    </li>;
  }
  return <section className="month-chapter" aria-labelledby={`month-${chapter.month}`}>
    <header className="month-anchor">
      <h3 id={`month-${chapter.month}`} className="serif"><Link href={href}>{chapter.label}</Link></h3>
      {chapter.ageLabel ? <p>当时 {chapter.ageLabel}</p> : null}
    </header>
    {entry.featured.length > 0 ? <div className="month-memories">{entry.featured.map((memory) => <EditorialMemory memory={memory} key={memory.id} />)}</div> : null}
    {entry.hiddenMemoryCount > 0 ? <p className="chapter-meta"><Link className="text-link" href={href}>这个月还有 {entry.hiddenMemoryCount} 段记忆 · 翻看整个月</Link></p> : null}
    <TraceDisclosure traces={entry.traces} hasMemories={entry.memoryCount > 0} moreHref={href} />
  </section>;
}
