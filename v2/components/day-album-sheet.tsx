"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { createPortal } from "react-dom";
import { dayMediaKind } from "@/components/day-photos";
import { PhotoGallery } from "@/components/photo-viewer";
import type { PhotoDay } from "@/lib/memory-chapters";

export function DayAlbumSheet({
  album,
  dateLabel,
  ageLabel,
  onClose,
  returnFocusTo,
}: {
  album: PhotoDay;
  dateLabel: string;
  ageLabel?: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The back button closes the album, the way it closes the photo viewer. The viewer opened from
    // inside the album pushes its own entry on top of this one, so a popstate that only takes the
    // viewer away lands back on this entry and must leave the album open.
    history.pushState({ nianDayAlbum: album.day }, "");
    const onPop = () => { if (history.state?.nianDayAlbum !== album.day) onClose(); };
    window.addEventListener("popstate", onPop);
    // Keyboard and screen readers stay inside the album while it covers the page: everything else on
    // <body> (skip link, header, bottom nav, the month itself) goes inert until it closes. Elements
    // that were already inert are left as they were.
    const sheet = panel.current;
    const madeInert: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === sheet || child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      madeInert.push(child);
    }
    sheet?.focus({ preventScroll: true });
    const focusBack = returnFocusTo.current;
    return () => {
      for (const child of madeInert) child.removeAttribute("inert");
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("popstate", onPop);
      // Only now is the entry focusable again.
      focusBack?.focus({ preventScroll: true });
    };
  }, [album.day, onClose, returnFocusTo]);

  const closeViaUI = useCallback(() => history.back(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The photo viewer handles its own Escape; only close the album when no viewer is on top.
      if (event.key !== "Escape" || document.querySelector(".photo-viewer")) return;
      event.preventDefault();
      closeViaUI();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeViaUI]);

  const titleId = `day-album-${album.day}`;
  // Named for what is in it, the same way 「这一天的照片」 and the month album name themselves: once the
  // archive's videos are deliverable (data track A3, 2026-09-13), a day can hold clips too.
  const kind = dayMediaKind(album.photos);
  // Portalled to <body>: month moments animate with transforms, and a fixed element inside a
  // transformed ancestor is positioned against that ancestor instead of the screen.
  return createPortal(
    <div className="day-album-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel} tabIndex={-1}>
      <header className="day-album-head">
        <div>
          <span className="section-mark">这个月的相册</span>
          <h2 id={titleId} className="serif">{dateLabel}</h2>
          {ageLabel ? <p>当时 {ageLabel} · 这一天拍下的{kind}</p> : <p>这一天拍下的{kind}</p>}
        </div>
        <button type="button" className="day-album-close" onClick={closeViaUI} aria-label="关闭相册，回到日记">✕</button>
      </header>
      <div className="day-album-body">
        <PhotoGallery photos={album.photos} dateLabel={dateLabel} ageLabel={ageLabel} stripSizes="(max-width: 700px) 32vw, 240px" />
      </div>
      <footer className="day-album-foot">
        <button type="button" className="day-album-back" onClick={closeViaUI}>← 回到日记</button>
      </footer>
    </div>,
    document.body,
  );
}
