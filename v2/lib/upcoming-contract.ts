// 近期待办 — the data track's half of the contract: what a todo IS, what the server hands the page,
// and what "we have nothing to show" is allowed to mean.
//
// The page track owns lib/upcoming.ts (rendering, ordering, the fail-closed normaliser). This file
// owns the shape and the feed, and is the only file either track should widen. `UpcomingItem` here
// is field-for-field the item that file already normalises, deliberately: rows produced here pass
// through `normalizeUpcoming` unchanged, and the day that duplicate is collapsed, it collapses
// onto this one.
//
// THE ONE RULE THIS FILE EXISTS FOR. "No rows" is not one state, it is four, and three of them
// must never be rendered as 「没有待办」:
//
//   not_extracted      nothing has ever run, or the store is not wired up yet
//   read_failed        we tried and could not read — a family is told nothing, not "you are free"
//   no_items           we really did read the covered window and there is genuinely nothing in it
//   ready              items, plus what was covered to find them
//
// Only `no_items` and `ready` are statements about the family's week, and both carry `coverage` so
// the page can say WHICH window it is talking about. A feed that cannot say what it covered cannot
// claim a clear week.

/** 确定待办 vs 待定计划. Kept separately from `status` because a plan that gets cancelled is still
 *  a plan that was cancelled — the page shows status, the archive keeps both. */
export type UpcomingKind = "commitment" | "plan";

export type UpcomingStatus = "open" | "tentative" | "done" | "rescheduled" | "cancelled";

/** When it falls. A resolved day, a resolved span, or an explicit "we do not know" — never a date
 *  this code inferred from silence, and never the raw words of the message. */
export type UpcomingWhen =
  | { kind: "day"; day: string }
  | { kind: "window"; fromDay: string; toDay: string }
  | { kind: "unconfirmed" };

/** How the date was arrived at. `unconfirmed` rows keep the words instead (see `whenOriginalText`),
 *  which is what 「时间不清楚就标注待确认，不猜具体日期」 means in a column. */
export type UpcomingWhenCertainty = "stated" | "resolved_from_message_time" | "unconfirmed";

/** Where a reader can go to check it. Never chat text: a published story, or the month it sits in.
 *  The raw message ids stay server-side on the record and never reach a page. */
export type UpcomingEvidence = { eventId?: string; day?: string };

/** What the page renders. Identical in shape to lib/upcoming.ts's UpcomingItem. */
export type UpcomingItem = {
  id: string;
  title: string;
  note?: string;
  when: UpcomingWhen;
  status: UpcomingStatus;
  evidence?: UpcomingEvidence;
  statusNote?: string;
  statusEvidence?: UpcomingEvidence;
  supersedes?: string[];
};

/** One recorded change to an item, with the message that proves it. This is what stops a
 *  strikethrough from ever being a guess: `done` without a row here cannot be stored. */
export type UpcomingChange = {
  at: string;
  day: string;
  change: "created" | "restated" | "rescheduled" | "cancelled" | "done";
  fromStatus?: UpcomingStatus;
  toStatus: UpcomingStatus;
  fromWhen?: UpcomingWhen;
  toWhen?: UpcomingWhen;
  note?: string;
  quote?: string;
  sourceIds: string[];
  batchId: string;
};

/** The full server-side row. Everything the page item has, plus the provenance a page must not
 *  carry: which messages it stands on, which run produced it, and whether a human has read it. */
export type UpcomingItemRecord = UpcomingItem & {
  profileId: string;
  kind: UpcomingKind;
  category?: string;
  whenCertainty: UpcomingWhenCertainty;
  /** The words, kept verbatim, when no day could be resolved. Never shown as a date. */
  whenOriginalText?: string;
  /** How a resolved day was arrived at, e.g. 「消息发于 2026-09-03，说『明天』」. */
  whenBasis?: string;
  whoAsked?: string;
  /** The message this item was first recognised in. Stable across re-runs; the id derives from it. */
  anchorSourceId: string;
  sourceIds: string[];
  changes: UpcomingChange[];
  extractionBatchId: string;
  firstSeenAt: string;
  updatedAt: string;
  /** Its own gate, separate from content_quality_reviews and never written by the extractor. */
  reviewDecision: "needs_human_review" | "approved" | "rejected";
  visibility: "family" | "private";
};

/** What each conversation actually held, and how far it really reached. `lastMessageAt` is the last
 *  MESSAGE covered — never the clock time the extractor ran, which would claim freshness the
 *  source does not have. */
export type UpcomingSourceCoverage = {
  conversationRef: string;
  messagesInWindow: number;
  lastMessageAt: string | null;
  status: "covered" | "partial" | "failed" | "out_of_scope";
  reason?: string;
};

export type UpcomingCoverage = {
  windowFrom: string;
  /** The newest message any covered conversation holds. Not a run timestamp. */
  windowToMessageAt: string | null;
  batchId: string;
  ranAt: string;
  conversations: UpcomingSourceCoverage[];
  unitsTotal: number;
  unitsCovered: number;
  unitsFailed: number;
  /** True when some part of the window could not be read. A page must not say "nothing to do" on a
   *  run that only half happened. */
  partial: boolean;
  /** Windows older than `windowFrom` were deliberately not scanned, so items that were only ever
   *  mentioned before it are missing by design, not by accident. */
  olderThanWindowNotScanned: true;
};

export type UpcomingFeedResult =
  | { state: "not_extracted"; reason: string }
  | { state: "read_failed"; reason: string; error: string }
  | { state: "no_items"; coverage: UpcomingCoverage }
  | { state: "ready"; items: UpcomingItem[]; coverage: UpcomingCoverage; unreviewed: number };

export const UPCOMING_STATUSES: readonly UpcomingStatus[] = ["open", "tentative", "done", "rescheduled", "cancelled"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isUpcomingDay(value: unknown): value is string {
  return typeof value === "string" && DAY.test(value);
}

/** A status that asserts something CHANGED needs a source for the change. Enforced on the way in
 *  (the store refuses to save otherwise) as well as on the way out, so a strikethrough can never
 *  originate in a missing row rather than in evidence. */
export function statusNeedsEvidence(status: UpcomingStatus): boolean {
  return status === "done" || status === "rescheduled" || status === "cancelled";
}

/** The page-facing projection. Drops every server-side field: raw message ids, the batch, the
 *  reviewer's decision and the speaker never cross this line. */
export function toUpcomingItem(record: UpcomingItemRecord): UpcomingItem {
  return {
    id: record.id,
    title: record.title,
    note: record.note,
    when: record.when,
    status: record.status,
    evidence: record.evidence,
    statusNote: record.statusNote,
    statusEvidence: record.statusEvidence,
    supersedes: record.supersedes?.length ? record.supersedes : undefined,
  };
}

/** A day that has come and gone does NOT close anything. An overdue commitment stays exactly as
 *  open as it was — the rule 「逾期且未明确结束的事项保留」 lives here so no read path can quietly
 *  drop it by moving a window. */
export function isStillOpen(record: Pick<UpcomingItemRecord, "status">): boolean {
  return record.status === "open" || record.status === "tentative" || record.status === "rescheduled";
}

/** Overdue is a presentation fact, not a status: it never changes what the row says. */
export function isOverdue(item: Pick<UpcomingItem, "when" | "status">, today: string): boolean {
  if (item.status === "done" || item.status === "cancelled") return false;
  if (item.when.kind === "day") return item.when.day < today;
  if (item.when.kind === "window") return item.when.toDay < today;
  return false;
}
