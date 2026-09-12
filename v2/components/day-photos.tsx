"use client";

import { useState } from "react";
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
}: {
  photos: MediaRef[];
  dateLabel: string;
  ageLabel?: string;
  previewCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  if (photos.length === 0) return null;

  const preview = photos.slice(0, previewCount);
  const rest = photos.slice(previewCount);
  const shown = expanded ? photos : preview;
  const kind = dayMediaKind(shown);

  return (
    <section className="day-photos" aria-label={`${dateLabel}的${kind}`}>
      <h3 className="section-mark">这一天的{kind}</h3>
      <PhotoGallery photos={shown} dateLabel={dateLabel} ageLabel={ageLabel} stripSizes="(max-width: 700px) 30vw, 200px" />
      {rest.length > 0 && !expanded ? (
        <p className="chapter-meta day-photos-expand">
          <button className="text-link" onClick={() => setExpanded(true)}>
            这一天还有 {rest.length} 张——点此展开
          </button>
        </p>
      ) : null}
    </section>
  );
}
