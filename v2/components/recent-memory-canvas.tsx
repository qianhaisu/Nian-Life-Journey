"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LifeEvent, Media } from "@/lib/types";

export function RecentMemoryCanvas({ events, media }: { events: LifeEvent[]; media: Media[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isInteractionPaused, setIsInteractionPaused] = useState(false);
  const [isManuallyPaused, setIsManuallyPaused] = useState(false);
  const [cycleVersion, setCycleVersion] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const safeIndex = events.length ? activeIndex % events.length : 0;
  const isPaused = isInteractionPaused || isManuallyPaused;
  const event = events[safeIndex];
  const hero = event ? mediaById.get(event.heroMediaId ?? event.mediaIds[0]) : undefined;

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReduceMotion(query.matches);
    updatePreference();
    query.addEventListener("change", updatePreference);
    return () => query.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (reduceMotion || isPaused || events.length < 2) return;
    const timer = window.setTimeout(() => setActiveIndex((current) => (current + 1) % events.length), 6000);
    return () => window.clearTimeout(timer);
  }, [events.length, isPaused, reduceMotion, safeIndex, cycleVersion]);

  function selectIndex(next: number) {
    if (!events.length) return;
    setActiveIndex((next + events.length) % events.length);
    setCycleVersion((current) => current + 1);
  }

  function move(direction: number) {
    selectIndex(safeIndex + direction);
  }

  if (!event || !hero) return null;
  return <section className="memory-canvas" data-ai-id="recent-memory-canvas" aria-label="最近的记忆"
    onMouseEnter={() => setIsInteractionPaused(true)} onMouseLeave={() => setIsInteractionPaused(false)}
    onFocusCapture={() => setIsInteractionPaused(true)} onBlurCapture={(focus) => { if (!focus.currentTarget.contains(focus.relatedTarget)) setIsInteractionPaused(false); }}
    onTouchStart={(touch) => { const point = touch.touches[0]; touchStart.current = point ? { x: point.clientX, y: point.clientY } : null; }}
    onTouchEnd={(touch) => { const start = touchStart.current; const point = touch.changedTouches[0]; if (start && point) { const deltaX = start.x - point.clientX; const deltaY = start.y - point.clientY; if (Math.abs(deltaX) > 44 && Math.abs(deltaX) > Math.abs(deltaY)) move(deltaX > 0 ? 1 : -1); } touchStart.current = null; }}>
    <div className="canvas-stage">
      <Image key={hero.id} className="canvas-image" src={hero.src} alt={hero.alt} fill priority sizes="(max-width: 700px) 100vw, 68vw" />
      <div className="canvas-shade" />
      <div className="canvas-story" aria-live="polite">
        <time dateTime={event.occurredAt}>{event.occurredAt.slice(5).replace("-", ".")}</time>
        <h2 className="serif">{event.title}</h2>
        <Link href={`/events/${event.id}`}>回到这一天 <span aria-hidden="true">↗</span></Link>
      </div>
      <button className="canvas-pause" type="button" aria-pressed={isManuallyPaused} onClick={() => setIsManuallyPaused((current) => !current)}>{isManuallyPaused ? "继续播放" : "暂停播放"}</button>
      <div className="canvas-mobile-controls" aria-label="切换最近记忆">
        <button type="button" onClick={() => move(-1)} aria-label="上一段记忆">←</button>
        <span>{activeIndex + 1} / {events.length}</span>
        <button type="button" onClick={() => move(1)} aria-label="下一段记忆">→</button>
      </div>
    </div>
    <div className="canvas-caption" aria-live="polite"><p>{event.story}</p></div>
    <ol className="canvas-index">
      {events.map((item, index) => <li key={item.id}><button type="button" className={index === safeIndex ? "is-active" : ""} aria-current={index === safeIndex ? "true" : undefined} onClick={() => selectIndex(index)}><time dateTime={item.occurredAt}>{item.occurredAt.slice(5).replace("-", ".")}</time><span>{item.title}</span></button></li>)}
    </ol>
  </section>;
}
