"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryPhoto } from "@/components/photo-viewer";

// Full-screen viewer: scroll-snap reel + double-tap zoom + keyboard nav + back-button close.
//
// Exported (2026-09-13) so the front page's cover can open the SAME viewer rather than growing a
// second one of its own. The cover is a fixed, cropped frame with its own caption and 换张照片
// button, so it cannot use PhotoGallery's hero — but 「打开原比例」 has to mean exactly what it
// means everywhere else on the site: this reel, this zoom, this back-button behaviour.
export function ViewerModal({
  photos,
  startIndex,
  dateLabel,
  ageLabel,
  captions,
  onClose,
}: {
  photos: GalleryPhoto[];
  startIndex: number;
  dateLabel: string;
  ageLabel?: string;
  captions?: Readonly<Record<string, string>>;
  onClose: () => void;
}) {
  const reelRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closingRef = useRef(false);
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [zoomAnnouncement, setZoomAnnouncement] = useState("");
  const lastClickMs = useRef(0);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);
  const suppressNextClickRef = useRef(false);

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 3;
  const ZOOM_STEP = 0.5;

  const clampPan = useCallback((nextPan: { x: number; y: number }, targetZoom: number) => {
    if (targetZoom <= MIN_ZOOM) return { x: 0, y: 0 };
    const reel = reelRef.current;
    const maxX = reel ? ((targetZoom - 1) * reel.clientWidth) / 2 : (targetZoom - 1) * 280;
    const maxY = reel ? ((targetZoom - 1) * reel.clientHeight) / 2 : (targetZoom - 1) * 280;
    return {
      x: Math.max(-maxX, Math.min(maxX, nextPan.x)),
      y: Math.max(-maxY, Math.min(maxY, nextPan.y)),
    };
  }, []);

  const applyZoom = useCallback((nextZoomOrUpdater: number | ((prev: number) => number)) => {
    setZoom((prev) => {
      const raw = typeof nextZoomOrUpdater === "function" ? nextZoomOrUpdater(prev) : nextZoomOrUpdater;
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(raw * 100) / 100));
      if (clamped !== prev) {
        setPan((p) => clampPan(p, clamped));
        setZoomAnnouncement(clamped <= MIN_ZOOM ? "已还原至 100%" : `已缩放至 ${Math.round(clamped * 100)}%`);
      }
      return clamped;
    });
  }, [clampPan]);

  const zoomIn = useCallback(() => applyZoom((z) => z + ZOOM_STEP), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom((z) => z - ZOOM_STEP), [applyZoom]);
  const resetZoom = useCallback(() => applyZoom(MIN_ZOOM), [applyZoom]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    closingRef.current = false;
    dialog?.showModal();
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
      dialog?.close();
      previousFocus?.focus({ preventScroll: true });
    };
  }, [startIndex, onClose]);

  const closeViaUI = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    history.back();
  }, []);

  const goToSlide = useCallback((targetIndex: number) => {
    const reel = reelRef.current;
    if (!reel) return;
    const bounded = Math.max(0, Math.min(photos.length - 1, targetIndex));
    setZoom(MIN_ZOOM);
    setPan({ x: 0, y: 0 });
    reel.scrollTo({ left: bounded * reel.offsetWidth, behavior: "smooth" });
  }, [photos.length]);

  useEffect(() => {
    const reel = reelRef.current;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeViaUI(); return; }
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomIn(); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomOut(); return; }
      if (e.key === "0") { e.preventDefault(); resetZoom(); return; }
      if (zoom > MIN_ZOOM && (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        const step = 48;
        setPan((prev) => clampPan({
          x: prev.x + (e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0),
          y: prev.y + (e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0),
        }, zoom));
        return;
      }
      if (!reel) return;
      if (e.key === "ArrowLeft" && currentIndex > 0) goToSlide(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < photos.length - 1) goToSlide(currentIndex + 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [currentIndex, photos.length, closeViaUI, zoom, zoomIn, zoomOut, resetZoom, clampPan, goToSlide]);

  const handleScroll = useCallback(() => {
    const reel = reelRef.current;
    if (!reel || !reel.offsetWidth) return;
    const idx = Math.round(reel.scrollLeft / reel.offsetWidth);
    if (idx !== currentIndex) {
      setCurrentIndex(idx);
      setZoom(MIN_ZOOM);
      setPan({ x: 0, y: 0 });
      setZoomAnnouncement("");
    }
  }, [currentIndex]);

  const handleSlideClick = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const now = Date.now();
    if (now - lastClickMs.current < 350) {
      applyZoom((z) => (z > MIN_ZOOM ? MIN_ZOOM : 2));
    }
    lastClickMs.current = now;
  }, [applyZoom]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, isActive: boolean) => {
    if (!isActive || zoom <= MIN_ZOOM) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y, moved: false };
    setIsDragging(true);
  }, [zoom, pan.x, pan.y]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    setPan(clampPan({ x: drag.baseX + dx, y: drag.baseY + dy }, zoom));
  }, [clampPan, zoom]);

  const handlePointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.moved) suppressNextClickRef.current = true;
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  // Escape animated/transformed ancestors. The native modal also makes the page underneath inert.
  if (typeof document === "undefined") return null;
  const activePhoto = photos[currentIndex];
  const rawCaption = activePhoto?.caption ?? (activePhoto ? captions?.[activePhoto.id] : undefined);
  const activeCaption = typeof rawCaption === "string" && rawCaption.trim().length > 0 ? rawCaption.trim() : undefined;
  const zoomPct = Math.round(zoom * 100);

  return createPortal(
    <dialog
      ref={dialogRef}
      className="photo-viewer"
      aria-modal="true"
      aria-label="照片查看器"
      onClick={(event) => { if (event.target === dialogRef.current) closeViaUI(); }}
      onCancel={(event) => { event.preventDefault(); closeViaUI(); }}
    >
      <style>{`
        .photo-viewer .viewer-zoom-group { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; }
        .photo-viewer .viewer-zoom-group .viewer-zoom { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; font-variant-numeric: tabular-nums; }
        .photo-viewer .viewer-zoom-group .viewer-zoom:disabled { opacity: 0.42; cursor: default; }
        .photo-viewer .viewer-zoom-group .viewer-zoom:focus-visible,
        .photo-viewer .viewer-close:focus-visible,
        .photo-viewer .viewer-nav button:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
        .photo-viewer .viewer-slide-zoomed { touch-action: none; cursor: grab; }
        .photo-viewer .viewer-slide-dragging { cursor: grabbing; }
        .photo-viewer .viewer-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
      `}</style>
      <header className="viewer-header">
        <button type="button" className="viewer-close" onClick={closeViaUI} aria-label="关闭" autoFocus>✕</button>
        <p className="viewer-caption">
          <time>{dateLabel}</time>
          {ageLabel ? <span>{ageLabel}</span> : null}
        </p>
        <div className="viewer-zoom-group" role="group" aria-label="缩放控制">
          <button
            type="button"
            className="viewer-zoom"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
            aria-label="缩小照片（快捷键 -）"
          >
            −
          </button>
          <button
            type="button"
            className="viewer-zoom"
            onClick={resetZoom}
            disabled={zoom <= MIN_ZOOM}
            aria-pressed={zoom > MIN_ZOOM}
            aria-label={zoom > MIN_ZOOM ? `还原照片比例，当前 ${zoomPct}%（快捷键 0）` : `当前比例 ${zoomPct}%`}
          >
            {zoomPct}%
          </button>
          <button
            type="button"
            className="viewer-zoom"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
            aria-label="放大照片（快捷键 +）"
          >
            ＋
          </button>
        </div>
      </header>
      <span className="viewer-sr-only" role="status" aria-live="polite">{zoomAnnouncement}</span>
      <div
        className="viewer-reel"
        ref={reelRef}
        onScroll={handleScroll}
        style={zoom > MIN_ZOOM ? { overflowX: "hidden" } : undefined}
      >
        {photos.map((photo, index) => {
          const isActive = index === currentIndex;
          const isZoomed = isActive && zoom > MIN_ZOOM;
          return (
            <div
              key={photo.id}
              className={`viewer-slide${isZoomed ? " viewer-slide-zoomed" : ""}${isZoomed && isDragging ? " viewer-slide-dragging" : ""}`}
              onClick={handleSlideClick}
              onPointerDown={(e) => handlePointerDown(e, isActive)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              {/* Plain img so object-fit:contain works naturally inside a flex container */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.src}
                alt={photo.alt}
                className={`viewer-image${isZoomed ? " viewer-image-zoomed" : ""}`}
                style={isZoomed ? { transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`, transition: isDragging ? "none" : "transform 0.16s ease" } : undefined}
                loading={Math.abs(index - startIndex) <= 1 ? "eager" : "lazy"}
                draggable={false}
              />
            </div>
          );
        })}
      </div>
      {activeCaption ? (
        <p className="viewer-photo-caption" aria-live="polite">{activeCaption}</p>
      ) : null}
      <footer className="viewer-nav">
        <button type="button" disabled={currentIndex === 0} aria-label="上一张"
          onClick={() => goToSlide(currentIndex - 1)}>‹</button>
        <span aria-live="polite">{currentIndex + 1} / {photos.length}</span>
        <button type="button" disabled={currentIndex === photos.length - 1} aria-label="下一张"
          onClick={() => goToSlide(currentIndex + 1)}>›</button>
      </footer>
    </dialog>,
    document.body,
  );
}
