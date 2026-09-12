// 近期待办 — the PAGE's half: what the front page renders, in what order, and the rules it enforces
// on whatever it is handed.
//
// The other half — what a todo is, where the rows live, how repeats are merged and how a four-state
// "nothing to show" is told apart — is the data track's, in lib/upcoming-contract.ts and
// lib/db/upcoming-store.ts (2026-09-13, commit 7886f14). Its `UpcomingItem` is the item this file
// normalises and sorts, so the two halves meet at one type and this file re-exports it rather than
// keeping a second copy of the shape.
//
// WHAT THIS FILE IS FOR. Four of Teddy's rules are promises a page can keep by itself, and they are
// enforced here so that no upstream mistake can put a false claim in front of the family:
//
//   1. 「只有后续信息明确证明同一事项已经完成，才显示删除线」. A strikethrough is a claim that
//      something was done. `done` therefore requires `statusEvidence`; without it the item renders
//      as OPEN. The store refuses to write such a row in the first place (statusNeedsEvidence), and
//      this is the same gate on the way out: a date that has passed, a silent thread, or a
//      photograph from that day is not evidence of anything.
//   2. 「时间不清楚就标注待确认，不猜具体日期」. There is no free-text date on an item: `when` is a
//      resolved day, a resolved window, or the explicit `unconfirmed`, and anything malformed
//      becomes `unconfirmed` rather than a guess.
//   3. 「未确定的计划明确标注待定」. `tentative` is its own status with its own label.
//   4. 「不得把数据未接入显示成没有待办」. The feed has four ways of having no rows
//      (lib/upcoming-contract.ts) and only ONE of them — `no_items`, a window really read with
//      nothing in it — can be a statement about the family's week. `feedFromResult` lets that one
//      through as `clear` ONLY when the run covered its whole window with no failed unit, and only
//      when nothing is sitting unreviewed behind it. `not_extracted`, `read_failed`, a partial run
//      and a queue waiting on a human all render nothing at all.
//
//   5. 只显示人工 approved 的事项 (总指挥, 2026-09-13). The store's default read returns approved
//      AND needs_human_review rows, with a count of the unreviewed ones; the family page takes
//      approved only (`HOME_UPCOMING_DECISIONS`), because an extracted todo can name the wrong
//      person — the same chat patterns that find 「小年明天带尿不湿」 also find a parent's own
//      hospital appointment. `readHomeUpcoming` is where that decision lives, and it is also why
//      「没有待办」 needs a second look at the review queue: with 22 unreviewed rows and no approved
//      one, the approved-only read answers `no_items`, and saying 没有待办 on the strength of that
//      would be reporting a backlog as a clear week.
import { isUpcomingDay, statusNeedsEvidence, type UpcomingCoverage, type UpcomingEvidence, type UpcomingFeedResult, type UpcomingItem, type UpcomingStatus, type UpcomingWhen } from "@/lib/upcoming-contract";

export type { UpcomingEvidence, UpcomingItem, UpcomingStatus, UpcomingWhen };

export type UpcomingFeed =
  | { status: "unavailable"; reason: string }
  | { status: "ready"; items: UpcomingItem[] }
  // A window that was really read, end to end, with nothing in it and nothing waiting on a
  // reviewer. The only case in which this page may say there is nothing to do, and it says which
  // period it read when it does.
  | { status: "clear"; windowFrom: string; readToDay?: string };

// How many items the front page shows before the rest go behind 展开全部. Four keeps the block from
// pushing 近况 and the day's story off a phone screen; nothing is dropped — see the component.
export const UPCOMING_VISIBLE = 4;

const STATUSES: ReadonlySet<string> = new Set<UpcomingStatus>(["open", "tentative", "done", "rescheduled", "cancelled"]);

function evidenceOf(raw: unknown): UpcomingEvidence | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as { eventId?: unknown; day?: unknown };
  const eventId = typeof value.eventId === "string" && value.eventId.trim() ? value.eventId.trim() : undefined;
  const day = isUpcomingDay(value.day) ? value.day : undefined;
  return eventId || day ? { eventId, day } : undefined;
}

function whenOf(raw: unknown): UpcomingWhen {
  if (!raw || typeof raw !== "object") return { kind: "unconfirmed" };
  const value = raw as { kind?: unknown; day?: unknown; fromDay?: unknown; toDay?: unknown };
  if (value.kind === "day" && isUpcomingDay(value.day)) return { kind: "day", day: value.day };
  if (value.kind === "window" && isUpcomingDay(value.fromDay) && isUpcomingDay(value.toDay)) {
    // A window whose ends arrived reversed is still two real days; order them rather than drop it.
    return value.fromDay <= value.toDay ? { kind: "window", fromDay: value.fromDay, toDay: value.toDay } : { kind: "window", fromDay: value.toDay, toDay: value.fromDay };
  }
  // Anything else — a free-text date, a missing one, a malformed one — is "we do not know", which
  // is a state the page prints. It is never turned into a guessed day.
  return { kind: "unconfirmed" };
}

// One item as handed over → one item the page may draw, or nothing. Fail-closed on every field the
// page makes a claim with.
export function normalizeUpcoming(raw: unknown): UpcomingItem | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const row = raw as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!id || !title) return undefined;
  const evidence = evidenceOf(row.evidence);
  // An item nobody can check does not go in front of the family (原则八).
  if (!evidence) return undefined;
  const statusEvidence = evidenceOf(row.statusEvidence);
  const claimed = typeof row.status === "string" && STATUSES.has(row.status) ? row.status as UpcomingStatus : "open";
  // done / rescheduled / cancelled each assert that something CHANGED. Without a source for that
  // change the item is simply still open: the page never strikes a line through an assumption, and
  // a cancelled trip that cannot be shown to have been cancelled is not cancelled here.
  const status: UpcomingStatus = statusNeedsEvidence(claimed) && !statusEvidence ? "open" : claimed;
  const note = typeof row.note === "string" && row.note.trim() ? row.note.trim() : undefined;
  const statusNote = typeof row.statusNote === "string" && row.statusNote.trim() ? row.statusNote.trim() : undefined;
  const supersedes = Array.isArray(row.supersedes) ? row.supersedes.filter((value): value is string => typeof value === "string") : undefined;
  return {
    id, title, note, when: whenOf(row.when), status,
    evidence,
    statusNote: statusNeedsEvidence(status) ? statusNote : undefined,
    statusEvidence: statusNeedsEvidence(status) ? statusEvidence : undefined,
    supersedes: supersedes?.length ? supersedes : undefined,
  };
}

// Still-to-do first, and inside that the soonest first; an item whose day nobody could pin comes
// after the dated ones rather than at the top of a list of dates. What has already been settled
// (done / cancelled) sits at the end, still legible — the point of keeping a finished item on the
// page is that a family can see it WAS done, not to hide it.
const STATUS_RANK: Record<UpcomingStatus, number> = { open: 0, rescheduled: 1, tentative: 2, done: 3, cancelled: 4 };
const whenKey = (when: UpcomingWhen) => when.kind === "day" ? when.day : when.kind === "window" ? when.fromDay : "9999-99-99";

export function sortUpcoming(items: UpcomingItem[]): UpcomingItem[] {
  return [...items].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || whenKey(a.when).localeCompare(whenKey(b.when))
    || a.id.localeCompare(b.id));
}

// Which review decisions may reach the family page. approved only — see rule 5 above.
export const HOME_UPCOMING_DECISIONS: ReadonlyArray<"approved" | "needs_human_review" | "rejected"> = ["approved"];

// A coverage block is "complete" when the run it came from read every unit it set out to read.
// `partial` already folds in a failed unit and an unfinished run (lib/upcoming-merge.ts); the rest
// is spelled out rather than trusted, because this is the one predicate that lets the page tell a
// family their week is clear.
function coveredWholeWindow(coverage: UpcomingCoverage): boolean {
  return !coverage.partial
    && coverage.unitsFailed === 0
    && coverage.unitsTotal > 0
    && coverage.unitsCovered === coverage.unitsTotal
    && Boolean(coverage.windowToMessageAt);
}

// The data track's four-state read (lib/db/upcoming-store.ts readUpcomingFeed) → what the page
// draws. `pendingReview` is how many rows are waiting on a human; with any of those, an empty
// approved list is a backlog and not a clear week, so nothing is drawn.
export function feedFromResult(result: UpcomingFeedResult | undefined, { pendingReview = 0 }: { pendingReview?: number } = {}): UpcomingFeed {
  if (!result) return { status: "unavailable", reason: "no feed was read" };
  if (result.state === "not_extracted" || result.state === "read_failed") return { status: "unavailable", reason: result.reason };
  if (result.state === "no_items") {
    if (pendingReview > 0) return { status: "unavailable", reason: "nothing is approved yet and rows are waiting on a reviewer" };
    if (!coveredWholeWindow(result.coverage)) return { status: "unavailable", reason: "the run did not cover its whole window, so nothing may be said about the week" };
    return { status: "clear", windowFrom: result.coverage.windowFrom, readToDay: result.coverage.windowToMessageAt?.slice(0, 10) };
  }
  const items = sortUpcoming(result.items.map(normalizeUpcoming).filter((item): item is UpcomingItem => Boolean(item)));
  if (items.length === 0) return { status: "unavailable", reason: "no item survived the page-side gate" };
  return { status: "ready", items };
}

export type UpcomingRead = (options?: { decisions?: Array<"approved" | "needs_human_review" | "rejected"> }) => Promise<UpcomingFeedResult>;

// What the front page calls. Two reads at most, and the second one only when the first found no
// approved row: the review queue has to be looked at before the page is allowed to say 没有待办.
// Both reads are on family-scale, profile-scoped tables; the common path is one of them.
export async function readHomeUpcoming(read?: UpcomingRead): Promise<UpcomingFeed> {
  const load = read ?? (await import("@/lib/db/upcoming-store")).readUpcomingFeed;
  let approved: UpcomingFeedResult | undefined;
  try { approved = await load({ decisions: [...HOME_UPCOMING_DECISIONS] }); }
  catch (error) { return { status: "unavailable", reason: `the upcoming read threw: ${String((error as Error)?.message ?? error)}` }; }
  if (approved.state !== "no_items") return feedFromResult(approved);
  let pendingReview = 0;
  try {
    const pending = await load({ decisions: ["needs_human_review"] });
    pendingReview = pending.state === "ready" ? pending.items.length : 0;
  } catch {
    // The census failed, so the page cannot prove the queue is empty and does not claim it is.
    return { status: "unavailable", reason: "could not check the review queue" };
  }
  return feedFromResult(approved, { pendingReview });
}
