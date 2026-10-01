import essaysFile from "./essays.json";
import type { Trip } from "./model";

type EssayRecord = { tripId: string; from: string; to: string; basis?: string; basisTitle?: string; title: string; paragraphs: string[] };
export type TripEssay = { title: string; paragraphs: string[]; authored: boolean };

/** A dated editorial revision bound to its evidence; an old essay cannot quietly describe a changed itinerary. */
export function validateEssays(raw: unknown): EssayRecord[] {
  const file = raw as { schema?: string; essays?: EssayRecord[] };
  if (file?.schema !== "nianlife.travel-essays/1" || !Array.isArray(file.essays)) throw new Error("essays.json: schema/essays 无效");
  const ids = new Set<string>();
  return file.essays.map(entry => {
    if (!entry || typeof entry.tripId !== "string" || !entry.tripId.trim() || ids.has(entry.tripId)) throw new Error("essays.json: tripId 无效或重复");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.from) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.to) || entry.from > entry.to) throw new Error("essays.json: from/to 无效");
    if (!(typeof entry.basis === "string" && entry.basis.trim()) && !(typeof entry.basisTitle === "string" && entry.basisTitle.trim())) throw new Error("essays.json: 缺事实依据");
    if (typeof entry.title !== "string" || !entry.title.trim() || !Array.isArray(entry.paragraphs) || entry.paragraphs.length < 2 || entry.paragraphs.some(p => typeof p !== "string" || !p.trim())) throw new Error("essays.json: 正文无效");
    ids.add(entry.tripId);
    return entry;
  });
}

const ESSAYS = validateEssays(essaysFile);

export function tripEssay(trip: Trip, records: readonly EssayRecord[] = ESSAYS): TripEssay {
  const essay = records.find(item => item.tripId === trip.id && item.from === trip.from && item.to === trip.to
    && (!item.basis || item.basis === trip.summary) && (!item.basisTitle || item.basisTitle === trip.title));
  return essay ? { title: essay.title, paragraphs: essay.paragraphs, authored: true }
    : { title: "这一程的记录", paragraphs: [trip.summary], authored: false };
}
