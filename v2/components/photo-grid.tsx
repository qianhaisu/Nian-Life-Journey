"use client";

import Image from "next/image";
import { useState, useCallback } from "react";
import { ViewerModal, videoFrameStyle, type GalleryPhoto } from "@/components/photo-viewer";
import { VideoPlayer } from "@/components/video-player";
import { mediaDeliveryUrl } from "@/lib/media/paths";

// Smart grid layout for any number of photos.
//
// Layout rules:
//   1 photo  — centred, max-height 400px
//   2 photos — side by side, equal cropped height
//   3 photos — 1 large left (2/3) + 2 small right (1/3, stacked)
//   4 photos — 2 × 2
//   5+       — 3-column rows of squares
//
// `limit` (the month page uses 6): with more photos than that, only `limit` cells are drawn and the
// last one carries a light veil and 「展开」 — never a count (原则三); tapping it calls `onExpand`, which
// shows them all.
// Without `limit` every photo is drawn (the day's own page, and a day the reader already opened).
//
// object-fit: cover throughout, 4px gap. Clicking any still opens the shared ViewerModal, whose reel
// is always every still of the day — including the ones a limited grid has not drawn yet.

// Grid cell: click → viewer (stills only), play in place (video)
function Cell({
  photo,
  onClick,
  sizes,
  priority = false,
  onMore,
  alone = false,
  large = alone,
}: {
  alone?: boolean;
  large?: boolean;
  photo: GalleryPhoto;
  onClick?: () => void;
  sizes: string;
  priority?: boolean;
  /** This cell is the last one drawn: a light veil with a real 「展开」 button that opens the rest. */
  onMore?: () => void;
}) {
  const isVideo = photo.type === "video";
  // A grid cell is at most a third or a half of the reading column, and the grid is what every day
  // shows by default — so a small cell asks for the ~480px thumbnail, derived from the id the way
  // components/photo.tsx does (`thumbnailSrc` is null on every WeChat row). A missing thumbnail
  // derivative falls back to the full file rather than leaving a hole. A picture standing alone, or
  // the large cell of three, gets the full file from the start.
  const [full, setFull] = useState(large);
  const src = isVideo ? (photo.posterSrc ?? mediaDeliveryUrl(photo.id, "poster")) : full ? photo.src : (photo.thumbnailSrc ?? mediaDeliveryUrl(photo.id, "thumbnail"));
  // A video under 「展开」 is drawn by its poster like a still: the cell's job there is to open the rest.
  if (isVideo && !onMore) {
    return (
      // Only a video standing alone keeps its own frame; inside a grid it takes the cell's shape like
      // every other picture, or its row runs taller than its neighbours.
      <figure className="pg-cell pg-cell-video" style={alone ? videoFrameStyle(photo) : undefined}>
        <VideoPlayer mediaId={photo.id} alt={photo.alt} durationSeconds={photo.durationSeconds} />
      </figure>
    );
  }
  return (
    <figure
      className="pg-cell"
      role={onClick && !onMore ? "button" : undefined}
      tabIndex={onClick && !onMore ? 0 : undefined}
      aria-label={onClick && !onMore ? "打开照片" : undefined}
      onClick={onMore ? undefined : onClick}
      onKeyDown={onClick && !onMore ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      <Image
        key={src}
        src={src}
        alt={photo.alt}
        fill
        sizes={sizes}
        priority={priority}
        unoptimized
        style={{ objectFit: "cover" }}
        onError={() => { if (!full) setFull(true); }}
      />
      {/* 原则三：展开控件只说它做什么，不报还剩几张。 */}
      {onMore ? <button type="button" className="pg-more" onClick={onMore} aria-label="展开这一天的其他照片">展开</button> : null}
    </figure>
  );
}

export function PhotoGrid({
  photos,
  dateLabel,
  ageLabel,
  priority = false,
  limit,
  onExpand,
}: {
  photos: GalleryPhoto[];
  dateLabel: string;
  ageLabel?: string;
  priority?: boolean;
  /** Draw at most this many cells; the last one becomes 「展开」. Only honoured for 5 or more cells. */
  limit?: number;
  /** Called when 「展开」 is tapped. */
  onExpand?: () => void;
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

  const limited = limit !== undefined && photos.length > limit;
  const displayed = limited ? photos.slice(0, limit) : photos;

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
          <Cell photo={displayed[0]} onClick={() => openStill(0)} sizes="(max-width: 700px) 100vw, 760px" priority={priority} alone />
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
          <Cell key={displayed[0].id} photo={displayed[0]} onClick={() => openStill(0)} sizes={twoThirdSizes} priority={priority} large />
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

  // ── 5+ photos: 3-column rows, the last drawn cell carrying 「展开」 when limited ──
  return (
    <>
      <div className="pg pg-3-row">
        {displayed.map((p, i) => {
          const isMore = limited && i === n - 1;
          return <Cell
            key={p.id}
            photo={p}
            onClick={() => openStill(i)}
            onMore={isMore ? onExpand : undefined}
            sizes={thirdSizes}
            priority={priority && i === 0}
          />;
        })}
      </div>
      {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
    </>
  );
}
