"use client";

import Image from "next/image";
import { useState, useCallback } from "react";
import { ViewerModal, videoFrameStyle, type GalleryPhoto } from "@/components/photo-viewer";
import { VideoPlayer } from "@/components/video-player";
import { mediaDeliveryUrl } from "@/lib/media/paths";

// Editorial grid layout for any number of photos:
//   1 photo  — single plate, natural aspect capped at 460px
//   2 photos — 2 equal plates side by side
//   3 photos — 1 large plate left (2fr) + 2 stacked right (1fr)
//   4 photos — 2 × 2 square plates
//   6 or 9   — 3-column hero-plate L-grid: photo 0 spans 2×2, remaining 5 or 8 wrap flush around it (zero empty slots)
//   other 5+ — 6-column flush mosaic: leading 2 (when n % 3 === 2) or 4 (when n % 3 === 1) span 3 cols, remaining span 2 cols (zero orphan slots)
//
// `limit` (the month page uses 6): with more photos than that, only `limit` cells are drawn and the
// last one carries a light veil and 「展开」 — never a count (原则三).

function Cell({
  photo,
  onClick,
  ariaLabel,
  className = "",
  sizes,
  priority = false,
  onMore,
  alone = false,
  large = alone,
}: {
  alone?: boolean;
  large?: boolean;
  className?: string;
  ariaLabel?: string;
  photo: GalleryPhoto;
  onClick?: () => void;
  sizes: string;
  priority?: boolean;
  onMore?: () => void;
}) {
  const isVideo = photo.type === "video";
  const [full, setFull] = useState(large);
  const [loaded, setLoaded] = useState(false);
  const src = isVideo ? (photo.posterSrc ?? mediaDeliveryUrl(photo.id, "poster")) : full ? photo.src : (photo.thumbnailSrc ?? mediaDeliveryUrl(photo.id, "thumbnail"));
  const cls = ["pg-cell", loaded ? "pg-cell--loaded" : "", className].filter(Boolean).join(" ");
  if (isVideo && !onMore) {
    return (
      <figure className={`${cls} pg-cell-video`} style={alone ? videoFrameStyle(photo) : undefined}>
        <VideoPlayer mediaId={photo.id} alt={photo.alt} durationSeconds={photo.durationSeconds} />
      </figure>
    );
  }
  return (
    <figure
      className={cls}
      role={onClick && !onMore ? "button" : undefined}
      tabIndex={onClick && !onMore ? 0 : undefined}
      aria-label={onClick && !onMore ? (ariaLabel ?? "打开照片") : undefined}
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
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        unoptimized
        style={{ objectFit: "cover" }}
        onLoad={() => setLoaded(true)}
        onError={() => { if (!full) setFull(true); }}
      />
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
  limit?: number;
  onExpand?: () => void;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openViewer = useCallback((idx: number) => setViewerIndex(idx), []);
  const closeViewer = useCallback(() => setViewerIndex(null), []);

  if (photos.length === 0) return null;

  const stillPhotos = photos.filter((p) => p.type !== "video");

  function viewerIdxFor(originalIdx: number): number {
    const still = photos[originalIdx];
    return Math.max(0, stillPhotos.indexOf(still));
  }

  function labelFor(originalIdx: number): string {
    return `打开第 ${viewerIdxFor(originalIdx) + 1} 张照片`;
  }

  function openStill(idx: number) {
    const photo = photos[idx];
    if (photo.type === "video") return;
    openViewer(viewerIdxFor(idx));
  }

  const limited = limit !== undefined && photos.length > limit;
  const displayed = limited ? photos.slice(0, limit) : photos;
  const n = displayed.length;

  const halfSizes = "(max-width: 700px) 50vw, 380px";
  const thirdSizes = "(max-width: 700px) 33vw, 250px";
  const twoThirdSizes = "(max-width: 700px) 66vw, 506px";

  if (n === 1) {
    return (
      <>
        <div className="pg pg-1">
          <Cell photo={displayed[0]} onClick={() => openStill(0)} ariaLabel={labelFor(0)} sizes="(max-width: 700px) 100vw, 760px" priority={priority} alone />
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  if (n === 2) {
    return (
      <>
        <div className="pg pg-2">
          {displayed.map((p, i) => <Cell key={p.id} photo={p} onClick={() => openStill(i)} ariaLabel={labelFor(i)} sizes={halfSizes} priority={priority && i === 0} />)}
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  if (n === 3) {
    return (
      <>
        <div className="pg pg-3">
          <Cell key={displayed[0].id} photo={displayed[0]} onClick={() => openStill(0)} ariaLabel={labelFor(0)} sizes={twoThirdSizes} priority={priority} />
          <div className="pg-col">
            <Cell key={displayed[1].id} photo={displayed[1]} onClick={() => openStill(1)} ariaLabel={labelFor(1)} sizes={thirdSizes} />
            <Cell key={displayed[2].id} photo={displayed[2]} onClick={() => openStill(2)} ariaLabel={labelFor(2)} sizes={thirdSizes} />
          </div>
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  if (n === 4) {
    return (
      <>
        <div className="pg pg-4">
          {displayed.map((p, i) => <Cell key={p.id} photo={p} onClick={() => openStill(i)} ariaLabel={labelFor(i)} sizes={halfSizes} priority={priority && i === 0} />)}
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  // 6 or 9 photos fill a 3-column grid seamlessly when photo 0 spans 2×2 (4 + 5 = 9 slots; 4 + 8 = 12 slots)
  if (n === 6 || n === 9) {
    return (
      <>
        <div className="pg pg-3-row pg-hero-grid">
          {displayed.map((p, i) => {
            const isMore = limited && i === n - 1;
            const isHero = i === 0;
            return <Cell
              key={p.id}
              className={isHero ? "pg-cell-hero" : ""}
              photo={p}
              onClick={() => openStill(i)}
              ariaLabel={labelFor(i)}
              onMore={isMore ? onExpand : undefined}
              sizes={isHero ? twoThirdSizes : thirdSizes}
              priority={priority && isHero}
            />;
          })}
        </div>
        {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
      </>
    );
  }

  // 5, 7, 8, 10+ photos: 6-column flush mosaic without orphan cells
  const wideLeadCount = n % 3 === 2 ? 2 : n % 3 === 1 ? 4 : 0;
  return (
    <>
      <div className="pg pg-mosaic">
        {displayed.map((p, i) => {
          const isMore = limited && i === n - 1;
          const isWide = i < wideLeadCount;
          return <Cell
            key={p.id}
            className={isWide ? "pg-span-3" : "pg-span-2"}
            photo={p}
            onClick={() => openStill(i)}
            ariaLabel={labelFor(i)}
            onMore={isMore ? onExpand : undefined}
            sizes={isWide ? halfSizes : thirdSizes}
            priority={priority && i === 0}
          />;
        })}
      </div>
      {viewerIndex !== null ? <ViewerModal photos={stillPhotos} startIndex={viewerIndex} dateLabel={dateLabel} ageLabel={ageLabel} onClose={closeViewer} /> : null}
    </>
  );
}
