'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const REVEAL_SELECTOR =
  '.memory-entry .memory-photo, .memory-entry .memory-copy, .month-moment, .month-card';

// IntersectionObserver fallback for animation-timeline:view() — runs only in browsers that do
// NOT support CSS scroll timelines (currently iOS Safari). Adds .io-reveal-pending to <html> so
// CSS can target it, then observes .memory-entry .memory-photo / .memory-copy / .month-moment
// and adds .is-visible as each enters the viewport. Re-scans on client navigation and DOM updates
// and immediately reveals elements already inside the initial viewport.
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof CSS === 'undefined') return;
    if (CSS.supports('animation-timeline', 'view()')) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    document.documentElement.classList.add('io-reveal-pending');

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

    const observed = new WeakSet<Element>();
    const scan = () => {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const targets = document.querySelectorAll<Element>(REVEAL_SELECTOR);
      targets.forEach((el) => {
        if (el.classList.contains('is-visible') || observed.has(el)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.top < viewportHeight && rect.bottom > 0) {
          el.classList.add('is-visible');
          return;
        }
        observed.add(el);
        observer.observe(el);
      });
    };

    scan();

    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scan();
            return;
          }
        }
      }
    });

    if (document.body) {
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      mutationObserver.disconnect();
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
