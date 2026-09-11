// 原则六 · Bring the Past Back — 让过去主动回来.
//
// One small module, one relation at a time, and every relation is one the archive can show its
// working for. There are two kinds, and the stronger one is preferred:
//
// 1. A GROUP — the same change in him, read at its different stages: 「同一种成长变化的前后」 and
//    「第一次 vs 现在」 from 原则六's own list. 问他鼻子在哪里他去摸你的鼻子 (10 个月) → 会说 ball
//    (1 岁 7 个月) → 老师说他开始要说话了 (1 岁 8 个月) is a thing that happened to a person over
//    nine months, and reading it in one place is the whole point of keeping an archive. Which
//    stories belong to one group is NOT computed here and must never be guessed from titles or
//    tags: somebody read them and recorded the grouping in the review ledger (echoGroupsFrom).
//
// 2. THE CALENDAR — 「去年的今天」 means a published story whose day is exactly one year before
//    today, and nothing else; when there is no such day, the relation still honestly available is
//    the month, 「去年的 9 月」, and it is written as the month, never as a day. A year-old month
//    printed as "一年前的今天" would be the module inventing a relation it does not have, which is
//    the failure 原则六 names by name (随机轮播 / 无条件占位).
//
// What this refuses to do:
//   - reach for a picture. It picks a STORY; the story's own lead photograph travels with it if it
//     has one (lib/media/story-binding.ts decides that, not this file). "随便挑了一张旧照片" is the
//     violation 原则六's 检验 sentence calls out, so there is no photo-first path here at all.
//   - draw at random. Among the days a relation genuinely covers, the choice is deterministic:
//     the strongest weight first (原则五 — a milestone is what makes a reader stop), then the day
//     closest to today's date, then the earlier day. Refreshing does not reshuffle the past.
//   - render anything when nothing hits. No placeholder, no 「暂无」, no widening of the window
//     until something turns up. The caller renders the section only when this returns a value.
//
// Drafts never reach here: `chapters` carries published memories only (lib/family-archive.ts), so
// a preview-marked story cannot surface on the family's front page.
import type { EditorialMemory, YearChapter } from "@/lib/memory-chapters";
import type { MemoryWeight } from "@/lib/types";

// `relation` is the line the page prints, and in every case it is a relation somebody can check:
// a date, a month, or the name a reviewer gave a group of stories about one change.
export type Resurfaced =
  // "day": exactly one year ago today. "month": that month a year ago, some other day.
  | { kind: "day" | "month"; relation: string; memory: EditorialMemory }
  // "echo": the same change read at its stages, oldest first.
  | { kind: "echo"; relation: string; stages: EditorialMemory[] };

/** The review-ledger rows that record "these stories are stages of one change". */
export const ECHO_GROUP_KIND = "echo_group";
export const ECHO_GROUP_PROVIDER = "nianlife-preview";
export const ECHO_GROUP_PROMPT_VERSION = "echo-group-v1";
// A group reads as a group, not as a list: two stages are a before and an after, and beyond four
// the module stops being the small thing 原则六 asks for.
export const ECHO_STAGES_MIN = 2;
export const ECHO_STAGES_MAX = 4;

export type EchoGroup = { key: string; label: string; eventIds: string[] };

/**
 * Reads the groupings out of the review ledger. One row per (group, story):
 * `target_kind = "echo_group"`, `target_id = "<groupKey>|<eventId>"`, and `reason_codes[0]` is the
 * name the page prints for the group. Gated on target_kind + provider + prompt_version, not on
 * `decision` — assembleStore() rewrites any decision value outside its own union, so that column
 * cannot carry meaning here (lib/preview-reading.ts documents the same hazard).
 */
export function echoGroupsFrom(
  reviews: ReadonlyArray<{ targetKind?: string | null; targetId?: string | null; provider?: string | null; promptVersion?: string | null; reasonCodes?: string[] | null }>,
): EchoGroup[] {
  const byKey = new Map<string, EchoGroup>();
  for (const review of reviews) {
    if (review.targetKind !== ECHO_GROUP_KIND) continue;
    if (review.provider !== ECHO_GROUP_PROVIDER || review.promptVersion !== ECHO_GROUP_PROMPT_VERSION) continue;
    const parts = (review.targetId ?? "").split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    const label = (review.reasonCodes ?? []).map((line) => line.trim()).find(Boolean);
    if (!label) continue;
    const existing = byKey.get(parts[0]);
    if (existing) existing.eventIds.push(parts[1]);
    else byKey.set(parts[0], { key: parts[0], label, eventIds: [parts[1]] });
  }
  return [...byKey.values()];
}

const WEIGHT_RANK: Record<MemoryWeight, number> = { chapter: 0, highlight: 1, memory: 2, trace: 3 };

// `today` is already an Asia/Shanghai calendar day (lib/time-truth.ts productToday), and so is every
// signature day, so this is plain string arithmetic on one calendar — the same reasoning
// lib/home-recent-pick.ts's window uses. 2 月 29 日 simply finds no match in a non-leap year, which
// is the correct answer rather than a silently shifted date.
export function sameDayLastYear(today: string): string {
  const year = Number(today.slice(0, 4));
  return `${year - 1}${today.slice(4)}`;
}

function published(chapters: YearChapter[]): EditorialMemory[] {
  const memories: EditorialMemory[] = [];
  for (const year of chapters) for (const month of year.months) memories.push(...month.memories);
  return memories;
}

/**
 * The strongest group the archive can read today, or nothing. A group needs at least two stages the
 * family can actually open — a draft is not a stage on the front page — and among the groups that
 * qualify the one whose latest stage is most recent wins, because that is the change he is in the
 * middle of. Deterministic: refreshing the page does not rotate through them.
 */
export function selectEchoGroup(groups: EchoGroup[], chapters: YearChapter[], today: string, excludeIds: ReadonlySet<string> = new Set()): Resurfaced | undefined {
  const byId = new Map(published(chapters).map((memory) => [memory.id, memory]));
  const readable = groups
    .map((group) => ({
      label: group.label,
      // Oldest first: a change is read in the order it happened, and the ages beside the dates are
      // what carry the distance between the stages.
      stages: [...new Set(group.eventIds)]
        .map((id) => byId.get(id))
        .filter((memory): memory is EditorialMemory => Boolean(memory) && !excludeIds.has(memory!.id) && memory!.signature.day <= today)
        .sort((a, b) => a.signature.day.localeCompare(b.signature.day) || a.id.localeCompare(b.id))
        .slice(0, ECHO_STAGES_MAX),
    }))
    .filter((group) => group.stages.length >= ECHO_STAGES_MIN);
  if (readable.length === 0) return undefined;
  const newest = (group: { stages: EditorialMemory[] }) => group.stages[group.stages.length - 1].signature.day;
  const best = [...readable].sort((a, b) => newest(b).localeCompare(newest(a)) || a.label.localeCompare(b.label))[0];
  return { kind: "echo", relation: best.label, stages: best.stages };
}

/**
 * One thing the archive can honestly say the reader is being reminded of, or nothing.
 * `excludeIds` are the stories already on the page — the front page's own cover, so that "忽然想起"
 * never shows the reader what they are already looking at. `groups` is optional: with none recorded,
 * this falls back to the calendar, which is what the front page showed before groups existed.
 */
export function resurface(chapters: YearChapter[], today: string, excludeIds: ReadonlySet<string> = new Set(), groups: EchoGroup[] = []): Resurfaced | undefined {
  const echo = selectEchoGroup(groups, chapters, today, excludeIds);
  if (echo) return echo;
  const anniversary = sameDayLastYear(today);
  const lastYearMonth = anniversary.slice(0, 7);
  const candidates = published(chapters).filter((memory) => !excludeIds.has(memory.id) && memory.signature.day <= today);
  const todayDate = Number(today.slice(8, 10));
  // Nearest to today's date within the month, so 「去年的 9 月」 really is 去年的这个时候.
  const distance = (memory: EditorialMemory) => Math.abs(Number(memory.signature.day.slice(8, 10)) - todayDate);
  const strongestFirst = (a: EditorialMemory, b: EditorialMemory) =>
    WEIGHT_RANK[a.weight] - WEIGHT_RANK[b.weight] || distance(a) - distance(b) || a.signature.day.localeCompare(b.signature.day) || a.id.localeCompare(b.id);

  const onTheDay = candidates.filter((memory) => memory.signature.day === anniversary).sort(strongestFirst)[0];
  if (onTheDay) return { relation: "去年的今天", kind: "day", memory: onTheDay };

  const inTheMonth = candidates.filter((memory) => memory.signature.day.slice(0, 7) === lastYearMonth).sort(strongestFirst)[0];
  if (inTheMonth) return { relation: `去年的 ${Number(lastYearMonth.slice(5, 7))} 月`, kind: "month", memory: inTheMonth };

  return undefined;
}
