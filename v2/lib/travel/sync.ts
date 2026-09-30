import type { MonthContent } from "@/lib/month-content";
import { PLACES, TRIPS, type Trip } from "./model";

/** Manual journeys win. A new published departure is a dated record, never a guessed stay. */
export function syncTrips(contents: readonly MonthContent[], curated: readonly Trip[] = TRIPS): Trip[] {
  const trips = [...curated];
  // The place registry already contains family-confirmed residence dates.
  for (const place of PLACES) {
    const dates = place.livedIn?.match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
    if (!dates || trips.some((trip) => trip.placeIds.includes(place.id) && trip.from <= dates[1] && trip.to >= dates[1])) continue;
    trips.push({ id: `stay-${dates[1]}-${place.id}`, title: `住在${place.name}的日子`, kind: place.hometown ? "hometown" : "travel",
      from: dates[1], to: dates[2], placeIds: [place.id], summary: `这段时间住在${place.name}。`, evidence: [`地点档案的居住记录：${place.livedIn}`] });
  }
  for (const content of contents) for (const day of content.days) {
    // Only explicit, completed departures/arrivals in the published day's own title.
    // Plans, other people's journeys, cancelled journeys and quoted questions never become stamps.
    const title = day.title ?? "";
    if (/准备|计划|打算|想去|明天|下周|可能|如果|没去|没有|取消|不去|爸爸|妈妈|爷爷|奶奶|外公|外婆|[？?]|说要/.test(title)) continue;
    for (const place of PLACES.filter((item) => item.level === "city" && !item.home)) {
      const names = [place.name, ...(place.aliases ?? [])].filter((name) => name.length >= 2);
      const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
      if (!new RegExp(`(?:出发(?:回|去|到)?|回到|到了|抵达|到达|来到)(?:${escaped})`).test(title)) continue;
      if (trips.some((trip) => trip.placeIds.includes(place.id) && trip.from <= day.day && trip.to >= day.day)) continue;
      trips.push({ id: `record-${day.day}-${place.id}`, title, kind: place.hometown || place.name === "温州" ? "hometown" : "travel",
        from: day.day, to: day.day, placeIds: [place.id], coverDay: day.day,
        recordOnly: true, summary: day.paragraphs[0] ?? title,
        evidence: [`已发布日页：${day.day}`, ...(day.sourceIds ?? [])] });
    }
  }
  return trips.sort((a, b) => b.from.localeCompare(a.from) || a.id.localeCompare(b.id));
}
