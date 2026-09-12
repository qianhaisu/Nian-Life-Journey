'use client';
import { useEffect } from 'react';

// The year nav on /memory is a set of in-page anchors, so the server can only guess which year the
// reader is on: it marks the newest one and that mark never moved again. A reader who clicked 2024
// and scrolled through it still saw 2026 lit up. This keeps the lit pill on the year actually being
// read, and it is the only thing that writes .year-pill--active after hydration.
//
// Rects, not scrollY: body carries `overflow-x: clip`, which makes the used overflow-y `auto`, so
// which element owns the scroll offset is not worth depending on. getBoundingClientRect is relative
// to the viewport either way. The scroll listener is on document with capture for the same reason —
// it catches the event whichever element actually scrolled.
export function YearNavHighlight() {
  useEffect(() => {
    const nav = document.querySelector('.memory-year-nav');
    if (!nav) return;

    const years = [...nav.querySelectorAll<HTMLAnchorElement>('.year-pill')]
      .map((pill) => {
        const id = pill.getAttribute('href')?.replace(/^#/, '');
        const section = id ? document.getElementById(id) : null;
        return section ? { pill, section } : null;
      })
      .filter((y): y is { pill: HTMLAnchorElement; section: HTMLElement } => y !== null);
    // One year is not a choice, so there is nothing to keep in sync.
    if (years.length < 2) return;

    let frame = 0;
    const sync = () => {
      frame = 0;
      // The year being read is the last one whose heading has crossed a line near the top of the
      // viewport. Before the first one crosses it — the masthead still fills the screen — the
      // newest year stays lit, which is what the server already rendered, so nothing flashes.
      const readingLine = window.innerHeight * 0.3;
      let current = years[0];
      for (const year of years) {
        if (year.section.getBoundingClientRect().top <= readingLine) current = year;
      }
      // The oldest year is the shortest — 2024 holds one month — so the page can run out of
      // scroll before its heading ever reaches the reading line, and it could never light up.
      // Once the document has no more to give, the year you are looking at is the last one.
      if (Math.round(document.documentElement.getBoundingClientRect().bottom) <= window.innerHeight + 2) {
        current = years[years.length - 1];
      }
      for (const { pill } of years) {
        const isCurrent = pill === current.pill;
        pill.classList.toggle('year-pill--active', isCurrent);
        if (isCurrent) pill.setAttribute('aria-current', 'true');
        else pill.removeAttribute('aria-current');
      }
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(sync);
    };

    sync();
    document.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', schedule);
    };
  }, []);

  return null;
}
