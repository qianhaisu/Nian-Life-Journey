// 原则六 · Bring the Past Back — 让过去主动回来.
//
// The first version of this is deliberately one small module showing one thing at a time, and it is
// built on the only relation this archive can currently state without guessing: the calendar.
// 「去年的今天」 means a published story whose day is exactly one year before today, and nothing
// else; when there is no such day, the relation the archive can still state honestly is the month —
// 「去年的 9 月」 — and it is written as the month, never as a day. A year-old month printed as "一年
// 前的今天" would be the module inventing a relation it does not have, which is the failure 原则六
// names by name (随机轮播 / 无条件占位).
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

export type Resurfaced = {
  // The relation, in the words the page prints. Always a真实 relation, never a guess.
  relation: string;
  // "day": exactly one year ago today. "month": the same month a year ago, some other day.
  kind: "day" | "month";
  memory: EditorialMemory;
};

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
 * One story the archive can honestly say the reader is being reminded of, or nothing.
 * `excludeIds` are the stories already on the page — the front page's own cover, so that "忽然想起"
 * never shows the reader what they are already looking at.
 */
export function resurface(chapters: YearChapter[], today: string, excludeIds: ReadonlySet<string> = new Set()): Resurfaced | undefined {
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
