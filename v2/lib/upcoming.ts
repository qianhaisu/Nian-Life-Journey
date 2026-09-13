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
//   5. 只显示人工 approved 的事项 (总指挥, 2026-09-13). An extracted todo can name the wrong
//      person — the same chat patterns that find 「小年明天带尿不湿」 also find a parent's own
//      hospital appointment — so the family page shows reviewed rows only. That gate is the
//      store's `readUpcomingFeedForFamily()`, which fixes `decisions` to `approved` so a caller
//      cannot forget to, and which answers `not_extracted` rather than `no_items` when rows exist
//      but nobody has read them: with 21 unreviewed rows and none approved, 「已检查，没有待办」
//      would be a claim about the family's week resting on a queue nobody has looked at. This file
//      had its own copy of that rule for a few hours on 2026-09-13; the store's is the one kept,
//      and `feedFromResult` is the second gate rather than a second implementation.
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

// 分组与排序 (总指挥, 2026-09-13). 一条条按日期排下来，最前面的是八月十一号那双忘在学校的鞋子——
// 它确实还没人标完成，但家人打开首页最先要看的不是一个月前的旧账。所以分成五组，按下面的次序读：
//
//   1 今天和之后      还没完成、有明确日子、日子还没过的 —— 越近越前
//   2 时间待确认      还没完成、明确要做，但没人能说出哪一天
//   3 待定的计划      还没定下来的，保留「待定」标签；有日子的按日子排，没日子的随后
//   4 过了日子还没完成 日子过了、仍然没有人说完成 —— 离今天越近越前
//   5 已经完成        保留删除线、日期、来源与上下文
//   6 已经取消        单独一组，永远不和「已经完成」混在一起
//
// 三条规则写在代码里而不是留给排序去碰运气：
//
//   · 区间看的是结束那天。「下周出游」写的是 9 月 7 日到 9 月 13 日，今天是 13 号，它还盖着今天，
//     不算过期。用开始日判断会把它错判成旧账。
//   · 改期的事项按它**现在**的时间归组（契约里 rescheduled 仍是「还没完成」），改期标记照旧显示。
//   · 过期不是一种状态。这里只决定它排在哪一组，库里的行一个字都不动 —— 不会因为日子过了就被
//     标成完成、取消或删掉。
export type UpcomingGroupKey = "upcoming" | "undated" | "tentative" | "overdue" | "done" | "cancelled";
export type UpcomingGroup = { key: UpcomingGroupKey; label: string; items: UpcomingItem[] };

export const UPCOMING_GROUP_LABEL: Record<UpcomingGroupKey, string> = {
  upcoming: "今天和之后",
  undated: "时间待确认",
  tentative: "待定的计划",
  overdue: "过了日子，还没完成",
  done: "已经完成",
  cancelled: "已经取消",
};

// 一件事「什么时候结束」。区间用结束日，单日就是那天，说不清的没有。
function endDayOf(when: UpcomingWhen): string | undefined {
  return when.kind === "day" ? when.day : when.kind === "window" ? when.toDay : undefined;
}
// 排序用的那一天：区间用开始日，这样同一组里先看到先开始的。
function startDayOf(when: UpcomingWhen): string | undefined {
  return when.kind === "day" ? when.day : when.kind === "window" ? when.fromDay : undefined;
}
// 「还没完成的明确待办」：open 与 rescheduled。契约的 isStillOpen 也把 tentative 算进去，
// 那是「行还活着」的意思；这里要分的是「是不是一件定下来的事」，所以另算。
const isCommitment = (status: UpcomingStatus) => status === "open" || status === "rescheduled";

export function groupUpcoming(items: UpcomingItem[], today: string): UpcomingGroup[] {
  const buckets: Record<UpcomingGroupKey, UpcomingItem[]> = { upcoming: [], undated: [], tentative: [], overdue: [], done: [], cancelled: [] };
  for (const item of items) {
    const end = endDayOf(item.when);
    if (item.status === "done") buckets.done.push(item);
    else if (item.status === "cancelled") buckets.cancelled.push(item);
    else if (item.status === "tentative") buckets.tentative.push(item);
    else if (!isCommitment(item.status)) buckets.tentative.push(item);
    else if (!end) buckets.undated.push(item);
    else if (end < today) buckets.overdue.push(item);
    else buckets.upcoming.push(item);
  }
  const byDay = (direction: 1 | -1) => (a: UpcomingItem, b: UpcomingItem) => {
    const da = startDayOf(a.when) ?? "";
    const db = startDayOf(b.when) ?? "";
    if (da !== db) return direction * da.localeCompare(db);
    return a.id.localeCompare(b.id);
  };
  buckets.upcoming.sort(byDay(1));
  buckets.undated.sort((a, b) => a.id.localeCompare(b.id));
  // 待定：有日子的按日子排在前，没日子的随后。
  buckets.tentative.sort((a, b) => {
    const da = startDayOf(a.when);
    const db = startDayOf(b.when);
    if (Boolean(da) !== Boolean(db)) return da ? -1 : 1;
    return da && db ? byDay(1)(a, b) : a.id.localeCompare(b.id);
  });
  buckets.overdue.sort(byDay(-1));
  buckets.done.sort(byDay(-1));
  buckets.cancelled.sort(byDay(-1));
  const order: UpcomingGroupKey[] = ["upcoming", "undated", "tentative", "overdue", "done", "cancelled"];
  return order
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: UPCOMING_GROUP_LABEL[key], items: buckets[key] }));
}

// 默认露出几条，按上面的组序取。其余全部在「展开全部」里，一条都不会丢 —— 组名在两边都写出来，
// 所以一组被折叠线切成两半时，读者两边都知道自己在看什么。
export function splitUpcomingGroups(groups: UpcomingGroup[], visible = UPCOMING_VISIBLE): { head: UpcomingGroup[]; rest: UpcomingGroup[] } {
  const head: UpcomingGroup[] = [];
  const rest: UpcomingGroup[] = [];
  let left = visible;
  for (const group of groups) {
    const take = Math.max(0, Math.min(left, group.items.length));
    if (take > 0) head.push({ ...group, items: group.items.slice(0, take) });
    if (take < group.items.length) rest.push({ ...group, items: group.items.slice(take) });
    left -= take;
  }
  return { head, rest };
}

// The data track's four-state read → what the page draws. `pendingReview` is how many rows are
// waiting on a human; with any of those, an empty approved list is a backlog and not a clear week,
// so nothing is drawn. Through `readUpcomingFeedForFamily` that case never even reaches here (it
// answers `not_extracted`), and the parameter stays because this function must be safe for any
// caller and because it is how the rule is tested.
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

export type UpcomingRead = () => Promise<UpcomingFeedResult>;

// What the front page calls: the store's family read (approved only, and never an approved-empty
// queue dressed up as an empty week), through the page's own gate. Injectable so the rules above
// can be tested without a database.
export async function readHomeUpcoming(read?: UpcomingRead): Promise<UpcomingFeed> {
  const load = read ?? (await import("@/lib/db/upcoming-store")).readUpcomingFeedForFamily;
  try { return feedFromResult(await load()); }
  catch (error) { return { status: "unavailable", reason: `the upcoming read threw: ${String((error as Error)?.message ?? error)}` }; }
}
