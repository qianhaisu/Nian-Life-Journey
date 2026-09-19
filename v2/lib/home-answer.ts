import { ageAtMonth, formatMonth, monthAgeQualifier } from "@/lib/time-signature";

/**
 * 首页标题问「最近怎么样，张年」，这一句就是答案本身（原则一）。
 *
 * 2026-09-19 全站验收：首屏此前只有一张照片加一段日期区间，标题提的问题页面一个字都没答，
 * 而站内已经写好了二十句这样的话——就在一个页面之外的 /memory 月卡上。
 *
 * 文字来源与 /memory 月卡**完全同一条**（app/memory/page.tsx 的 snapshotBlurb）：月度快照 summary
 * 的第一行可读行。不是新写的句子，不是模板拼的，也不是数字凑的——所以它天然满足原则七。
 *
 * 取哪个月：优先当前日历月，没有就退到有 summary 的最新一个月。
 */
export type HomeAnswer = {
  /** 月度快照 summary 的第一行可读行，原文照抄。 */
  line: string;
  /** "2026-09" */
  month: string;
  /** 「2026 年 9 月 · 现在 1 岁 8 个月」——出处，供链接文案用。 */
  sourceLabel: string;
  /** "/memory/2026/09" */
  href: string;
};

/**
 * 为什么一定要把月份写出来：首屏下面那张 hero 的时钟说的是**另一段**时间（最近一周）。
 * lib/home-view.ts buildOverview 那条注释记着线上出过的事故——同一段时间被标了两个互相矛盾的
 * 年龄。两段不同的时间各自标清楚不是矛盾，不标才是。
 */
export function selectHomeAnswer(
  snapshots: readonly { month: string; summary?: string | null }[],
  today: string,
  birthDay?: string,
): HomeAnswer | undefined {
  const withSummary = snapshots
    .filter((snapshot) => snapshot.summary?.trim())
    .sort((a, b) => b.month.localeCompare(a.month));
  // 当前日历月优先；没有就退到有 summary 的最新一个月。不猜、不合成。
  const snapshot = withSummary.find((item) => item.month === today.slice(0, 7)) ?? withSummary[0];
  if (!snapshot) return undefined;

  // Markdown 列表符号是快照的书写格式，不是这句话的一部分，所以只剥行首的「- 」。
  const line = (snapshot.summary ?? "").split("\n")
    .map((raw) => raw.replace(/^-\s*/, "").trim())
    .find((raw) => raw.length > 0);
  if (!line) return undefined;

  const age = ageAtMonth(birthDay, snapshot.month);
  // 「出生的那个月」接在「当时」后面读不通（见 home-memory.ts ageSpan 同样的判断），这种时候只留月份。
  const clock = age && !age.startsWith("出生")
    ? ` · ${monthAgeQualifier(snapshot.month, today)} ${age}`
    : "";
  const [year, month] = snapshot.month.split("-");
  return {
    line,
    month: snapshot.month,
    sourceLabel: `${formatMonth(snapshot.month)}${clock}`,
    href: `/memory/${year}/${month}`,
  };
}
