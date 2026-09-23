import Link from "next/link";
import { DayHead } from "@/components/day-head";
import { DayPhotos } from "@/components/day-photos";
import type { TimelineDay } from "@/lib/month-timeline";

// One day of an edited month, and the only shape a day has on the month page (2026-09-23):
//
//   date · age → title → the day's words → any story folded into this day → photo grid → 读这一天的原记录 →
//
// Every day, in that order. Before this a day's pictures moved around — above the words on an
// ordinary day, a large photograph first on a "lead" day, and a strip that only became a grid once
// expanded — so no two days read alike and 「这一天的照片」 sat sometimes before the text, sometimes
// after it. A lead day (lib/month-day-weight.ts) is still marked, by a larger title; its pictures sit
// where everyone's do.
//
// Stories: a published memory that happened on a day the content file had already written is read
// inside that day (lib/month-timeline.ts), under its own small heading, with only what the day did not
// already say. Its photographs join the day's grid.
//
// A day with no pictures still renders: the words belong in the timeline on their own, and nothing is
// borrowed from an unreviewed set to fill the space.
//
// No "use client": this renders on the server for the first week, and inside MonthTimeline (a client
// component) for every week loaded after it.
export function MonthDayEntry({ entry, year, monthAgeLabel }: {
  entry: TimelineDay;
  year: string;
  monthAgeLabel?: string;
}) {
  return (
    <article className={entry.lead ? "month-moment moment-day-entry moment-day-lead" : "month-moment moment-day-entry"}>
      <DayHead day={entry.day} dateLabel={entry.dateLabel} ageLabel={entry.ageLabel} monthAgeLabel={monthAgeLabel} year={year} />
      <div className="moment-body">
        {entry.title ? <h3 className="serif day-entry-title">{entry.title}</h3> : null}
        {/* Paragraphs are paragraphs: the browser wraps, at 390px and at 1280px alike. */}
        {entry.paragraphs.map((text, index) => <p className="serif day-entry-text" key={index}>{text}</p>)}
        {entry.stories.map((story) => (
          <div className="day-entry-story" key={story.id}>
            {story.title ? <h4 className="serif day-entry-story-title"><Link href={story.href} prefetch={false}>{story.title}</Link></h4> : null}
            {story.paragraphs.map((text, index) => <p className="serif day-entry-text" key={index}>{text}</p>)}
          </div>
        ))}
        {entry.photos.length > 0 ? <DayPhotos photos={entry.photos} dateLabel={entry.dateLabel} ageLabel={entry.ageLabel} quietLabel /> : null}
        {/* prefetch={false} (2026-09-20): a month page holds one of these per day, and Next's default
            prefetch turned each into a real server render of that day — twenty-odd cold renders queued
            in front of the reader's photographs. Clicking still costs exactly one render. */}
        <p className="chapter-meta day-entry-more"><Link className="text-link" href={entry.href} prefetch={false}>读这一天的原记录 →</Link></p>
      </div>
    </article>
  );
}
