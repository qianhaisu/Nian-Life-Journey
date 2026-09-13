// 待办保鲜：一件事什么时候不该再占首页 (HOME-20260913, 2026-09-13).
//
// 为什么要有这个文件。2026-09-13 线上首页「近期待办」默认位上最靠前的两条，一条是 28 天前提出的
// 一次性采购，一条是 23 天前提出的、没有期限的一件小事。两条谁都没标完成，所以它们在库里确实还是
// open；但一个家人打开首页看到的不是「张年最近怎么样」，是一份一个月前的旧账。
// （这两条的真实标题与提出日属于家庭原文，不进仓库：见 NianlifeOps/home-2026-09-13/data/
//   home-feed-verification.json 的「逐条保鲜判定」。）
//
// 这个文件只回答一个问题：**这条事项还新鲜吗**。它不回答「做完了吗」——那要证据，在别处
// （lib/upcoming-contract.ts statusNeedsEvidence，库里写不进一个没有证据的 done）。
//
// 退场 ≠ 完成（共同规格 §6.1）。这里算出来的 stale 只影响首页露不露出，库里那一行、它的来源、
// 它的状态轨迹一个字都不动。一条 open 的事项退场之后仍然是 open，仍然可达。
//
// 起算点是**原始事项被提出的那天**，不是导入的那天、不是 AI 重跑的那天、更不是打开页面的那天
// （§6.2）。那一天在页面投影里就是 `item.evidence.day`——lib/db/upcoming-store.ts 写的是
// `evidence: { day: candidate.firstSeenDay }`，firstSeenDay 是**消息日**，而 `firstSeenAt` 才是
// 入库时刻。两者差着好几个月：这批微信记录是 2026 年导进来的，消息本身是 2025 年说的。
// 拿 firstSeenAt 当起算点，会让 2025 年的一句话在 2026 年导入当天变成「新鲜的待办」。
import { isUpcomingDay, type UpcomingItem, type UpcomingWhen } from "@/lib/upcoming-contract";
import { formatDay } from "@/lib/time-signature";

/**
 * 一条事项按哪种保鲜规则处理。顺序即优先级，从上往下第一个命中的胜出。
 *
 * - `dated`：有明确期限。**沿用原意**，到期日之后才算过期（§6.2 第一句）。
 * - `important`：接种、就诊这类。**永不按时钟过期**（§6.4、§6.7），没有结果就一直是待核实。
 * - `habit`：习惯提醒，7 天关注周期，最多两个不同日期露出（§6.3）。
 * - `stock_forecast`：库存预测类，72 小时（§6.2）。
 * - `errand`：一次性、没有期限的临时事项（临时采购是其中一类），48 小时（§6.2）。
 * - `undecided_plan`：还没定下来的计划。**不按时钟过期**——见下面 UNDECIDED_PLAN 那段。
 */
export type FreshnessClass = "dated" | "important" | "habit" | "stock_forecast" | "errand" | "undecided_plan";

/** 各类的新鲜期，小时。数字来自共同规格 §6.2 / §6.3，不是这里定的。 */
export const FRESHNESS_HOURS: Record<"errand" | "stock_forecast" | "habit", number> = {
  errand: 48,
  stock_forecast: 72,
  habit: 7 * 24,
};

/** 同一条习惯提醒最多露出几个不同日期（§6.3）。 */
export const HABIT_MAX_DATES = 2;

/**
 * 关键事项的词表。**刻意短而具体**：宁可把一件重要的事漏判成普通事项（它会按 48 小时退场，
 * 但仍然可达、状态不变），也不要把一件普通琐事抬成「关键健康事项」而永远不退场——
 * 那样首页又会长回成一份旧账，只是这次挂着「关键」两个字。
 */
const IMPORTANT_WORDS = ["接种", "疫苗", "补种", "就诊", "看医生", "体检", "门诊", "住院", "复查", "打针"];

/** 库存预测类：说的是「还剩多少 / 快没了」，不是「某天要做什么」。 */
const STOCK_WORDS = ["快没了", "用完了", "还剩", "不够了", "备货", "囤", "补货", "存货"];

/** 习惯提醒：一个反复的关注，不是一件一次性的事。 */
const HABIT_WORDS = ["每天", "每晚", "每周", "习惯", "坚持", "按时", "规律", "作息"];

const hit = (text: string, words: string[]) => words.some((word) => text.includes(word));

const textOf = (item: Pick<UpcomingItem, "title" | "note">) => `${item.title}${item.note ?? ""}`;

/** 接种/就诊等关键事项。它是 FreshnessClass 的一档，也被首页排序单独用到。 */
export function isImportantItem(item: Pick<UpcomingItem, "title" | "note">): boolean {
  return hit(textOf(item), IMPORTANT_WORDS);
}

const endDayOf = (when: UpcomingWhen): string | undefined =>
  when.kind === "day" ? when.day : when.kind === "window" ? when.toDay : undefined;

function dayNumberOf(day: string): number {
  return Math.floor(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000);
}

function addDays(day: string, days: number): string {
  return new Date((dayNumberOf(day) + days) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 起算点：这件事是哪天被提出来的。
 *
 * `evidence.day` 是 lib/db/upcoming-store.ts 从 `candidate.firstSeenDay` 写进去的**消息日**。
 * 它是页面投影里唯一一个真的表示「什么时候说的」的字段，也是唯一一个不会被重放推着往前走的——
 * upcoming-store 的合并分支现在取两者里更早的那天，所以同一来源重放不会给事项续期（§6.5）。
 *
 * 拿不到就返回 undefined，**不拿今天顶替**：用今天当起算点会让每一条无期限事项在每次打开页面时
 * 重新变得新鲜，那正是这个文件要防的事。
 */
export function raisedOnOf(item: Pick<UpcomingItem, "evidence">): string | undefined {
  const day = item.evidence?.day;
  return isUpcomingDay(day) ? day : undefined;
}

/**
 * 合并一条已存在的事项时，提出日取哪一个：**更早的那个**。
 *
 * 同一件事被第二条消息再说一次，新候选的 `firstSeenDay` 是那条更晚的消息的日子。直接写下去，
 * 一条 8 月 16 日提出的事项就会因为 9 月的一次重放变成「9 月才提出的」，48 小时的新鲜期跟着
 * 重新开始——这正是 §6.5 禁止的「来源重放给事项续期」，也是「重放同一来源是幂等的」的反面。
 *
 * 所以这里只许往早走，不许往晚走。更晚的那次沉在 `sourceIds` 和 changes 里，一条都没丢。
 * 规则放在这个纯函数里而不是留在 SQL 旁边，是为了它能被直接测到（lib/db/upcoming-store.ts 的
 * 合并分支调它）。
 */
export function pinnedRaisedOn(existingDay: string | undefined | null, candidateDay: string | undefined | null): string | undefined {
  const a = isUpcomingDay(existingDay) ? existingDay : undefined;
  const b = isUpcomingDay(candidateDay) ? candidateDay : undefined;
  if (a && b) return a < b ? a : b;
  return a ?? b;
}

export function classifyFreshness(item: Pick<UpcomingItem, "title" | "note" | "when" | "status">): FreshnessClass {
  if (endDayOf(item.when)) return "dated";
  if (isImportantItem(item)) return "important";
  const text = textOf(item);
  if (hit(text, HABIT_WORDS)) return "habit";
  if (hit(text, STOCK_WORDS)) return "stock_forecast";
  // 待定的计划不是「临时事项」：它没有过期，只是还没定。见下面 UNDECIDED_PLAN。
  if (item.status === "tentative") return "undecided_plan";
  return "errand";
}

export type FreshnessVerdict = {
  klass: FreshnessClass;
  /** 起算点：原始事项被提出的那天（消息日）。 */
  raisedOn?: string;
  /** 新鲜期的最后一天（含）。undefined = 这一类不按时钟过期。 */
  freshThrough?: string;
  /** 今天还该不该占首页。true = 不该。**它不代表完成，也不代表取消。** */
  stale: boolean;
  /** 人能读的一句话，写进退场记录。 */
  reason: string;
};

/**
 * UNDECIDED_PLAN —— 为什么一条无日期的待定计划在这里**不设过期**。
 *
 * 共同规格给了三个具体数字：临时采购 48 小时、库存预测 72 小时、习惯提醒 7 天。它**没有**给
 * 「一条没有日期的待定计划」一个数字，而生产里正好有这样一条：8 月下旬提出的、关于十月某个假期的
 * 一次出行打算。那个假期还没到——它不是旧账，是一件还没定下来的未来的事。按 48 小时把它判成过期，
 * 是拿一个规格没给的数字去否定一件真实存在的打算；按「不猜具体日期」的规矩，我们也不能替它把
 * 那个假期解析成某一天再去比较。
 *
 * 所以这一档保持 `tentative`、不设过期，**靠排序而不是靠时钟**让它不占默认位：
 * lib/home-feed.ts 的默认位只有 1–2 条，待定计划排在最后，本来就进不去，但在「展开全部」里一条不少。
 * 需要给它一个默认期限，请总指挥给数字，这里不臆造。
 */
export function freshnessOf(item: Pick<UpcomingItem, "title" | "note" | "when" | "status" | "evidence">, today: string): FreshnessVerdict {
  const klass = classifyFreshness(item);
  const raisedOn = raisedOnOf(item);

  if (klass === "dated") {
    const end = endDayOf(item.when)!;
    // 区间看的是**结束**那天。生产里有一条窗口是 9 月 7 日到 9 月 13 日的计划，今天是 13 号，
    // 它还盖着今天，不算过期；用开始日判断会把它错判成一个月前的旧账。
    //
    // 一条待定的计划过期时说的是「没有后续消息」，而不是「没有完成记录」：它从来没被定下来，
    // 谈不上完成（§6：未确定的计划明确标注待定）。
    const gone = item.status === "tentative" ? "没有后续消息" : "没有完成记录";
    return end < today
      ? { klass, raisedOn, freshThrough: end, stale: true, reason: `${formatDay(end)}已经过去，${gone}` }
      : { klass, raisedOn, freshThrough: end, stale: false, reason: end === today ? "就在今天" : `${formatDay(end)}之前` };
  }

  if (klass === "important") {
    return { klass, raisedOn, stale: false, reason: "关键事项，没有结果就一直留着，不按时钟过期" };
  }

  if (klass === "undecided_plan") {
    return { klass, raisedOn, stale: false, reason: "还没定下来的计划，不设过期；默认位按排序不占" };
  }

  // 剩下三类按小时算。拿不到起算点就**不判过期**：宁可多留一条，也不要拿今天当起算点，
  // 那会让它每次打开页面都重新新鲜一次。
  if (!raisedOn) {
    return { klass, raisedOn, stale: false, reason: "没有可用的提出日期，不按时钟判过期（不拿今天顶替起算点）" };
  }
  const hours = FRESHNESS_HOURS[klass];
  const freshThrough = addDays(raisedOn, Math.floor(hours / 24));
  const label = klass === "errand" ? "临时事项" : klass === "stock_forecast" ? "库存预测提醒" : "习惯提醒";
  return freshThrough < today
    ? { klass, raisedOn, freshThrough, stale: true, reason: `${label}，${formatDay(raisedOn)}提出，${hours} 小时新鲜期到 ${formatDay(freshThrough)}，已经过去` }
    : { klass, raisedOn, freshThrough, stale: false, reason: `${label}，${formatDay(raisedOn)}提出，新鲜期到 ${formatDay(freshThrough)}` };
}

/**
 * 一条事项**实际被展示过**的自然日。由调用方提供，因为这是历史，算不出来。
 *
 * 为什么不能拿 `raisedOn` 代替（上一版就是这么错的）：`raisedOn` 是这件事**被说起**的那天，
 * 和它**在首页露过脸**的那些天毫无关系。一条 9 月 8 日提起的习惯提醒，可能一次都没露出过，
 * 也可能连着露了五天——按 raisedOn 数，前者会被算成「已经用掉一个日期」，后者会被算成「才用掉一个」。
 * §6.3 数的是露出，所以只能记露出。
 */
export type HabitDisplayLog = {
  /** 这条事项露出过的自然日（"YYYY-MM-DD"），顺序不重要，重复会被去重。 */
  daysShown: (itemId: string) => readonly string[];
};

/** 什么都没记过的日志。没有接上持久化时就是这个——上限因此不会误伤任何人。 */
export const NO_HABIT_DISPLAY_LOG: HabitDisplayLog = { daysShown: () => [] };

/** 用一个 Map 记住露出日，测试与本地验证用。 */
export function habitDisplayLogFrom(days: ReadonlyMap<string, readonly string[]>): HabitDisplayLog {
  return { daysShown: (itemId) => days.get(itemId) ?? [] };
}

export type HabitCapEntry = { id: string; title: string; klass: FreshnessClass };

/**
 * 习惯提醒「最多两个不同**自然日**露出」（§6.3），按**实际展示过的日子**算。
 *
 * 判定只有三种情况：
 *
 *   · 今天已经露过 → 放行。**同一天内刷新多少次都不会多占一个日期**，因为占的是「日」不是「次」。
 *   · 今天没露过，但已经露过 `max` 个不同的日子 → 拦下。第三个自然日起它不再占默认位。
 *   · 今天没露过，露过的日子还不够 `max` 个 → 放行（真的露出之后，调用方把今天记进日志）。
 *
 * **没露出过就一天都不算**：日志里没有它，`daysShown` 就是空的，它当然放行。
 *
 * 拦下 ≠ 过期、≠ 完成。它只是不再占默认位，仍然在「展开全部」里，库里那一行一个字不动。
 */
export function capHabitByShownDays(
  entries: readonly HabitCapEntry[],
  today: string,
  log: HabitDisplayLog = NO_HABIT_DISPLAY_LOG,
  max = HABIT_MAX_DATES,
): { kept: HabitCapEntry[]; dropped: { entry: HabitCapEntry; reason: string }[] } {
  const kept: HabitCapEntry[] = [];
  const dropped: { entry: HabitCapEntry; reason: string }[] = [];
  for (const entry of entries) {
    if (entry.klass !== "habit") { kept.push(entry); continue; }
    const days = new Set(log.daysShown(entry.id));
    if (days.has(today)) { kept.push(entry); continue; }
    if (days.size >= max) {
      dropped.push({ entry, reason: `这条习惯提醒已经在 ${days.size} 个不同的日子露出过（上限 ${max} 个自然日），今天起不占默认位` });
      continue;
    }
    kept.push(entry);
  }
  return { kept, dropped };
}
