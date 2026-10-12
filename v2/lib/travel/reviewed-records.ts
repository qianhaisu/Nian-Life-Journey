import type { MonthContent } from "@/lib/month-content";
import { PLACES, validateTrips, type Trip } from "./model";

type ReviewedRecord = Trip & {
  reviewStatus: "approved"; reviewedBy: "codex"; visibility: "public"; childPresent: true;
  reviewedAt: string; sourceFingerprints: { id: string; sha256: string }[];
};
const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day)
  && !Number.isNaN(Date.parse(`${day}T00:00:00Z`))
  && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
const samePlaces = (a: Trip, b: Trip) => [...a.placeIds].sort().join("|") === [...b.placeIds].sort().join("|");

/** Explicitly reviewed source records supplement title detection without rewriting existing days. */
export function mergeReviewedTravelRecords(contents: readonly MonthContent[], existing: readonly Trip[], today: string): Trip[] {
  if (!validDay(today)) throw new Error("travelRecords: invalid current date");
  const records: Trip[] = [];
  const seen = new Set<string>();
  for (const content of contents) {
    const raw = (content as MonthContent & { travelRecords?: unknown }).travelRecords;
    if (raw === undefined) continue;
    if (!Array.isArray(raw)) throw new Error("travelRecords: expected an array");
    for (const item of raw) {
      const r = item as ReviewedRecord;
      if (!r || r.reviewStatus !== "approved" || r.reviewedBy !== "codex" || r.visibility !== "public" || r.childPresent !== true
        || typeof r.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(r.reviewedAt) || Number.isNaN(Date.parse(r.reviewedAt))
        || !Array.isArray(r.sourceFingerprints) || r.sourceFingerprints.length === 0
        || r.sourceFingerprints.some((s) => !s || typeof s.id !== "string" || !s.id.startsWith("wechat-message:") || !/^[a-f0-9]{64}$/.test(s.sha256))) {
        throw new Error("travelRecords: missing confirmed child, visibility or source review");
      }
      const trip = validateTrips({ trips: [r] }, PLACES)[0];
      if (!validDay(trip.from) || !validDay(trip.to) || !trip.from.startsWith(`${content.month}-`) || trip.to > today) {
        throw new Error("travelRecords: invalid, wrong-month or future journey");
      }
      if (seen.has(trip.id) || existing.some((old) => old.id === trip.id)) throw new Error("travelRecords: duplicate journey id");
      seen.add(trip.id);
      // Reviewed fingerprints stay server-side; readers receive the same Trip shape as before.
      records.push({ id: trip.id, title: trip.title, kind: trip.kind, from: trip.from, to: trip.to,
        placeIds: trip.placeIds, summary: trip.summary, evidence: trip.evidence,
        ...(trip.coverDay ? { coverDay: trip.coverDay } : {}), ...(trip.coverMediaId ? { coverMediaId: trip.coverMediaId } : {}),
        ...(trip.recordOnly ? { recordOnly: true } : {}) });
    }
  }
  // A confirmed stay can replace an automatic single-day record for that same stay.
  // Curated journeys are immutable, even when their dates overlap a reviewed record.
  const kept = existing.filter((old) => !old.recordOnly || !records.some((r) => samePlaces(old, r) && r.from <= old.from && r.to >= old.to));
  return [...kept, ...records].sort((a, b) => b.from.localeCompare(a.from) || a.id.localeCompare(b.id));
}
