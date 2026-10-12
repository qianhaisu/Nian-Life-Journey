import Link from "next/link";
import { formatDay } from "@/lib/time-signature";
import type { ReadingParagraph } from "@/lib/life-reading-narratives";

export function ReadingEssay({ paragraphs }: { paragraphs: readonly ReadingParagraph[] }) {
  return <div className="reading-essay">{paragraphs.map((paragraph, index) => <p key={index}>
    {paragraph.text}
    <span className="reading-citations" role="group" aria-label="这段文字的原记录">{paragraph.sources.map(source => <Link key={source.entry.day} href={source.entry.href} prefetch={false} title={source.excerpt}>
      <time dateTime={source.entry.day}>{formatDay(source.entry.day)}</time>{source.entry.ageLabel && <span> · {source.entry.ageLabel}</span>}
    </Link>)}</span>
  </p>)}</div>;
}
