"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DailyTrace, LifeEvent, Media, TimelineScope } from "@/lib/types";
import { heroCandidates } from "@/lib/media/hero";

type TimelineFilter = "all" | TimelineScope;
type TimelineItem = { kind: "event"; occurredAt: string; event: LifeEvent } | { kind: "trace"; occurredAt: string; trace: DailyTrace };
const filters: { label: string; value: TimelineFilter }[] = [{ label: "全部", value: "all" }, { label: "家里", value: "family" }, { label: "托班", value: "daycare" }, { label: "出游", value: "outing" }, { label: "成长", value: "growth" }];
const labels = { trace: "生活痕迹", memory: "一段记忆", highlight: "值得再看", chapter: "人生章节" } as const;
function isFilter(value: string | null): value is TimelineFilter { return value === "family" || value === "daycare" || value === "outing" || value === "growth"; }

export function Timeline({ events, media, traces }: { events: LifeEvent[]; media: Media[]; traces: DailyTrace[] }) {
  const [activeFilter, setActiveFilter] = useState<TimelineFilter>("all");
  const [yearbookIds, setYearbookIds] = useState(() => new Set(events.filter((event) => event.keptInYearbook).map((event) => event.id)));
  const [failedMediaIds, setFailedMediaIds] = useState<Set<string>>(() => new Set());
  function markMediaFailed(mediaId: string) {
    setFailedMediaIds((current) => current.has(mediaId) ? current : new Set(current).add(mediaId));
  }
  useEffect(() => { const sync = () => { const value = new URLSearchParams(window.location.search).get("scope"); setActiveFilter(isFilter(value) ? value : "all"); }; sync(); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  const mediaById = useMemo(() => new Map(media.map((item) => [item.id, item])), [media]);
  const items: TimelineItem[] = [...events.filter((event) => activeFilter === "all" || event.scopes.includes(activeFilter)).map((event) => ({ kind: "event" as const, occurredAt: event.occurredAt, event })), ...traces.filter((trace) => activeFilter === "all" || trace.scopes.includes(activeFilter)).map((trace) => ({ kind: "trace" as const, occurredAt: trace.occurredAt, trace }))].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  function updateFilter(value: TimelineFilter) { setActiveFilter(value); const url = new URL(window.location.href); value === "all" ? url.searchParams.delete("scope") : url.searchParams.set("scope", value); window.history.pushState(null, "", `${url.pathname}${url.search}`); }

  return <>
    <nav className="memory-filters" aria-label="按生活视角阅读记忆">{filters.map((filter) => <button type="button" key={filter.value} aria-pressed={filter.value === activeFilter} className={filter.value === activeFilter ? "is-active" : ""} onClick={() => updateFilter(filter.value)}>{filter.label}</button>)}</nav>
    <div className="memory-stream">
      {items.length ? items.map((item) => {
        const date = item.occurredAt.slice(8);
        if (item.kind === "trace") return <article className="stream-entry stream-trace" key={item.trace.id}><div className="stream-date"><strong>{date}</strong></div><div className="trace-copy"><span>{labels.trace}</span><ul>{item.trace.entries.map((entry) => <li key={entry}>{entry}</li>)}</ul><small>这些小事留在当天，不需要被写成故事。</small></div></article>;
        const event = item.event;
        const eventCandidates = event.mediaIds.map((id) => mediaById.get(id)).filter((entry): entry is Media => Boolean(entry));
        const hero = heroCandidates(event.heroMediaId, eventCandidates).find((entry) => !failedMediaIds.has(entry.id));
        const isKept = yearbookIds.has(event.id);
        const orientation = hero && hero.height > hero.width ? "portrait" : "landscape";
        return <article className={`stream-entry stream-${event.memoryWeight}`} key={event.id}>
          <div className="stream-date"><strong>{date}</strong><button className={isKept ? "yearbook-mark is-kept" : "yearbook-mark"} type="button" aria-label={isKept ? "从年鉴移除" : "留在年鉴"} aria-pressed={isKept} title={isKept ? "已留在年鉴" : "留在年鉴"} onClick={() => setYearbookIds((current) => { const next = new Set(current); next.has(event.id) ? next.delete(event.id) : next.add(event.id); return next; })}>{isKept ? "★" : "☆"}</button></div>
          <Link className="stream-memory" href={`/events/${event.id}`}>
            {hero ? <div className={`stream-media media-${orientation}`}><Image key={hero.id} src={hero.thumbnailSrc ?? hero.src} alt={hero.alt} fill sizes="(max-width: 700px) 100vw, (max-width: 1100px) 70vw, 620px" onError={() => markMediaFailed(hero.id)} /></div> : null}
            <div className="stream-copy"><span>{labels[event.memoryWeight]}</span>{event.title ? <h2 className="serif">{event.title}</h2> : null}{event.story ? <p>{event.story}</p> : null}<small>{event.locationLabel}{event.mediaIds.length > 1 ? ` · ${event.mediaIds.length} 项媒体` : ""}</small></div>
          </Link>
        </article>;
      }) : <div className="timeline-empty"><p className="serif">这条线还没有被写下。</p><button type="button" onClick={() => setActiveFilter("all")}>回到全部日子</button></div>}
    </div>
  </>;
}
