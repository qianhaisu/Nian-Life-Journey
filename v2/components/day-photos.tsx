"use client";

import { useState } from "react";
import { PhotoGallery } from "@/components/photo-viewer";
import type { MediaRef } from "@/lib/memory-chapters";

export const DAY_GROUP_PREVIEW_MAX = 6;

// 「这一天的照片」 — the photographs a chapter day left behind, read on that day instead of at the
// end of the month.
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

  return (
    <section className="day-photos" aria-label={`${dateLabel}的照片`}>
      <h3 className="section-mark">这一天的照片</h3>
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
