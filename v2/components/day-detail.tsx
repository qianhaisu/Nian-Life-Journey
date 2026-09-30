import Link from "next/link";
import { DayMaterial } from "@/components/day-material";
import { PhotoGrid } from "@/components/photo-grid";
import type { TimelineStory } from "@/lib/month-timeline";
import type { MediaRef } from "@/lib/memory-chapters";
import type { MonthContentDay } from "@/lib/month-content";
import type { Media, RawSource } from "@/lib/types";

// One edited day, read in full. Used by both entrances so they cannot drift apart: the day's own
// page (for days the Organizer never made an event for) and an old /events/<id> link (for the days
// whose several fragments were merged into one story).
//
// Photographs are ALL shown, not a first screen with a button. A month page is a place to skim, so
// it draws six and folds the rest behind 「+N」; a detail page is where somebody arrived to look at one day, so
// folding anything there is asking them to click to get what they came for. "All" is the curated
// set from MEMORY-03, re-gated on every render — never the day's whole raw roll.
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
  previous?: { href: string; title: string };
  next?: { href: string; title: string };
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

      {stories.length > 0 ? <section className="reading-wrap story-layer">{stories.map((story) => <div className="story-column" key={story.id}>
        {story.title ? <h2 className="serif">{story.title}</h2> : null}
        {story.paragraphs.map((text, index) => <p key={index}>{text}</p>)}
      </div>)}</section> : null}

      {/* The month page's grid (components/photo-grid.tsx), every photograph drawn: somebody came to
          this page to look at one day, so nothing is folded behind a 「+N」 here. Tapping opens the viewer. */}
      {photos.length > 0 ? (
        <div className="reading-wrap detail-supporting day-detail-photos">
          <PhotoGrid photos={photos} dateLabel={dateLabel} ageLabel={ageLabel} priority />
        </div>
      ) : null}

      <DayMaterial
        sources={sources}
        media={sourceMedia}
        speakerBySourceId={speakerBySourceId}
        deliverableIds={deliverableIds}
      />

      {mergedNote ? <p className="reading-wrap chapter-meta day-detail-merged">{mergedNote}</p> : null}

      <nav className="reading-wrap day-neighbors" aria-label="继续读日子">
        {previous ? <Link href={previous.href} prefetch={false}>← {previous.title}</Link> : <span />}
        {next ? <Link href={next.href} prefetch={false}>{next.title} →</Link> : null}
      </nav>
      <footer className="detail-footer reading-wrap">
        <Link className="text-link" href={monthHref}>回到 {monthLabel}</Link>
      </footer>
    </article>
  );
}
