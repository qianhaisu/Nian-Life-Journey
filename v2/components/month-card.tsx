import type { CSSProperties } from "react";
import Link from "next/link";
import type { MonthIndexEntry } from "@/lib/memory-index";
import type { MediaRef } from "@/lib/memory-chapters";
import { Photo } from "@/components/photo";
import { monthAgeQualifier } from "@/lib/time-signature";
import { productToday } from "@/lib/time-truth";

// One month as a tappable card on /memory: a cropped cover photo, the month and age, and the first
// line of the month's snapshot (or the first memory's title). No counts — the card is an invitation,
// not a summary.
export function MonthCard({ entry, blurb, cover, coverFocal, coverFrame }: {
  entry: MonthIndexEntry; blurb?: string; cover?: MediaRef;
  /** Where an edited cover's crop sits, measured for that photograph in the real card at both widths. */
  coverFocal?: { mobilePercent: number; desktopPercent: number };
  coverFrame?: "square" | "full";
}) {
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
  // `cover` is an edited month's chosen face. The caller only passes one that already cleared the
  // same gate `preview` is built behind (subject-checked, deliverable, not store_only), so this is a
  // choice among pictures the card was allowed to show — not a way around the gate.
  const coverPhoto = cover ?? preview[0];
  const cardBlurb = blurb ?? featured[0]?.title;
  // D1：没有封面照片的卡（通常是刚开始、内容还很少的当前月）不该占跟有照片的卡一样高的地方——
  // 网格默认把同一行的卡拉伸到等高（globals.css `.memory-month-grid`），没有照片区块的卡会被拉出
  // 一截自己的纯白背景，看着像一张空白卡。加一个 compact 类，配合 CSS 让它按自己内容的高度显示。
  const compact = !coverPhoto;

  return (
    <Link href={href} className={`month-card scroll-reveal${compact ? " month-card--compact" : ""}`}>
      {coverPhoto ? (
        <div
          className={`month-card-photo${cover && coverFrame ? ` month-card-photo--${coverFrame}` : ""}`}
          // Only an edited cover carries its own focal point; every other card keeps the stylesheet's
          // 30% / 45%, which were measured on September's face and are not a rule for other photos.
          style={cover && coverFocal ? {
            "--card-focal-mobile": `${coverFocal.mobilePercent}%`,
            "--card-focal-desktop": `${coverFocal.desktopPercent}%`,
          } as CSSProperties : undefined}
        >
          <Photo
            media={coverPhoto}
            variant={cover && coverFrame ? "web" : "thumbnail"}
            fit={cover && coverFrame === "full" ? "natural" : "crop"}
            sizes="(max-width: 720px) calc(100vw - 32px), 340px"
          />
        </div>
      ) : null}
      <div className="month-card-body">
        <span className="serif month-card-label">{chapter.shortLabel}</span>
        {/* B1：当前月读「现在」，历史月份读「当时」。 */}
        {chapter.ageLabel ? <span className="month-card-age">{monthAgeQualifier(chapter.month, productToday())} {chapter.ageLabel}</span> : null}
        {cardBlurb ? <p className="month-card-blurb">{cardBlurb}</p> : null}
      </div>
    </Link>
  );
}
