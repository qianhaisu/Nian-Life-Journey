import Link from "next/link";
import { DayMaterial } from "@/components/day-material";
import { PhotoGallery } from "@/components/photo-viewer";
import type { MediaRef } from "@/lib/memory-chapters";
import type { MonthContentDay } from "@/lib/month-content";
import type { Media, RawSource } from "@/lib/types";

// One edited day, read in full. Used by both entrances so they cannot drift apart: the day's own
// page (for days the Organizer never made an event for) and an old /events/<id> link (for the days
// whose several fragments were merged into one story).
//
// Photographs are ALL shown, not a first screen with a button. A month page is a place to skim, so
// it opens three and folds the rest; a detail page is where somebody arrived to look at one day, so
// folding anything there is asking them to click to get what they came for. "All" is the curated
// set from MEMORY-03, re-gated on every render — never the day's whole raw roll.
export function DayDetail({
  day, dateLabel, ageLabel, title, paragraphs, photos, sources, sourceMedia,
  speakerBySourceId, deliverableIds, monthHref, monthLabel, mergedNote,
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
}) {
  return (
    <article className="detail-page day-detail">
      <header className="reading-wrap detail-head">
        <Link className="back-link" href={monthHref}>← 回到 {monthLabel}</Link>
        <p className="detail-signature day-detail-when">
          <time dateTime={day.day}>{dateLabel}</time>
          {ageLabel ? <span>当时 {ageLabel}</span> : null}
        </p>
        <h1 className="serif day-detail-title">{title}</h1>
      </header>

      {paragraphs.length > 0 ? (
        <section className="story-layer reading-wrap">
          <div className="story-column">
            {paragraphs.map((text, index) => (
              <p key={index} className={index === 0 ? "story-lead" : undefined}>{text}</p>
            ))}
          </div>
        </section>
      ) : null}

      {photos.length > 0 ? (
        <div className="reading-wrap detail-supporting day-detail-photos">
          <PhotoGallery
            photos={photos}
            heroIndex={0}
            heroClassName="detail-hero"
            dateLabel={dateLabel}
            ageLabel={ageLabel}
            priority
            heroSizes="(max-width: 700px) 100vw, 1120px"
            stripSizes="(max-width: 700px) 30vw, 200px"
          />
        </div>
      ) : null}

      <DayMaterial
        sources={sources}
        media={sourceMedia}
        speakerBySourceId={speakerBySourceId}
        deliverableIds={deliverableIds}
      />

      {mergedNote ? <p className="reading-wrap chapter-meta day-detail-merged">{mergedNote}</p> : null}

      <footer className="detail-footer reading-wrap">
        <Link className="text-link" href={monthHref}>回到 {monthLabel}</Link>
      </footer>
    </article>
  );
}
