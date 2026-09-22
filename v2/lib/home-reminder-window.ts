// 2026-09-22：本周按上海日历周一至周日；未结束的计划不因消息超过七天而消失。
// 消息日期仍取原始证据，不拿导入时间续期。过期、取消和取代由 home-feed 先过滤。
import type { UpcomingItem } from "@/lib/upcoming-contract";
import { isUpcomingDay } from "@/lib/upcoming-contract";
import type { UpcomingProvenance } from "@/lib/upcoming-provenance";

/** 一个自然周的天数。 */
export const REMINDER_WINDOW_DAYS = 7;

function dayNumberOf(day: string): number {
  return Math.floor(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000);
}

/** today 是 productToday 给出的上海日历日；UTC 运算避免宿主机时区影响。 */
export function windowStart(today: string): string {
  const day = dayNumberOf(today);
  const weekday = new Date(day * 86_400_000).getUTCDay();
  return new Date((day - (weekday + REMINDER_WINDOW_DAYS - 1) % REMINDER_WINDOW_DAYS) * 86_400_000).toISOString().slice(0, 10);
}

export function windowEnd(today: string): string {
  return new Date((dayNumberOf(windowStart(today)) + REMINDER_WINDOW_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 这条事项**最近一次被提到**是哪天。
 *
 * 取「第一次提出」和「后来每一次重申」里最晚的那个。`lastMentionedOn` 由数据轨从
 * `upcoming_item_changes` 算好后随投影下发；拿不到就退回 `evidence.day`——
 * 用于证据日期与排序，不把导入或更新时间当作新的提及。
 */
export function lastMentionedOn(item: Pick<UpcomingItem, "evidence" | "lastMentionedOn">): string | undefined {
  const raised = isUpcomingDay(item.evidence?.day) ? item.evidence.day : undefined;
  const restated = isUpcomingDay(item.lastMentionedOn) ? item.lastMentionedOn : undefined;
  if (raised && restated) return raised > restated ? raised : restated;
  return restated ?? raised;
}

/** 来源是不是「微信里有人说的」。只挡明确标为 record_check 的档案核对来源。 */
export function fromWechat(provenance: UpcomingProvenance | undefined): boolean {
  const kind = provenance?.raised?.role.kind;
  // 摘要还没审（pending_review，没有 raised）时**放行**：那是"我们还没写好这句摘要"，
  // 不是"这条不是微信来的"。挡掉它等于拿审核进度当事实判断（原则四那条同样的错误）。
  if (!kind) return true;
  return kind !== "record_check";
}

export type ReminderWindowVerdict = {
  /** 本周有关联且来源合格；调用方另行过滤过期和无效状态。 */
  inWindow: boolean;
  /** 最近一次被提到的那天，拿不到就是 undefined。 */
  mentionedOn?: string;
  /** 为什么进 / 为什么不进。写进审计与 STATUS，不显示给家人。 */
  reason: string;
};

/**
 * 判一条事项该不该出现在「每周提醒」里。
 *
 * **只判窗口与来源**。「还需不需要办」是另一件事，已经由 lib/home-feed.ts 的
 * `reminderStateOf` 判过了（cancelled / superseded / expired 不进入；done 只放行重要事实），
 * 两边不重复实现——重复实现的两套规则迟早会分叉。
 */
export function reminderInWindow(
  item: Pick<UpcomingItem, "evidence" | "lastMentionedOn"> & Partial<Pick<UpcomingItem, "status" | "when" | "statusEvidence">>,
  provenance: UpcomingProvenance | undefined,
  today: string,
): ReminderWindowVerdict {
  const mentionedOn = lastMentionedOn(item);
  if (!mentionedOn) {
    return { inWindow: false, mentionedOn, reason: "没有可用的消息日期，无法确认事项来源日期" };
  }
  if (!fromWechat(provenance)) {
    return { inWindow: false, mentionedOn, reason: "来源是档案核对提醒，不是微信里有人提的" };
  }
  if (mentionedOn > today) {
    return { inWindow: false, mentionedOn, reason: `最近一次提及是 ${mentionedOn}，晚于今天 ${today}` };
  }
  const start = windowStart(today);
  const end = windowEnd(today);
  const ongoing = item.status === "open" || item.status === "tentative" || item.status === "rescheduled";
  if (ongoing) {
    // 有明确日期的事项须与本周相交；没有日期的有效计划继续保留待确认状态。
    // 保鲜规则仍由调用方执行，不能把旧采购、过期日程重新带回首页。
    const when = item.when;
    const from = when?.kind === "day" ? when.day : when?.kind === "window" ? when.fromDay : undefined;
    const to = when?.kind === "day" ? when.day : when?.kind === "window" ? when.toDay : undefined;
    const overlaps = !from || !to || (from <= end && to >= start);
    return { inWindow: overlaps, mentionedOn, reason: overlaps
      ? `事项仍未结束，保留在 ${start} — ${end} 本周提醒中`
      : `事项日期不在 ${start} — ${end} 本周范围内` };
  }
  // 已完成的重要事实按完成证据日归周，不按最初提出日归周。
  const day = item.status === "done" && isUpcomingDay(item.statusEvidence?.day) ? item.statusEvidence.day : mentionedOn;
  const inWindow = day >= start && day <= today;
  return { inWindow, mentionedOn, reason: inWindow
    ? `事项日期 ${day}，在 ${start} — ${end} 本周范围内`
    : `事项日期 ${day}，不在本周已发生的日期范围内（早于窗口起点或晚于今天）` };
}
