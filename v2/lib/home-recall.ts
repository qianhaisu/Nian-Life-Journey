// 首页「回忆浮现」：只用已经存在的数据可以证明的关系，禁止随机内容伪装成关系（PAGE-0915-FULL-REMEDIATION-R1
// 已批准的产品决策 4、验收 D3）。两档关系，按顺序找到第一个真的成立的就用，一个都没有就整块不显示：
//
//   1. 一年前同日 / N 年前同日 —— 某段记忆的日子和今天月、日相同，年份更早。这是唯一一种「今天」
//      本身就构成的关系，不需要任何猜测。
//   2. 相同月龄 —— 某段记忆发生时张年的月龄，和他今天的月龄一样（同一算法 ageBetween，不是估的）。
//
// PAGE-0915-FULL-REMEDIATION-R2：原来还有第三档「第一次」——标题写着「第一次」的已发布记忆，
// 同一天有多条时按「今天是一年中第几天」取模挑一条。Codex 审核指出：那个取模挑选和「今天」之间
// 没有真实关系，挑哪一条纯粹是日期对余数的巧合，本质是一套包着"确定性"外衣的任意轮换——跟"禁止
// 随机内容伪装成关系"这条要求相悖。删掉整档，不用别的规则（关键词、另一套轮换）去凑一个替代。
// 没有可靠命中就返回 undefined，整块不显示，符合原本的兜底。
//
// 不做的事：不比较标题、不猜"重要"、不读健康/私密记录、不把 lead 自己算作浮现出来的另一条。
import type { YearChapter } from "@/lib/memory-chapters";
import { ageBetween, formatAge } from "@/lib/time-signature";

export type HomeRecall = {
  eventId: string;
  href: string;
  title: string;
  day: string;
  dateLabel: string;
  ageLabel?: string;
  // 页面用它决定怎么把这条和"今天"接起来读，不重新判断关系种类。
  relation: "anniversary" | "same-age";
  // "一年前的今天"「3 年前的今天」「那时他也是 1 岁 3 个月」—— 已经是完整短句，
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

export function selectHomeRecall(chapters: YearChapter[], today: string, birthDay: string | undefined, excludeEventId: string | undefined): HomeRecall | undefined {
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

  // 2) 相同月龄：今天的月龄和那天的月龄用同一算法算出来一样（没有出生日期就没法算，整档跳过）。
  if (birthDay) {
    const todayAge = ageBetween(birthDay, today);
    if (todayAge) {
      const sameAge = pool.filter((memory) => {
        const age = ageBetween(birthDay, memory.day);
        return age && age.years === todayAge.years && age.months === todayAge.months;
      });
      if (sameAge.length > 0) {
        sameAge.sort((a, b) => yearOf(a.day) - yearOf(b.day) || a.eventId.localeCompare(b.eventId));
        const memory = sameAge[0];
        const ageLabel = formatAge(todayAge) ?? memory.ageLabel;
        return { ...memory, relation: "same-age", contextLabel: ageLabel ? `那时他也是${ageLabel}大` : "那时他也是这个月龄" };
      }
    }
  }

  return undefined;
}
