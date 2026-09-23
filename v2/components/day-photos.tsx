"use client";

import { useState } from "react";
import { PhotoGrid } from "@/components/photo-grid";
import type { MediaRef } from "@/lib/memory-chapters";

export const DAY_GROUP_PREVIEW_MAX = 6;

// What to call this group, given what is in it. The month album already names itself this way
// (app/memory/[year]/[month]/page.tsx), and the day group had been left saying 「照片」 over a set
// that held the archive's one playable clip — on 2025-11-22 the word 「视频」 appeared nowhere on
// the page at all.
//
// It reads the set that is on the page right now, not the day's whole list: a clip still folded
// behind 「点此展开」 has not been shown to anyone yet, and a heading that promised it would be
// promising something the reader cannot see.
export function dayMediaKind(shown: { type?: string }[]): string {
  const hasVideo = shown.some((item) => item.type === "video");
  const hasPhoto = shown.some((item) => item.type !== "video");
  if (hasVideo && !hasPhoto) return "视频";
  return hasVideo ? "照片与视频" : "照片";
}

// 「这一天的照片」, or 「这一天的照片与视频」, or 「这一天的视频」 — a day's pictures, read on that day.
// dayMediaKind above picks which.
//
// Always a grid now (2026-09-23, Teddy: 「图片排版要整齐」). The first screen used to be a strip of
// thumbnails that only turned into a grid once expanded, so the same day looked like two different
// designs depending on one click. Now it is one grid from the start: up to DAY_GROUP_PREVIEW_MAX
// cells, the last one carrying 「展开」 (no count, 原则三) when there are more, and tapping it lays the rest out in the
// same grid. Every picture that mounts is lazy, so the unexpanded day costs only what it draws.
export function DayPhotos({
  photos,
  dateLabel,
  ageLabel,
  previewCount = DAY_GROUP_PREVIEW_MAX,
  quietLabel = false,
}: {
  photos: MediaRef[];
  dateLabel: string;
  ageLabel?: string;
  previewCount?: number;
  /**
   * The grid sits inside its own day, so 「这一天的照片」 would only repeat what the pictures already
   * say — repeated once per day it became wallpaper (2026-09-19 acceptance: 14–26 times on a month
   * page). The heading stays in the DOM for screen readers; it is just not drawn.
   */
  quietLabel?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (photos.length === 0) return null;

  const limited = !expanded && photos.length > previewCount;
  const kind = dayMediaKind(limited ? photos.slice(0, previewCount) : photos);

  return (
    <section className="day-photos" aria-label={`${dateLabel}的${kind}`}>
      <h3 className={quietLabel ? "section-mark visually-hidden" : "section-mark"}>这一天的{kind}</h3>
      <PhotoGrid
        photos={photos}
        dateLabel={dateLabel}
        ageLabel={ageLabel}
        limit={limited ? previewCount : undefined}
        onExpand={() => setExpanded(true)}
      />
      {/* The way back: a reader who opened a 30-picture day should not have to scroll past all of it. */}
      {expanded && photos.length > previewCount ? (
        <p className="chapter-meta day-photos-expand">
          <button className="text-link" onClick={() => setExpanded(false)}>收起这一天的照片</button>
        </p>
      ) : null}
    </section>
  );
}
