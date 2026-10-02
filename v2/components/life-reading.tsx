import Link from "next/link";
import { Photo } from "./photo";
import { formatDay } from "@/lib/time-signature";
import type { ReadingMatch } from "@/lib/life-reading";
import type { MediaRef } from "@/lib/memory-chapters";

export function ReadingDate({ entry }: { entry: ReadingMatch["entry"] }) {
  return <p className="life-date"><time dateTime={entry.day}>{formatDay(entry.day)}</time>{entry.ageLabel && <span> · {entry.ageLabel.startsWith("出生前") ? entry.ageLabel : `当时 ${entry.ageLabel}`}</span>}</p>;
}

export function ReadingPassage({ match, label, photo }: { match: ReadingMatch; label?: string; photo?: MediaRef }) {
  const { entry, excerpt } = match;
  return <article className="life-passage">
    {label && <p className="life-node-label">{label}</p>}
    <ReadingDate entry={entry} />
    <h3><Link href={entry.href} prefetch={false}>{entry.title || "这一天"}</Link></h3>
    <p className="life-excerpt">{excerpt}</p>
    {photo && <figure className="life-day-picture"><Photo media={photo} sizes="(max-width: 700px) 90vw, 480px" variant="thumbnail" /><figcaption>这一天留下的画面</figcaption></figure>}
    <Link className="text-link" href={entry.href} prefetch={false}>读这一天的原记录 →</Link>
  </article>;
}
