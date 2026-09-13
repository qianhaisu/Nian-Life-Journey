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
import { recentWindowStart } from "@/lib/home-recent-pick";
import type { UpcomingFeed, UpcomingSources } from "@/lib/upcoming";
import type { UpcomingItem, UpcomingWhen } from "@/lib/upcoming-contract";
import type { UpcomingProvenance } from "@/lib/upcoming-provenance";

/** 契约版本。页面轨按这个字符串确认自己接的是哪一版；只做兼容新增时递增小版本号。 */
export const HOME_FEED_VERSION = "home-feed/1.0.0";

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

/** Asia/Shanghai 的日历日与 0..23 小时。用 Intl 而不是「UTC+8」硬算，规则由时区库说，不由我们说。 */
function shanghaiNow(now: Date): { day: string; hour: number } {
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

/** 这张照片被放在首页的哪个用途上。一次批准只对一个用途有效（总指挥 2026-09-13）。 */
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
export type HomePhotoCandidate = {
  /** 切换用的稳定键 "<eventId>|<mediaId>"。 */
  key: string;
  photo: HomeFeedPhoto;
  story: HomeStoryRef;
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
  /** 证据链入口 "/events/<id>"（原则八）。 */
  evidenceHref?: string;
  provenance?: UpcomingProvenance;
};

/** 退场的事项：为什么退。它仍然可达，仍然不是完成。 */
export type HomeRetiredReminder = {
  id: string;
  title: string;
  /** 退场原因，人能读的一句话。 */
  reason: string;
  /** 退场时它在库里的状态——原封不动。 */
  status: UpcomingItem["status"];
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
  | { status: "ready"; shown: HomeReminder[]; more: HomeReminder[]; retired: HomeRetiredReminder[] }
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

/** 候选窗口：最近 60 天（§5.2）。历史照片只有命中现有真实回看关系才参与，本版不参与。 */
export const HOME_CANDIDATE_WINDOW_DAYS = 60;
/** 交给浏览器的候选上限。 */
export const HOME_PHOTO_CANDIDATES_MAX = 6;
/** 同一张照片的冷却天数 / 同一事件的冷却天数（§5.5）。候选不足时缩短，并记录理由。 */
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
  /** 显式切换：页面「换张照片」时把候选的 key 传回来，只在合格候选里换（§5.6）。 */
  photoKey?: string;
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
 * 一段记忆的合格配图。memory.lead 已经是逐 (eventId, mediaId) 人工审核后的结果
 * （lib/memory-chapters.ts → storyDisplayMedia，只认 Basis C），所以这里**不再放宽一格**：
 * 不看 trusted、不看同日、不看 confirmed 扁平集合。
 */
function leadPhotoOf(memory: EditorialMemory, birthDay: string | undefined): HomeFeedPhoto | undefined {
  if (!memory.lead) return undefined;
  const day = memory.signature.day;
  return {
    media: memory.lead,
    use: "story_lead",
    approval: { kind: "story_binding", eventId: memory.id },
    day,
    dateLabel: memory.signature.dateLabel,
    ageLabel: ageOn(birthDay, day),
  };
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
export function buildPhotoCandidates(
  memories: EditorialMemory[],
  birthDay: string | undefined,
  today: string,
  edition: HomeFeedEdition,
  quality: HomePhotoQualityLookup | undefined,
  photoKey?: string,
): HomePhotoCandidate[] {
  type Pair = { photo: HomeFeedPhoto; story: HomeStoryRef; burst: string };
  const paired: Pair[] = [];
  for (const memory of memories) {
    const photo = leadPhotoOf(memory, birthDay);
    if (!photo) continue;
    const scored: HomeFeedPhoto = { ...photo, quality: qualityFor(quality, photo, today) };
    paired.push({ photo: scored, story: storyRefOf(memory), burst: burstKeyOf(scored) });
  }
  paired.sort((a, b) =>
    (b.photo.quality?.score ?? 0) - (a.photo.quality?.score ?? 0)
    || b.photo.day.localeCompare(a.photo.day)
    || a.photo.media.id.localeCompare(b.photo.media.id));
  const seenBursts = new Set<string>();
  const kept: Pair[] = [];
  const dropped: { entry: Pair; reason: string }[] = [];
  for (const entry of paired) {
    if (seenBursts.has(entry.burst)) { dropped.push({ entry, reason: "同一时刻的连拍里已经取了一张" }); continue; }
    seenBursts.add(entry.burst);
    kept.push(entry);
  }
  const rotation = Math.min(kept.length, HOME_PHOTO_CANDIDATES_MAX);
  const rotationIndex = rotation > 0 ? edition.index % rotation : 0;
  // 冷却是否被缩短：一轮走完需要 rotation 期 × 6 小时。不足 PHOTO_COOLDOWN_DAYS 就是缩短了，说出来。
  const rotationDays = (rotation * EDITION_HOURS) / 24;
  const shortened = rotation > 0 && rotationDays < PHOTO_COOLDOWN_DAYS
    ? `候选不足：合格 (故事, 照片) 对只有 ${rotation} 组，整轮 ${rotationDays} 天 < 同图冷却 ${PHOTO_COOLDOWN_DAYS} 天，冷却缩短为整轮轮换；展示门槛未放宽`
    : undefined;
  const explicit = photoKey ? kept.findIndex((entry) => `${entry.story.eventId}|${entry.photo.media.id}` === photoKey) : -1;
  const chosenIndex = explicit >= 0 ? explicit : rotationIndex;
  const candidates: HomePhotoCandidate[] = kept.slice(0, HOME_PHOTO_CANDIDATES_MAX).map((entry, index) => ({
    key: `${entry.story.eventId}|${entry.photo.media.id}`,
    photo: entry.photo,
    story: entry.story,
    chosen: index === chosenIndex,
    reason: index === chosenIndex
      ? (explicit >= 0
        ? "页面显式切换到这一对"
        : `第 ${edition.index} 期轮换到这一对（第 ${rotationIndex + 1}/${rotation} 位）${shortened ? `；${shortened}` : ""}`)
      : `本期未选中${shortened ? `；${shortened}` : `；等轮换到第 ${index + 1}/${rotation} 位`}`,
  }));
  for (const { entry, reason } of dropped) {
    if (candidates.length >= HOME_PHOTO_CANDIDATES_MAX) break;
    candidates.push({
      key: `${entry.story.eventId}|${entry.photo.media.id}`,
      photo: entry.photo, story: entry.story, chosen: false, reason,
    });
  }
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
 * 词表刻意短而具体，宁可漏判成普通事项，也不把一件普通琐事抬成「关键健康事项」而永不退场。
 */
const IMPORTANT_WORDS = ["接种", "疫苗", "补种", "就诊", "看医生", "体检", "门诊", "住院", "复查", "打针"];
export function isImportantReminder(item: Pick<UpcomingItem, "title" | "note">): boolean {
  const text = `${item.title}${item.note ?? ""}`;
  return IMPORTANT_WORDS.some((word) => text.includes(word));
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
    evidenceHref: item.evidence?.eventId ? `/events/${item.evidence.eventId}` : undefined,
    provenance: sources?.status === "ready" ? sources.byItem.get(item.id) : undefined,
  };
}

/**
 * 一条事项在首页上的状态。**只决定它排在哪、露不露出，库里那一行一个字都不动**（§6.1）。
 *
 * 过期不是一种库状态（lib/upcoming-contract.ts isOverdue 的原话），所以这里算出来的 expired
 * 只是「不该再占首页」，不是完成、不是取消、不是删除。
 */
export function reminderStateOf(item: UpcomingItem, today: string, supersededIds: ReadonlySet<string>): { state: HomeReminderState; reason: string } {
  if (supersededIds.has(item.id)) return { state: "superseded", reason: "另一条事项明确取代了它" };
  if (item.status === "done") return { state: "done", reason: "有明确的完成证据" };
  if (item.status === "cancelled") return { state: "cancelled", reason: "有明确的取消证据" };
  const end = endDayOf(item.when);
  if (item.status === "tentative") {
    return end && end < today
      ? { state: "expired", reason: `待定的计划，${formatDay(end)}已经过去，没有后续消息` }
      : { state: "tentative", reason: "还没定下来" };
  }
  if (!end) {
    return isImportantReminder(item)
      ? { state: "needs_confirmation", reason: "关键事项，时间待确认，还没有结果" }
      : { state: "needs_confirmation", reason: "时间待确认" };
  }
  if (end < today) return { state: "expired", reason: `${formatDay(end)}已经过去，没有完成记录` };
  return { state: "active", reason: end === today ? "就在今天" : `${formatDay(end)}之前` };
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
export function buildReminders(feed: UpcomingFeed | undefined, today: string, sources: UpcomingSources | undefined): HomeFeedReminders {
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
    .map((reminder) => ({ id: reminder.id, title: reminder.title, reason: reminder.reason, status: reminder.item.status }));
  const showable = all.filter((reminder) => reminder.state === "active" || reminder.state === "needs_confirmation" || reminder.state === "tentative");
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
  const limit = ordered.some((reminder) => reminder.important) ? REMINDERS_MAX_SHOWN : REMINDERS_DEFAULT_SHOWN;
  const shown = ordered.slice(0, limit);
  const shownIds = new Set(shown.map((reminder) => reminder.id));
  const more = all.filter((reminder) => !shownIds.has(reminder.id));
  return { status: "ready", shown, more, retired };
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
  const photoCandidates = buildPhotoCandidates(memories, birthDay, today, edition, options.quality, options.photoKey);
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
    reminders: buildReminders(options.upcoming, today, options.upcomingSources),
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
  const archive = await loadFamilyArchiveOnDemand();
  const upcoming = options.upcoming ?? await readHomeUpcoming();
  const upcomingSources = options.upcomingSources
    ?? (upcoming.status === "ready" ? await readHomeUpcomingSources() : undefined);
  return buildHomeFeed(archive, { ...options, upcoming, upcomingSources });
}
