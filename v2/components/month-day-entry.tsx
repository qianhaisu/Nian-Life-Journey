import Link from "next/link";
import { DayHead } from "@/components/month-moment";
import { DayPhotos } from "@/components/day-photos";
import { PhotoGallery } from "@/components/photo-viewer";
import type { MediaRef } from "@/lib/memory-chapters";

// One day of an edited month: its date, one title, one piece of writing, then that day's pictures.
//
// The shape is the point. Before this, a day could arrive in three places — as a story card, as a
// separate 「这一天的照片」 group, and a third time inside the month-wide album at the bottom — so a
// reader met 9 月 8 日 four times over and each meeting showed some of the same photographs. Here a
// day happens once: one head, one body, one picture area holding every picture chosen for that day,
// story-bound and same-day alike, already de-duplicated by the caller.
//
// Where the pictures sit (2026-09-19 acceptance): they used to come AFTER all of a day's words, so a
// day with four paragraphs put a whole phone screen of text between the title and its first picture —
// the middle of a month page had no photographs in it at all. Now a day's pictures sit directly under
// its title, and the words read on below them.
//   - a LEAD day (lib/month-day-weight.ts picks a few per month) opens on one large photograph, then
//     its words, then the rest of its pictures as a strip;
//   - every other day keeps its strip but moves it up under the title.
// Which day leads is a richness proxy until someone marks real milestones — see that file.
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
  lead = false,
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
  /** This day opens on one large photograph and a larger title. */
  lead?: boolean;
}) {
  // A lead day is led by a photograph, not a clip: prefer the first still, fall back to whatever is first.
  const leadPhoto = lead ? (photos.find((item) => item.type !== "video") ?? photos[0]) : undefined;
  const rest = leadPhoto ? photos.filter((item) => item !== leadPhoto) : photos;
  const previewCount = Math.max(1, Math.min(firstScreenCount, photos.length));
  // The rest of a lead day's pictures: at least a small strip's worth, never the whole day.
  const restPreview = Math.max(3, previewCount - 1);

  return (
    <article className={lead ? "month-moment moment-day-entry moment-day-lead" : "month-moment moment-day-entry"}>
      <DayHead day={day} dateLabel={dateLabel} ageLabel={ageLabel} monthAgeLabel={monthAgeLabel} year={year} />
      <div className="moment-body">
        {title ? <h3 className="serif day-entry-title">{title}</h3> : null}
        {leadPhoto ? (
          <PhotoGallery photos={[leadPhoto]} heroIndex={0} heroClassName="moment-hero day-lead-photo" dateLabel={dateLabel} ageLabel={ageLabel} />
        ) : null}
        {!lead && photos.length > 0 ? (
          <DayPhotos photos={photos} dateLabel={dateLabel} ageLabel={ageLabel} previewCount={previewCount} quietLabel />
        ) : null}
        {/* Paragraphs are paragraphs. Nothing here inserts a line break to make a line land a
            certain way — the browser wraps, and the same text reads correctly at 390px and 1280px. */}
        {paragraphs.map((text, index) => (
          <p className="serif day-entry-text" key={index}>{text}</p>
        ))}
        {eventHref ? (
          <p className="chapter-meta"><Link className="text-link" href={eventHref}>读这一天的原记录 →</Link></p>
        ) : null}
      </div>
      {lead && rest.length > 0 ? (
        <DayPhotos photos={rest} dateLabel={dateLabel} ageLabel={ageLabel} previewCount={Math.min(restPreview, rest.length)} />
      ) : null}
    </article>
  );
}
