"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DailyTrace, LifeEvent, Media, TimelineScope } from "@/lib/types";
import { LifeEventCard } from "./life-event-card";

type TimelineFilter = "all" | TimelineScope;
type TimelineItem = { kind: "event"; occurredAt: string; event: LifeEvent } | { kind: "trace"; occurredAt: string; trace: DailyTrace };

const filters: { label: string; value: TimelineFilter }[] = [
	{ label: "全部", value: "all" },
	{ label: "家里", value: "family" },
	{ label: "托班", value: "daycare" },
	{ label: "出游", value: "outing" },
	{ label: "成长", value: "growth" },
];

function formatDate(date: string) { return date.slice(5).replace("-", "."); }
function weightLabel(weight: LifeEvent["memoryWeight"]) { return weight === "feature" ? "重要记忆" : weight === "daily_trace" ? "日常留下" : "记忆"; }
function isTimelineFilter(value: string | null): value is TimelineFilter { return value === "family" || value === "daycare" || value === "outing" || value === "growth"; }

export function Timeline({ events, media, traces }: { events: LifeEvent[]; media: Media[]; traces: DailyTrace[] }) {
	const [activeFilter, setActiveFilter] = useState<TimelineFilter>("all");
	useEffect(() => {
		const syncFilter = () => {
			const value = new URLSearchParams(window.location.search).get("scope");
			setActiveFilter(isTimelineFilter(value) ? value : "all");
		};
		syncFilter();
		window.addEventListener("popstate", syncFilter);
		return () => window.removeEventListener("popstate", syncFilter);
	}, []);
	function updateFilter(value: TimelineFilter) {
		setActiveFilter(value);
		const url = new URL(window.location.href);
		if (value === "all") url.searchParams.delete("scope");
		else url.searchParams.set("scope", value);
		window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
	}
	const mediaById = new Map(media.map((item) => [item.id, item]));
	const items: TimelineItem[] = [
		...events.filter((event) => activeFilter === "all" || event.scopes.includes(activeFilter)).map((event) => ({ kind: "event" as const, occurredAt: event.occurredAt, event })),
		...traces.filter((trace) => activeFilter === "all" || trace.scopes.includes(activeFilter)).map((trace) => ({ kind: "trace" as const, occurredAt: trace.occurredAt, trace })),
	].sort((first, second) => second.occurredAt.localeCompare(first.occurredAt));

	return <>
		<nav className="timeline-filters" aria-label="按来源阅读时间线">
			{filters.map((filter) => <button className={activeFilter === filter.value ? "is-active" : ""} aria-pressed={activeFilter === filter.value} type="button" key={filter.value} onClick={() => updateFilter(filter.value)}>{filter.label}</button>)}
		</nav>
		<div className="timeline">
			{items.length > 0 ? items.map((item, index) => <section className={`timeline-entry timeline-entry-${item.kind}`} key={item.kind === "event" ? item.event.id : item.trace.id}>
				<div className="timeline-date"><span>{item.occurredAt.slice(0, 4)}</span><strong>{formatDate(item.occurredAt)}</strong></div>
				<div className="timeline-line" aria-hidden="true"><i /></div>
				<div className="timeline-content">
					{item.kind === "trace" ? <>
						<span className="eyebrow">日常留下</span>
						<article className="timeline-trace"><div><span className="trace-label">几件小事</span><h2 className="serif">这一天没有被写成故事</h2></div><ul>{item.trace.entries.map((entry) => <li key={entry}>{entry}</li>)}</ul><span className="trace-source">来自 {item.trace.sourceIds.length} 个来源</span></article>
					</> : item.event.memoryWeight === "daily_trace" ? <>
						<span className="eyebrow">日常留下</span>
						<Link className="timeline-trace timeline-trace-link" href={`/events/${item.event.id}`}><div><span className="trace-label">{weightLabel(item.event.memoryWeight)}</span><h2 className="serif">{item.event.title}</h2></div><p>{item.event.story}</p><span className="trace-source">打开这段记忆 ↗</span></Link>
					</> : <>
						<span className="eyebrow">{item.event.memoryWeight === "feature" ? "值得多年以后再看" : index === 0 ? "最近留下" : "一段记忆"}</span>
						<LifeEventCard event={item.event} mediaItem={item.event.mediaIds.map((id) => mediaById.get(id)).find((mediaItem): mediaItem is Media => Boolean(mediaItem))} featured={item.event.memoryWeight === "feature"} />
					</>}
				</div>
			</section>) : <div className="timeline-empty"><p className="serif">这条线还没有被写下。</p><button type="button" onClick={() => setActiveFilter("all")}>回到全部日子</button></div>}
		</div>
	</>;
}
