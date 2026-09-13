'use client';
import { useEffect } from 'react';

// The year nav on /memory is a set of in-page anchors, so the server can only guess which year the
// reader is on: it marks the newest one and that mark never moved again. A reader who clicked 2024
// and scrolled through it still saw 2026 lit up. This keeps the lit pill on the year the reader
// actually asked for or actually reached, and it is the only thing that writes .year-pill--active
// after hydration.
//
// Two things decide the answer, in this order.
//
// 1. THE YEAR THE READER ASKED FOR. Clicking 2024, opening /memory#year-2024, reloading that URL,
//    or coming back to it with the back button all name a year in the address. The browser then
//    scrolls as close to that heading as the document allows — for the oldest year that is not all
//    the way, because 2024 holds one month and the page simply ends first. Measured on the private
//    site: the click settles 56px short of the bottom with the 2024 heading 1084px down the screen,
//    visible but nowhere near the reading line. Judged by scrolling alone the answer came out 2025
//    while the address said 2024, so the address wins until the reader scrolls for themselves.
//
// 2. OTHERWISE, THE YEAR BEING READ — the last heading to have crossed a line near the top of the
//    viewport, with the bottom of the document counting as the oldest year for the same reason.
//
// Rects, not scroll offsets: getBoundingClientRect is relative to the viewport whichever element
// owns the scroll. The scroll listener is on document with capture for the same reason.
export function YearNavHighlight() {
  useEffect(() => {
    const nav = document.querySelector('.memory-year-nav');
    if (!nav) return;

    const years = [...nav.querySelectorAll<HTMLAnchorElement>('.year-pill')]
      .map((pill) => {
        const id = pill.getAttribute('href')?.replace(/^#/, '');
        const section = id ? document.getElementById(id) : null;
        return section ? { pill, section, id: id as string } : null;
      })
      .filter((y): y is { pill: HTMLAnchorElement; section: HTMLElement; id: string } => y !== null);
    // One year is not a choice, so there is nothing to keep in sync.
    if (years.length < 2) return;

    // Whether the reader has taken the page over by scrolling it themselves. Until they do, the
    // year named in the address decides.
    //
    // The address is read at the moment it is needed rather than cached: history.replaceState and
    // pushState change it without firing hashchange or popstate, and the App Router uses both, so
    // a cached answer can outlive the address it came from. It did — with the hash cleared and the
    // page at the top, 2024 was still lit.
    let readerTookOver = false;
    const askedYear = () => {
      if (readerTookOver) return undefined;
      const id = window.location.hash.replace(/^#/, '');
      return years.find((y) => y.id === id);
    };

    let frame = 0;
    const sync = () => {
      frame = 0;
      let current = years[0];
      const asked = askedYear();
      if (asked) {
        current = asked;
      } else {
        const readingLine = window.innerHeight * 0.3;
        for (const year of years) {
          if (year.section.getBoundingClientRect().top <= readingLine) current = year;
        }
        // Once the document has no more to give, the year you are looking at is the last one.
        if (Math.round(document.documentElement.getBoundingClientRect().bottom) <= window.innerHeight + 2) {
          current = years[years.length - 1];
        }
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
    // Naming a year again hands the page back to the address.
    const onAddressChange = () => {
      readerTookOver = false;
      schedule();
    };
    const onNavClick = (event: Event) => {
      const pill = (event.target as Element | null)?.closest?.('.year-pill');
      if (!pill || !years.some((y) => y.pill === pill)) return;
      readerTookOver = false;
      schedule();
    };
    // Anything the reader does to move the page themselves retires the address.
    const onReaderScroll = () => {
      if (readerTookOver) return;
      readerTookOver = true;
      schedule();
    };
    const SCROLLING_KEYS = new Set([
      'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar',
    ]);
    const onReaderKey = (event: KeyboardEvent) => {
      if (SCROLLING_KEYS.has(event.key)) onReaderScroll();
    };


    sync();
    document.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    window.addEventListener('hashchange', onAddressChange);
    window.addEventListener('popstate', onAddressChange);
    nav.addEventListener('click', onNavClick);
    window.addEventListener('wheel', onReaderScroll, { passive: true });
    window.addEventListener('touchmove', onReaderScroll, { passive: true });
    window.addEventListener('keydown', onReaderKey);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      window.removeEventListener('hashchange', onAddressChange);
      window.removeEventListener('popstate', onAddressChange);
      nav.removeEventListener('click', onNavClick);
      window.removeEventListener('wheel', onReaderScroll);
      window.removeEventListener('touchmove', onReaderScroll);
      window.removeEventListener('keydown', onReaderKey);
    };
  }, []);

  return null;
}
