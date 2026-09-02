import Link from "next/link";
import type { MonthChapter as Chapter } from "@/lib/memory-chapters";
import { EditorialMemory } from "@/components/editorial-memory";
import { TraceDisclosure } from "@/components/trace-disclosure";

// A month of the archive: its anchor (month + age), the memories worth reading, and the folded
// ordinary days. `open` renders memories in full; otherwise the month is one index row.
export function MonthChapter({ chapter, open }: { chapter: Chapter; open: boolean }) {
  const href = `/memory/${chapter.month.slice(0, 4)}/${chapter.month.slice(5, 7)}`;
  if (!open) {
    return <li className="month-index-row">
      <Link href={href}>
        <span className="month-index-label serif">{chapter.shortLabel}</span>
        {chapter.ageLabel ? <span className="month-index-age">当时 {chapter.ageLabel}</span> : null}
        <span className="month-index-count">{chapter.memories.length > 0 ? `${chapter.memories.length} 段记忆` : `${chapter.traceDays.length} 天生活痕迹`}</span>
      </Link>
    </li>;
  }
  return <section className="month-chapter" aria-labelledby={`month-${chapter.month}`}>
    <header className="month-anchor">
      <h3 id={`month-${chapter.month}`} className="serif"><Link href={href}>{chapter.label}</Link></h3>
      {chapter.ageLabel ? <p>当时 {chapter.ageLabel}</p> : null}
    </header>
    {chapter.memories.length > 0 ? <div className="month-memories">{chapter.memories.map((memory) => <EditorialMemory memory={memory} key={memory.id} />)}</div> : null}
    <TraceDisclosure traceDays={chapter.traceDays} hasMemories={chapter.memories.length > 0} />
  </section>;
}
