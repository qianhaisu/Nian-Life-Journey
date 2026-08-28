import Image from "next/image";
import Link from "next/link";
import type { LifeEvent, Media } from "@/lib/types";

function formatDate(date: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(`${date}T12:00:00`)); }
function weightLabel(weight: LifeEvent["memoryWeight"]) { return weight === "chapter" ? "人生章节" : weight === "highlight" ? "值得再看" : weight === "trace" ? "生活痕迹" : "一段记忆"; }
function formatDuration(seconds?: number) { return seconds ? `00:${String(seconds).padStart(2, "0")}` : ""; }

export function LifeEventCard({ event, mediaItem, featured = false, priority }: { event: LifeEvent; mediaItem?: Media; featured?: boolean; priority?: boolean }) {
	return <Link className={`event-card event-card-${event.memoryWeight} ${featured ? "event-card-featured" : ""}`} href={`/events/${event.id}`}>
		<div className="event-image">
			{mediaItem ? <Image src={mediaItem.src} alt={mediaItem.alt} fill priority={priority ?? featured} sizes={featured ? "(max-width: 700px) 100vw, 58vw" : "(max-width: 700px) 100vw, 32vw"} style={{ objectFit: "cover" }} /> : null}
			{mediaItem?.type === "video" ? <span className="media-chip">Video · {formatDuration(mediaItem.durationSeconds)}</span> : null}
		</div>
		<div className="event-copy">
			<div className="event-kicker"><span className="event-date">{formatDate(event.occurredAt)}</span><span>{weightLabel(event.memoryWeight)}</span></div>
			{event.title ? <h3 className="serif">{event.title}</h3> : null}
			{event.story ? <p>{event.story}</p> : null}
			<div className="event-meta"><span>{event.locationLabel}</span><span>{event.tags.slice(0, 2).join(" · ")}</span></div>
		</div>
	</Link>;
}
