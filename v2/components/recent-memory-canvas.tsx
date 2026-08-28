"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import type { LifeEvent, Media } from "@/lib/types";

export function RecentMemoryCanvas({ events, media }: { events: LifeEvent[]; media: Media[] }) {
  const [activeId, setActiveId] = useState(events[0]?.id ?? "");
  const touchStart = useRef<number | null>(null);
  const activeIndex = Math.max(0, events.findIndex((event) => event.id === activeId));
  const event = events[activeIndex];
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const hero = event ? mediaById.get(event.heroMediaId ?? event.mediaIds[0]) : undefined;

  function move(direction: number) {
    const next = (activeIndex + direction + events.length) % events.length;
    setActiveId(events[next].id);
  }

  if (!event || !hero) return null;
  return <section className="memory-canvas" data-ai-id="recent-memory-canvas" aria-label="最近的记忆"
    onTouchStart={(touch) => { touchStart.current = touch.touches[0]?.clientX ?? null; }}
    onTouchEnd={(touch) => { const start = touchStart.current; const end = touch.changedTouches[0]?.clientX; if (start !== null && end !== undefined && Math.abs(start - end) > 44) move(start > end ? 1 : -1); touchStart.current = null; }}>
    <div className="canvas-stage">
      <Image key={hero.id} className="canvas-image" src={hero.src} alt={hero.alt} fill priority sizes="(max-width: 700px) 100vw, 68vw" />
      <div className="canvas-shade" />
      <div className="canvas-story" aria-live="polite">
        <time dateTime={event.occurredAt}>{event.occurredAt.slice(5).replace("-", ".")}</time>
        <h2 className="serif">{event.title}</h2>
        <p>{event.story}</p>
        <Link href={`/events/${event.id}`}>回到这一天 <span aria-hidden="true">↗</span></Link>
      </div>
      <div className="canvas-mobile-controls" aria-label="切换最近记忆">
        <button type="button" onClick={() => move(-1)} aria-label="上一段记忆">←</button>
        <span>{activeIndex + 1} / {events.length}</span>
        <button type="button" onClick={() => move(1)} aria-label="下一段记忆">→</button>
      </div>
    </div>
    <ol className="canvas-index">
      {events.map((item) => <li key={item.id}><button type="button" className={item.id === activeId ? "is-active" : ""} aria-pressed={item.id === activeId} onClick={() => setActiveId(item.id)}><time dateTime={item.occurredAt}>{item.occurredAt.slice(5).replace("-", ".")}</time><span>{item.title}</span></button></li>)}
    </ol>
  </section>;
}
