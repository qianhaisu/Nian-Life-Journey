import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dayLabel } from "@/components/month-moment";
import { Photo } from "@/components/photo";
import { PhotoGallery } from "@/components/photo-viewer";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildPreviewYear, confirmedPhotoIdsByEvent, monthlyReviewDraftsFrom, previewEventIdsFrom, type PreviewStory } from "@/lib/preview-reading";
import { renderOnDemand } from "@/lib/render-on-demand";
import type { MediaRef } from "@/lib/memory-chapters";

export async function generateMetadata({ params }: { params: Promise<{ year: string }> }): Promise<Metadata> {
  const { year } = await params;
  return { title: `${year} 年 · 试读`, robots: { index: false, follow: false } };
}

// One story as it reads in the private surface: the two clocks, the title, the picture if a reviewer
// recorded one, then the story whole. A draft says so on its own date line — the mark travels with
// the story rather than sitting once at the top of the page, because a reader scrolling a year will
// meet the story long after they have passed the header.
function PreviewStoryBlock({ story, year, monthAgeLabel }: { story: PreviewStory; year: string; monthAgeLabel?: string }) {
  const title = story.draft
    ? <h3 className="serif">{story.title}</h3>
    : <h3 className="serif"><Link href={`/events/${story.id}`}>{story.title}</Link></h3>;
  // The month heading above already carries the year and the month's age, so a day states only
  // what differs — the same rule the month pages use (components/month-moment.tsx DayHead).
  const showAge = story.signature.ageLabel && story.signature.ageLabel !== monthAgeLabel;
  return <article className={`month-moment preview-story${story.draft ? " is-draft" : ""}`}>
    <p className="month-day-date">
      <time dateTime={story.day}>{dayLabel(story.signature.dateLabel, year)}</time>
      {showAge ? <span>当时 {story.signature.ageLabel}</span> : null}
      {story.draft ? <span className="preview-draft-mark">草稿 · 未发布</span> : null}
    </p>
    <div className="moment-body">
      {title}
      {story.photo ? <Photo media={story.photo} variant="web" sizes="(max-width: 700px) 100vw, 760px" className="preview-photo" /> : null}
      {story.paragraphs.map((paragraph, index) => <p className="serif preview-paragraph" key={index}>{paragraph}</p>)}
    </div>
  </article>;
}

// A year read straight through, January first — the shape a book has and the month pages do not.
// Everything on this page is real: published stories exactly as the family sees them, plus the
// stories a reviewer marked readable in private (lib/preview-reading.ts). Nothing here publishes
// anything, and nothing here relaxes what the family's own pages are allowed to show.
export default async function PreviewYearPage({ params }: { params: Promise<{ year: string }> }) {
  await renderOnDemand();
  const { year } = await params;
  if (!/^\d{4}$/.test(year)) notFound();
  const archive = await loadFamilyArchiveOnDemand();
  const reviews = archive.store.qualityReviews ?? [];
  const leadById = new Map<string, MediaRef>();
  for (const chapter of archive.chapters) for (const month of chapter.months) for (const memory of month.memories) {
    if (memory.lead) leadById.set(memory.id, memory.lead);
  }
  const preview = buildPreviewYear({
    year,
    months: archive.chapters.find((item) => item.year === year)?.months ?? [],
    identities: archive.eventIdentities,
    publishedIds: new Set(archive.events.map((event) => event.id)),
    previewIds: previewEventIdsFrom(reviews),
    reviewDrafts: monthlyReviewDraftsFrom(reviews),
    photosByEvent: confirmedPhotoIdsByEvent(reviews),
    media: archive.media,
    leadById,
    vouchedPhotoIds: new Set([...archive.privilege.confirmed, ...(archive.privilege.checked ?? [])]),
    birthDay: archive.birthDay,
  });

  return <div className="preview-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href="/preview">← 试读</Link>
      <span className="section-mark">私下试读 · 未公开发布</span>
      <h1 className="serif">{year} 年</h1>
      {preview.ageSpan ? <p className="chapter-age">{preview.ageSpan}</p> : null}
      <p className="chapter-standfirst serif">从一月读到十二月。标着「草稿」的段落还没有发布，家人的页面上看不到。</p>
    </header>

    {preview.months.map((month) => {
      const quiet = month.stories.length === 0 && !month.review;
      return <section className={`preview-month${quiet ? " is-quiet" : ""}`} key={month.month} aria-labelledby={`month-${month.month}`}>
        <h2 id={`month-${month.month}`} className="preview-month-head serif">
          <Link href={`/memory/${month.month.slice(0, 4)}/${month.month.slice(5, 7)}`}>{month.label}</Link>
          {month.ageLabel ? <span className="chapter-meta">当时 {month.ageLabel}</span> : null}
        </h2>
        {/* 原则七: the month's own review, in the private draft it is. A month without one shows
            nothing here — a quiet index entry rather than a review assembled out of counts. */}
        {month.review ? <div className="preview-review">
          <p className="section-mark">这个月的张年 · 回顾初稿</p>
          <SnapshotSummary text={month.review.join("\n")} className="chapter-summary serif" />
          {/* 原则七 asks a review for a few meaningful pictures. These are only the ones somebody
              recorded a reason for (lib/preview-reading.ts); a month with none reads as text, which
              is the honest answer rather than a strip chosen for falling in the right month. */}
          {month.reviewPhotos.length > 0 ? <PhotoGallery photos={month.reviewPhotos} dateLabel={month.label} ageLabel={month.ageLabel} stripSizes="(max-width: 700px) 45vw, 240px" /> : null}
        </div> : null}
        {month.stories.map((story) => <PreviewStoryBlock key={story.id} story={story} year={year} monthAgeLabel={month.ageLabel} />)}
      </section>;
    })}

    {!preview.readable ? <p className="serif archive-empty">这一年还没有可以从头读的内容。</p> : null}
    <p className="chapter-meta"><Link className="text-link" href="/preview">回到试读入口</Link></p>
  </div>;
}
