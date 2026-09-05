'use client';
import { useEffect } from 'react';

// IntersectionObserver fallback for animation-timeline:view() — runs only in browsers that do
// NOT support CSS scroll timelines (currently iOS Safari). Adds .io-reveal-pending to <html> so
// CSS can target it, then observes .memory-entry .memory-photo / .memory-copy / .month-moment
// and adds .is-visible as each enters the viewport. prefers-reduced-motion is respected.
export function ScrollReveal() {
  useEffect(() => {
    if (typeof CSS === 'undefined') return;
    if (CSS.supports('animation-timeline', 'view()')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.documentElement.classList.add('io-reveal-pending');

    const targets = document.querySelectorAll<Element>(
      '.memory-entry .memory-photo, .memory-entry .memory-copy, .month-moment, .month-card'
    );
    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.08, rootMargin: '0px 0px -5% 0px' }
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return null;
}
