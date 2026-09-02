import type { TraceDay } from "@/lib/memory-chapters";

// Ordinary days are present but folded. The summary line is the whole point: the family sees that
// the month was noticed without reading thirty bullet lists.
export function TraceDisclosure({ traceDays, hasMemories }: { traceDays: TraceDay[]; hasMemories: boolean }) {
  if (traceDays.length === 0) return null;
  const label = hasMemories ? `这个月还有 ${traceDays.length} 天留下了生活痕迹` : `这个月有 ${traceDays.length} 天留下了生活痕迹`;
  return <details className="trace-disclosure">
    <summary>{label}</summary>
    <ol>
      {traceDays.map((day) => <li key={day.day}>
        <time dateTime={day.day}>{day.dateLabel}</time>
        <ul>{day.entries.map((entry, index) => <li key={index}>{entry}</li>)}</ul>
      </li>)}
    </ol>
  </details>;
}
