import Link from "next/link";
import { CardThumbnail } from "@/components/card-thumbnail";
import { DayDetailCard } from "@/components/day-detail-card";
import { DayMaterial } from "@/components/day-material";
import type { DayNeighbor } from "@/lib/day-reading";
import type { TimelineStory } from "@/lib/month-timeline";
import type { MediaRef } from "@/lib/memory-chapters";
import type { MonthContentDay } from "@/lib/month-content";
import type { Media, RawSource } from "@/lib/types";

// One edited day, read in full. Used by both entrances so they cannot drift apart: the day's own
// page (for days the Organizer never made an event for) and an old /events/<id> link (for the days
// whose several fragments were merged into one story).
//
// Photographs are ALL shown, never folded: photo #1 serves as the hero plate, paragraph-anchored
// photos sit right after the paragraph that speaks of them, and any remaining curated photos appear
// in the closing mosaic — with strict deduplication across all three zones.
export function DayDetail({
  day, dateLabel, ageLabel, title, paragraphs, photos, sources, sourceMedia,
  speakerBySourceId, deliverableIds, monthHref, monthLabel, mergedNote, stories = [], previous, next,
}: {
  day: MonthContentDay;
  dateLabel: string;
  ageLabel?: string;
  title: string;
  paragraphs: string[];
  photos: MediaRef[];
  sources: RawSource[];
  sourceMedia: Media[];
  speakerBySourceId?: Record<string, string>;
  deliverableIds?: ReadonlySet<string>;
  monthHref: string;
  monthLabel: string;
  /** Rendered only for a reader who followed an old link into a day that was merged. */
  mergedNote?: string;
  stories?: TimelineStory[];
  previous?: DayNeighbor;
  next?: DayNeighbor;
}) {
  const ageText = ageLabel
    ? (/^(当时|出生)/.test(ageLabel) ? ageLabel : `当时 ${ageLabel}`)
    : undefined;

  return (
    <article className="detail-page day-detail">
      <nav className="detail-breadcrumb reading-wrap" aria-label="返回路径">
        <Link className="back-link" href={monthHref}>← {monthLabel}</Link>
      </nav>

      <DayDetailCard
        day={day}
        dateLabel={dateLabel}
        ageLabel={ageLabel}
        ageText={ageText}
        title={title}
        paragraphs={paragraphs}
        photos={photos}
        stories={stories}
      />

      <DayMaterial
        sources={sources}
        media={sourceMedia}
        speakerBySourceId={speakerBySourceId}
        deliverableIds={deliverableIds}
      />

      {mergedNote ? <p className="reading-wrap chapter-meta day-detail-merged">{mergedNote}</p> : null}

      <nav className="reading-wrap day-neighbors" aria-label="继续读日子">
        {previous ? (
          <Link
            className={`day-neighbor day-neighbor-prev${previous.thumbnail ? " day-neighbor--with-thumb" : ""}`}
            href={previous.href}
            prefetch={false}
          >
            {previous.thumbnail ? (
              <CardThumbnail thumbnail={previous.thumbnail} className="day-neighbor-thumb" sizes="64px" />
            ) : null}
            <span className="day-neighbor-copy">
              <span className="section-mark">← 上一日</span>
              <span className="serif day-neighbor-title">{previous.title}</span>
            </span>
          </Link>
        ) : <span className="day-neighbor-spacer" aria-hidden="true" />}
        {next ? (
          <Link
            className={`day-neighbor day-neighbor-next${next.thumbnail ? " day-neighbor--with-thumb" : ""}`}
            href={next.href}
            prefetch={false}
          >
            <span className="day-neighbor-copy">
              <span className="section-mark">下一日 →</span>
              <span className="serif day-neighbor-title">{next.title}</span>
            </span>
            {next.thumbnail ? (
              <CardThumbnail thumbnail={next.thumbnail} className="day-neighbor-thumb" sizes="64px" />
            ) : null}
          </Link>
        ) : null}
      </nav>
      <footer className="detail-footer reading-wrap">
        <Link className="text-link" href={monthHref}>回到 {monthLabel}</Link>
      </footer>
    </article>
  );
}
