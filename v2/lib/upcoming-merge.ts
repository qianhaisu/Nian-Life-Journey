// 近期待办 — the rules, with no database in them.
//
// Everything here is a pure function so that each of Teddy's rules is a test rather than a comment:
// a date that has passed closes nothing, a strikethrough needs a message behind it, two 复查 on
// different days are two things, and "no rows" is four different answers. lib/db/upcoming-store.ts
// is the thin I/O layer over this file.
import { createHash } from "node:crypto";
import {
  statusNeedsEvidence,
  type UpcomingChange,
  type UpcomingCoverage,
  type UpcomingFeedResult,
  type UpcomingItem,
  type UpcomingItemRecord,
  type UpcomingKind,
  type UpcomingStatus,
  type UpcomingWhen,
  type UpcomingWhenCertainty,
} from "./upcoming-contract";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** Stable across re-runs because it derives from the source message, never from a counter or a
 *  clock. The title is in the hash so two different commitments first said in one message
 *  (「明天带尿不湿，另外周六有活动」) stay two items. */
export function upcomingItemId(profileId: string, anchorSourceId: string, title: string): string {
  return `upcoming-${sha(`${profileId}|${anchorSourceId}|${title.trim()}`).slice(0, 20)}`;
}

/**
 * The same-item test used when two conversations carry one reminder and the anchor messages differ.
 *
 * It requires the SAME resolved date as well as the same title. That is the whole point:
 * 「同一事项有充分依据才合并；不同日期的复查、出游等不能只凭主题相同合并」. Two items titled 复查
 * on different days are two appointments, and this returns different keys for them. Two
 * `unconfirmed` items never merge at all — with no date to agree on, a shared title is not
 * evidence, so this returns null and both survive separately.
 */
export function mergeKeyOf(profileId: string, title: string, when: UpcomingWhen): string | null {
  if (when.kind === "unconfirmed") return null;
  const key = when.kind === "day" ? when.day : `${when.fromDay}..${when.toDay}`;
  return `${profileId}|${title.trim()}|${key}`;
}

export type UpcomingCandidateChange = {
  day: string;
  change: "restated" | "rescheduled" | "cancelled" | "done";
  newWhen?: UpcomingWhen;
  note?: string;
  quote?: string;
  sourceIds: string[];
};

export type UpcomingCandidate = {
  title: string;
  note?: string;
  category?: string;
  kind: UpcomingKind;
  when: UpcomingWhen;
  whenCertainty: UpcomingWhenCertainty;
  whenOriginalText?: string;
  whenBasis?: string;
  whoAsked?: string;
  anchorSourceId: string;
  sourceIds: string[];
  firstSeenDay: string;
  changes: UpcomingCandidateChange[];
};

const STATUS_FOR_CHANGE: Record<UpcomingCandidateChange["change"], UpcomingStatus> = {
  restated: "open", rescheduled: "rescheduled", cancelled: "cancelled", done: "done",
};

export type ResolvedCandidate = {
  status: UpcomingStatus;
  when: UpcomingWhen;
  statusNote?: string;
  statusEvidenceDay?: string;
  changes: Array<Omit<UpcomingChange, "at" | "batchId">>;
  /** Every refusal, with its reason. Nothing is dropped silently. */
  refusals: Array<{ reason: string }>;
};

/**
 * Walk a candidate's observed changes in day order and work out the status the EVIDENCE supports.
 *
 * Two refusals are the reason this function exists:
 *   - a change with no source message is not applied (there is nothing to show a reader);
 *   - a status that asserts something changed (done / rescheduled / cancelled) is reverted to open
 *     when no change carried a day. A strikethrough is a claim, and this is where an unsupported
 *     one dies rather than reaching a page.
 * Note what is NOT here: today's date. A commitment whose day has passed comes out exactly as open
 * as it went in — 「逾期且未明确结束的事项保留」.
 */
export function resolveUpcomingStatus(candidate: UpcomingCandidate): ResolvedCandidate {
  let status: UpcomingStatus = candidate.kind === "plan" ? "tentative" : "open";
  let when: UpcomingWhen = candidate.when;
  let statusNote: string | undefined;
  let statusEvidenceDay: string | undefined;
  const changes: ResolvedCandidate["changes"] = [];
  const refusals: Array<{ reason: string }> = [];

  for (const change of [...candidate.changes].sort((a, b) => a.day.localeCompare(b.day))) {
    if (!change.sourceIds?.length) {
      refusals.push({ reason: `change "${change.change}" on ${change.day} had no source message` });
      continue;
    }
    const next = STATUS_FOR_CHANGE[change.change];
    if (!next) { refusals.push({ reason: `unknown change "${change.change}"` }); continue; }
    const fromStatus: UpcomingStatus = status;
    const fromWhen: UpcomingWhen = when;
    // A reschedule must actually say where it moved to; without a new date it is only evidence the
    // thing is still live, which is what `restated` means.
    if (change.change === "rescheduled" && !change.newWhen) {
      refusals.push({ reason: `reschedule on ${change.day} gave no new date — kept as a restatement` });
      changes.push({ day: change.day, change: "restated", fromStatus, toStatus: fromStatus, fromWhen, toWhen: when, note: change.note, quote: change.quote, sourceIds: change.sourceIds });
      continue;
    }
    if (change.change === "rescheduled" && change.newWhen) when = change.newWhen;
    status = change.change === "restated" ? (fromStatus === "tentative" ? "tentative" : "open") : next;
    if (change.change !== "restated") { statusNote = change.note; statusEvidenceDay = change.day; }
    changes.push({ day: change.day, change: change.change, fromStatus, toStatus: status, fromWhen, toWhen: when, note: change.note, quote: change.quote, sourceIds: change.sourceIds });
  }

  if (statusNeedsEvidence(status) && !statusEvidenceDay) {
    refusals.push({ reason: `status "${status}" had no evidence — kept open` });
    status = candidate.kind === "plan" ? "tentative" : "open";
    statusNote = undefined;
  }
  return { status, when, statusNote, statusEvidenceDay, changes, refusals };
}

// ---------------------------------------------------------------------------------------------
// The four-state feed, built from rows that have already been read.
// ---------------------------------------------------------------------------------------------
export type FeedRunRow = {
  id: string;
  windowFrom: string;
  windowToMessageAt: string | null;
  startedAt: string;
  status: string;
  conversations: unknown;
  unitsTotal: number;
  unitsCovered: number;
  unitsFailed: number;
};

export type FeedInput = {
  runs: FeedRunRow[];
  records: UpcomingItemRecord[];
  includePrivate?: boolean;
};

const STATUS_RANK: Record<UpcomingStatus, number> = { open: 0, rescheduled: 1, tentative: 2, done: 3, cancelled: 4 };
const whenKey = (when: UpcomingWhen) => when.kind === "day" ? when.day : when.kind === "window" ? when.fromDay : "9999-99-99";

/** Still-to-do first, soonest first; an item nobody could date sits after the dated ones rather
 *  than at the top of a list of dates; settled things sit at the end, still legible. */
export function sortUpcoming(items: UpcomingItem[]): UpcomingItem[] {
  return [...items].sort((a, b) =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || whenKey(a.when).localeCompare(whenKey(b.when))
    || a.id.localeCompare(b.id));
}

/**
 * Turn rows into the feed the page reads. The only place that decides between the four answers,
 * and it never collapses them: `not_extracted` (nothing has run), `read_failed` (raised by the
 * caller), `no_items` (we really did cover a window and it is empty), `ready`.
 *
 * `no_items` always carries coverage, because "nothing to do" is only meaningful next to "over
 * which window" — and `partial` is true whenever any part of that window failed, so a half-finished
 * run can never present itself as a clear week.
 */
export function upcomingFeedFrom({ runs, records, includePrivate = false }: FeedInput): UpcomingFeedResult {
  if (!runs.length) return { state: "not_extracted", reason: "no extraction run has been recorded for this profile" };
  const ordered = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const newest = ordered[ordered.length - 1];
  const coverage: UpcomingCoverage = {
    windowFrom: newest.windowFrom,
    windowToMessageAt: newest.windowToMessageAt,
    batchId: newest.id,
    ranAt: newest.startedAt,
    conversations: (newest.conversations ?? []) as UpcomingCoverage["conversations"],
    unitsTotal: newest.unitsTotal,
    unitsCovered: newest.unitsCovered,
    unitsFailed: newest.unitsFailed,
    partial: ordered.some((run) => run.status !== "completed") || newest.unitsFailed > 0,
    olderThanWindowNotScanned: true,
  };
  const visible = records.filter((record) => includePrivate || record.visibility !== "private");
  if (!visible.length) return { state: "no_items", coverage };
  return {
    state: "ready",
    items: sortUpcoming(visible.map((record) => ({
      id: record.id, title: record.title, note: record.note, when: record.when, status: record.status,
      evidence: record.evidence, statusNote: record.statusNote, statusEvidence: record.statusEvidence,
      supersedes: record.supersedes?.length ? record.supersedes : undefined,
    }))),
    coverage,
    unreviewed: visible.filter((record) => record.reviewDecision === "needs_human_review").length,
  };
}
