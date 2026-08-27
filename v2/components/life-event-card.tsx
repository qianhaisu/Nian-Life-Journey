import Image from "next/image";
import Link from "next/link";
import type { LifeEvent, Media } from "@/lib/types";

function formatDate(date: string) { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`)); }
export function LifeEventCard({ event, mediaItem, featured = false }: { event: LifeEvent; mediaItem?: Media; featured?: boolean }) { return <Link className={`event-card ${featured ? "event-card-featured" : ""}`} href={`/events/${event.id}`}><div className="event-image">{mediaItem ? <Image src={mediaItem.src} alt={mediaItem.alt} fill sizes={featured ? "(max-width: 700px) 100vw, 58vw" : "(max-width: 700px) 100vw, 32vw"} style={{ objectFit: "cover" }} /> : null}</div><div className="event-copy"><span className="event-date">{formatDate(event.occurredAt)}</span><h3 className="serif">{event.title}</h3><p>{event.story}</p><div className="event-meta"><span>{event.locationLabel}</span><span>{event.tags.slice(0, 2).join(" · ")}</span></div></div></Link>; }
