import Link from "next/link";
import type { MonthIndexEntry } from "@/lib/memory-index";
import { Photo } from "@/components/photo";

// One month as a tappable card on /memory: a cropped cover photo, the month and age, and the first
// line of the month's snapshot (or the first memory's title). No counts — the card is an invitation,
// not a summary.
export function MonthCard({ entry, blurb }: { entry: MonthIndexEntry; blurb?: string }) {
  const { chapter, href, preview, featured } = entry;
  // The month's face comes from `preview`, and only from `preview`.
  //
  // 2026-09-13, 照片展示隔离. This used to reach for `featured.find(m => m.lead)?.lead` FIRST, on the
  // reasoning that a story's own lead is "the only picture with a recorded reason to be about him".
  // That reasoning was wrong in a way that only became visible when R8 published: a `media_binding`
  // says the picture belongs to those WORDS, not that it is a photograph of this child. So the card
  // was reading a claim off a record that does not make it — and it went around the gated cover
  // entirely (lib/publication-moments.ts builds `cover`/`preview` behind `isSubjectChecked`).
  //
  // Caught in acceptance, not by a test: `wechat-media:02b3ff49…` has an approved binding for
  // `event-r10-20260907-coldhot` and no subject check, and on publication it became 2026-09's card
  // cover on /memory — a cover slot, which is exactly what the isolation says a binding may not buy.
  //
  // `preview` is already ordered cover-first and every entry in it is subject-checked, so taking its
  // head keeps the old preference (a checked story lead still sorts first, because `cover` prefers
  // it) while losing the bypass. No checked picture → no image area, not a guess.
  const coverPhoto = preview[0];
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
