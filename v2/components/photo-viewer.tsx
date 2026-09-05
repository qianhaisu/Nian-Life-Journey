"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { orientationOf, aspectRatioOf } from "@/lib/media/presentation";
import { mediaDeliveryUrl } from "@/lib/media/paths";

// Subset of MediaRef — pass MediaRef directly; all fields are present there.
export type GalleryPhoto = {
  id: string;
  src: string;
  thumbnailSrc?: string | null;
  alt: string;
  width: number;
  height: number;
};

// Full-screen viewer: scroll-snap reel + double-tap zoom + keyboard nav + back-button close.
function ViewerModal({
  photos,
  startIndex,
  dateLabel,
  ageLabel,
  onClose,
}: {
  photos: GalleryPhoto[];
  startIndex: number;
  dateLabel: string;
  ageLabel?: string;
  onClose: () => void;
}) {
  const reelRef = useRef<HTMLDivElement>(null);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoomed, setZoomed] = useState(false);
  const lastClickMs = useRef(0);

  useEffect(() => {
    const reel = reelRef.current;
    if (reel) reel.scrollTo({ left: startIndex * reel.offsetWidth, behavior: "instant" as ScrollBehavior });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    history.pushState({ nianPhotoViewer: true }, "");
    const handlePop = () => onClose();
    window.addEventListener("popstate", handlePop);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("popstate", handlePop);
    };
  }, [startIndex, onClose]);

  const closeViaUI = useCallback(() => history.back(), []);

  useEffect(() => {
    const reel = reelRef.current;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeViaUI(); return; }
      if (!reel) return;
      const w = reel.offsetWidth;
      if (e.key === "ArrowLeft" && currentIndex > 0) reel.scrollTo({ left: (currentIndex - 1) * w, behavior: "smooth" });
      if (e.key === "ArrowRight" && currentIndex < photos.length - 1) reel.scrollTo({ left: (currentIndex + 1) * w, behavior: "smooth" });
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentIndex, photos.length, closeViaUI]);

  const handleScroll = useCallback(() => {
    const reel = reelRef.current;
    if (!reel) return;
    const idx = Math.round(reel.scrollLeft / reel.offsetWidth);
    if (idx !== currentIndex) { setCurrentIndex(idx); setZoomed(false); }
  }, [currentIndex]);

  const handleSlideClick = useCallback(() => {
    const now = Date.now();
    if (now - lastClickMs.current < 350) setZoomed((z) => !z);
    lastClickMs.current = now;
  }, []);

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="照片查看器">
      <header className="viewer-header">
        <button className="viewer-close" onClick={closeViaUI} aria-label="关闭" autoFocus>✕</button>
        <p className="viewer-caption">
          <time>{dateLabel}</time>
          {ageLabel ? <span>{ageLabel}</span> : null}
        </p>
      </header>
      <div className="viewer-reel" ref={reelRef} onScroll={handleScroll}>
        {photos.map((photo, index) => (
          <div key={photo.id} className="viewer-slide" onClick={handleSlideClick}>
            {/* Plain img so object-fit:contain works naturally inside a flex container */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.src}
              alt={photo.alt}
              className={`viewer-image${zoomed && index === currentIndex ? " viewer-image-zoomed" : ""}`}
              loading={Math.abs(index - startIndex) <= 1 ? "eager" : "lazy"}
            />
          </div>
        ))}
      </div>
      {photos.length > 1 ? (
        <footer className="viewer-nav">{currentIndex + 1} / {photos.length}</footer>
      ) : null}
    </div>
  );
}

// Renders a set of photos with a click-to-view full-screen viewer.
// - heroIndex: which photo to show at full editorial width (others go in a strip below it).
// - heroClassName: CSS class(es) applied to the hero figure (e.g. "moment-hero").
// - dateLabel / ageLabel: shown in the viewer header (原则二: 两个时钟并存).
export function PhotoGallery({
  photos,
  heroIndex,
  heroClassName = "",
  dateLabel,
  ageLabel,
  priority = false,
  heroSizes = "(max-width: 700px) 100vw, 760px",
  stripSizes = "(max-width: 700px) 46vw, 260px",
}: {
  photos: GalleryPhoto[];
  heroIndex?: number;
  heroClassName?: string;
  dateLabel: string;
  ageLabel?: string;
  priority?: boolean;
  heroSizes?: string;
  stripSizes?: string;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openViewer = useCallback((idx: number) => setViewerIndex(idx), []);
  const closeViewer = useCallback(() => setViewerIndex(null), []);

  if (photos.length === 0) return null;

  const heroPhoto = heroIndex !== undefined ? photos[heroIndex] : undefined;
  const stripPhotos = heroPhoto ? photos.filter((_, i) => i !== heroIndex) : photos;
  // Viewer order: hero first (index 0), then strip order
  const viewerPhotos = heroPhoto ? [heroPhoto, ...stripPhotos] : photos;

  function viewerIdxFor(originalIdx: number): number {
    if (!heroPhoto) return originalIdx;
    if (originalIdx === heroIndex) return 0;
    return stripPhotos.indexOf(photos[originalIdx]) + 1;
  }

  return (
    <>
      {heroPhoto ? (
        <figure
          className={`photo photo-${orientationOf(heroPhoto)} ${heroClassName}`.trim()}
          style={{ aspectRatio: aspectRatioOf(heroPhoto) }}
          role="button"
          tabIndex={0}
          aria-label="打开照片"
          onClick={() => openViewer(viewerIdxFor(heroIndex!))}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(viewerIdxFor(heroIndex!)); } }}
        >
          <Image src={heroPhoto.src} alt={heroPhoto.alt} width={heroPhoto.width || 4} height={heroPhoto.height || 3} sizes={heroSizes} priority={priority} />
        </figure>
      ) : null}

      {stripPhotos.length > 0 ? (
        <div className={`photo-strip photo-strip-${Math.min(stripPhotos.length, 5)}`}>
          {stripPhotos.map((photo, si) => {
            const origIdx = heroPhoto ? photos.indexOf(photo) : si;
            return (
              <figure
                key={photo.id}
                className={`photo photo-${orientationOf(photo)}`}
                style={{ aspectRatio: aspectRatioOf(photo) }}
                role="button"
                tabIndex={0}
                aria-label="打开照片"
                onClick={() => openViewer(viewerIdxFor(origIdx))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(viewerIdxFor(origIdx)); } }}
              >
                <Image
                  src={photo.thumbnailSrc ?? mediaDeliveryUrl(photo.id, "thumbnail")}
                  alt={photo.alt}
                  width={photo.width || 4}
                  height={photo.height || 3}
                  sizes={stripSizes}
                  priority={priority && si === 0 && !heroPhoto}
                />
              </figure>
            );
          })}
        </div>
      ) : null}

      {viewerIndex !== null ? (
        <ViewerModal
          photos={viewerPhotos}
          startIndex={viewerIndex}
          dateLabel={dateLabel}
          ageLabel={ageLabel}
          onClose={closeViewer}
        />
      ) : null}
    </>
  );
}
