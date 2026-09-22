"use client";

import { useState } from "react";
import { PhotoGrid } from "@/components/photo-grid";
import { PhotoGallery } from "@/components/photo-viewer";
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

// 「这一天的照片」, or 「这一天的照片与视频」, or 「这一天的视频」 — what a chapter day left behind,
// read on that day instead of at the end of the month. dayMediaKind above picks which.
//
// Deliberately not a story's illustration. It renders outside the story card, under the day's own
// neutral heading, and says nothing about which story any picture belongs to — a story whose
// photograph was taken away still shows none of its own. What this section claims is only the date,
// which is the one relation every one of these pictures actually has on record.
//
// Unlike ArchiveExpander this needs no server action: the day's photographs are already composed on
// the server and passed whole. The rest stay unmounted until asked for, so the initial HTML carries
// a preview rather than a wall (原则五), and every picture that does mount is lazy — expanding costs
// requests only for what comes into view.
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
   * The strip sits directly under its own day's title, so 「这一天的照片」 would only repeat what the
   * pictures already say — and repeated once per day it became wallpaper (2026-09-19 acceptance:
   * 14–26 times on a month page). The heading stays in the DOM for screen readers and for the
   * section's accessible name; it is just not drawn.
   */
  quietLabel?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (photos.length === 0) return null;

  const preview = photos.slice(0, previewCount);
  const rest = photos.slice(previewCount);
  const shown = expanded ? photos : preview;
  const kind = dayMediaKind(shown);

  return (
    <section className="day-photos" aria-label={`${dateLabel}的${kind}`}>
      <h3 className={quietLabel ? "section-mark visually-hidden" : "section-mark"}>这一天的{kind}</h3>
      {/* P-1: PhotoGrid for smart layout; fall back to PhotoGallery strip when preview only */}
      {expanded || rest.length === 0 ? (
        <PhotoGrid photos={shown} dateLabel={dateLabel} ageLabel={ageLabel} />
      ) : (
        <PhotoGallery photos={shown} dateLabel={dateLabel} ageLabel={ageLabel} stripSizes="(max-width: 700px) 30vw, 200px" />
      )}
      {/* One control, in place, and it goes both ways. Expanding used to be one-way: a reader who
          opened a 30-picture day had no way back except scrolling past all of it. */}
      {rest.length > 0 ? (
        <p className="chapter-meta day-photos-expand">
          <button className="text-link" onClick={() => setExpanded((open) => !open)}>
            {expanded ? "收起这一天的照片" : "展开这一天的其他照片"}
          </button>
        </p>
      ) : null}
    </section>
  );
}
