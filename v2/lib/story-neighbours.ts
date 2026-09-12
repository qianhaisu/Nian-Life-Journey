import type { LifeEvent } from "@/lib/types";

// The story before this one and the story after it, in the order the family lived them.
//
// Until now a story page was a dead end: two links, both back to /memory, and no way to keep
// reading. The archive is chronological, so "the next page" is a real thing here — it is the next
// day somebody wrote something down — and it costs nothing to say what it is.
//
// ORDER. By `occurredAt`, ascending, with the id as a tie-break. The tie-break is not decoration:
// two stories written about the same day carry the same timestamp often enough (the importer sets
// occurredAt to the calendar day, not the message time), and without it the pair's order depends on
// whatever order the rows came back in — so 上一篇 and 下一篇 could point at each other from both
// sides, or swap between two renders of the same page. Ids are stable, so this is stable.
//
// WHAT MAY APPEAR. Only what the reader could already reach: the caller passes the publishable,
// non-private set, which is the same rule the month pages and the front page publish under. A
// draft, a store_only row, or anything awaiting review is not a neighbour, because it is not a page.
//
// ENDS. The first story has no 上一篇 and the last has no 下一篇, and those entries are simply
// absent — not disabled, not a greyed-out box saying there is nothing there. Year boundaries are not
// ends: 2025-12-31 and 2026-01-01 are neighbours like any other two days, because the sort is on the
// timestamp and knows nothing about years.
export type NeighbourCandidate = Pick<LifeEvent, "id" | "title" | "occurredAt">;
export type StoryNeighbours = { previous?: NeighbourCandidate; next?: NeighbourCandidate };

function byTimeThenId(a: NeighbourCandidate, b: NeighbourCandidate): number {
  return a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id);
}

/**
 * `current` is positioned by its own timestamp whether or not it appears in `others`, so a page
 * that is reachable but outside the public set (a private story opened by its own URL) still knows
 * where it sits, and still only ever offers neighbours the reader may actually open.
 */
export function storyNeighbours(current: NeighbourCandidate, others: readonly NeighbourCandidate[]): StoryNeighbours {
  const ordered = [current, ...others.filter((item) => item.id !== current.id)].toSorted(byTimeThenId);
  const index = ordered.findIndex((item) => item.id === current.id);
  if (index < 0) return {};
  return { previous: ordered[index - 1], next: ordered[index + 1] };
}
