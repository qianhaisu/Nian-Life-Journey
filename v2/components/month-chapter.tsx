import Link from "next/link";
import type { MonthIndexEntry } from "@/lib/memory-index";
import { EditorialMemory } from "@/components/editorial-memory";
import { PhotoStrip } from "@/components/media-sequence";
import { TraceDisclosure } from "@/components/trace-disclosure";

// One quiet line for an index row: the most meaningful thing the month holds. Counts are only ever
// of what a reader can actually open.
function indexCount(entry: MonthIndexEntry): string | undefined {
  if (entry.memoryCount > 0) return `${entry.memoryCount} 段记忆`;
  if (entry.chapter.photoCount > 0) return `${entry.chapter.photoCount} 张照片`;
  if (entry.traces.dayCount > 0) return `${entry.traces.dayCount} 天生活痕迹`;
  return undefined;
}

// A month as it appears on /memory: its anchor (month + age), the few memories curated for the
// index, and the folded ordinary days. In "index" mode the month is one row. The month page itself
// (/memory/[year]/[month]) is the only place a month is shown whole.
export function MonthChapter({ entry }: { entry: MonthIndexEntry }) {
  const { chapter, href } = entry;
  if (entry.mode === "index") {
    const count = indexCount(entry);
    return <li className="month-index-row">
      <Link href={href}>
        <span className="month-index-label serif">{chapter.shortLabel}</span>
        {chapter.ageLabel ? <span className="month-index-age">当时 {chapter.ageLabel}</span> : null}
        {count ? <span className="month-index-count">{count}</span> : null}
      </Link>
    </li>;
  }
  return <section className="month-chapter" aria-labelledby={`month-${chapter.month}`}>
    <header className="month-anchor">
      <h3 id={`month-${chapter.month}`} className="serif"><Link href={href}>{chapter.label}</Link></h3>
      {chapter.ageLabel ? <p>当时 {chapter.ageLabel}</p> : null}
    </header>
    {entry.featured.length > 0 ? <div className="month-memories">{entry.featured.map((memory) => <EditorialMemory memory={memory} key={memory.id} />)}</div> : null}
    <PhotoStrip photos={chapter.photos} />
    {chapter.photoCount > chapter.photos.length ? <p className="chapter-meta"><Link className="text-link" href={href}>这个月一共 {chapter.photoCount} 张照片 · 翻看整个月</Link></p> : null}
    {entry.hiddenMemoryCount > 0 ? <p className="chapter-meta"><Link className="text-link" href={href}>这个月还有 {entry.hiddenMemoryCount} 段记忆 · 翻看整个月</Link></p> : null}
    <TraceDisclosure traces={entry.traces} hasMemories={entry.memoryCount > 0} moreHref={href} />
  </section>;
}
