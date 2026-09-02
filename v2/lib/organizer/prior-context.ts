// Prior context selection for an Evidence Window.
//
// The evidence pipeline already knows how to attach to an existing memory instead of creating a
// second one: the Memory Editor prompt renders `window.priorContext.lifeEvents` as attach targets,
// and the Validator resolves `proposedTargetId` against `ValidatorContext.existingLifeEvents`.
// Nothing ever populated either of them — every real-data caller passed `[]` — so `attach_existing`
// was unreachable and `recentSameTypeCount` was permanently 0, which pinned the redundancy penalty
// off. A smarter per-window decision does not help if the pipeline cannot see what it already wrote.
//
// This module is a pure selection over rows the caller has already loaded, so both the JSON and the
// Postgres path can use it and it stays directly testable.
import type { ContentType } from "@/lib/types";

export type PriorEvent = { id: string; occurredAt: string; title?: string; contentTypes: ContentType[]; visibility: string };
export type PriorTrace = { id: string; occurredAt: string };

export type PriorContextOptions = {
  /** How far either side of the window's activity day an event may still be the same event. */
  attachWindowDays?: number;
  /** Trailing span used to judge "we have already kept several of these lately". */
  redundancyWindowDays?: number;
  /** Upper bound on attach targets offered to the model, nearest day first. */
  maxAttachTargets?: number;
};

export type PriorContextResult = {
  priorContext: { lifeEvents: PriorEvent[]; dailyTraces: PriorTrace[] };
  existingLifeEvents: PriorEvent[];
  recentSameTypeCount: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (iso: string) => iso.slice(0, 10);
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(`${dayOf(a)}T00:00:00Z`) - Date.parse(`${dayOf(b)}T00:00:00Z`)) / DAY_MS;

// A private event is not a legal attach target (the Validator rejects one), so offering it to the
// model would only produce a proposal that is guaranteed to degrade. Callers are additionally
// expected to pass only *published* events: attaching fresh evidence to an artifact that was hidden
// by quality review would quietly bring the hidden artifact back into view.
function attachable(event: PriorEvent) {
  return event.visibility !== "private";
}

export function selectPriorContext(
  input: { activityDate: string; contentTypes: ContentType[]; lifeEvents: PriorEvent[]; dailyTraces: PriorTrace[] },
  options: PriorContextOptions = {},
): PriorContextResult {
  const attachWindowDays = options.attachWindowDays ?? 3;
  const redundancyWindowDays = options.redundancyWindowDays ?? 14;
  const maxAttachTargets = options.maxAttachTargets ?? 8;
  const types = new Set(input.contentTypes);

  const nearby = input.lifeEvents
    .filter(attachable)
    .filter((event) => daysBetween(event.occurredAt, input.activityDate) <= attachWindowDays)
    .toSorted((a, b) => daysBetween(a.occurredAt, input.activityDate) - daysBetween(b.occurredAt, input.activityDate) || a.id.localeCompare(b.id))
    .slice(0, maxAttachTargets);

  const sameDayTraces = input.dailyTraces
    .filter((trace) => dayOf(trace.occurredAt) === dayOf(input.activityDate))
    .toSorted((a, b) => a.id.localeCompare(b.id));

  // Only events strictly BEFORE this window count as "we already have several of these": an event
  // created later cannot be a reason to keep this one quieter, and counting the window's own
  // same-day event would penalise it for its own existence.
  const recentSameTypeCount = input.lifeEvents.filter((event) => {
    if (Date.parse(dayOf(event.occurredAt)) >= Date.parse(dayOf(input.activityDate))) return false;
    if (daysBetween(event.occurredAt, input.activityDate) > redundancyWindowDays) return false;
    return event.contentTypes.some((type) => types.has(type));
  }).length;

  return { priorContext: { lifeEvents: nearby, dailyTraces: sameDayTraces }, existingLifeEvents: nearby, recentSameTypeCount };
}
