// 首页「回忆浮现」：只用已经存在的数据可以证明的关系，禁止随机内容伪装成关系（PAGE-0915-FULL-REMEDIATION-R1
// 已批准的产品决策 4、验收 D3）。两档关系，按顺序找到第一个真的成立的就用，一个都没有就整块不显示：
//
//   1. 一年前同日 / N 年前同日 —— 某段记忆的日子和今天月、日相同，年份更早。这是唯一一种「今天」
//      本身就构成的关系，不需要任何猜测。
//   2. 去年的这个月 / N 年前的这个月 —— 某段记忆和今天落在同一个公历月份，年份更早。
//
// 2026-09-16 视觉验收：第二档原本是「相同月龄」。它在线上渲染出来的是「那时他也是 1 岁 8 个月大：
// 到了时间，他会自己爬上床 · 2026 年 9 月 4 日」——那天离今天只有 12 天。这不是巧合，是定义决定的：
// 「和今天月龄相同的日子」这个集合，就是他当前这个月龄区间的那三十天，永远只能落在最近一个月内。
// 一个 20 个月大的孩子，上周当然也是 1 岁 8 个月——同义反复，不是关系。原则六的检验句是「浮现出来的
// 内容是否让人停一下」，这条让人停不下来。按 R2 删掉「第一次」档的同一条理由（不用别的规则去凑一个
// 替代），把这一档换成原则六明确列出的、天然带回看距离的关系：去年这个月。
//
// PAGE-0915-FULL-REMEDIATION-R2：原来还有第三档「第一次」——标题写着「第一次」的已发布记忆，
// 同一天有多条时按「今天是一年中第几天」取模挑一条。Codex 审核指出：那个取模挑选和「今天」之间
// 没有真实关系，挑哪一条纯粹是日期对余数的巧合，本质是一套包着"确定性"外衣的任意轮换——跟"禁止
// 随机内容伪装成关系"这条要求相悖。删掉整档，不用别的规则（关键词、另一套轮换）去凑一个替代。
// 没有可靠命中就返回 undefined，整块不显示，符合原本的兜底。
//
// 不做的事：不比较标题、不猜"重要"、不读健康/私密记录、不把 lead 自己算作浮现出来的另一条。
import type { YearChapter } from "@/lib/memory-chapters";

export type HomeRecall = {
  eventId: string;
  href: string;
  title: string;
  day: string;
  dateLabel: string;
  ageLabel?: string;
  // 页面用它决定怎么把这条和"今天"接起来读，不重新判断关系种类。
  relation: "anniversary" | "same-month";
  // 「一年前的今天」「3 年前的今天」「去年的这个月」—— 已经是完整短句，
  // 页面直接拼进句子里，不再自己判断措辞。
  contextLabel: string;
};

type Candidate = { eventId: string; href: string; title: string; day: string; dateLabel: string; ageLabel?: string };

function flatten(chapters: YearChapter[]): Candidate[] {
  const out: Candidate[] = [];
  for (const year of chapters) for (const month of year.months) for (const memory of month.memories) {
    out.push({ eventId: memory.id, href: `/events/${memory.id}`, title: memory.title, day: memory.signature.day, dateLabel: memory.signature.dateLabel, ageLabel: memory.signature.ageLabel });
  }
  return out;
}

function monthDayOf(day: string): string { return day.slice(5); } // "MM-DD"
function yearOf(day: string): number { return Number(day.slice(0, 4)); }

// birthDay 现在两档都用不到了（两档关系都只看日历），签名保留以免动所有调用方。
export function selectHomeRecall(chapters: YearChapter[], today: string, _birthDay: string | undefined, excludeEventId: string | undefined): HomeRecall | undefined {
  const pool = flatten(chapters).filter((memory) => memory.eventId !== excludeEventId && memory.day !== today);
  if (pool.length === 0) return undefined;

  // 1) 一年前 / N 年前同一天：年份差最小的那条（最近的一次周年）。
  const anniversaries = pool.filter((memory) => monthDayOf(memory.day) === monthDayOf(today) && yearOf(memory.day) < yearOf(today));
  if (anniversaries.length > 0) {
    anniversaries.sort((a, b) => yearOf(b.day) - yearOf(a.day) || a.eventId.localeCompare(b.eventId));
    const memory = anniversaries[0];
    const years = yearOf(today) - yearOf(memory.day);
    return { ...memory, relation: "anniversary", contextLabel: years === 1 ? "一年前的今天" : `${years} 年前的今天` };
  }

  // 2) 去年 / N 年前的这个月：同一个公历月份、更早的年份。回看距离至少跨一个年份，
  //    不会像「相同月龄」那样退化成「上周」。最近的一年优先；同一年里取日子离今天最近的那条。
  const earlierSameMonth = pool.filter((memory) => memory.day.slice(5, 7) === today.slice(5, 7) && yearOf(memory.day) < yearOf(today));
  if (earlierSameMonth.length > 0) {
    const todayDayOfMonth = Number(today.slice(8, 10));
    const distance = (day: string) => Math.abs(Number(day.slice(8, 10)) - todayDayOfMonth);
    earlierSameMonth.sort((a, b) => yearOf(b.day) - yearOf(a.day) || distance(a.day) - distance(b.day) || a.eventId.localeCompare(b.eventId));
    const memory = earlierSameMonth[0];
    const years = yearOf(today) - yearOf(memory.day);
    return { ...memory, relation: "same-month", contextLabel: years === 1 ? "去年的这个月" : `${years} 年前的这个月` };
  }

  return undefined;
}
