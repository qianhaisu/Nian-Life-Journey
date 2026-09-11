import Link from "next/link";
import type { MonthIndexEntry } from "@/lib/memory-index";
import { isFromFamilyAlbum } from "@/lib/media/representative";
import { Photo } from "@/components/photo";

// One month as a tappable card on /memory: a cropped cover photo, the month and age, and the first
// line of the month's snapshot (or the first memory's title). No counts — the card is an invitation,
// not a summary.
export function MonthCard({ entry, blurb }: { entry: MonthIndexEntry; blurb?: string }) {
  const { chapter, href, preview, featured } = entry;
  // Prefer a picture off the family's own camera roll over one out of a group chat: a daycare
  // conversation carries other people's children, screenshots and receipts. It is a source
  // preference, not a claim that 张年 is in the frame (lib/media/representative.ts) — no
  // family-album photo in the preview means no image area rather than a guessed one.
  const coverPhoto = preview.find(isFromFamilyAlbum);
  const cardBlurb = blurb ?? featured[0]?.title;

  return (
    <Link href={href} className="month-card scroll-reveal">
      {coverPhoto ? (
        <div className="month-card-photo">
          <Photo
            media={coverPhoto}
            variant="thumbnail"
            fit="crop"
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
