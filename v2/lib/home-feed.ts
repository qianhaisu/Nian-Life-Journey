// 首页的数据契约 (HOME-20260913, 2026-09-13). 页面只做呈现，领域状态全部在这里决定。
//
// 为什么要有这一层。2026-09-12 的首页把「读什么」摊在 app/page.tsx 里：三十天随机抽一天
// (home-recent-pick.ts)、近况概览、上月回顾、近期待办、忽然想起、三张近期照片、底部月份导航，各自
// 独立取数、独立判断「最近」。新版设计把首页收敛成四件事——真实今日与当前年龄、一组有证据关联的
// 主照片和故事、至多一条不重复的近况、默认一条最多两条有效提醒——那四件事的取舍不能再散在 JSX 里，
// 否则「同一期不随刷新变」和「撤销展示资格立即生效」这两条互相拉扯的规则没有一个地方能同时守住。
//
// 这一层不新增任何整库读取。它复用已经存在的三次读：
//
//   1. loadFamilyArchiveOnDemand()  —— 300s 记忆化的一次 archive 读（lib/family-archive.ts）。
//      首页今天已经在读它，这里不多读一次，也不在渲染路径上碰 getStore()/getOrganizerStore()
//      （CLAUDE.md 里那条 $87 出站流量的规矩）。
//   2. readHomeUpcoming()           —— 待办的 approved-only 家庭读（lib/upcoming.ts）。
//   3. readHomeUpcomingSources()    —— 来源摘要，只有在第 2 步真的有东西可挂时才读。
//
// 最坏调用数与今天的首页逐字相同：archive 1 次（命中 300s 记忆化时 0 次）＋ 待办 3 小查询
// ＋ 来源 2 小查询。没有新表、没有新的整表扫描、没有 raw_sources.text。
//
// 模型不进入 SSR。照片质量评分通过 `quality` 注入（HomePhotoQualityLookup），由离线批次预先算好并
// 缓存；查不到就是查不到，走确定性降级并把降级原因写在 HomePhotoQuality.degraded 里，绝不在这里
// 现场调模型，也绝不编一个分数假装已经评过。
import type { FamilyArchive } from "@/lib/family-archive";
import type { EditorialMemory, MediaRef, YearChapter } from "@/lib/memory-chapters";
import { ageOn, formatDay } from "@/lib/time-signature";
import { monthHrefOf } from "@/lib/home-view";
import { STORY_PHOTO_REVIEW_KIND, storyPhotoKey } from "@/lib/media/story-binding";
import { recentWindowStart } from "@/lib/home-recent-pick";
import type { UpcomingFeed, UpcomingSources } from "@/lib/upcoming";
import type { UpcomingItem, UpcomingWhen } from "@/lib/upcoming-contract";
import { capHabitByShownDays, classifyFreshness, freshnessOf, isImportantItem, NO_HABIT_DISPLAY_LOG, type HabitDisplayLog } from "@/lib/upcoming-freshness";
import type { UpcomingProvenance } from "@/lib/upcoming-provenance";

/** 契约版本。页面轨按这个字符串确认自己接的是哪一版；只做兼容新增时递增小版本号。 */
export const HOME_FEED_VERSION = "home-feed/1.5.0";

// ─────────────────────────────────────────────────────────────────────────────
// 时钟
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 首页自己的时钟，和选中的故事日期完全独立（原则二）。
 *
 * 2026-09-12 的首页在 masthead 上印的是「刚抽到的那段故事的月份」，于是 9 月 12 日那天页面顶上写着
 * 「2026 年 8 月 · 最近」，下一次刷新又会变成 9 月——一个 today 没有动过的页面。这里的 today 只来自
 * archive.time.today（lib/time-truth.ts productToday，Asia/Shanghai 日历日），永远不随抽签移动。
 */
export type HomeFeedClock = {
  /** "YYYY-MM-DD"，Asia/Shanghai 日历日。 */
  today: string;
  /** "2026 年 9 月 13 日" */
  todayLabel: string;
  /** "2025-01-03"；档案里没有出生日期时为 undefined，不猜。 */
  birthDay?: string;
  /** 「现在 1 岁 8 个月」里的那截；出生日期未知或日期早于出生时为 undefined。 */
  ageToday?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 期次
// ─────────────────────────────────────────────────────────────────────────────

/** 一期多长。六小时：共同规格 §5.5「同一期至少稳定 6 小时」。 */
export const EDITION_HOURS = 6;
const EDITION_SLOTS_PER_DAY = 24 / EDITION_HOURS;
const SHANGHAI = "Asia/Shanghai";

/**
 * 期次。刷新、返回、换设备都不会换——因为它不是随机数加 cookie，而是 Asia/Shanghai 日历时间的
 * 一个纯函数：同一个 id 在同一份合格候选上永远算出同一个选择（共同规格 §5.6）。
 *
 * index 是自 1970-01-01 起的第几期，用来做轮换取模。它单调递增，所以「同一张照片要等整轮转完才会
 * 再出现」这件事是由构造保证的，不依赖任何写库的选片历史（§5.6 的「等效约束」）。
 */
export type HomeFeedEdition = {
  /** "2026-09-13#2"：日历日 + 当天第几个六小时档。 */
  id: string;
  /** 这一期的起止，带 +08:00 偏移，不是裸数据库时间（原则二）。 */
  startedAt: string;
  expiresAt: string;
  /** 当天第几档，0..3。 */
  slot: number;
  /** 全局期次序号，轮换用。 */
  index: number;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

/**
 * Asia/Shanghai 的日历日与 0..23 小时。用 Intl 而不是「UTC+8」硬算，规则由时区库说，不由我们说。
 *
 * 一个 Invalid Date 传进来时 `formatToParts` 会**抛 RangeError**，不是返回空数组——所以下面那个
 * 「拿不到 parts 就退回 ISO」的兜底原本永远走不到，而这条路径在 SSR 上：一个坏时间值会把整张首页
 * 变成错误页，只为了算它在哪个六小时档。所以先判有效性，再进 Intl。
 */
function shanghaiNow(now: Date): { day: string; hour: number } {
  if (Number.isNaN(now.getTime())) {
    // 时间本身是坏的，连 ISO 都取不出来。退到纪元日的第 0 档：期次会是一个明显不对的日子，
    // 但页面照样渲染真实内容，而且这个日子一眼看得出是兜底，不会被误读成「今天」。
    return { day: "1970-01-01", hour: 0 };
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SHANGHAI, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const [year, month, day, hour] = [get("year"), get("month"), get("day"), get("hour")];
  if (!year || !month || !day) {
    const fallback = now.toISOString();
    return { day: fallback.slice(0, 10), hour: Number(fallback.slice(11, 13)) };
  }
  return { day: `${year}-${month}-${day}`, hour: Number(hour) };
}

/** 日历日 → 自 1970-01-01 起的天数。纯字符串算术，不经过本机时区。 */
function dayNumberOf(day: string): number {
  return Math.floor(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / 86_400_000);
}

function dayFromNumber(value: number): string {
  return new Date(value * 86_400_000).toISOString().slice(0, 10);
}

export function editionAt(now: Date = new Date()): HomeFeedEdition {
  const { day, hour } = shanghaiNow(now);
  const slot = Math.min(EDITION_SLOTS_PER_DAY - 1, Math.max(0, Math.floor(hour / EDITION_HOURS)));
  const dayNumber = dayNumberOf(day);
  const nextSlot = slot + 1;
  const endDay = nextSlot >= EDITION_SLOTS_PER_DAY ? dayFromNumber(dayNumber + 1) : day;
  const endHour = nextSlot >= EDITION_SLOTS_PER_DAY ? 0 : nextSlot * EDITION_HOURS;
  return {
    id: `${day}#${slot}`,
    startedAt: `${day}T${pad2(slot * EDITION_HOURS)}:00:00+08:00`,
    expiresAt: `${endDay}T${pad2(endHour)}:00:00+08:00`,
    slot,
    index: dayNumber * EDITION_SLOTS_PER_DAY + slot,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 照片
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 这张照片被放在首页的哪个用途上。一次批准只对一个用途有效（总指挥 2026-09-13）。
 *
 * **本轮只产出 `story_lead`。** `standalone_cover` 在类型里留着，因为 §5.1 给它定了门槛
 * （独立封面必须满足 `media_subject_check`），但**没有任何代码路径产出它**——新版首页的照片永远
 * 属于它旁边那段故事。
 *
 * 将来真要加独立封面：它的门是 `isSubjectChecked`（lib/publication-moments.ts），**不是**
 * `story_binding`，也不是 trusted。生产里这两组几乎不重叠，拿 `story_binding` 去放独立封面等于
 * 用「这张图属于这段文字」的批准去主张「这张图里是这个孩子」——那是两句不同的话。
 */
export type HomePhotoUse = "story_lead" | "standalone_cover";

/**
 * 凭什么可以展示。两种批准不互相代替：
 *
 * - `story_binding`：content_quality_reviews 里 target_kind="media_binding"、
 *   target_id="<eventId>|<mediaId>"、最新一条 decision="approved"——有人打开这张图，记下它属于这段
 *   文字（lib/media/story-binding.ts Basis C）。主故事配图只认这一种。
 * - `subject_check`：target_kind="media_subject_check"、target_id="<mediaId>"、最新一条 approved——
 *   有人打开这个文件，记下画面里是这个孩子，与任何故事无关。独立封面只认这一种。
 *
 * media_binding 不是 media_subject_check，反过来也不是。生产里这两组几乎不重叠：三张获批故事配图
 * 一张主体审核都没有，34 张主体审核过的照片一张都没绑到故事上（slots-055e919.json，2026-09-13）。
 */
export type HomePhotoApproval =
  | { kind: "story_binding"; eventId: string }
  | { kind: "subject_check" };

export type HomePhotoQualitySource = "ai_vision" | "deterministic";

/**
 * 一张候选照片的质量评价。四项权重是共同规格 §5.3 的初始产品参数：
 * 可见互动/动作 35%、画面可读性 25%、可靠上下文 25%、近期差异 15%。四项各自 0..100。
 *
 * source 必须说实话。`ai_vision` 表示真的有一次视觉评估的结果（model 写明是谁评的、
 * assessedAt 写明什么时候）；`deterministic` 表示没有视觉结果，这是确定性降级分，
 * degraded 必须写明为什么降级。**不存在第三种情况**：查不到就是 `deterministic`，
 * 不允许把降级分当成 AI 评分，也不允许在没有评估结果时编一个数。
 */
export type HomePhotoQuality = {
  /** 0..100，四项按权重加权。 */
  score: number;
  interaction: number;
  readability: number;
  context: number;
  distinction: number;
  source: HomePhotoQualitySource;
  assessedAt?: string;
  model?: string;
  /** source === "deterministic" 时必填：为什么没有视觉评估。 */
  degraded?: string;
};

/** 首页要展示的一张照片，连同它自己的日期和当时年龄——旧图也带自己的时间（§5.2）。 */
export type HomeFeedPhoto = {
  media: MediaRef;
  use: HomePhotoUse;
  approval: HomePhotoApproval;
  /** 照片所属的那一天（故事日 / 拍摄日），"YYYY-MM-DD"。 */
  day: string;
  dateLabel: string;
  /** 「当时 1 岁 7 个月」里的那截。 */
  ageLabel?: string;
  quality?: HomePhotoQuality;
};

/**
 * 没有合格配图时的明确状态。它**不是**「已满足图片覆盖」，也不是「稍后再试」——
 * 页面据此保留真实文字，不画空照片框、不借别的故事的照片（§5.7）。
 *
 * - `reviewed_no_photo`：有人看过，判定这段记忆不配图（event.heroMediaId === NO_HERO_MEDIA_ID）。
 * - `no_reviewed_binding`：这段记忆挂着照片，但没有任何一对 (故事, 照片) 通过人工审核。
 * - `no_media_at_all`：这段记忆本来就没有附件。
 *
 * 前两者的区别是「做过的决定」和「缺的证据」，不能混成一句「没有照片」。
 */
export type HomePhotoAbsence = "reviewed_no_photo" | "no_reviewed_binding" | "no_media_at_all";

// ─────────────────────────────────────────────────────────────────────────────
// 主故事
// ─────────────────────────────────────────────────────────────────────────────

/** 一段真实已发布记忆的引用。每个字段都来自库里那一行，没有一个是这里生成的。 */
export type HomeStoryRef = {
  eventId: string;
  /** "/events/<id>"，站内既有路由。 */
  href: string;
  title: string;
  /** 已发布正文的有限摘录；这段记忆没有正文时为 undefined。 */
  excerpt?: string;
  /** 故事自己的日子，和 clock.today 无关。 */
  day: string;
  dateLabel: string;
  /** 「当时 1 岁 7 个月」。 */
  ageLabel?: string;
  monthHref: string;
};

export type HomeFeedLead = {
  story: HomeStoryRef;
  photo?: HomeFeedPhoto;
  /** photo 为空时**一定**有值，说明是哪一种「没有」。 */
  photoAbsence?: HomePhotoAbsence;
};

/**
 * 一个可切换的候选：一张合格照片 + 它所属的那段故事。
 *
 * 切换单位是这一对，不是单独一张照片。共同规格 §5.6：「照片与事件不一致时标题/日期/链接一起更新。
 * 同事件内切换才允许文案不变。」把切换单位定成 (故事, 照片) 对，这条规则就是构造保证的，
 * 页面不可能只换图不换标题。
 */
/**
 * 实际做到的冷却，**量出来的数，不是一句话**（§5.5）。
 *
 * 首页是纯轮转：位次每期 +1，所以同一张照片正好隔「候选数」期再出现。候选只有 n 组时，
 * n 期就是**可达的上限**——不可能更久了。所以这里报的是三件事：做到了几期、折算几天、
 * 以及离 14 天的目标差多少。差多少也照实写，不用一句「冷却已按规则处理」蒙过去。
 */
export type HomePhotoCooldown = {
  /** 同一张照片下一次出现要等几期。 */
  editions: number;
  /** 折算成天（一期 6 小时）。 */
  days: number;
  /** §5.5 的目标值，14 天。 */
  targetDays: number;
  /** 达到目标了吗。 */
  meetsTarget: boolean;
  /** 没达到时：差在哪，以及实际做到了多少。达到时为 undefined。 */
  shortfall?: string;
};

/** 给定参与轮换的候选数，算出实际做到的冷却。候选数就是唯一的自变量。 */
export function cooldownOf(rotation: number): HomePhotoCooldown {
  const days = (rotation * EDITION_HOURS) / 24;
  const meetsTarget = rotation > 0 && days >= PHOTO_COOLDOWN_DAYS;
  return {
    editions: rotation,
    days,
    targetDays: PHOTO_COOLDOWN_DAYS,
    meetsTarget,
    shortfall: rotation === 0 || meetsTarget
      ? undefined
      : `合格 (故事, 照片) 对只有 ${rotation} 组，整轮 ${days} 天 < 目标 ${PHOTO_COOLDOWN_DAYS} 天；`
        + `${rotation} 组时 ${days} 天已是可达上限，冷却缩短为整轮轮换，展示门槛未放宽`,
  };
}

export type HomePhotoCandidate = {
  /** 切换用的稳定键 "<eventId>|<mediaId>"。 */
  key: string;
  photo: HomeFeedPhoto;
  story: HomeStoryRef;
  /** 质量分在全部合格候选里排第几（1 = 最高）。决定谁进轮换 band，**不决定轮换次序**。 */
  qualityRank?: number;
  /** 实际做到的同图冷却。只有真正参与轮换的候选才有。 */
  cooldown?: HomePhotoCooldown;
  chosen: boolean;
  /** 排在这个位置、或没被选中的原因（连拍同组、质量降级、冷却缩短……），供审计和 STATUS 取证。 */
  reason: string;
};

/** 至多一条不重复的近况：真实 eventId/href/日期/当时年龄/原有标题，不与主故事重复。 */
export type HomeRecentFact = HomeStoryRef;

// ─────────────────────────────────────────────────────────────────────────────
// 提醒
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 提醒在首页上的状态。
 *
 * `expired` 是这一版新加的，也是整件事的要害：**退场不等于完成**（§6.1）。一件日子已经过去、
 * 没有任何完成证据的琐事从首页退下来，它在库里仍然是 open，来源、时间轨迹一个字都不动。
 * 把它写成 done 会是一句假话，把它留在首页会让首页变成一个月前的旧账。
 */
export type HomeReminderState =
  | "active"
  | "needs_confirmation"
  | "tentative"
  | "expired"
  | "done"
  | "cancelled"
  | "superseded";

/** 状态的读法，由数据轨给定，页面不自拟文案。 */
export const HOME_REMINDER_LABEL: Record<HomeReminderState, string> = {
  active: "要做的",
  needs_confirmation: "待核实",
  tentative: "待定",
  expired: "过了日子，没有完成记录",
  done: "已完成",
  cancelled: "已取消",
  superseded: "已被新的安排替代",
};

export type HomeReminder = {
  id: string;
  title: string;
  state: HomeReminderState;
  /** 原始契约项，含 when / status / evidence。页面要更细的东西从这里取，不另建一份。 */
  item: UpcomingItem;
  /** 「9 月 15 日」/「9 月 7 日 — 9 月 13 日」/「时间待确认」。不猜日期（§6.4）。 */
  deadlineLabel: string;
  /** 为什么它是这个状态 / 为什么还在首页。 */
  reason: string;
  /**
   * 关键事项。接种、就诊这类即使过了日子也不从首页消失（§6.4、§6.7），
   * 也不因为「超出两条」被折叠到看不见。
   */
  important: boolean;
  /** 可展开详情：事项自己的 note，或状态变更的说明。 */
  detail?: string;
  /**
   * 证据链入口（原则八）。**读它之前先看 `evidenceKind`**——两种去处读起来完全不同，
   * 标签不能共用一句话。
   *
   * 1.0.0 只认 `evidence.eventId`，于是这个字段对**生产上全部 18 条待办都是 undefined**：
   * lib/db/upcoming-store.ts 写进 `evidence` 的只有 `{ day }`（它自己的注释写着「What a reader
   * can open: the month the commitment was made in」），从来没有 eventId。一条追不回来源的待办
   * 违反原则八，而这个洞是在验收原则八时才发现的——不是 grep 出来的，是真的去点那个链接。
   */
  evidenceHref?: string;
  /**
   * `event` = 能落到某一段具体的记忆上（"/events/<id>"），页面可以说「看那一天」。
   * `month` = 只能落到这件事被提起的那个月（"/memory/YYYY/MM"），页面**必须**说成「翻到 X 月」
   * 之类的月份说法——把一个月份链接标成「看那一天」，是对读者说了一句假话。
   */
  evidenceKind?: "event" | "month";
  provenance?: UpcomingProvenance;
};

/** 退场的事项：为什么退。它仍然可达（在 `more` 里），仍然不是完成。 */
export type HomeRetiredReminder = {
  id: string;
  title: string;
  /** 退场原因，人能读的一句话。 */
  reason: string;
  /**
   * 退场时它在库里的状态——**原封不动照抄那一行**，不是这里推断的。
   * 一条 tentative 的习惯提醒被日期上限压下去时，这里就是 `tentative`，不是 `open`。
   */
  status: UpcomingItem["status"];
  /**
   * 为什么退场，两种，别混：
   * - `expired`：日子过了，或无期限事项过了新鲜期。
   * - `habit_capped`：同一件习惯关注已经露出过两个不同日期了（§6.3）。**它没有过期。**
   */
  kind: "expired" | "habit_capped";
};

/**
 * 「没有可展示的东西」有三种，三种都不等于「没有待办」（原则四的反面、§6 的底线）。
 *
 * - `empty_material`：读到了，但没有一条能放上首页的材料。
 * - `not_extracted`：提取没跑完、或还有行等着人审——**未知不是没有**。
 * - `read_failed`：读这件事本身失败了。
 */
export type HomeUnavailableKind = "empty_material" | "not_extracted" | "read_failed";
export type HomeUnavailable = { kind: HomeUnavailableKind; reason: string };

export type HomeFeedReminders =
  /** 默认露出 shown（1 条，有关键事项时最多 2 条），其余在 more 里保持可达，retired 记退场原因。 */
  | {
    status: "ready";
    shown: HomeReminder[];
    more: HomeReminder[];
    retired: HomeRetiredReminder[];
    /**
     * `shown` 里属于习惯类的那几条的 id——**页面真的把它们画出来之后**，回报这一组来记露出日
     * （§6.3）。**上报口会自己重算一遍这个集合**，不直接信这个数组——见 `reportHabitDisplay()`。
     *
     * 为什么只给这一组、而不是让调用方自己从 `shown` 里筛：筛的规则（哪一类算习惯）属于数据轨，
     * 让页面去重新判一次，两边迟早会分叉；而分叉的后果是把不该计数的条目记进配额。
     * `more` 里的东西一条都不在这里——折叠着没露脸不算露出。
     */
    habitShownIds: string[];
  }
  /** 真的读完了整个窗口、真的什么都没有。只有这一种可以说「已检查，没有待办」。 */
  | { status: "clear"; windowFrom: string; readToDay?: string }
  | { status: "unavailable"; unavailable: HomeUnavailable };

/** 默认露出几条 / 有关键事项时最多几条（共同规格 §1、§6.6）。 */
export const REMINDERS_DEFAULT_SHOWN = 1;
export const REMINDERS_MAX_SHOWN = 2;

// ─────────────────────────────────────────────────────────────────────────────
// 首页
// ─────────────────────────────────────────────────────────────────────────────

export type HomeFeed = {
  version: string;
  clock: HomeFeedClock;
  edition: HomeFeedEdition;
  lead?: HomeFeedLead;
  /** lead 为空时**一定**有值：档案里为什么现在没有一段可放首页的故事。 */
  leadAbsence?: HomeUnavailable;
  /** 当期合格候选，最多 HOME_PHOTO_CANDIDATES_MAX 条。不往浏览器搬全库媒体或审核账本。 */
  photoCandidates: HomePhotoCandidate[];
  recentFact?: HomeRecentFact;
  reminders: HomeFeedReminders;
};

/**
 * 候选窗口：最近 60 天（§5.2）——**只管文字**：没有合格照片时退回的那段真实文字、以及近况，都从这里取。
 *
 * 照片池不再受它限制（2026-09-14 用户：「换张照片」来回只有 3 张）。数据轨只读量化：全库逐对获批的
 * (故事, 照片) 只有 4 对 / 3 篇，60 天窗口、每篇一张、返回上限都不是瓶颈；但随着人工批准新的故事配图，
 * 被批准的多半是更早的故事，60 天窗口会让它们永远进不了首页。照片自带自己的日期和当时年龄（原则二），
 * 一张旧照片在首页也读得出是哪一天——所以照片池是**全部已发布故事的获批配图**，门槛一格没放。
 */
export const HOME_CANDIDATE_WINDOW_DAYS = 60;
/**
 * 交给浏览器的候选上限——「换张照片」能翻到的就是这几条。2026-09-14 从 6 提到 12：池子会随新获批的
 * 故事配图自己长大（photoPoolMemories），6 条会先于池子变成「只有几张在循环」的原因。
 */
export const HOME_PHOTO_CANDIDATES_MAX = 12;
/**
 * §5.5 的两个冷却天数。**它们是规格给的目标值，不是这段代码里的开关**——写在这里是为了让实际做到了
 * 多少能被对着一个数字讲清楚：
 *
 * - `PHOTO_COOLDOWN_DAYS`：同一张照片 14 天。整轮走完需要「候选数 × 6 小时」，候选不足 56 组就
 *   满足不了，此时缩短为整轮轮换，理由逐条写进 `candidate.reason`（生产今天是 3 组 = 18 小时）。
 * - `EVENT_COOLDOWN_DAYS`：同一事件 3 天。2026-09-14 起一段记忆的每张获批配图都进池，相邻期次不重复
 *   同一段故事改由**按故事交错的轮换次序**保证（见 interleaveByStory）；某段故事的照片多到交错不开时，
 *   相邻几处照实写进 reason。满 3 天同样受候选数限制，一并由那条 reason 说明。
 *
 * 两个值都没有被当成过滤条件使用：**门槛一格没放，也没有一个候选因为冷却被悄悄丢掉**。
 */
export const PHOTO_COOLDOWN_DAYS = 14;
export const EVENT_COOLDOWN_DAYS = 3;

export type HomePhotoQualityLookup = (mediaId: string) => HomePhotoQuality | undefined;

export type BuildHomeFeedOptions = {
  now?: Date;
  edition?: HomeFeedEdition;
  /** 已缓存的离线质量评估结果。查不到即走确定性降级，不在渲染里调模型。 */
  quality?: HomePhotoQualityLookup;
  upcoming?: UpcomingFeed;
  upcomingSources?: UpcomingSources;
  /**
   * 已读好的档案。`readHomeFeed` 默认自己走 `loadFamilyArchiveOnDemand()`；传了就用传的。
   *
   * 它和 `upcoming`/`upcomingSources` 是同一类注入点，补上它是为了**能端到端测 readHomeFeed 本身**
   * ——包括「它有没有真的去读那份离线质量缓存」。少了这个口，那条测试只能把接线逻辑照抄一遍，
   * 于是删掉 readHomeFeed 里那一行，测试照样绿。
   */
  archive?: FamilyArchive;
  /** 显式切换：页面「换张照片」时把候选的 key 传回来，只在合格候选里换（§5.6）。 */
  photoKey?: string;
  /**
   * 习惯提醒「实际展示过哪些自然日」的日志（§6.3）。不传就是空日志——上限因此不会误伤任何人，
   * 但也**不会生效**。它是历史，算不出来，只能记；接上哪个存储是另一件事。
   */
  habitLog?: HabitDisplayLog;
};

// 一段记忆 → 页面可读的故事引用。
function storyRefOf(memory: EditorialMemory): HomeStoryRef {
  return {
    eventId: memory.id,
    href: `/events/${memory.id}`,
    title: memory.title,
    excerpt: memory.excerpt,
    day: memory.signature.day,
    dateLabel: memory.signature.dateLabel,
    ageLabel: memory.signature.ageLabel,
    monthHref: monthHrefOf(memory.signature.day.slice(0, 7)),
  };
}

/**
 * 窗口内的已发布记忆，新的在前。
 *
 * chapters 里只有已发布的记忆（lib/family-archive.ts 传的是可发布集合），并且日期晚于 today 的
 * 记录进不了窗口，所以未来日期的行永远到不了首页。
 */
export function candidateMemories(chapters: YearChapter[], today: string, days = HOME_CANDIDATE_WINDOW_DAYS): EditorialMemory[] {
  const start = recentWindowStart(today, days);
  const found: EditorialMemory[] = [];
  for (const year of chapters) {
    for (const month of year.months) {
      for (const memory of month.memories) {
        const day = memory.signature.day;
        if (day < start || day > today) continue;
        found.push(memory);
      }
    }
  }
  return found.sort((a, b) => b.signature.day.localeCompare(a.signature.day) || a.id.localeCompare(b.id));
}

/**
 * 首页照片池取材的记忆：**全部**已发布记忆，日期不晚于今天（未来日期的行照样进不了首页）。
 * 哪一张能进池仍然只由逐对人工批准的配图决定（storyPhotosFor），这里不放宽任何门槛，只是不再按 60 天截。
 */
export function photoPoolMemories(chapters: YearChapter[], today: string): EditorialMemory[] {
  const found: EditorialMemory[] = [];
  for (const year of chapters) {
    for (const month of year.months) {
      for (const memory of month.memories) {
        if (memory.signature.day > today) continue;
        found.push(memory);
      }
    }
  }
  return found.sort((a, b) => b.signature.day.localeCompare(a.signature.day) || a.id.localeCompare(b.id));
}

/**
 * 确定性降级分。没有视觉评估时用得到的、与画面内容无关的事实算一个可复现的序，
 * 并且**明确标注自己不是 AI 评分**。
 *
 * 只用三件已知为真的事：像素面积（可读性的下限——一张 120×90 的缩略图无论内容如何都读不出东西）、
 * 有没有人给过这张图的审核记录（可靠上下文；能进到这里的候选都有，所以是满分），以及距今天数
 * （近期差异）。可见互动/动作这一项**无法**从元数据得出，所以它是 0 而不是一个猜测——
 * 它恰好就是需要视觉评估的那一项，把它留成 0 让「还没评过」在分数里看得见。
 */
export function deterministicQuality(photo: { media: MediaRef; day: string }, today: string, degraded: string): HomePhotoQuality {
  const { width, height } = photo.media;
  const pixels = (width ?? 0) * (height ?? 0);
  // 1MP 以上按满分算：手机照片普遍在 3–12MP，这条只用来把缩略图和小截图挡在下面。
  const readability = Math.max(0, Math.min(100, Math.round((pixels / 1_000_000) * 100)));
  const context = 100;
  const ageDays = Math.max(0, dayNumberOf(today) - dayNumberOf(photo.day));
  const distinction = Math.max(0, Math.min(100, Math.round(100 - (ageDays / HOME_CANDIDATE_WINDOW_DAYS) * 100)));
  const interaction = 0;
  const score = Math.round(interaction * 0.35 + readability * 0.25 + context * 0.25 + distinction * 0.15);
  return { score, interaction, readability, context, distinction, source: "deterministic", degraded };
}

/** 没有视觉评估时写在 degraded 里的那句话。 */
export const QUALITY_NOT_ASSESSED = "没有这张照片的视觉评估结果，这是确定性降级分，不是 AI 评分";

/**
 * 查一张照片的质量评价，查不到或查出错都降级，**永远不往上抛**。
 *
 * 抛上去会怎样：`quality` 是注入进来的缓存读取，它背后可能是一个文件、一张表、一个本地服务。
 * 这条路径在 SSR 里，一次 throw 就是整张首页变成错误页——为了一个排序用的分数，把真实的照片、
 * 故事和提醒全部换成一个错误页。所以失败在这里就地吞掉，降级成确定性分，并把失败原因写进
 * degraded：家人照样看到内容，我们照样知道评估没跑成（共同规格「离线/模型失败仍可渲染真实内容」）。
 */
function qualityFor(lookup: HomePhotoQualityLookup | undefined, photo: HomeFeedPhoto, today: string): HomePhotoQuality {
  if (!lookup) return deterministicQuality(photo, today, QUALITY_NOT_ASSESSED);
  try {
    const found = lookup(photo.media.id);
    if (found) return found;
  } catch (error) {
    return deterministicQuality(photo, today, `读取视觉评估结果失败（${String((error as Error)?.message ?? error)}），这是确定性降级分，不是 AI 评分`);
  }
  return deterministicQuality(photo, today, QUALITY_NOT_ASSESSED);
}

/**
 * 本期该用哪个分数。
 *
 * 一个 `ai_vision` 分数要 `assessedAt < edition.startedAt` 才在本期生效——**质量更新从下一期起算**。
 * 不这样做的话，一份离线缓存在期中落地就会改变「返回哪几条、怎么排」，而那份清单就是家人点
 * 「换张照片」时看到的东西；期次说好了六小时不变，那它整块都不该在期中变。
 *
 * 没有 `assessedAt` 的分数不受这条约束：确定性降级分是此刻算出来的默认值，不是一次「更新」。
 */
const LEDGER_TIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d+))?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * 账本时间 → 毫秒时刻，**与进程时区无关**。解析不出来返回 NaN。
 *
 * content_quality_reviews.reviewed_at 是 timestamp without time zone（schema.ts mode:"string"），库时区
 * Asia/Shanghai，所以进档案时长这样："2026-09-14 19:02:13.893609"——空格、微秒、**没有时区**。
 * 生产容器是 UTC：直接 Date.parse 会把它当成 UTC 19:02，晚 8 小时（数据轨 2026-09-14 审查实测）。
 * 所以没有时区后缀的一律按上海时间（+08:00）解释；带 Z 或 ±hh:mm 的照常。小数秒截到毫秒。
 */
export function parseLedgerTime(value: string): number {
  const match = LEDGER_TIME.exec(value.trim());
  if (!match) return Number.NaN;
  const [, day, clock, fraction, zone] = match;
  const seconds = clock.length === 5 ? `${clock}:00` : clock;
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, "0")}` : "";
  let offset = "+08:00";
  if (zone) {
    if (zone.toUpperCase() === "Z") offset = "Z";
    else { const digits = zone.replace(":", ""); offset = `${digits.slice(0, 3)}:${digits.slice(3, 5) || "00"}`; }
  }
  return Date.parse(`${day}T${seconds}${millis}${offset}`);
}

/**
 * 这个时间戳是不是落在本期开始之时或之后。**按时刻比，不按字符串比，也不依赖进程时区。**
 *
 * 2026-09-14：账本 reviewedAt 是不带时区的上海本地时间（见 parseLedgerTime），期次 startedAt 是
 * "2026-09-14T18:00:00+08:00"。按字符串比，"2026-09-14 19:02" 的空格排在 "T" 前面，一张 19:02 才批
 * 的照片被当成「本期开始前就批了」，期中直接进了轮换——六小时稳定就破了。
 * 两边任一解析不出来时按「不在本期之后」处理：宁可让它照常参与，也不因为一个坏时间把它挡掉。
 */
export function isAtOrAfterEditionStart(at: string, startedAt: string): boolean {
  const atMs = parseLedgerTime(at);
  const startMs = parseLedgerTime(startedAt);
  if (Number.isNaN(atMs) || Number.isNaN(startMs)) return false;
  return atMs >= startMs;
}

function effectiveQuality(
  lookup: HomePhotoQualityLookup | undefined,
  photo: HomeFeedPhoto,
  today: string,
  edition: HomeFeedEdition,
): HomePhotoQuality {
  const found = qualityFor(lookup, photo, today);
  if (found.source === "ai_vision" && found.assessedAt && isAtOrAfterEditionStart(found.assessedAt, edition.startedAt)) {
    return deterministicQuality(photo, today, `这张照片的视觉评估是本期（${edition.id}）开始后才写下的，本期先用确定性降级分，下一期起生效`);
  }
  return found;
}

/**
 * 一段记忆的全部合格配图。memory.storyPhotos 已经是逐 (eventId, mediaId) 人工审核后的结果
 * （lib/memory-chapters.ts → storyDisplayMedia，只认 Basis C；lead 就是它的第一张），所以这里
 * **不再放宽一格**：不看 trusted、不看同日、不看 confirmed 扁平集合、不看主体审核。
 *
 * 2026-09-14 之前这里只取 lead：一段故事获批了两张（9 月 7 日 cold/hot 那篇），第二张永远上不了首页。
 */
function storyPhotosFor(memory: EditorialMemory, birthDay: string | undefined): HomeFeedPhoto[] {
  const approved = memory.storyPhotos ?? (memory.lead ? [memory.lead] : []);
  const day = memory.signature.day;
  return approved.map((media) => ({
    media,
    use: "story_lead",
    approval: { kind: "story_binding", eventId: memory.id },
    day,
    dateLabel: memory.signature.dateLabel,
    ageLabel: ageOn(birthDay, day),
  }));
}

/**
 * 轮换次序：按故事**环形**交错。轮换是一圈——最后一期之后回到第一期，「换张照片」翻到末尾也回到开头——
 * 所以首尾也算相邻。
 *
 * 做法：先按 mediaId 排好（与质量分无关，§5.5），按故事分组，组按照片数从多到少（同数按第一张 mediaId），
 * 依次填进偶数位、再填奇数位。只要照片最多的那段故事不超过总数的一半（floor(n/2)），这样排出来的一圈里
 * 没有任何两个相邻位置属于同一段故事；超过一半时本来就交错不开，调用方数出相邻处写进 reason。
 *
 * 2026-09-14 数据轨审查抓到上一版：逐轮各取一张，生产上排成 coldhot、庆典、小辫子、coldhot，
 * 绕回开头时两张 coldhot 挨着，reason 还写着「交错不开」——其实 2 对 2 完全排得开。
 */
function interleaveByStory<T extends { story: { eventId: string }; photo: { media: { id: string } } }>(entries: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const entry of [...entries].sort((a, b) => a.photo.media.id.localeCompare(b.photo.media.id))) {
    const group = groups.get(entry.story.eventId);
    if (group) group.push(entry);
    else groups.set(entry.story.eventId, [entry]);
  }
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length || a[0].photo.media.id.localeCompare(b[0].photo.media.id));
  const slots: T[] = new Array(entries.length);
  const positions = [
    ...Array.from({ length: Math.ceil(entries.length / 2) }, (_, i) => i * 2),
    ...Array.from({ length: Math.floor(entries.length / 2) }, (_, i) => i * 2 + 1),
  ];
  let next = 0;
  for (const group of ordered) for (const entry of group) slots[positions[next++]] = entry;
  return slots;
}

/** 照片最多的那段故事是否超过一圈的一半——只有这时才是真的「交错不开」。 */
function largestStoryShare<T extends { story: { eventId: string } }>(entries: T[]): { largest: number; limit: number } {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.story.eventId, (counts.get(entry.story.eventId) ?? 0) + 1);
  return { largest: Math.max(0, ...counts.values()), limit: Math.floor(entries.length / 2) };
}

function photoAbsenceOf(memory: EditorialMemory): HomePhotoAbsence {
  if (memory.noPhoto) return "reviewed_no_photo";
  if (memory.photoCount + memory.videoCount === 0) return "no_media_at_all";
  return "no_reviewed_binding";
}

/**
 * 连拍分组键：同一时刻的一串照片一期只出一张（§5.3）。
 *
 * 用照片自己的 takenAt 按 BURST_BUCKET_SECONDS 取桶。publication-moments.ts 的 burstGroups 做的是
 * 同一天内相邻时间的聚类，这里的候选来自不同的故事、可能跨天，用不上那个形状，所以用同一个 90 秒的
 * 尺度取一个稳定的桶键，而不是重新实现一遍聚类。没有 takenAt 的照片各自成组。
 */
const BURST_BUCKET_SECONDS = 90;
function burstKeyOf(photo: HomeFeedPhoto): string {
  const takenAt = photo.media.takenAt;
  if (!takenAt) return `solo:${photo.media.id}`;
  const at = Date.parse(takenAt);
  if (Number.isNaN(at)) return `solo:${photo.media.id}`;
  return `burst:${Math.floor(at / (BURST_BUCKET_SECONDS * 1000))}`;
}

/**
 * 当期的 (故事, 照片) 候选，并挑出这一期用哪一对。
 *
 * 排序：质量分降序 → 日期降序 → mediaId 升序。全程确定性，没有 Math.random()。
 * 轮换：edition.index % rotation，rotation 是候选数（上限 HOME_PHOTO_CANDIDATES_MAX）。
 * 这条取模保证「一张照片要等整轮转完才会再出现」——候选足够多时它就是 §5.5 的冷却；
 * 候选不足时它是被缩短的冷却，缩短的理由写进 reason，门槛一格都没放。
 *
 * 撤销优先于期次缓存（§5.7）：候选每次都从当前 archive 现算，期次里不缓存 mediaId。
 * 一条审核被撤回，下一次读到的候选里就没有它，同一个 edition.id 会落到另一张仍然合格的图上。
 *
 * 过滤顺序抄的是 2026-09-13 那次教训（publication-moments.ts photoLedMoment）：
 * 先把不合格的全部滤掉，再分连拍组、再选。反过来做，只要某个连拍组里排在前面的那张不合格，
 * 组里合格的那张就永远选不中——那是假阴性，不是「这组没有合格照片」。
 */
/**
 * 每一对 (故事, 照片) 最近一次 `approved` 的时间戳，从档案已经带着的审核账本里现算。
 *
 * 为什么不去改 `lib/media/story-binding.ts`：那里是**全站**媒体判据，本轮的规矩是复用它、不借首页
 * 任务重构它。而且这里要的不是「能不能展示」——那个已经由 `memory.lead` 判过了——只是「什么时候
 * 批的」。键的格式借 `storyPhotoKey`，免得两边对 `"<eventId>|<mediaId>"` 的写法各写一遍。
 *
 * 「最近一次」的判法和账本那边一致：`reviewedAt` 大者胜，同刻用 `id` 兜底。只有最近一次是
 * `approved` 时才记时间戳；最近一次是 `rejected` 的对根本到不了这里（`memory.lead` 已经滤掉）。
 */
export function approvedBindingTimes(
  reviews: ReadonlyArray<{ id?: string | null; targetKind?: string | null; targetId?: string | null; decision?: unknown; reviewedAt?: string | null }>,
): ReadonlyMap<string, string> {
  const latest = new Map<string, { decision: unknown; at: string; rank: string }>();
  for (const review of reviews) {
    if (review.targetKind !== STORY_PHOTO_REVIEW_KIND) continue;
    const parts = (review.targetId ?? "").split("|");
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    const key = storyPhotoKey(parts[0], parts[1]);
    const rank = `${review.reviewedAt ?? ""}|${review.id ?? ""}`;
    const held = latest.get(key);
    if (!held || rank > held.rank) latest.set(key, { decision: review.decision, at: review.reviewedAt ?? "", rank });
  }
  const approved = new Map<string, string>();
  for (const [key, held] of latest) if (held.decision === "approved" && held.at) approved.set(key, held.at);
  return approved;
}

/** 一次候选构建要的东西。做成对象是因为参数已经到六个，位置参数记错一个就是静默错选。 */
export type BuildPhotoCandidatesInput = {
  memories: EditorialMemory[];
  birthDay?: string;
  today: string;
  edition: HomeFeedEdition;
  quality?: HomePhotoQualityLookup;
  photoKey?: string;
  /**
   * `"<eventId>|<mediaId>"` → 这一对最近一次 `approved` 的 `reviewedAt`。
   *
   * 用来兑现「**期内新增候选应在后续期次生效**」：一对在本期开始之后才获批的候选，本期不参与轮换。
   * 拿不到这张表（或表里没有这一对）时按**可参与**处理——宁可让一张新获批的图早半期出现，
   * 也不要因为缺一张辅助表就让首页空掉。
   */
  approvedAt?: ReadonlyMap<string, string>;
};

/**
 * 当期的 (故事, 照片) 候选，并挑出这一期用哪一对。
 *
 * 三件事分得很清，混在一起就是上一版的那些 bug：
 *
 * 1. **轮换池 = 全部合格候选，不设上限。** 冷却长度等于池子大小，所以池子绝不能被页面的呈现上限
 *    截断。上一版把「进轮换」和「返回给页面」用同一个 6 去截，于是就算档案里有 20 组合格候选，
 *    同一张照片也每 6 期（1.5 天）就回来一次——冷却被一个**呈现**参数按住了。
 * 2. **返回给页面的最多 HOME_PHOTO_CANDIDATES_MAX 条**（当期选中的那条一定在里面）。
 *    这是「不向浏览器搬全库媒体」那条。池子有多大，看 `cooldown.editions`。
 * 3. **轮换次序只看 mediaId。** 质量分只决定「返回的那几条怎么排」，不决定轮到谁——
 *    否则一份离线质量缓存落地就会在六小时之内换掉照片（§5.5）。
 *
 * 期内不变的两条，都用**真实时间戳**兑现，不是靠约定：
 *   · 新获批的候选要 `reviewedAt < edition.startedAt` 才参与本期；
 *   · 一个 `ai_vision` 分数要 `assessedAt < edition.startedAt` 才在本期生效。
 * 撤销是唯一的例外，它立刻生效（§5.7）——候选每次从当前档案现算，撤掉的根本不在里面。
 *
 * 过滤顺序照 2026-09-13 `photoLedMoment` 的教训：先滤掉不合格的，再分连拍组，再选。
 */
export function buildPhotoCandidates(input: BuildPhotoCandidatesInput): HomePhotoCandidate[] {
  const { memories, birthDay, today, edition, quality, photoKey, approvedAt } = input;
  type Pair = { photo: HomeFeedPhoto; story: HomeStoryRef; burst: string; key: string };
  const paired: Pair[] = [];
  const seenKeys = new Set<string>();
  for (const memory of memories) {
    for (const photo of storyPhotosFor(memory, birthDay)) {
      const key = `${memory.id}|${photo.media.id}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const scored: HomeFeedPhoto = { ...photo, quality: effectiveQuality(quality, photo, today, edition) };
      paired.push({ photo: scored, story: storyRefOf(memory), burst: burstKeyOf(scored), key });
    }
  }
  // 一张照片只能对应一篇故事（PAGE-DECISION-0914-C）：同一个 mediaId 在两篇以上故事里都是获批配图时，
  // 首页不知道点它该进哪一篇，这张照片整个不进首页池——不是挑一篇，也不作为候选返回给页面。
  const storiesPerPhoto = new Map<string, Set<string>>();
  for (const entry of paired) {
    const owners = storiesPerPhoto.get(entry.photo.media.id) ?? new Set<string>();
    owners.add(entry.story.eventId);
    storiesPerPhoto.set(entry.photo.media.id, owners);
  }
  for (let i = paired.length - 1; i >= 0; i -= 1) {
    if ((storiesPerPhoto.get(paired[i].photo.media.id)?.size ?? 0) > 1) paired.splice(i, 1);
  }
  paired.sort((a, b) => a.photo.media.id.localeCompare(b.photo.media.id));

  // **先按本期资格过滤，再分连拍组。这个顺序是要害，不是实现细节。**
  //
  // 反过来做会怎样：一组连拍里有一张旧的（本期就能用）和一张本期刚获批的。连拍去重按 mediaId
  // 取组里的第一张——如果被取中的恰好是那张**新**的，随后资格过滤又把它拿掉，于是这一组在本期
  // 一张都不剩：那张本来合格的旧照片已经作为「同组重复」被丢掉了。家人看到的是「这组没有照片」，
  // 而真相是「合格的那张被一张本期还不能用的照片挤掉了」——假阴性。
  //
  // 这正是 2026-09-13 `photoLedMoment` 那次教训的同一个形状（先过滤完整候选，再选头图与缩略图）。
  // 上一版我把资格过滤写在了去重之后，等于把那条教训又踩了一遍。
  const eligible: Pair[] = [];
  const pending: { entry: Pair; reason: string }[] = [];
  for (const entry of paired) {
    const at = approvedAt?.get(entry.key);
    if (at && isAtOrAfterEditionStart(at, edition.startedAt)) {
      pending.push({ entry, reason: `本期（${edition.id}）开始后才通过审核，从下一期起参与轮换` });
      continue;
    }
    eligible.push(entry);
  }
  // 连拍去重只在**本期有资格**的候选里做，所以一张本期还不能用的照片不可能占掉组里的名额。
  const seenBursts = new Set<string>();
  const pool: Pair[] = [];
  const dropped: { entry: Pair; reason: string }[] = [];
  for (const entry of eligible) {
    if (seenBursts.has(entry.burst)) { dropped.push({ entry, reason: "同一时刻的连拍里已经取了一张" }); continue; }
    seenBursts.add(entry.burst);
    pool.push(entry);
  }
  // 同事件冷却：一段故事的每张获批配图都在池里，所以轮换次序按故事交错（interleaveByStory）。
  // 交错不开的相邻处（含整轮回到开头那一处）数出来写进 reason。有测试钉住它。
  const interleaved = interleaveByStory(pool);
  pool.splice(0, pool.length, ...interleaved);
  const adjacentSameStory = pool.length > 1
    ? pool.filter((entry, i) => entry.story.eventId === pool[(i + 1) % pool.length].story.eventId).length
    : 0;
  const share = largestStoryShare(pool);
  const adjacency = adjacentSameStory > 0
    ? `整轮 ${pool.length} 期里有 ${adjacentSameStory} 处相邻两期同属一段故事（首尾相接也算）`
      + (share.largest > share.limit ? `：一段故事有 ${share.largest} 张获批照片，超过一圈 ${pool.length} 张的一半，交错不开` : "")
    : "";
  const rotation = pool.length;
  const rotationIndex = rotation > 0 ? edition.index % rotation : 0;
  const cooldown = cooldownOf(rotation);
  const shortened = cooldown.shortfall;
  // 质量分只排「返回哪几条、怎么排」。它排在 mediaId 序之上，所以页面拿到的第一批是分最高的几条，
  // 但**轮到谁**已经由上面的 rotationIndex 定死了。
  const rankOf = new Map<string, number>();
  [...paired]
    .sort((a, b) =>
      (b.photo.quality?.score ?? 0) - (a.photo.quality?.score ?? 0)
      || b.photo.day.localeCompare(a.photo.day)
      || a.photo.media.id.localeCompare(b.photo.media.id))
    .forEach((entry, index) => rankOf.set(entry.key, index + 1));

  const explicit = photoKey ? pool.findIndex((entry) => entry.key === photoKey) : -1;
  const chosenIndex = explicit >= 0 ? explicit : rotationIndex;
  const chosen = pool[chosenIndex];

  const candidates: HomePhotoCandidate[] = [];
  const push = (entry: Pair, extra: { chosen: boolean; reason: string; cooldown?: HomePhotoCooldown }) => {
    if (candidates.length >= HOME_PHOTO_CANDIDATES_MAX) return;
    candidates.push({
      key: entry.key, photo: entry.photo, story: entry.story,
      qualityRank: rankOf.get(entry.key), ...extra,
    });
  };
  // 当期选中的那一条永远排第一，也永远在返回的清单里——池子再大也不会把它挤掉。
  if (chosen) {
    push(chosen, {
      chosen: true, cooldown,
      reason: explicit >= 0
        ? "页面显式切换到这一对"
        : `第 ${edition.index} 期轮换到这一对（池内第 ${rotationIndex + 1}/${rotation} 位）${shortened ? `；${shortened}` : ""}${adjacency ? `；${adjacency}` : ""}`,
    });
  }
  // 其余池内候选供「换张照片」用：**哪几条**进清单按质量分挑（池子比上限大时分高的先进），**怎么排**
  // 按轮换次序从当期那一条往后接——页面按清单顺序一张张换，所以清单顺序就是家人看到的换图顺序。
  // 2026-09-14 本地验收抓到：按质量分排时同一段故事的两张获批照片会连着出现，把按故事交错又拆散了。
  const restMax = HOME_PHOTO_CANDIDATES_MAX - (chosen ? 1 : 0);
  const restPicked = [...pool].filter((entry) => entry !== chosen)
    .sort((a, b) => (rankOf.get(a.key) ?? 0) - (rankOf.get(b.key) ?? 0))
    .slice(0, restMax);
  // 2026-09-14 总指挥批准修复：清单本身要重新按故事交错成一圈，再从当期那一张起转。
  // 上一版是在整个池的轮换次序上把没挑中的项抽掉——池子比上限大时，被抽掉的中间项让本来隔开的同一段故事
  // 挨在一起（生产 22 对时 16 次换图相邻 4 处）。对「挑中的这几条」重新交错，只要其中照片最多的一段故事不超过
  // 一半，整圈（含首尾相接）就没有相邻；池子不超过上限时挑中的就是整个池，排出来和原来的轮换次序一模一样。
  const listed = interleaveByStory(chosen ? [chosen, ...restPicked] : restPicked);
  const startAt = chosen ? listed.indexOf(chosen) + 1 : 0;
  const restInRotation = listed.map((_, k) => listed[(startAt + k) % listed.length]).filter((entry) => entry !== chosen);
  for (const entry of restInRotation) {
    push(entry, {
      chosen: false, cooldown,
      reason: `本期未选中（池内第 ${pool.indexOf(entry) + 1}/${rotation} 位）${shortened ? `；${shortened}` : ""}`,
    });
  }
  // 本期还不参与的、以及被连拍分组挡下的，都带原因列出来——没轮到和不合格是两件事。
  // 它们不参与轮换，所以不带 cooldown。
  for (const { entry, reason } of [...pending, ...dropped]) push(entry, { chosen: false, reason });
  return candidates;
}

/**
 * 首页的主故事。
 *
 * 有合格 (故事, 照片) 对时就用当期轮换到的那一对——新版设计的首页就是「一组有证据关联的主照片和
 * 故事」，照片和故事同属一个事件。一对都没有时退回窗口内的一段真实文字（同样按期次轮换，不随刷新
 * 变），并写明是哪一种「没有照片」：不画空框、不借别的故事的照片（§5.7）。
 */
function selectLead(
  memories: EditorialMemory[],
  candidates: HomePhotoCandidate[],
  edition: HomeFeedEdition,
): { lead?: HomeFeedLead; leadAbsence?: HomeUnavailable } {
  const chosen = candidates.find((candidate) => candidate.chosen);
  if (chosen) return { lead: { story: chosen.story, photo: chosen.photo } };
  if (memories.length === 0) {
    return { leadAbsence: { kind: "empty_material", reason: `最近 ${HOME_CANDIDATE_WINDOW_DAYS} 天里没有一段已发布的记忆` } };
  }
  const memory = memories[edition.index % memories.length];
  return { lead: { story: storyRefOf(memory), photoAbsence: photoAbsenceOf(memory) } };
}

/** 至多一条近况，绝不与主故事重复；同样按期次轮换，不随刷新变。 */
function selectRecentFact(memories: EditorialMemory[], leadEventId: string | undefined, edition: HomeFeedEdition): HomeRecentFact | undefined {
  const pool = memories.filter((memory) => memory.id !== leadEventId);
  if (pool.length === 0) return undefined;
  return storyRefOf(pool[edition.index % pool.length]);
}

// ── 提醒 ─────────────────────────────────────────────────────────────────────

/** 「9 月 15 日」/「9 月 7 日 — 9 月 13 日」/「时间待确认」。不猜日期。 */
export function deadlineLabelOf(when: UpcomingWhen): string {
  if (when.kind === "day") return formatDay(when.day);
  if (when.kind === "window") return `${formatDay(when.fromDay)} — ${formatDay(when.toDay)}`;
  return "时间待确认";
}

const endDayOf = (when: UpcomingWhen) => when.kind === "day" ? when.day : when.kind === "window" ? when.toDay : undefined;

/**
 * 关键事项：接种、就诊。它们过了日子也不从首页消失，也不会因为「最多两条」被折叠掉（§6.4、§6.7）。
 *
 * 判据是标题/备注里的实词，而不是 AI 分类：这一层不调模型，而 UpcomingItem 的页面投影里没有
 * category 列（lib/upcoming-contract.ts toUpcomingItem 故意只投影页面要用的字段）。
 * 词表与保鲜那边共用一份（lib/upcoming-freshness.ts），不在两个文件里各写一遍——
 * 两份词表迟早会分叉，而分叉的那一天，一件关键事项会在一个文件里永不过期、在另一个文件里按
 * 48 小时退场。
 */
export function isImportantReminder(item: Pick<UpcomingItem, "title" | "note">): boolean {
  return isImportantItem(item);
}

/**
 * 一条事项的证据链去处。先找具体那段记忆，找不到就退到它被提起的那个月——但**说清楚是哪一种**，
 * 让页面能给出对得上的标签（原则八）。两者都没有时返回空，页面就不画一个去不了的链接。
 */
function evidenceLinkOf(item: UpcomingItem): { evidenceHref?: string; evidenceKind?: "event" | "month" } {
  const eventId = item.evidence?.eventId;
  if (eventId) return { evidenceHref: `/events/${eventId}`, evidenceKind: "event" };
  const day = item.evidence?.day;
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) return { evidenceHref: monthHrefOf(day.slice(0, 7)), evidenceKind: "month" };
  return {};
}

function reminderOf(item: UpcomingItem, state: HomeReminderState, reason: string, sources: UpcomingSources | undefined): HomeReminder {
  return {
    id: item.id,
    title: item.title,
    state,
    item,
    deadlineLabel: deadlineLabelOf(item.when),
    reason,
    important: isImportantReminder(item),
    detail: item.note ?? item.statusNote,
    ...evidenceLinkOf(item),
    provenance: sources?.status === "ready" ? sources.byItem.get(item.id) : undefined,
  };
}

/**
 * 一条事项在首页上的状态。**只决定它排在哪、露不露出，库里那一行一个字都不动**（§6.1）。
 *
 * 过期不是一种库状态（lib/upcoming-contract.ts isOverdue 的原话），所以这里算出来的 expired
 * 只是「不该再占首页」，不是完成、不是取消、不是删除。
 *
 * 「还新鲜吗」整件事交给 lib/upcoming-freshness.ts 判：有期限的沿用原意、无期限的临时事项 48 小时、
 * 库存预测 72 小时、习惯提醒 7 天、接种就诊永不按时钟过期、待定计划不设过期。起算点是原始事项被
 * 提出的那天，不是导入日，也不是打开页面的那天。
 */
export function reminderStateOf(item: UpcomingItem, today: string, supersededIds: ReadonlySet<string>): { state: HomeReminderState; reason: string } {
  if (supersededIds.has(item.id)) return { state: "superseded", reason: "另一条事项明确取代了它" };
  if (item.status === "done") return { state: "done", reason: "有明确的完成证据" };
  if (item.status === "cancelled") return { state: "cancelled", reason: "有明确的取消证据" };
  const verdict = freshnessOf(item, today);
  if (verdict.stale) return { state: "expired", reason: verdict.reason };
  // 状态是领域事实，保鲜只决定「还新不新鲜」。一条**待定**的计划即使写了日子也还是待定：
  // 生产里有一条计划带着 9 月 7 日到 13 日的窗口，但没人定下来去哪、去不去。
  // 把它显示成「要做的」，就是把一次商量说成一件已定的事（§6 的「未确定的计划明确标注待定」）。
  if (item.status === "tentative") {
    return { state: "tentative", reason: verdict.klass === "dated" ? `还没定下来（${verdict.reason}）` : "还没定下来" };
  }
  if (verdict.klass === "dated") return { state: "active", reason: verdict.reason };
  if (verdict.klass === "undecided_plan") return { state: "tentative", reason: "还没定下来" };
  // 剩下的都是「没有期限、还在新鲜期内」：时间待确认。关键事项在这里永远落到这一档，
  // 因为 freshnessOf 对它从不判过期——没有结果就一直是待核实，不生成医疗期限（§6.4）。
  return {
    state: "needs_confirmation",
    reason: verdict.klass === "important" ? "关键事项，时间待确认，还没有结果" : `时间待确认（${verdict.reason}）`,
  };
}

/**
 * 待办 → 首页提醒。
 *
 * 默认露出一条；有关键事项时最多两条。退场的进 retired 并带原因，其余的进 more 保持可达
 * （§6.6：用一个可展开摘要保持可达，默认布局不膨胀）。
 *
 * 露出次序：关键待核实 → 今天/之后 → 待核实 → 待定。**过期的一条都不默认露出**——那正是
 * 「把陈旧采购从首页移出」要解决的事——但它们仍然在 more 和 retired 里，一条都没丢。
 */
export function buildReminders(
  feed: UpcomingFeed | undefined,
  today: string,
  sources: UpcomingSources | undefined,
  habitLog: HabitDisplayLog = NO_HABIT_DISPLAY_LOG,
): HomeFeedReminders {
  if (!feed) return { status: "unavailable", unavailable: { kind: "not_extracted", reason: "本次渲染没有读到待办" } };
  if (feed.status === "clear") return { status: "clear", windowFrom: feed.windowFrom, readToDay: feed.readToDay };
  if (feed.status === "unavailable") {
    return { status: "unavailable", unavailable: { kind: unavailableKindOf(feed.reason), reason: feed.reason } };
  }
  const supersededIds = new Set(feed.items.flatMap((item) => item.supersedes ?? []));
  const all = feed.items.map((item) => {
    const { state, reason } = reminderStateOf(item, today, supersededIds);
    return reminderOf(item, state, reason, sources);
  });
  if (all.length === 0) {
    return { status: "unavailable", unavailable: { kind: "empty_material", reason: "读到了待办，但没有一条能放上首页" } };
  }
  const retired: HomeRetiredReminder[] = all
    .filter((reminder) => reminder.state === "expired")
    .map((reminder) => ({ id: reminder.id, title: reminder.title, reason: reminder.reason, status: reminder.item.status, kind: "expired" as const }));
  const showable = all.filter((reminder) =>
    reminder.state === "active" || reminder.state === "needs_confirmation" || reminder.state === "tentative");
  const rank = (reminder: HomeReminder) => {
    if (reminder.important && reminder.state === "needs_confirmation") return 0;
    if (reminder.state === "active") return 1;
    if (reminder.state === "needs_confirmation") return 2;
    return 3;
  };
  const ordered = [...showable].sort((a, b) =>
    rank(a) - rank(b)
    || (endDayOf(a.item.when) ?? "9999-99-99").localeCompare(endDayOf(b.item.when) ?? "9999-99-99")
    || a.id.localeCompare(b.id));
  // 习惯提醒「最多两个不同自然日露出」（§6.3）——数的是**实际展示过的日子**，由 habitLog 提供。
  //
  // 2026-09-13 第二次修这里。第一次改对了「作用在待展示序列上」和「退场记录照抄真实 status」，
  // 但计数仍然用 `raisedOn`——那是这件事**被说起**的那天，和它**在首页露过脸**的日子毫无关系。
  // 一条 9 月 8 日提起的习惯提醒可能一次都没露出过，也可能连着露了五天；按 raisedOn 数，前者会被
  // 算成「已经用掉一个日期」，后者会被算成「才用掉一个」。两种都错，而且错得反方向。
  //
  // 现在：今天露过 → 放行（同一天刷新多少次都只占一个自然日）；今天没露过且已经露过两个不同的
  // 日子 → 拦下（第三个自然日起不占默认位）；没露出过 → 一天都不算，当然放行。
  const { dropped: habitDropped } = capHabitByShownDays(
    ordered.map((reminder) => ({ id: reminder.id, title: reminder.title, klass: classifyFreshness(reminder.item) })),
    today,
    habitLog,
  );
  const cappedIds = new Set(habitDropped.map(({ entry }) => entry.id));
  for (const { entry, reason } of habitDropped) {
    const source = all.find((reminder) => reminder.id === entry.id);
    retired.push({ id: entry.id, title: entry.title, reason, status: source?.item.status ?? "open", kind: "habit_capped" });
  }
  const displayable = ordered.filter((reminder) => !cappedIds.has(reminder.id));
  const limit = displayable.some((reminder) => reminder.important) ? REMINDERS_MAX_SHOWN : REMINDERS_DEFAULT_SHOWN;
  const shown = displayable.slice(0, limit);
  const shownIds = new Set(shown.map((reminder) => reminder.id));
  const more = all.filter((reminder) => !shownIds.has(reminder.id));
  // 只有真的进了默认位、且本身是习惯类的，才进这一组。
  const habitShownIds = shown
    .filter((reminder) => classifyFreshness(reminder.item) === "habit")
    .map((reminder) => reminder.id);
  return { status: "ready", shown, more, retired, habitShownIds };
}

/**
 * UpcomingFeed 的 unavailable 只带一句英文 reason（lib/upcoming.ts feedFromResult 写的），
 * 首页契约要求区分三种。这里按那一句话的来源归类，**把不确定的一律归到 not_extracted**：
 * 未知不能推断为「没有待办」或「全部完成」。
 */
function unavailableKindOf(reason: string): HomeUnavailableKind {
  if (reason.includes("threw") || reason.includes("could not read")) return "read_failed";
  if (reason.includes("no item survived")) return "empty_material";
  return "not_extracted";
}

// ─────────────────────────────────────────────────────────────────────────────
// 组装
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 纯函数：给定一次已经读好的 archive（不新增读取）＋ 已读好的待办，算出首页要的全部内容。
 * 测试直接喂 fixture 调它；SSR 走下面的 readHomeFeed()。
 */
export function buildHomeFeed(archive: FamilyArchive, options: BuildHomeFeedOptions = {}): HomeFeed {
  const now = options.now ?? new Date();
  const edition = options.edition ?? editionAt(now);
  const today = archive.time.today;
  const birthDay = archive.birthDay;
  const memories = candidateMemories(archive.chapters, today);
  const photoCandidates = buildPhotoCandidates({
    // 照片池取全部已发布记忆的获批配图；文字兜底与近况仍然只看 60 天窗口（memories）。
    memories: photoPoolMemories(archive.chapters, today), birthDay, today, edition,
    quality: options.quality,
    photoKey: options.photoKey,
    // 审核时间戳从档案已经带着的账本里现算，不额外读库。
    approvedAt: approvedBindingTimes(archive.store.qualityReviews ?? []),
  });
  const { lead, leadAbsence } = selectLead(memories, photoCandidates, edition);
  const recentFact = selectRecentFact(memories, lead?.story.eventId, edition);
  return {
    version: HOME_FEED_VERSION,
    clock: { today, todayLabel: formatDay(today), birthDay, ageToday: ageOn(birthDay, today) },
    edition,
    lead,
    leadAbsence,
    photoCandidates,
    recentFact,
    reminders: buildReminders(options.upcoming, today, options.upcomingSources, options.habitLog),
  };
}

/**
 * 首页的 SSR 入口。**复用现有三次读，不新增任何整库读取**：
 *
 *   loadFamilyArchiveOnDemand()   —— 300s 记忆化，首页今天已经在读（1 次或 0 次）
 *   readHomeUpcoming()            —— approved-only 家庭读（3 小查询，家庭量级表）
 *   readHomeUpcomingSources()     —— 只有第 2 步真的有东西可挂时才读（2 小查询）
 *
 * 没有 raw_sources、没有无 LIMIT 的整表查询、没有 getStore()/getOrganizerStore()。
 * 也没有任何模型调用：质量评分从 quality 注入，由离线批次算好后缓存。
 */
export async function readHomeFeed(options: BuildHomeFeedOptions = {}): Promise<HomeFeed> {
  const [{ loadFamilyArchiveOnDemand }, { readHomeUpcoming, readHomeUpcomingSources }] = await Promise.all([
    import("@/lib/family-archive"),
    import("@/lib/upcoming"),
  ]);
  const archive = options.archive ?? await loadFamilyArchiveOnDemand();
  const upcoming = options.upcoming ?? await readHomeUpcoming();
  const upcomingSources = options.upcomingSources
    ?? (upcoming.status === "ready" ? await readHomeUpcomingSources() : undefined);
  // 离线质量缓存的**最后一段线**。2026-09-13 之前这一段是断的：批次脚本会写出一份缓存，
  // `buildHomeFeed` 会用传进来的 `quality`，但 `readHomeFeed` 从来没有去读那份文件——
  // 于是就算批次跑成功了，首页也永远看不到它，每张照片都停在确定性降级分上。
  // 三个部件都对，中间没人接线，而每一段单独看都是「已实现」。
  const quality = options.quality ?? await loadHomePhotoQuality();
  // 习惯上限要的「露出过哪些自然日」。只按本次要判的那几条 id 去查，不整表扫；
  // 表还不存在（迁移随统一发布执行）时返回空日志，上限因此不生效——不生效的后果是不误伤任何人。
  const habitLog = options.habitLog ?? await loadHabitDisplayLog(upcoming);
  return buildHomeFeed(archive, { ...options, quality, upcoming, upcomingSources, habitLog });
}

/**
 * 读这几条待办的露出日日志。只问 feed 里真的有的那些 id，读不到就是空日志（上限不生效）。
 * 它是一次小查询：`where profile_id = ? and item_id in (…)`，家庭量级表，没有整表扫描。
 */
async function loadHabitDisplayLog(upcoming: UpcomingFeed | undefined): Promise<HabitDisplayLog | undefined> {
  if (!upcoming || upcoming.status !== "ready") return undefined;
  const ids = upcoming.items.map((item) => item.id);
  if (ids.length === 0) return undefined;
  try {
    const { habitDisplayLog } = await import("@/lib/db/habit-display-store");
    return await habitDisplayLog(ids);
  } catch {
    return undefined;
  }
}

/**
 * 读离线质量缓存，读不到就返回 undefined（首页照样渲染，分数标成降级）。
 *
 * 路径来自 `HOME_PHOTO_QUALITY_PATH`。没设、文件不在、JSON 坏了、缺 model/assessedAt——
 * 每一种都当「没有评估结果」，绝不半信半疑地用一半。这里**不调模型**（§4：模型不进入 SSR），
 * 只读一个已经算好的文件。
 *
 * 按请求读一次文件的成本：一份 30 张的缓存是几 KB 的本地 JSON，和这条路径上那次档案读不在一个量级。
 * 真要缓存它，得先想清楚「缓存失效」和「撤销立刻生效」怎么共存，所以现在不缓存。
 */
async function loadHomePhotoQuality(): Promise<HomePhotoQualityLookup | undefined> {
  try {
    const { loadQualityCache, qualityLookupFrom } = await import("@/lib/home-photo-quality");
    const cache = await loadQualityCache();
    return cache ? qualityLookupFrom(cache) : undefined;
  } catch {
    // 连模块都加载不了也不能打掉首页：没有分数就是没有分数。
    return undefined;
  }
}

/**
 * 习惯露出上报的**最小接口**（§6.3）。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 服务端自己校验「哪几条可计数」和「算哪一天」，**不信调用方给的任何一项**
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 上一版是 `reportHabitShown(feed)`：直接把 `feed.reminders.habitShownIds` 和 `feed.clock.today`
 * 写进库。那等于把两件事都交给调用方——**而配额是有限的，写错一次就少一天**：
 *
 *   · 日期给错（比如调用方自己算了一次 `new Date()`，或者拿了一份跨过日界的旧 feed），
 *     就会往错误的自然日插一行，而唯一键正是那一天；
 *   · 事项给错（折叠项、非习惯类、或者一份陈旧/被改过的 `habitShownIds`），
 *     就会让一条家人从没看见的提醒白占一个自然日。
 *
 * 所以这里：
 *
 *   1. **日期只用服务端自己的产品时钟**（`productToday()`，Asia/Shanghai 自然日）。
 *      调用方无法传日期——参数里没有这一项。
 *   2. **可计数的事项由服务端重新算一遍**：必须此刻真的在默认位（`shown`）里，
 *      **且**本身是习惯类（`classifyFreshness` 现算，不读 `habitShownIds` 那个预存数组）。
 *   3. `claimedItemIds` **只能收窄，不能放宽**：不在服务端算出的集合里的，一律拒，并写明原因。
 *   4. 传进来的 feed 如果跨过了日界（`feed.clock.today !== productToday()`），整次拒掉——
 *      那是一份陈旧的 feed，它说的「露出」属于昨天。
 *
 * 返回值把**记了什么**和**拒了什么、为什么**分开列出来，所以一次错误接线是看得见的，不是静默的。
 * 它从不抛：记不上一行露出日志，不该让家人看不到首页。
 *
 * **这个函数不决定自己在哪里被调用。** 本轮只提供接口与校验；接在哪个时机上（渲染后、
 * 单独的上报入口、还是别的）由总指挥定，数据轨不替页面轨决定接线位置。
 */
export type HabitDisplayReport = {
  /** 服务端自己的上海自然日。 */
  day: string;
  /** 真的写进去的事项 id。 */
  recorded: string[];
  /** 被拒的，带原因——错误接线在这里看得见。 */
  rejected: { id: string; reason: string }[];
  /** 整次没写的原因（没有连接、表还不存在、feed 跨了日界……）。 */
  skipped?: string;
};

export async function reportHabitDisplay(input: {
  /** 调用方声称露出了哪几条。**只能收窄**；不传就用服务端算出来的全部。 */
  claimedItemIds?: readonly string[];
  /** 已经读好的 feed。不传则服务端自己读一次；无论传不传，下面都会重算可计数集合。 */
  feed?: HomeFeed;
} = {}): Promise<HabitDisplayReport> {
  const { productToday } = await import("@/lib/time-truth");
  // 日期只来自服务端自己的时钟。参数里没有 day，调用方给不了。
  const day = productToday();
  const empty = (skipped?: string): HabitDisplayReport => ({ day, recorded: [], rejected: [], skipped });

  let feed: HomeFeed;
  try { feed = input.feed ?? await readHomeFeed(); }
  catch (error) { return empty(`读不到 feed：${String((error as Error)?.message ?? error)}`); }

  // 一份跨过日界的 feed，它说的「露出」属于昨天。整次拒掉，不往今天记。
  if (feed.clock.today !== day) {
    return empty(`feed 的产品日是 ${feed.clock.today}，服务端今天是 ${day}——这是一份跨日界的旧 feed，不计数`);
  }
  if (feed.reminders.status !== "ready") return empty(`提醒不是 ready（${feed.reminders.status}），没有任何露出可记`);

  // 可计数集合由服务端现算：此刻真的在默认位上，且本身是习惯类。
  const countable = new Set(
    feed.reminders.shown
      .filter((reminder) => classifyFreshness(reminder.item) === "habit")
      .map((reminder) => reminder.id),
  );
  const rejected: { id: string; reason: string }[] = [];
  let ids = [...countable];
  if (input.claimedItemIds) {
    const claimed = [...new Set(input.claimedItemIds)];
    for (const id of claimed) {
      if (countable.has(id)) continue;
      const inFeed = [...feed.reminders.shown, ...feed.reminders.more].find((reminder) => reminder.id === id);
      rejected.push({
        id,
        reason: !inFeed
          ? "这条事项不在本次 feed 里"
          : feed.reminders.shown.some((reminder) => reminder.id === id)
            ? "在默认位上，但不是习惯类——不占习惯配额"
            : "只折叠在展开里，没有真的露出",
      });
    }
    ids = claimed.filter((id) => countable.has(id));
  }
  if (ids.length === 0) return { day, recorded: [], rejected, skipped: rejected.length ? undefined : "没有可计数的习惯露出" };

  try {
    const { recordHabitShown } = await import("@/lib/db/habit-display-store");
    const result = await recordHabitShown(ids, day);
    return { day, recorded: result.skipped ? [] : ids, rejected, skipped: result.skipped };
  } catch (error) {
    return { day, recorded: [], rejected, skipped: `记录露出日失败：${String((error as Error)?.message ?? error)}` };
  }
}
