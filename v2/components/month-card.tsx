import Link from "next/link";
import type { MonthIndexEntry } from "@/lib/memory-index";
import { isFromFamilyAlbum } from "@/lib/media/representative";
import { Photo } from "@/components/photo";

// One month as a tappable card on /memory: a cropped cover photo, the month and age, and the first
// line of the month's snapshot (or the first memory's title). No counts — the card is an invitation,
// not a summary.
export function MonthCard({ entry, blurb }: { entry: MonthIndexEntry; blurb?: string }) {
  const { chapter, href, preview, featured } = entry;
  // The month's face, in order of what the archive can actually say about a picture:
  //
  //   1. a featured memory's own lead — the only pictures with a recorded reason to be about him
  //      (lib/media/story-binding.ts), and therefore the only ones this card may present as such;
  //   2. failing that, a picture off the family's own camera roll rather than out of a group chat.
  //
  // Step 2 is a source preference and nothing more: a daycare conversation carries other people's
  // children, screenshots and receipts, and a camera roll mostly does not — but neither fact says
  // who is in the frame (lib/media/representative.ts). It is a cover, not a portrait, and it is
  // ordered after the evidence rather than in place of it. Neither → no image area, not a guess.
  const coverPhoto = featured.find((memory) => memory.lead)?.lead ?? preview.find(isFromFamilyAlbum);
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
