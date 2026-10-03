import { formatDay } from "@/lib/time-signature";
import type { ReadingMatch } from "@/lib/life-reading";

export function ReadingDate({ entry }: { entry: ReadingMatch["entry"] }) {
  return <p className="life-date"><time dateTime={entry.day}>{formatDay(entry.day)}</time>{entry.ageLabel && <span> · {entry.ageLabel.startsWith("出生前") ? entry.ageLabel : `当时 ${entry.ageLabel}`}</span>}</p>;
}
