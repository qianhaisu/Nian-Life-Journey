import Link from "next/link";
import type { MonthIndexEntry } from "@/lib/memory-index";
import { isPortraitOfZhangnian } from "@/lib/media/representative";
import { Photo } from "@/components/photo";

// One month as a tappable card on /memory: a cropped cover photo, the month and age, and the first
// line of the month's snapshot (or the first memory's title). No counts — the card is an invitation,
// not a summary.
export function MonthCard({ entry, blurb }: { entry: MonthIndexEntry; blurb?: string }) {
  const { chapter, href, preview, featured } = entry;
  // Only quark family-album photos are representative of 张年 — WeChat group/daycare shots
  // may be vouched for evidence but the subject is often not him. No quark photo → no image area.
  const coverPhoto = preview.find(isPortraitOfZhangnian);
  const cardBlurb = blurb ?? featured[0]?.title;

  return (
    <Link href={href} className="month-card scroll-reveal">
      {coverPhoto ? (
        <div className="month-card-photo">
          <Photo
            media={coverPhoto}
            variant="web"
            sizes="(max-width: 720px) calc(100vw - 32px), 340px"
          />
        </div>
      ) : null}
      <div className="month-card-body">
        <span className="serif month-card-label">{chapter.shortLabel}</span>
        {chapter.ageLabel ? <span className="month-card-age">当时 {chapter.ageLabel}</span> : null}
        {cardBlurb ? <p className="month-card-blurb">{cardBlurb}</p> : null}
      </div>
    </Link>
  );
}
