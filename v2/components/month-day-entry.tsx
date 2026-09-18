import Link from "next/link";
import { DayHead } from "@/components/month-moment";
import { DayPhotos } from "@/components/day-photos";
import type { MediaRef } from "@/lib/memory-chapters";

// One day of an edited month: its date, one title, one piece of writing, then that day's pictures.
//
// The shape is the point. Before this, a day could arrive in three places — as a story card, as a
// separate 「这一天的照片」 group, and a third time inside the month-wide album at the bottom — so a
// reader met 9 月 8 日 four times over and each meeting showed some of the same photographs. Here a
// day happens once: one head, one body, one picture area holding every picture chosen for that day,
// story-bound and same-day alike, already de-duplicated by the caller.
//
// A day with no pictures still renders. 9 月 13 日 has words from the family and photographs that no
// reviewer has cleared yet: the words belong in the timeline on their own, and nothing is borrowed
// from the unreviewed set to fill the space.
export function MonthDayEntry({
  day,
  dateLabel,
  ageLabel,
  monthAgeLabel,
  year,
  title,
  paragraphs,
  photos,
  firstScreenCount,
  eventHref,
}: {
  day: string;
  dateLabel: string;
  ageLabel?: string;
  monthAgeLabel?: string;
  year: string;
  title: string | null;
  paragraphs: string[];
  photos: MediaRef[];
  firstScreenCount: number;
  eventHref?: string;
}) {
  return (
    <article className="month-moment moment-day-entry">
      <DayHead day={day} dateLabel={dateLabel} ageLabel={ageLabel} monthAgeLabel={monthAgeLabel} year={year} />
      <div className="moment-body">
        {title ? <h3 className="serif day-entry-title">{title}</h3> : null}
        {/* Paragraphs are paragraphs. Nothing here inserts a line break to make a line land a
            certain way — the browser wraps, and the same text reads correctly at 390px and 1280px. */}
        {paragraphs.map((text, index) => (
          <p className="serif day-entry-text" key={index}>{text}</p>
        ))}
        {eventHref ? (
          <p className="chapter-meta"><Link className="text-link" href={eventHref}>读这一天的原记录 →</Link></p>
        ) : null}
      </div>
      {photos.length > 0 ? (
        <DayPhotos
          photos={photos}
          dateLabel={dateLabel}
          ageLabel={ageLabel}
          previewCount={Math.max(1, Math.min(firstScreenCount, photos.length))}
        />
      ) : null}
    </article>
  );
}
