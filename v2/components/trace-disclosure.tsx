import Link from "next/link";
import type { TraceFold } from "@/lib/memory-index";

// Ordinary days are present but folded. The summary line is the whole point: the family sees that
// the month was noticed without reading thirty bullet lists. What is inside the fold is bounded by
// lib/memory-ia-policy.ts; when more days exist than fit, the month page carries them.
export function TraceDisclosure({ traces, hasMemories, moreHref }: { traces: TraceFold; hasMemories: boolean; moreHref?: string }) {
  if (traces.dayCount === 0) return null;
  const label = hasMemories ? `这个月还有 ${traces.dayCount} 天留下了生活痕迹` : `这个月有 ${traces.dayCount} 天留下了生活痕迹`;
  return <details className="trace-disclosure">
    <summary>{label}</summary>
    <ol>
      {traces.days.map((day) => <li key={day.day}>
        <time dateTime={day.day}>{day.dateLabel}</time>
        <ul>
          {day.entries.map((entry, index) => <li key={index}>{entry}</li>)}
          {day.hiddenEntryCount > 0 ? <li className="trace-more">还有 {day.hiddenEntryCount} 条</li> : null}
        </ul>
      </li>)}
      {traces.hiddenDayCount > 0 ? <li className="trace-more">{moreHref ? <Link href={moreHref}>还有 {traces.hiddenDayCount} 天，在月份章节里</Link> : <span>还有 {traces.hiddenDayCount} 天</span>}</li> : null}
    </ol>
  </details>;
}
