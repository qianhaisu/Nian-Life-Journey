"use client";

import Image from "next/image";
import { useState, useCallback } from "react";
import { ViewerModal, videoFrameStyle, type GalleryPhoto } from "@/components/photo-viewer";
import { VideoPlayer } from "@/components/video-player";

// Smart grid layout for 1–9+ photos.
//
// Layout rules:
//   1 photo  — centred, max-height 400px
//   2 photos — side by side, equal cropped height
//   3 photos — 1 large left (2/3) + 2 small right (1/3, stacked)
//   4 photos — 2 × 2
//   5 photos — top row 3, bottom row 2
//   6 photos — 2 rows of 3
//   7–8      — top row 4, bottom row 3 / 4
//   9        — 3 × 3
//   10+      — 3 × 3 with last cell showing "+N"
//
// object-fit: cover throughout, 4px gap.
// Videos take the hero slot when present.
// Clicking any still opens the shared ViewerModal.

const GAP = 4; // px

// Grid cell: click → viewer (stills only), play in place (video)
function Cell({
  photo,
  onClick,
  sizes,
  priority = false,
  overlay,
}: {
  photo: GalleryPhoto;
  onClick?: () => void;
  sizes: string;
  priority?: boolean;
  overlay?: string;
}) {
  const isVideo = photo.type === "video";
  if (isVideo) {
    return (
      <figure className="pg-cell pg-cell-video" style={videoFrameStyle(photo)}>
        <VideoPlayer mediaId={photo.id} alt={photo.alt} durationSeconds={photo.durationSeconds} />
      </figure>
    );
  }
  return (
    <figure
      className="pg-cell"
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? "打开照片" : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <Image
        src={photo.src}
        alt={photo.alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized
        style={{ objectFit: "cover" }}
      />
      {overlay ? <span className="pg-overlay">{overlay}</span> : null}
    </figure>
  );
}

export function PhotoGrid({
  photos,
  dateLabel,
  ageLabel,
  priority = false,
}: {
  photos: GalleryPhoto[];
  dateLabel: string;
  ageLabel?: string;
  priority?: boolean;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openViewer = useCallback((idx: number) => setViewerIndex(idx), []);
  const closeViewer = useCallback(() => setViewerIndex(null), []);

  if (photos.length === 0) return null;

  // Stills-only reel for the viewer (videos play in place)
  const stillPhotos = photos.filter((p) => p.type !== "video");

  function viewerIdxFor(originalIdx: number): number {
    const still = photos[originalIdx];
    return Math.max(0, stillPhotos.indexOf(still));
  }

  function openStill(idx: number) {
    const photo = photos[idx];
    if (photo.type === "video") return;
    openViewer(viewerIdxFor(idx));
  }

  // Limit display to 9, show "+N" on the 9th cell
  const MAX_DISPLAY = 9;
  const displayed = photos.slice(0, MAX_DISPLAY);
  const extra = photos.length - MAX_DISPLAY;

  const n = displayed.length;

  // Sizes hint — rough: most cells are 1/2 or 1/3 of the reading column (max ~760px)
  const halfSizes = "(max-width: 700px) 50vw, 380px";
  const thirdSizes = "(max-width: 700px) 33vw, 250px";
  const twoThirdSizes = "(max-width: 700px) 66vw, 506px";

  // ── 1 photo ──────────────────────────────────────────────────────────────
  if (n === 1) {
    return (
      <>
        <div className="pg pg-1">
          <Cell photo={displayed[0]} onClick={() => openStill(0)} sizes="(max-width: 700px) 100vw, 760px" priority={priority} />
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  // ── 2 photos ──────────────────────────────────────────────────────────────
  if (n === 2) {
    return (
      <>
        <div className="pg pg-2">
          {displayed.map((p, i) => <Cell key={p.id} photo={p} onClick={() => openStill(i)} sizes={halfSizes} priority={priority && i === 0} />)}
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  // ── 3 photos: left large (2/3) + right column with 2 stacked ─────────────
  if (n === 3) {
    return (
      <>
        <div className="pg pg-3">
          <Cell key={displayed[0].id} photo={displayed[0]} onClick={() => openStill(0)} sizes={twoThirdSizes} priority={priority} />
          <div className="pg-col">
            <Cell key={displayed[1].id} photo={displayed[1]} onClick={() => openStill(1)} sizes={thirdSizes} />
            <Cell key={displayed[2].id} photo={displayed[2]} onClick={() => openStill(2)} sizes={thirdSizes} />
          </div>
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  // ── 4 photos: 2 × 2 ──────────────────────────────────────────────────────
  if (n === 4) {
    return (
      <>
        <div className="pg pg-4">
          {displayed.map((p, i) => <Cell key={p.id} photo={p} onClick={() => openStill(i)} sizes={halfSizes} priority={priority && i === 0} />)}
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  // ── 5–6 photos: top row of 3, bottom row of 2–3 ──────────────────────────
  if (n <= 6) {
    return (
      <>
        <div className="pg pg-3-row">
          {displayed.map((p, i) => <Cell key={p.id} photo={p} onClick={() => openStill(i)} sizes={thirdSizes} priority={priority && i === 0} />)}
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  // ── 7–9+ photos: 3 × 3 with optional +N overlay ───────────────────────────
  return (
    <>
      <div className="pg pg-3-row">
        {displayed.map((p, i) => {
          const isLast = i === MAX_DISPLAY - 1;
          const overlay = isLast && extra > 0 ? `+${extra}` : undefined;
          return <Cell key={p.id} photo={p} onClick={() => openStill(i)} sizes={thirdSizes} priority={priority && i === 0} overlay={overlay} />;
        })}
      </div>
      {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
    </>
  );
}
