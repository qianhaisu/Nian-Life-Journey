// 每周提醒的窗口口径（2026-09-16，用户裁定「严格 7 天，今天就留白」）。
//
// 这个文件只回答一个问题：**这条事项属于「过去 7 天微信里提到的、仍需办理的事」吗。**
//
// ─────────────────────────────────────────────────────────────────────────────
// 两条约束，都是用户原话，都容易实现错
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. **「过去 7 天」数的是消息日，不是导入日、不是 updatedAt。**
//    库里 `evidence.day` 是 `candidate.firstSeenDay`，也就是**消息发出的那天**
//    （lib/db/upcoming-store.ts 写进去的），不是入库时刻——这批微信记录是 2026 年导进来的，
//    消息本身有 2025 年的。拿 `updatedAt` 或 `firstSeenAt` 当窗口依据，2025 年的一句话
//    会在导入当天变成"本周提及"。
//
// 2. **`evidence.day` 是「第一次提出」，不是「最近一次提及」。**
//    任务书专门点了这条：「特别注意：现有 evidence.day / raisedOn 可能固定为首次提出日期，
//    不能直接拿它当最近一次提及时间。」确实如此，而且是**故意**如此——
//    lib/upcoming-freshness.ts 的 `pinnedRaisedOn` 只许这个值往早走，
//    免得同一条消息被重放时给事项续期。
//
//    最近一次提及在**另一张表**里：`upcoming_item_changes`，`change='restated'` 那些行
//    （「同一件事这周又被说了一次」）。2026-09-16 对生产 RDS 只读核查：这张表有 7 行，
//    其中 `restated` 4 行，跨 2026-08-04 → 2026-09-08 —— **数据是真的存在的**，
//    不是一个理论上的字段。所以「最近一次提及」做得出来，不用猜。
//
//    页面投影原本把 `changes` 整个丢掉了（lib/upcoming-contract.ts 的 `toUpcomingItem`
//    只投影页面要用的字段），所以本轮给投影补了一个 `lastMentionedOn`——**只补这一个**，
//    不把 changes 整串搬到前台（那里面有 `quote`，是聊天原文，不能上页面）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 「微信提及」不等于「有一条记录」
// ─────────────────────────────────────────────────────────────────────────────
//
// 生产里有一条 `核对张年的接种记录`，提出日 2026-09-13，落在 7 天窗口内——但它的来源角色是
// `record_check`（「档案核对提醒」），**不是任何人在微信里说的话**，是总指挥建的档案核对项。
// 口径写的是「过去 7 天微信中提到的」，所以它不算。
//
// 判据只认 `provenance.raised.role.kind === "family_member"`：成员表确认过的人说的话。
// `unconfirmed`（来源人物未确认）也放行——那仍然是一条微信消息，只是没认出说话的人；
// 只有 `record_check` 这一种明确"不是聊天来源"的被挡掉。
import type { UpcomingItem } from "@/lib/upcoming-contract";
import { isUpcomingDay } from "@/lib/upcoming-contract";
import type { UpcomingProvenance } from "@/lib/upcoming-provenance";

/** 窗口长度。用户 2026-09-16 定的「过去 7 天」，含今天。 */
export const REMINDER_WINDOW_DAYS = 7;

function dayNumberOf(day: string): number {
  return Math.floor(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000);
}

/** 窗口的第一天（含）。today 往回数 6 天 = 连同今天共 7 个自然日。 */
export function windowStart(today: string, days = REMINDER_WINDOW_DAYS): string {
  return new Date((dayNumberOf(today) - (days - 1)) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 这条事项**最近一次被提到**是哪天。
 *
 * 取「第一次提出」和「后来每一次重申」里最晚的那个。`lastMentionedOn` 由数据轨从
 * `upcoming_item_changes` 算好后随投影下发；拿不到就退回 `evidence.day`——
 * 退回的后果是保守（一条这周又被说起的旧事会被判在窗口外、不显示），
 * 而不是冒进（不会把一条没人再提的旧事说成本周的事）。
 */
export function lastMentionedOn(item: Pick<UpcomingItem, "evidence" | "lastMentionedOn">): string | undefined {
  const raised = isUpcomingDay(item.evidence?.day) ? item.evidence.day : undefined;
  const restated = isUpcomingDay(item.lastMentionedOn) ? item.lastMentionedOn : undefined;
  if (raised && restated) return raised > restated ? raised : restated;
  return restated ?? raised;
}

/** 来源是不是「微信里有人说的」。见文件顶部：只挡 record_check 这一种。 */
export function fromWechat(provenance: UpcomingProvenance | undefined): boolean {
  const kind = provenance?.raised?.role.kind;
  // 摘要还没审（pending_review，没有 raised）时**放行**：那是"我们还没写好这句摘要"，
  // 不是"这条不是微信来的"。挡掉它等于拿审核进度当事实判断（原则四那条同样的错误）。
  if (!kind) return true;
  return kind !== "record_check";
}

export type ReminderWindowVerdict = {
  /** 在窗口内、来源是微信、并且还需要办 —— 三条都成立才显示。 */
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
 * `reminderStateOf` 判过了（done / cancelled / superseded / expired 都不会走到这里），
 * 两边不重复实现——重复实现的两套规则迟早会分叉。
 */
export function reminderInWindow(
  item: Pick<UpcomingItem, "evidence" | "lastMentionedOn">,
  provenance: UpcomingProvenance | undefined,
  today: string,
  days = REMINDER_WINDOW_DAYS,
): ReminderWindowVerdict {
  const mentionedOn = lastMentionedOn(item);
  if (!mentionedOn) {
    // 没有任何可用的消息日：不显示。**不拿今天顶替**——那会让每条无日期的事项
    // 在每次打开页面时都变成"本周提到过"。
    return { inWindow: false, mentionedOn, reason: "没有可用的消息日期，无法判断是不是这 7 天里提到的" };
  }
  if (!fromWechat(provenance)) {
    return { inWindow: false, mentionedOn, reason: "来源是档案核对提醒，不是微信里有人提的" };
  }
  const start = windowStart(today, days);
  if (mentionedOn < start) {
    return { inWindow: false, mentionedOn, reason: `最近一次提及是 ${mentionedOn}，早于窗口起点 ${start}` };
  }
  if (mentionedOn > today) {
    return { inWindow: false, mentionedOn, reason: `最近一次提及是 ${mentionedOn}，晚于今天 ${today}` };
  }
  return { inWindow: true, mentionedOn, reason: `最近一次提及 ${mentionedOn}，在 ${start} — ${today} 窗口内` };
}
