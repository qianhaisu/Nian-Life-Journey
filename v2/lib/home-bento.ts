import type { FamilyArchive } from "@/lib/family-archive";
import { NO_TOPICS, type PhotoTopicLabel, type PhotoTopicLookup } from "@/lib/home-memory-topics";
import { uniqueDisplayMedia } from "@/lib/media/display-identity";
import { isScreenShaped, photographsFirst } from "@/lib/media/presentation";
import { isGarbageLifeEvent, toMediaRef, type MediaRef } from "@/lib/memory-chapters";
import { detectMilestone, type Milestone } from "@/lib/milestones";
import type { MonthContent } from "@/lib/month-content";
import { presentableEvidenceText, stripWechatEmoticons } from "@/lib/organizer/evidence-text";
import { ageAtMonth, ageOn, formatDay, formatMonth, monthAgeLine } from "@/lib/time-signature";
import {
  PLACES,
  TRIPS,
  placeById,
  stampCount,
  stampKeyOf,
  travelStats,
  tripAge,
  tripRange,
  unitOf,
  type Trip,
} from "@/lib/travel/model";
import { mergeReviewedTravelRecords } from "@/lib/travel/reviewed-records";
import type { Contributor } from "@/lib/types";

// 首页模块化画布（Concept 02 · Modular Canvas）的纯内存选择器。
//
// 硬约束（CLAUDE.md & docs/nianlife-product-principles.md）：
//   1. 零新增数据库查询、零文件系统调用、零网络请求——只消费首页已加载的 FamilyArchive、
//      已缓存的月稿（MonthContent[]）、主题标注缓存（PhotoTopicLookup）与静态旅行档案。
//   2. 双时钟（原则二）：每一处日期都同时给出日历时间与张年当时的生命年龄（「当时 1 岁 8 个月」/
//      「出生那天」）。
//   3. 内容说话（原则三、原则四）：不编造一句文案，不输出「已归档 X 个月」「含照片与记录」
//      「微信同步」「[media]」「[旺柴]」等工程计数或占位符。
//   4. 记忆浮现（原则六）：时间胶囊只选 ≥45 天前、经质量门控且有真实叙事的过往瞬间，跨月份去重；
//      不足 2 张合格卡片时整节收起，绝不随机凑数或画空框。

export type HomeClockHeader = {
  today: string;
  todayLabel: string;
  currentAgeLabel?: string;
  kickerText: string;
};

export type BentoDayCard = {
  day: string;
  shortDateLabel: string;
  fullDateLabel: string;
  weekdayDateLabel: string;
  ageLabel?: string;
  ageDisplay?: string;
  title: string;
  excerpt: string;
  photo?: MediaRef;
  href: string;
  milestone?: Milestone | null;
};

export type BentoGrowthHighlight = {
  month: string;
  monthLabel: string;
  isCurrentMonth: boolean;
  ageDisplay?: string;
  headline: string;
  tags: string[];
  href: string;
};

export type VoiceTone = "mom" | "dad" | "teacher" | "elder" | "care";

export type BentoFamilyVoice = {
  id: string;
  speaker: string;
  avatarInitial: string;
  tone: VoiceTone;
  quote: string;
  day: string;
  shortDateLabel: string;
  ageDisplay?: string;
  href: string;
};

export type TimeCapsuleReason = "anniversary" | "half_year" | "milestone" | "season";

export type BentoTimeCapsule = {
  day: string;
  month: string;
  monthLabel: string;
  shortDateLabel: string;
  fullDateLabel: string;
  ageDisplay: string;
  badgeLabel: string;
  title: string;
  photo: MediaRef;
  href: string;
  reason: TimeCapsuleReason;
};

export type BentoTravelCity = {
  key: string;
  name: string;
  tripId: string;
  href: string;
  isLatest: boolean;
};

export type BentoTravelFootprint = {
  countryCount: number;
  cityCount: number;
  latestTrip?: {
    id: string;
    from: string;
    title: string;
    summary: string;
    rangeLabel: string;
    ageDisplay?: string;
    href: string;
  };
  cities: BentoTravelCity[];
};

export type HomeBentoModel = {
  clock: HomeClockHeader;
  latestDay: BentoDayCard | null;
  growth: BentoGrowthHighlight | null;
  voices: BentoFamilyVoice[];
  journal: {
    days: BentoDayCard[];
    latestMonthHref?: string;
    latestMonthLabel?: string;
  };
  capsules: BentoTimeCapsule[];
  travel: BentoTravelFootprint;
};

export type BuildHomeBentoInput = {
  archive: FamilyArchive;
  monthContents?: readonly MonthContent[];
  topics?: PhotoTopicLookup;
  today: string;
  /** 首屏回忆卡当前处于「某一天」模式时的日期（YYYY-MM-DD），避免紧邻的最新日切片重复同一天。 */
  activeLeadDay?: string;
  /** 顶部 RecentAnswer 已经展示的答案句，成长亮点与家人的话避免重复同一件事。 */
  answerLine?: string;
  /** 首屏回忆封面/主视觉已占用的照片 ID，下方卡片与时间胶囊硬性避让。 */
  excludePhotoIds?: Iterable<string>;
  /** 首屏各段回忆幻灯片包含的照片 ID，时间胶囊与近期卡片在有替代照片时优先避让。 */
  memorySlidePhotoIds?: Iterable<string>;
};

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

const PLACEHOLDER_NOISE =
  /!?\[[^\]]*\]\(\s*media\/[^)]*\)|\[(media|图片|视频|视频文件|表情包|动画表情|语音|文件|位置|链接|链接分享|名片|转账|红包)\]|\$(names|username|revoke|emoji)\$/gi;

const PIPELINE_JARGON = /微信同步|已归档\s*\d+|本月真实记录|\braw_source|\blife_event/i;

const SENSITIVE_MEDICAL = /发烧|高烧|体温\s*3[89]|急诊|门诊|住院|抗生素|雾化|腹泻|呕吐|过敏性|疫苗接种反应/;

// 只认 FAMILY_REGISTRY 与 STYLE.zhang.md 明确允许的称谓，长词优先匹配（如「潇潇老师」优先于「老师」）。
const CONFIRMED_SPEAKERS: readonly {
  label: string;
  initial: string;
  tone: VoiceTone;
}[] = [
  { label: "潇潇老师", initial: "潇", tone: "teacher" },
  { label: "阳阳老师", initial: "阳", tone: "teacher" },
  { label: "大兵老师", initial: "兵", tone: "teacher" },
  { label: "托班老师", initial: "师", tone: "teacher" },
  { label: "老师", initial: "师", tone: "teacher" },
  { label: "妈妈", initial: "妈", tone: "mom" },
  { label: "爸爸", initial: "爸", tone: "dad" },
  { label: "外婆", initial: "婆", tone: "elder" },
  { label: "外公", initial: "公", tone: "elder" },
  { label: "奶奶", initial: "奶", tone: "elder" },
  { label: "爷爷", initial: "爷", tone: "elder" },
  { label: "雪姨", initial: "雪", tone: "care" },
  { label: "吴艳", initial: "吴", tone: "care" },
  { label: "多多", initial: "多", tone: "care" },
];

const SPEAKER_MAP = new Map(CONFIRMED_SPEAKERS.map((item) => [item.label, item]));
const SPEAKER_PATTERN = CONFIRMED_SPEAKERS.map((item) => item.label).join("|");

const QUOTE_SPEECH_BEFORE = new RegExp(
  `(${SPEAKER_PATTERN})[^「“”」\\n。！？]{0,20}?(?:笑着说|发消息说|在群里说|发视频说|感叹说|记录道|写道|记下|嘱咐|感叹|提醒|夸他|夸赞|夸|笑着|说|问|讲|回|喊|道)[：:，,\\s]*[「“]([^」”]{4,72})[」”]`,
  "g",
);

const QUOTE_SPEECH_AFTER = new RegExp(
  `[「“]([^」”]{4,72})[」”][，,\\s]*(${SPEAKER_PATTERN})(?:笑着说|感叹|说|讲|回|写道)`,
  "g",
);

const norm = (text: string): string =>
  text.replace(/[\s，。！？、；：“”「」『』（）()·—\-]/g, "").toLowerCase();

function parseUtcDay(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  if ([y, m, d].some((n) => Number.isNaN(n))) return NaN;
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

export function daysBetween(earlier: string, later: string): number {
  const a = parseUtcDay(earlier);
  const b = parseUtcDay(later);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round(b - a);
}

export function shortDateLabel(day: string): string {
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  if (Number.isNaN(m) || Number.isNaN(d)) return day;
  return `${m} 月 ${d} 日`;
}

export function weekdayDateLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if ([y, m, d].some((n) => Number.isNaN(n))) return day;
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m} 月 ${d} 日 · ${wd}`;
}

export function formatAgeWhen(birthDay: string | undefined, day: string): string | undefined {
  const age = ageOn(birthDay, day);
  if (!age) return undefined;
  if (age === "出生的那天") return "出生那天";
  return `当时 ${age}`;
}

export function cleanDisplayText(raw: string | undefined | null): string {
  if (!raw) return "";
  const unescaped = raw.replace(/\\([[\]().*_~`>#+\-!\\])/g, "$1");
  const cleaned = stripWechatEmoticons(unescaped)
    .replace(PLACEHOLDER_NOISE, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  if (!cleaned || PIPELINE_JARGON.test(cleaned)) return "";
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

function trimExcerpt(text: string, maxChars = 86): string {
  const clean = cleanDisplayText(text).replace(/\n+/g, " ");
  const chars = [...clean];
  if (chars.length <= maxChars) return clean;
  let slice = chars.slice(0, maxChars).join("");

  // 绝不在未闭合的「…」或“…”引号内部拦腰截断
  const unclosedCorner = slice.lastIndexOf("「") > slice.lastIndexOf("」") ? slice.lastIndexOf("「") : -1;
  const unclosedCurly = slice.lastIndexOf("“") > slice.lastIndexOf("”") ? slice.lastIndexOf("“") : -1;
  const unclosedQuoteIdx = Math.max(unclosedCorner, unclosedCurly);
  if (unclosedQuoteIdx >= 8) {
    const beforeQuote = slice.slice(0, unclosedQuoteIdx);
    const speechLeadIn = beforeQuote.match(
      /[，,；]\s*(?:[^，,。！？；]{0,14}[，,]\s*)?[^，,。！？；]{0,14}?(?:说|道|夸|感叹|嘱咐|问|讲|喊)[：:，,\s]*$/u,
    );
    if (speechLeadIn && speechLeadIn.index !== undefined && [...beforeQuote.slice(0, speechLeadIn.index)].length >= 10) {
      const stem = beforeQuote.slice(0, speechLeadIn.index).replace(/[，、,。！？；：\s]+$/u, "");
      return `${stem}。`;
    }
    slice = beforeQuote;
  }

  const lastStop = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("！"), slice.lastIndexOf("？"), slice.lastIndexOf("；"));
  if (lastStop >= Math.floor(maxChars * 0.55)) {
    return slice.slice(0, lastStop + 1);
  }
  const cut = slice.replace(/[，、,。！？；：\s「“]+$/u, "");
  return `${cut}……`;
}

function deriveTitleFromParagraphs(paragraphs: readonly string[]): { title: string; usedFirstClause: boolean } | null {
  const first = cleanDisplayText(paragraphs[0]);
  if (!first) return null;
  const clauseMatch = first.match(/^([^。！？；\n]{4,24})[。！？；]/);
  if (clauseMatch) {
    return { title: clauseMatch[1].trim(), usedFirstClause: true };
  }
  const commaMatch = first.match(/^([^，,。！？；\n]{4,20})[，,]/);
  if (commaMatch) {
    return { title: commaMatch[1].trim(), usedFirstClause: false };
  }
  const chars = [...first];
  const short = chars.length <= 20 ? first : `${chars.slice(0, 19).join("").replace(/[，、,\s]+$/u, "")}……`;
  return { title: short, usedFirstClause: false };
}

type PhotoOrigin = "nursery" | "family" | "unknown";

type PhotoScene =
  | "nursery_group_routine"
  | "meal"
  | "water"
  | "sleep"
  | "outdoor"
  | "toy"
  | "hold"
  | "laugh"
  | "general";

type DayContext = "family" | "nursery" | "mixed";

type PublishedDayRecord = BentoDayCard & {
  month: string;
  paragraphs: string[];
  photos: MediaRef[];
  curatedLeadIds: Set<string>;
  monthCoverIds: Set<string>;
  dayContext: DayContext;
  dayMealCue: boolean;
  photoOrigins: ReadonlyMap<string, PhotoOrigin>;
  hasExplicitTitle: boolean;
  kind: "story" | "visual-description" | "text-only" | "event";
};

const TEACHER_SPEAKER_RE = /老师|园长|保育/;
const FAMILY_SPEAKER_RE = /妈妈|爸爸|外婆|外公|奶奶|爷爷|雪姨|吴艳|多多/;
const DAYCARE_TEXT_RE = /托班|乳儿班|教室|老师|园里|入园|全班|同学/;
const MEAL_ONLY_CUE_RE = /午饭|晚饭|餐盘|餐椅|吃饭|喂饭|喝粥|南瓜粥|辅食|点心|光盘|碗里/;
const NON_MEAL_ACTIVITY_RE = /滑梯|草坪|公园|泡泡|绘本|画册|看书|收书|小熊|马桶|英文|画|贝壳|涂色|帽|自行车|晒太阳|小鸟|暖风|睡|玩具|积木|车/;

function hasTextOverlap(a: string | undefined, b: string | undefined, minGram = 5): boolean {
  if (!a || !b) return false;
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  const minLen = Math.min(na.length, nb.length);
  if (minLen >= 4 && (na.includes(nb) || nb.includes(na))) return true;
  if (minLen < minGram) return false;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  for (let i = 0; i <= shorter.length - minGram; i += 1) {
    if (longer.includes(shorter.slice(i, i + minGram))) return true;
  }
  return false;
}

const GENERIC_ECHO_FRAMING_RE =
  /张小年|张年|小年|年年|[一二三四五六七八九十\d]{1,2}月(?:初|中旬|中|底|末|\d{1,2}日)?|(?:潇潇|阳阳|大兵|托班)?老师[说在]|(?:妈妈|爸爸|外婆|外公|奶奶|爷爷|雪姨)(?:笑着)?[说在]|今天|昨天|前天|早上|清晨|上午|中午|午后|下午|傍晚|晚上|夜里|半夜|回家|家里|屋里|自己|一起|一直|一下|一个|一点|开始|起来|出来|进去|过去|过来|下来|上去|时候|觉得|喜欢|看到|看见/g;

function stripEchoFraming(text: string): string {
  return norm(text.replace(GENERIC_ECHO_FRAMING_RE, " "));
}

function hasSemanticEcho(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  if (hasTextOverlap(a, b, 4)) return true;

  const ca = stripEchoFraming(a);
  const cb = stripEchoFraming(b);
  if (!ca || !cb) return false;

  const minLen = Math.min(ca.length, cb.length);
  if (minLen >= 3 && (ca.includes(cb) || cb.includes(ca))) return true;

  const shorter = ca.length <= cb.length ? ca : cb;
  const longer = ca.length <= cb.length ? cb : ca;

  if (minLen >= 3) {
    for (let i = 0; i <= shorter.length - 3; i += 1) {
      if (longer.includes(shorter.slice(i, i + 3))) return true;
    }
  }

  if (minLen >= 4) {
    const matchedBigrams = new Set<string>();
    for (let i = 0; i <= shorter.length - 2; i += 1) {
      const bg = shorter.slice(i, i + 2);
      if (longer.includes(bg)) {
        matchedBigrams.add(bg);
        if (matchedBigrams.size >= 2) return true;
      }
    }
  }

  return false;
}

function splitCleanSentences(raw: string | undefined | null): string[] {
  const cleaned = cleanDisplayText(raw);
  if (!cleaned) return [];
  const parts = cleaned
    .split(/(?<=[。！？；])(?![」”])\s*|\n+/)
    .map((s) => s.trim())
    .filter((s) => [...s].length >= 8);
  return parts.length > 1 ? parts : [];
}

function extractAllCleanSentences(paragraphs: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of paragraphs) {
    const cleaned = cleanDisplayText(p);
    if (!cleaned) continue;
    const parts = cleaned
      .split(/(?<=[。！？；])(?![」”])\s*|\n+/)
      .map((s) => s.trim())
      .filter((s) => [...s].length >= 10);
    if (parts.length > 0) {
      out.push(...parts);
    } else if ([...cleaned].length >= 10) {
      out.push(cleaned);
    }
  }
  return out;
}

const GROWTH_POSITIVE_CUE_RE =
  /学会|第一次|自己|独立|主动|会骑|会说|会唱|会数|认识|收拢|叠好|收书|放回|骑.*车|搬.*椅|戴着.*帽|跟着.*歌|晃脑袋|拍手/;

const GROWTH_NEGATIVE_CUE_RE = /半夜醒|折腾|补觉|不睡觉|迟一点|哭闹|闹觉|赖床/;

const TRAILING_SPEECH_CLAUSE_RE =
  /[，,；]\s*(?:[^，,。！？；「“]{0,14}[，,]\s*)?[^，,。！？；「“]{0,14}?(?:说|道|夸|感叹|嘱咐|问|讲|喊)[：:，,\s]*[「“][^」”]{4,}[」”][。！？；]?$/u;

function stripTrailingSpeechClause(sentence: string): string {
  const match = sentence.match(TRAILING_SPEECH_CLAUSE_RE);
  if (match && match.index !== undefined && [...sentence.slice(0, match.index)].length >= 10) {
    const stem = sentence.slice(0, match.index).replace(/[，、,。！？；：\s]+$/u, "");
    return `${stem}。`;
  }
  return sentence;
}

function isWeekdayIso(day: string | undefined): boolean {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  if ([y, m, d].some((n) => Number.isNaN(n))) return false;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd >= 1 && wd <= 5;
}

function parseClockMinutes(ts: string | undefined): number | null {
  if (!ts) return null;
  const match = ts.match(/[T\s](\d{2}):(\d{2})/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// 兼容微信导入中 UTC / 东八区字面量 / +8h 偏移三类时间戳：仅在托班上下文中使用
function isNurseryMealTimestamp(takenAt: string | undefined): boolean {
  const mins = parseClockMinutes(takenAt);
  if (mins === null) return false;
  const mod8h = mins % 480; // 03:25 / 11:25 / 19:25 -> 205
  return mod8h >= 185 && mod8h <= 265;
}

function isNurseryRoutineTimestamp(takenAt: string | undefined): boolean {
  if (isNurseryMealTimestamp(takenAt)) return true;
  const mins = parseClockMinutes(takenAt);
  if (mins === null) return false;
  const mod8h = mins % 480; // 午睡 12:30-13:35 (270..335) & 下午点心 15:00-15:40 (420..460)
  return (mod8h >= 270 && mod8h <= 335) || (mod8h >= 420 && mod8h <= 460);
}

function inferPhotoOrigins(
  archive: FamilyArchive,
  monthContents: readonly MonthContent[],
): Map<string, PhotoOrigin> {
  const rawSourceById = new Map(archive.store.rawSources.map((s) => [s.id, s]));
  const contributorById = new Map((archive.store.contributors ?? []).map((c) => [c.id, c]));
  const mediaById = new Map(archive.media.map((m) => [m.id, m]));

  const nurserySourceIds = new Set<string>();
  const familySourceIds = new Set<string>();
  const nurseryLabels = new Set<string>();
  const familyLabels = new Set<string>();

  for (const src of archive.store.rawSources) {
    const role = contributorById.get(src.contributorId)?.role;
    if (src.sourceType === "daycare_photo" || src.sourceType === "daycare_note" || role === "teacher") {
      nurserySourceIds.add(src.id);
      if (src.sourceLabel) nurseryLabels.add(src.sourceLabel);
    } else if (
      src.sourceType === "family_photo" ||
      src.sourceType === "parent_note" ||
      role === "mother" ||
      role === "father" ||
      role === "grandfather" ||
      role === "grandmother"
    ) {
      familySourceIds.add(src.id);
      if (src.sourceLabel) familyLabels.add(src.sourceLabel);
    }
  }

  const weekdayLandscapeDaysByLabel = new Map<string, Set<string>>();
  const daycareMentionLabels = new Set<string>();

  for (const content of monthContents) {
    const speakerMap = content.speakerBySourceId ?? {};
    for (const [srcId, speaker] of Object.entries(speakerMap)) {
      const src = rawSourceById.get(srcId);
      if (TEACHER_SPEAKER_RE.test(speaker)) {
        nurserySourceIds.add(srcId);
        if (src?.sourceLabel && src.sourceType !== "family_photo") nurseryLabels.add(src.sourceLabel);
      } else if (FAMILY_SPEAKER_RE.test(speaker)) {
        familySourceIds.add(srcId);
        if (src?.sourceLabel) familyLabels.add(src.sourceLabel);
      }
    }

    for (const entry of content.days) {
      const daySpeakers = (entry.sourceIds ?? []).map((id) => speakerMap[id]).filter(Boolean);
      const fullText = [entry.title ?? "", ...entry.paragraphs].join(" ");
      const hasTeacher = daySpeakers.some((s) => TEACHER_SPEAKER_RE.test(s)) || TEACHER_SPEAKER_RE.test(fullText);
      const hasFamily = daySpeakers.some((s) => FAMILY_SPEAKER_RE.test(s) && !TEACHER_SPEAKER_RE.test(s));
      const hasDaycareText = DAYCARE_TEXT_RE.test(fullText);
      const allDayMediaIds = [...entry.firstScreenMediaIds, ...entry.expandedMediaIds];

      for (const id of allDayMediaIds) {
        const m = mediaById.get(id);
        const src = m?.rawSourceId ? rawSourceById.get(m.rawSourceId) : undefined;
        if (!m || !src?.sourceLabel || src.sourceType === "family_photo") continue;
        if (hasTeacher || hasDaycareText) {
          daycareMentionLabels.add(src.sourceLabel);
          if (!hasFamily) nurseryLabels.add(src.sourceLabel);
        } else if (hasFamily) {
          familyLabels.add(src.sourceLabel);
        }
        const px = (m.width ?? 0) * (m.height ?? 0);
        if (isWeekdayIso(entry.day) && m.width > m.height && px > 500_000 && px < 3_500_000) {
          const set = weekdayLandscapeDaysByLabel.get(src.sourceLabel) ?? new Set<string>();
          set.add(entry.day);
          weekdayLandscapeDaysByLabel.set(src.sourceLabel, set);
        }
      }
    }
  }

  for (const [label, daySet] of weekdayLandscapeDaysByLabel.entries()) {
    if (daySet.size >= 2 && daycareMentionLabels.has(label)) {
      nurseryLabels.add(label);
    }
  }

  const out = new Map<string, PhotoOrigin>();
  for (const m of archive.media) {
    const src = m.rawSourceId ? rawSourceById.get(m.rawSourceId) : undefined;
    if (!src) {
      out.set(m.id, "unknown");
      continue;
    }
    if (src.sourceType === "family_photo" || src.sourceType === "parent_note") {
      out.set(m.id, "family");
    } else if (nurserySourceIds.has(src.id) || (src.sourceLabel && nurseryLabels.has(src.sourceLabel))) {
      out.set(m.id, "nursery");
    } else if (familySourceIds.has(src.id) || (src.sourceLabel && familyLabels.has(src.sourceLabel))) {
      out.set(m.id, "family");
    } else {
      out.set(m.id, "unknown");
    }
  }
  return out;
}

function detectDayContext(
  entry: { title?: string | null; paragraphs: readonly string[]; sourceIds?: readonly string[] },
  speakerMap?: Record<string, string>,
): { dayContext: DayContext; dayMealCue: boolean } {
  const daySpeakers = (entry.sourceIds ?? []).map((id) => speakerMap?.[id]).filter((s): s is string => Boolean(s));
  const fullText = [entry.title ?? "", ...entry.paragraphs].join(" ");
  const hasTeacher = daySpeakers.some((s) => TEACHER_SPEAKER_RE.test(s)) || TEACHER_SPEAKER_RE.test(fullText);
  const hasDaycare = hasTeacher || DAYCARE_TEXT_RE.test(fullText);
  const hasFamily =
    daySpeakers.some((s) => FAMILY_SPEAKER_RE.test(s) && !TEACHER_SPEAKER_RE.test(s)) ||
    FAMILY_SPEAKER_RE.test(fullText);

  let dayContext: DayContext = "mixed";
  if (hasFamily && !hasDaycare) dayContext = "family";
  else if (hasDaycare && !hasFamily) dayContext = "nursery";

  const titleText = entry.title ?? "";
  const dayMealCue =
    MEAL_ONLY_CUE_RE.test(titleText) ||
    (MEAL_ONLY_CUE_RE.test(fullText) && !NON_MEAL_ACTIVITY_RE.test(fullText));

  return { dayContext, dayMealCue };
}

function classifyPhotoScene(
  photo: MediaRef,
  label: PhotoTopicLabel | undefined,
  origin: PhotoOrigin,
  dayContext: DayContext,
  dayMealCue: boolean,
  dayPhotoCount: number,
): PhotoScene {
  const px = (photo.width ?? 0) * (photo.height ?? 0);
  const isLowMpLandscape = Boolean(
    photo.width &&
      photo.height &&
      photo.width > photo.height &&
      px > 0 &&
      px < 3_500_000 &&
      !isScreenShaped(photo),
  );

  if (label?.carousel) {
    if (
      !label.carousel.childMain &&
      (origin === "nursery" || label.topic === "吃饭" || label.topic === "睡觉")
    ) {
      return "nursery_group_routine";
    }
  } else if (isLowMpLandscape) {
    if (origin === "nursery" || (dayContext === "nursery" && isNurseryRoutineTimestamp(photo.takenAt))) {
      return "nursery_group_routine";
    }
  }

  if (label) {
    switch (label.topic) {
      case "吃饭":
        return "meal";
      case "玩水":
        return "water";
      case "睡觉":
        return "sleep";
      case "户外":
        return "outdoor";
      case "玩玩具":
        return "toy";
      case "抱着":
        return "hold";
      case "笑":
        return label.water ? "water" : "laugh";
      default:
        return label.water ? "water" : "general";
    }
  }

  if ((origin === "nursery" || dayContext === "nursery") && isNurseryMealTimestamp(photo.takenAt)) {
    return "meal";
  }
  if (dayMealCue && dayPhotoCount <= 2) {
    return "meal";
  }
  return "general";
}

type PhotoSelectionTracker = {
  topics: PhotoTopicLookup;
  privilege?: FamilyArchive["privilege"];
  hardExcludeIds: Set<string>;
  hardExcludeDisplayKeys: Set<string>;
  hardExcludeSceneKeys: Set<string>;
  softExcludeIds: Set<string>;
  usedBursts: Array<{ day: string; timeMs: number }>;
  usedScenes: Set<PhotoScene>;
};

function createPhotoTracker(options?: {
  topics?: PhotoTopicLookup;
  privilege?: FamilyArchive["privilege"];
  excludePhotoIds?: Iterable<string>;
  softExcludePhotoIds?: Iterable<string>;
  archiveMedia?: readonly FamilyArchive["media"][number][];
}): PhotoSelectionTracker {
  const topics = options?.topics ?? NO_TOPICS;
  const hardExcludeIds = new Set(options?.excludePhotoIds ?? []);
  const softExcludeIds = new Set(options?.softExcludePhotoIds ?? []);
  const hardExcludeDisplayKeys = new Set<string>();
  const hardExcludeSceneKeys = new Set<string>();

  if (options?.archiveMedia && hardExcludeIds.size > 0) {
    for (const m of options.archiveMedia) {
      if (!hardExcludeIds.has(m.id)) continue;
      const dk = (m as { displayKey?: string }).displayKey;
      if (dk) hardExcludeDisplayKeys.add(dk);
      const sk = topics(m.id)?.carousel?.sceneKey;
      if (sk) hardExcludeSceneKeys.add(sk);
    }
  }

  return {
    topics,
    privilege: options?.privilege,
    hardExcludeIds,
    hardExcludeDisplayKeys,
    hardExcludeSceneKeys,
    softExcludeIds,
    usedBursts: [],
    usedScenes: new Set<PhotoScene>(),
  };
}

function isHardExcludedPhoto(photo: MediaRef, day: string, tracker: PhotoSelectionTracker): boolean {
  if (tracker.hardExcludeIds.has(photo.id)) return true;
  if (photo.displayKey && tracker.hardExcludeDisplayKeys.has(photo.displayKey)) return true;
  const sk = tracker.topics(photo.id)?.carousel?.sceneKey;
  if (sk && tracker.hardExcludeSceneKeys.has(sk)) return true;
  const timeMs = photo.takenAt ? Date.parse(photo.takenAt) : NaN;
  if (!Number.isNaN(timeMs)) {
    for (const b of tracker.usedBursts) {
      if (b.day === day && Math.abs(timeMs - b.timeMs) <= 90_000) return true;
    }
  }
  return false;
}

function markPhotoUsed(photo: MediaRef, day: string, scene: PhotoScene, tracker: PhotoSelectionTracker): void {
  tracker.hardExcludeIds.add(photo.id);
  if (photo.displayKey) tracker.hardExcludeDisplayKeys.add(photo.displayKey);
  const sk = tracker.topics(photo.id)?.carousel?.sceneKey;
  if (sk) tracker.hardExcludeSceneKeys.add(sk);
  const timeMs = photo.takenAt ? Date.parse(photo.takenAt) : NaN;
  if (!Number.isNaN(timeMs)) {
    tracker.usedBursts.push({ day, timeMs });
  }
  if (scene !== "general") {
    tracker.usedScenes.add(scene);
  }
}

function pickBestPhotoForDay(
  record: PublishedDayRecord,
  tracker: PhotoSelectionTracker,
  allowHardExcludedFallback = false,
): { photo: MediaRef; scene: PhotoScene; score: number; sceneClashed: boolean } | undefined {
  if (record.photos.length === 0) return undefined;

  let candidates = record.photos
    .map((photo, index) => ({ photo, index }))
    .filter(({ photo }) => !isHardExcludedPhoto(photo, record.day, tracker));

  if (candidates.length === 0) {
    if (!allowHardExcludedFallback) return undefined;
    candidates = record.photos.map((photo, index) => ({ photo, index }));
  }

  let best:
    | { photo: MediaRef; scene: PhotoScene; score: number; sceneClashed: boolean }
    | undefined;

  for (const { photo, index } of candidates) {
    const label = tracker.topics(photo.id);
    const origin = record.photoOrigins.get(photo.id) ?? "unknown";
    const scene = classifyPhotoScene(
      photo,
      label,
      origin,
      record.dayContext,
      record.dayMealCue,
      record.photos.length,
    );

    let score = 0;
    if (record.monthCoverIds.has(photo.id)) score += 0.36;
    if (record.curatedLeadIds.has(photo.id)) {
      score += 0.14 + Math.max(0, 0.04 - index * 0.008);
    } else {
      score += Math.max(0, 0.02 - index * 0.002);
    }

    if (isScreenShaped(photo)) score -= 0.65;

    const px = (photo.width ?? 0) * (photo.height ?? 0);
    if (px >= 6_000_000) score += 0.24;
    if ((photo.height ?? 0) >= (photo.width ?? 0) && !isScreenShaped(photo)) score += 0.16;

    const c = label?.carousel;
    if (c) {
      if (
        !c.qualified ||
        c.motionBlur ||
        c.sensitive ||
        !c.childMain ||
        !c.faceClear ||
        c.faceUnblocked === false
      ) {
        score -= 0.5;
      } else {
        score += 0.3 + ((c.clarity * 0.55 + c.expression * 0.45) / 100) * 0.24;
      }
    } else if (label) {
      if (label.childInFrame === false) score -= 0.7;
      else score += (label.value - 0.5) * 0.35;
    }

    if (scene === "nursery_group_routine") score -= 0.55;

    if (record.dayContext === "family") {
      if (origin === "family") score += 0.28;
      else if (origin === "nursery") score -= 0.18;
    }

    if (tracker.privilege?.checked?.has(photo.id)) score += 0.08;
    if (tracker.privilege?.confirmed.has(photo.id)) score += 0.05;
    if (tracker.softExcludeIds.has(photo.id)) score -= 0.48;

    const sceneClashed = scene !== "general" && tracker.usedScenes.has(scene);
    if (sceneClashed) {
      score -= scene === "nursery_group_routine" ? 0.85 : scene === "meal" ? 0.6 : 0.45;
    }

    if (!best || score > best.score) {
      best = { photo, scene, score, sceneClashed };
    }
  }

  return best;
}

function resolveCuratedPhotos(
  ids: readonly string[],
  available: ReadonlyMap<string, FamilyArchive["media"][number]>,
  excluded: ReadonlySet<string> | undefined,
  context?: string,
): MediaRef[] {
  const seen = new Set<string>();
  const raw: FamilyArchive["media"][number][] = [];
  for (const id of ids) {
    if (seen.has(id) || excluded?.has(id)) continue;
    seen.add(id);
    const media = available.get(id);
    if (media) raw.push(media);
  }
  return photographsFirst(uniqueDisplayMedia(raw)).map((item) => toMediaRef(item, context));
}

export function collectPublishedDays(
  archive: FamilyArchive,
  monthContents: readonly MonthContent[],
  today: string,
  topics: PhotoTopicLookup = NO_TOPICS,
): PublishedDayRecord[] {
  const available = new Map(
    archive.media
      .filter((item) => item.type === "photo" && item.visibility !== "private")
      .map((item) => [item.id, item]),
  );
  const excluded = archive.privilege.excluded;
  const photoOrigins = inferPhotoOrigins(archive, monthContents);
  const defaultTracker = createPhotoTracker({ topics, privilege: archive.privilege });
  const byDay = new Map<string, PublishedDayRecord>();
  const editedMonths = new Set(monthContents.map((c) => c.month));
  const representedEventIds = new Set<string>();

  for (const content of monthContents) {
    const monthCoverIds = new Set<string>(content.coverMediaId ? [content.coverMediaId] : []);
    for (const entry of content.days) {
      for (const id of entry.eventIds ?? []) representedEventIds.add(id);
      if (entry.eventId) representedEventIds.add(entry.eventId);
      if (entry.day > today) continue;
      if (
        entry.kind === "visual-description" &&
        entry.expandedMediaIds.length > 0 &&
        entry.expandedMediaIds.every((id) => excluded?.has(id))
      ) {
        continue;
      }

      const explicitTitle = cleanDisplayText(entry.title);
      const cleanParagraphs = entry.paragraphs.map((p) => cleanDisplayText(p)).filter(Boolean);
      const orderedIds = [...entry.firstScreenMediaIds, ...entry.expandedMediaIds];
      const photos = resolveCuratedPhotos(orderedIds, available, excluded, explicitTitle || formatDay(entry.day));

      if (!explicitTitle && cleanParagraphs.length === 0 && photos.length === 0) continue;

      const derived = !explicitTitle ? deriveTitleFromParagraphs(cleanParagraphs) : null;
      const title = explicitTitle || derived?.title || `${shortDateLabel(entry.day)}的记录`;
      const bodySource = cleanParagraphs.join(" ");
      let remainder = bodySource;
      if (derived?.usedFirstClause && bodySource.startsWith(derived.title)) {
        remainder = bodySource.slice(derived.title.length).replace(/^[。！？；\s]+/, "");
      } else if (explicitTitle && bodySource.startsWith(explicitTitle)) {
        remainder = bodySource.slice(explicitTitle.length).replace(/^[，,。！？；：\s]+/, "");
      }
      const rawExcerpt = trimExcerpt(remainder || cleanParagraphs[0] || "");
      const excerpt = norm(rawExcerpt) === norm(title) ? "" : rawExcerpt;

      const [year, monthSeg, dom] = entry.day.split("-");
      const ageLabel = ageOn(archive.birthDay, entry.day) ?? entry.ageLabel;
      const milestone = detectMilestone(entry.day, [explicitTitle, ...cleanParagraphs], archive.birthDay);
      const { dayContext, dayMealCue } = detectDayContext(entry, content.speakerBySourceId);

      const record: PublishedDayRecord = {
        day: entry.day,
        month: content.month,
        shortDateLabel: shortDateLabel(entry.day),
        fullDateLabel: formatDay(entry.day),
        weekdayDateLabel: weekdayDateLabel(entry.day),
        ageLabel,
        ageDisplay: formatAgeWhen(archive.birthDay, entry.day) ?? (entry.ageLabel ? `当时 ${entry.ageLabel}` : undefined),
        title,
        excerpt,
        photo: photos[0],
        photos,
        curatedLeadIds: new Set(entry.firstScreenMediaIds),
        monthCoverIds,
        dayContext,
        dayMealCue,
        photoOrigins,
        hasExplicitTitle: Boolean(explicitTitle),
        paragraphs: cleanParagraphs,
        href: `/memory/${year}/${monthSeg}/${dom}`,
        milestone,
        kind: entry.kind,
      };
      record.photo = pickBestPhotoForDay(record, defaultTracker, true)?.photo ?? photos[0];
      byDay.set(entry.day, record);
    }
  }

  for (const yearChapter of archive.chapters) {
    for (const monthChapter of yearChapter.months) {
      for (const memory of monthChapter.memories) {
        if (representedEventIds.has(memory.id)) continue;
        const day = memory.signature.day;
        if (!day || day > today) continue;
        if (isGarbageLifeEvent({ title: memory.title, story: memory.excerpt })) continue;

        const cleanTitle = cleanDisplayText(memory.title);
        const cleanExcerpt = cleanDisplayText(memory.excerpt);
        if (!cleanTitle && !cleanExcerpt) continue;

        const storyPhotos = (memory.storyPhotos ?? (memory.lead ? [memory.lead] : []))
          .filter((p) => p.type === "photo" && available.has(p.id) && !excluded?.has(p.id));
        const orderedPhotos = photographsFirst(uniqueDisplayMedia(storyPhotos));

        const existing = byDay.get(day);
        if (existing) {
          if (cleanExcerpt && !norm(existing.paragraphs.join("")).includes(norm(cleanExcerpt))) {
            existing.paragraphs.push(cleanExcerpt);
            if (!existing.excerpt && norm(cleanExcerpt) !== norm(existing.title)) {
              existing.excerpt = trimExcerpt(cleanExcerpt);
            }
          }
          const have = new Set(existing.photos.map((p) => p.id));
          for (const photo of orderedPhotos) {
            if (!have.has(photo.id)) {
              existing.photos.push(photo);
              have.add(photo.id);
            }
          }
          existing.photo = pickBestPhotoForDay(existing, defaultTracker, true)?.photo ?? existing.photos[0];
          continue;
        }

        const [year, monthSeg, dom] = day.split("-");
        const href = editedMonths.has(monthChapter.month)
          ? `/memory/${year}/${monthSeg}/${dom}`
          : `/events/${memory.id}`;
        const milestone = detectMilestone(day, [cleanTitle, cleanExcerpt], archive.birthDay);
        const { dayContext, dayMealCue } = detectDayContext({
          title: cleanTitle,
          paragraphs: cleanExcerpt ? [cleanExcerpt] : [],
        });

        const record: PublishedDayRecord = {
          day,
          month: monthChapter.month,
          shortDateLabel: shortDateLabel(day),
          fullDateLabel: formatDay(day),
          weekdayDateLabel: weekdayDateLabel(day),
          ageLabel: ageOn(archive.birthDay, day) ?? memory.signature.ageLabel,
          ageDisplay: formatAgeWhen(archive.birthDay, day),
          title: cleanTitle || `${shortDateLabel(day)}的记录`,
          excerpt: trimExcerpt(cleanExcerpt && norm(cleanExcerpt) !== norm(cleanTitle) ? cleanExcerpt : ""),
          photo: orderedPhotos[0],
          photos: orderedPhotos,
          curatedLeadIds: new Set(orderedPhotos[0] ? [orderedPhotos[0].id] : []),
          monthCoverIds: new Set(),
          dayContext,
          dayMealCue,
          photoOrigins,
          hasExplicitTitle: Boolean(cleanTitle && !cleanTitle.endsWith("的一天")),
          paragraphs: cleanExcerpt ? [cleanExcerpt] : [],
          href,
          milestone,
          kind: "event",
        };
        record.photo = pickBestPhotoForDay(record, defaultTracker, true)?.photo ?? orderedPhotos[0];
        byDay.set(day, record);
      }
    }
  }

  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}

function toDayCard(record: PublishedDayRecord, photoOverride?: MediaRef): BentoDayCard {
  return {
    day: record.day,
    shortDateLabel: record.shortDateLabel,
    fullDateLabel: record.fullDateLabel,
    weekdayDateLabel: record.weekdayDateLabel,
    ageLabel: record.ageLabel,
    ageDisplay: record.ageDisplay,
    title: record.title,
    excerpt: record.excerpt,
    photo: photoOverride !== undefined ? photoOverride : record.photo,
    href: record.href,
    milestone: record.milestone,
  };
}

export function selectLatestDaySlice(
  days: readonly PublishedDayRecord[],
  activeLeadDay?: string,
  tracker?: PhotoSelectionTracker,
): BentoDayCard | null {
  if (days.length === 0) return null;
  const distinct = activeLeadDay ? days.filter((d) => d.day !== activeLeadDay) : [...days];
  const pool = distinct.length > 0 ? distinct : [...days];
  const richPool = pool.filter(
    (d) => d.kind !== "visual-description" && (d.excerpt.length >= 8 || d.hasExplicitTitle),
  );
  const candidates = richPool.length > 0 ? richPool : pool;

  if (!tracker) {
    return toDayCard(candidates[0]);
  }

  // 若首候选仅有一张已被首屏封面硬性占用的照片，尝试顺延到下一篇有独立照片的近期日；否则允许纯文字或回退
  for (const cand of candidates) {
    if (cand.photos.length === 0) {
      return toDayCard(cand, undefined);
    }
    const picked = pickBestPhotoForDay(cand, tracker, false);
    if (picked) {
      markPhotoUsed(picked.photo, cand.day, picked.scene, tracker);
      return toDayCard(cand, picked.photo);
    }
  }

  const fallback = candidates[0];
  const fallbackPick = pickBestPhotoForDay(fallback, tracker, true);
  if (fallbackPick) {
    markPhotoUsed(fallbackPick.photo, fallback.day, fallbackPick.scene, tracker);
  }
  return toDayCard(fallback, fallbackPick?.photo);
}

function shortHighlightTag(raw: string): string | null {
  const cleaned = cleanDisplayText(raw)
    .replace(/^[·•\-—\d.、\s]+/, "")
    .replace(/[。！？；]+$/g, "")
    .trim();
  if (!cleaned || PIPELINE_JARGON.test(cleaned)) return null;
  if (/^\d+\s*(篇|张|条|个|次)/.test(cleaned)) return null;
  const firstClause = cleaned.split(/[。！？；]/)[0]?.trim() ?? cleaned;
  const chars = [...firstClause];
  if (chars.length < 3) return null;
  if (chars.length <= 16) return firstClause;
  const subClause = firstClause.split(/[，,]/)[0]?.trim() ?? "";
  if ([...subClause].length >= 4 && [...subClause].length <= 16) return subClause;
  return null;
}

export function selectGrowthHighlight(
  archive: FamilyArchive,
  monthContents: readonly MonthContent[],
  days: readonly PublishedDayRecord[],
  today: string,
  answerLine?: string,
  options?: {
    displayedDays?: readonly BentoDayCard[];
  },
): BentoGrowthHighlight | null {
  const currentMonth = today.slice(0, 7);
  const displayedDays = options?.displayedDays ?? [];
  const displayedDaySet = new Set(displayedDays.map((d) => d.day));

  const candidateMonths = new Set<string>();
  for (const s of archive.snapshots) if (s.month <= currentMonth) candidateMonths.add(s.month);
  for (const c of monthContents) if (c.month <= currentMonth && c.days.some((d) => d.day <= today)) candidateMonths.add(c.month);
  for (const d of days) if (d.month <= currentMonth) candidateMonths.add(d.month);

  const sortedMonths = [...candidateMonths].sort((a, b) => b.localeCompare(a));
  const contentByMonth = new Map(monthContents.map((c) => [c.month, c]));
  const snapshotByMonth = new Map(archive.snapshots.map((s) => [s.month, s]));

  for (const month of sortedMonths) {
    const snapshot = snapshotByMonth.get(month);
    const content = contentByMonth.get(month);
    const monthDays = days.filter((d) => d.month === month);
    const unusedMonthDays = monthDays.filter((d) => !displayedDaySet.has(d.day));
    const unusedNarrativeDays = [
      ...unusedMonthDays.filter((d) => d.kind === "story"),
      ...unusedMonthDays.filter((d) => d.kind === "text-only"),
      ...unusedMonthDays.filter((d) => d.kind !== "story" && d.kind !== "text-only" && d.kind !== "visual-description"),
    ];

    type HeadlineCandidate = {
      text: string;
      sourceDay?: string;
      tier: "editorial" | "day_sentence" | "day_title";
      hasMilestone?: boolean;
      isStory?: boolean;
    };

    const rawHeadlinePool: Array<{
      text: string | undefined | null;
      sourceDay?: string;
      tier: HeadlineCandidate["tier"];
      hasMilestone?: boolean;
      isStory?: boolean;
    }> = [
      { text: content?.intro, tier: "editorial" },
      ...splitCleanSentences(content?.intro).map((text) => ({ text, tier: "editorial" as const })),
      { text: snapshot?.summary, tier: "editorial" },
      ...splitCleanSentences(snapshot?.summary).map((text) => ({ text, tier: "editorial" as const })),
      { text: content?.cardLine, tier: "editorial" },
      ...(snapshot?.highlights ?? []).map((text) => ({ text, tier: "editorial" as const })),
      ...unusedNarrativeDays.flatMap((d) => {
        const sentences = extractAllCleanSentences(d.paragraphs);
        const pool = sentences.length > 0 ? sentences : d.excerpt ? [d.excerpt] : [];
        return pool
          .map((s) => stripTrailingSpeechClause(s))
          .filter((s) => [...s].length >= 10)
          .map((text) => ({
            text,
            sourceDay: d.day,
            tier: "day_sentence" as const,
            hasMilestone: Boolean(d.milestone),
            isStory: d.kind === "story",
          }));
      }),
      ...unusedMonthDays
        .filter((d) => d.milestone || d.hasExplicitTitle)
        .map((d) => ({ text: d.title, sourceDay: d.day, tier: "day_title" as const, hasMilestone: Boolean(d.milestone) })),
      ...monthDays
        .filter((d) => d.milestone || d.hasExplicitTitle)
        .map((d) => ({ text: d.title, sourceDay: d.day, tier: "day_title" as const, hasMilestone: Boolean(d.milestone) })),
    ];

    const seenHeadlineNorms = new Set<string>();
    const candidateHeadlines: HeadlineCandidate[] = [];
    for (const item of rawHeadlinePool) {
      const cleaned = cleanDisplayText(item.text);
      if ([...cleaned].length < 6) continue;
      const k = norm(cleaned);
      if (!k || seenHeadlineNorms.has(k)) continue;
      seenHeadlineNorms.add(k);
      candidateHeadlines.push({
        text: cleaned,
        sourceDay: item.sourceDay,
        tier: item.tier,
        hasMilestone: item.hasMilestone,
        isStory: item.isStory,
      });
    }

    const headlineScore = (cand: HeadlineCandidate, index: number): number => {
      let score =
        cand.tier === "editorial" ? 2.4 : cand.tier === "day_sentence" ? 0.8 : 0.2;
      // 同档内保持原始时间/编辑顺序的微弱优先
      score -= index * 0.002;

      if (answerLine && hasSemanticEcho(cand.text, answerLine)) score -= 4.0;
      for (const d of displayedDays) {
        if (
          hasSemanticEcho(cand.text, d.title) ||
          (d.excerpt && hasSemanticEcho(cand.text, d.excerpt))
        ) {
          score -= 2.6;
        }
      }

      if (GROWTH_NEGATIVE_CUE_RE.test(cand.text)) {
        score -= 1.5;
      }

      if (cand.tier === "day_sentence") {
        if (cand.hasMilestone) score += 0.3;
        if (cand.isStory) score += 0.1;
        if (GROWTH_POSITIVE_CUE_RE.test(cand.text)) score += 0.55;
        if (!/[「“][^」”]+[」”]/.test(cand.text)) score += 0.15;
      }

      return score;
    };

    let distinctHeadline: string | undefined;
    let headlineSourceDay: string | undefined;
    let bestScore = -Infinity;
    for (let i = 0; i < candidateHeadlines.length; i += 1) {
      const cand = candidateHeadlines[i];
      const s = headlineScore(cand, i);
      if (s > bestScore) {
        bestScore = s;
        distinctHeadline = cand.text;
        headlineSourceDay = cand.sourceDay;
      }
    }

    const headlinePreview = distinctHeadline ? trimExcerpt(distinctHeadline, 58) : "";
    const tagPoolDays = headlineSourceDay
      ? unusedMonthDays.filter((d) => d.day !== headlineSourceDay)
      : unusedMonthDays;

    const tagCandidates: Array<{ raw: string; fromDay: boolean }> = [
      ...(snapshot?.highlights ?? []).map((raw) => ({ raw, fromDay: false })),
      ...tagPoolDays.filter((d) => d.milestone).map((d) => ({ raw: d.title, fromDay: true })),
      ...tagPoolDays.filter((d) => d.hasExplicitTitle && d.kind === "story").map((d) => ({ raw: d.title, fromDay: true })),
      ...tagPoolDays.filter((d) => d.hasExplicitTitle).map((d) => ({ raw: d.title, fromDay: true })),
    ];

    const tags: string[] = [];
    const seenTagNorms = new Set<string>(headlinePreview ? [norm(headlinePreview)] : []);
    for (const item of tagCandidates) {
      const tag = shortHighlightTag(item.raw);
      if (!tag) continue;
      const key = norm(tag);
      if (seenTagNorms.has(key)) continue;
      if (item.fromDay) {
        if (headlinePreview && hasSemanticEcho(tag, headlinePreview)) continue;
        if (answerLine && hasSemanticEcho(tag, answerLine)) continue;
        if (
          displayedDays.some(
            (d) => hasSemanticEcho(tag, d.title) || (d.excerpt && hasSemanticEcho(tag, d.excerpt)),
          )
        ) {
          continue;
        }
        if (tags.some((existing) => hasSemanticEcho(tag, existing))) continue;
      } else {
        if (headlinePreview && hasTextOverlap(tag, headlinePreview, 4)) continue;
        if (answerLine && hasTextOverlap(tag, answerLine, 6)) continue;
        if (displayedDays.some((d) => hasTextOverlap(tag, d.title, 4))) continue;
      }
      seenTagNorms.add(key);
      tags.push(tag);
      if (tags.length >= 4) break;
    }

    if (!distinctHeadline && tags.length === 0) continue;

    const headline = headlinePreview || tags[0];
    const [year, monthSeg] = month.split("-");
    const ageDisplay = monthAgeLine(month, today, ageAtMonth(archive.birthDay, month));

    return {
      month,
      monthLabel: formatMonth(month),
      isCurrentMonth: month === currentMonth,
      ageDisplay,
      headline,
      tags: distinctHeadline ? tags : tags.slice(1),
      href: `/memory/${year}/${monthSeg}`,
    };
  }

  return null;
}

function contributorSpeaker(contributor: Contributor | undefined): {
  label: string;
  initial: string;
  tone: VoiceTone;
} | null {
  if (!contributor) return null;
  const byDisplay = SPEAKER_MAP.get(contributor.displayName.trim());
  if (byDisplay) return byDisplay;
  switch (contributor.role) {
    case "mother":
      return SPEAKER_MAP.get("妈妈")!;
    case "father":
      return SPEAKER_MAP.get("爸爸")!;
    case "teacher":
      return SPEAKER_MAP.get("老师")!;
    default:
      return null;
  }
}

export function selectFamilyVoices(
  archive: FamilyArchive,
  days: readonly PublishedDayRecord[],
  today: string,
  limit = 3,
  options?: {
    answerLine?: string;
    avoidTexts?: readonly string[];
  },
): BentoFamilyVoice[] {
  const candidates: BentoFamilyVoice[] = [];
  const seenQuotes = new Set<string>();

  const pushCandidate = (
    speakerLabel: string,
    rawQuote: string,
    day: string,
    href: string,
    id: string,
  ) => {
    const meta = SPEAKER_MAP.get(speakerLabel);
    if (!meta) return;
    const cleaned = cleanDisplayText(rawQuote)
      .replace(/^[「“”」]+|[「“”」]+$/g, "")
      .trim();
    const charLen = [...cleaned].length;
    if (!cleaned || charLen < 4 || charLen > 72) return;
    if (SENSITIVE_MEDICAL.test(cleaned)) return;
    const key = norm(cleaned);
    if (key.length < 3 || seenQuotes.has(key)) return;
    seenQuotes.add(key);
    candidates.push({
      id,
      speaker: meta.label,
      avatarInitial: meta.initial,
      tone: meta.tone,
      quote: cleaned,
      day,
      shortDateLabel: shortDateLabel(day),
      ageDisplay: formatAgeWhen(archive.birthDay, day),
      href,
    });
  };

  for (const record of days) {
    const blocks = [record.title, ...record.paragraphs];
    for (let b = 0; b < blocks.length; b += 1) {
      const text = blocks[b];
      if (!text) continue;
      for (const match of text.matchAll(QUOTE_SPEECH_BEFORE)) {
        pushCandidate(match[1], match[2], record.day, record.href, `voice-${record.day}-${b}-${match.index ?? 0}`);
      }
      for (const match of text.matchAll(QUOTE_SPEECH_AFTER)) {
        pushCandidate(match[2], match[1], record.day, record.href, `voice-after-${record.day}-${b}-${match.index ?? 0}`);
      }
    }
  }

  // 同时扫描已发布事件的正文段落（部分早期月份没有外部月稿文件，原话记在 LifeEvent.story 里）
  const dayHrefByDate = new Map(days.map((d) => [d.day, d.href]));
  const sortedEvents = [...archive.events]
    .filter((e) => e.visibility !== "private" && e.occurredAt.slice(0, 10) <= today)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  for (const event of sortedEvents) {
    const day = event.occurredAt.slice(0, 10);
    const href = dayHrefByDate.get(day) ?? `/events/${event.id}`;
    const texts = [...(event.storySections ?? []), event.story ?? ""];
    for (let i = 0; i < texts.length; i += 1) {
      const text = texts[i];
      if (!text) continue;
      for (const match of text.matchAll(QUOTE_SPEECH_BEFORE)) {
        pushCandidate(match[1], match[2], day, href, `voice-ev-${event.id}-${i}-${match.index ?? 0}`);
      }
      for (const match of text.matchAll(QUOTE_SPEECH_AFTER)) {
        pushCandidate(match[2], match[1], day, href, `voice-ev-after-${event.id}-${i}-${match.index ?? 0}`);
      }
    }
  }

  // 当演示/测试档案里带有明确发言人且已公开的 rawSources 原文时，仅在引语不足时兜底补充
  if (candidates.length < limit && archive.store.contributors?.length) {
    const contributors = new Map(archive.store.contributors.map((c) => [c.id, c]));
    const knownMonths = new Set(archive.chapters.flatMap((y) => y.months.map((m) => m.month)));
    const rawSources = [...archive.store.rawSources]
      .filter((s) => s.visibility !== "private" && !s.deletedAt && typeof s.text === "string" && s.capturedAt.slice(0, 10) <= today)
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));

    for (const source of rawSources) {
      if (candidates.length >= limit * 2) break;
      const speaker = contributorSpeaker(contributors.get(source.contributorId));
      if (!speaker) continue;
      const cleaned = stripWechatEmoticons(presentableEvidenceText(source.text));
      if (!cleaned || [...cleaned].length < 6 || [...cleaned].length > 64) continue;
      if (SENSITIVE_MEDICAL.test(cleaned)) continue;
      const day = source.capturedAt.slice(0, 10);
      const month = day.slice(0, 7);
      const href =
        dayHrefByDate.get(day) ??
        (source.relatedLifeEventId ? `/events/${source.relatedLifeEventId}` : undefined) ??
        (knownMonths.has(month) ? `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}` : "/memory");
      pushCandidate(speaker.label, cleaned, day, href, `voice-src-${source.id}`);
    }
  }

  const answerLine = options?.answerLine;
  const avoidTexts = (options?.avoidTexts ?? []).filter(Boolean);

  const quoteRank = (item: BentoFamilyVoice): number => {
    if (answerLine && hasTextOverlap(item.quote, answerLine, 5)) return 2;
    if (avoidTexts.some((t) => hasTextOverlap(item.quote, t, 6))) return 1;
    return 0;
  };

  // 优先挑不与 RecentAnswer 或相邻日卡摘要重复的 10–72 字完整对话原句；
  // 同一档内优先让不同家人/老师的声音同场出现，再按时间新鲜度补足。
  const cleanFuller = candidates
    .filter((item) => [...item.quote].length >= 10 && quoteRank(item) === 0);
  const secondaryFuller = candidates
    .filter((item) => [...item.quote].length >= 10 && quoteRank(item) === 1);
  const cleanShorter = candidates
    .filter((item) => [...item.quote].length < 10 && quoteRank(item) <= 1)
    .sort((a, b) => quoteRank(a) - quoteRank(b));
  const answerOverlapping = candidates.filter((item) => quoteRank(item) === 2);

  const picked: BentoFamilyVoice[] = [];
  const usedIds = new Set<string>();
  const usedSpeakers = new Set<string>();

  const fillSpeakerDiverse = (tier: readonly BentoFamilyVoice[]) => {
    for (const item of tier) {
      if (picked.length >= limit) return;
      if (usedIds.has(item.id) || usedSpeakers.has(item.speaker)) continue;
      usedSpeakers.add(item.speaker);
      usedIds.add(item.id);
      picked.push(item);
    }
  };

  const fillRemaining = (tier: readonly BentoFamilyVoice[]) => {
    for (const item of tier) {
      if (picked.length >= limit) return;
      if (usedIds.has(item.id)) continue;
      usedIds.add(item.id);
      picked.push(item);
    }
  };

  // 第一轮：完整句中优先保证不同说话人（先非重复句，再已展示日卡内的次优句）
  fillSpeakerDiverse(cleanFuller);
  fillSpeakerDiverse(secondaryFuller);
  // 第二轮：同档完整句补足
  fillRemaining(cleanFuller);
  fillRemaining(secondaryFuller);
  // 第三轮：短句兜底（仍避开与顶部 RecentAnswer 撞梗的句子）
  if (picked.length < limit) {
    fillSpeakerDiverse(cleanShorter);
    fillRemaining(cleanShorter);
  }
  // 最终兜底：仅当全库候选极少时才允许与 RecentAnswer 重合的引语上场
  if (picked.length < limit) {
    fillSpeakerDiverse(answerOverlapping);
    fillRemaining(answerOverlapping);
  }

  return picked;
}

export function selectRecentJournalDays(
  archive: FamilyArchive,
  days: readonly PublishedDayRecord[],
  today: string,
  excludeDays: ReadonlySet<string>,
  limit = 3,
  tracker?: PhotoSelectionTracker,
): HomeBentoModel["journal"] {
  const activeTracker = tracker ?? createPhotoTracker({ privilege: archive.privilege });
  const eligible = days.filter(
    (d) => !excludeDays.has(d.day) && (d.excerpt.length > 0 || d.photos.length > 0 || d.photo !== undefined),
  );
  // 优先在近 45 天内选片（与「过去的张年」≥45 天严格错开），且同窗口内带公开照片的日子优先；
  // 仅当近 45 天总篇数不足 limit 时才向更早的候选窗口回退。
  const nearDays = eligible.filter((d) => daysBetween(d.day, today) < 45).slice(0, 30);
  const recentWindow = nearDays.length >= limit ? nearDays : eligible.slice(0, 30);

  const withPhoto = recentWindow.filter((d) => d.photos.length > 0 || d.photo !== undefined);
  const textOnly = recentWindow.filter((d) => d.photos.length === 0 && d.photo === undefined);

  const pickedCards: BentoDayCard[] = [];
  const pickedDaySet = new Set<string>();
  const deferredRoutineOrClash: PublishedDayRecord[] = [];

  // 第一遍：优先选出画面与场景各不雷同（尤其是避开重复托班餐桌/同主题）的带图日；
  // 若某一天有多张照片且首图与前卡同场景，pickBestPhotoForDay 会自动切换到该日另一张非雷同好图。
  for (const record of withPhoto) {
    if (pickedCards.length >= limit) break;
    const choice = pickBestPhotoForDay(record, activeTracker, false);
    if (!choice) {
      deferredRoutineOrClash.push(record);
      continue;
    }
    if (choice.sceneClashed || choice.scene === "nursery_group_routine") {
      deferredRoutineOrClash.push(record);
      continue;
    }
    markPhotoUsed(choice.photo, record.day, choice.scene, activeTracker);
    pickedDaySet.add(record.day);
    pickedCards.push(toDayCard(record, choice.photo));
  }

  // 第二遍：若非雷同带图日不足 limit，从延后的带图日中按时间顺序回填（仍严禁同一 media.id 重复）
  if (pickedCards.length < limit) {
    for (const record of deferredRoutineOrClash) {
      if (pickedCards.length >= limit) break;
      if (pickedDaySet.has(record.day)) continue;
      const choice = pickBestPhotoForDay(record, activeTracker, false);
      if (choice) {
        markPhotoUsed(choice.photo, record.day, choice.scene, activeTracker);
        pickedDaySet.add(record.day);
        pickedCards.push(toDayCard(record, choice.photo));
      } else if (record.excerpt.length > 0) {
        pickedDaySet.add(record.day);
        pickedCards.push(toDayCard(record, undefined));
      }
    }
  }

  // 第三遍：带图日总数仍不足 limit 时，用纯文字日补齐
  if (pickedCards.length < limit) {
    for (const record of textOnly) {
      if (pickedCards.length >= limit) break;
      if (pickedDaySet.has(record.day)) continue;
      pickedDaySet.add(record.day);
      pickedCards.push(toDayCard(record, undefined));
    }
  }

  const filtered = pickedCards.sort((a, b) => b.day.localeCompare(a.day));

  const latestMonth =
    days[0]?.month ??
    archive.chapters
      .flatMap((y) => y.months.map((m) => m.month))
      .filter((m) => m <= today.slice(0, 7))
      .sort()
      .at(-1);

  return {
    days: filtered,
    latestMonthHref: latestMonth ? `/memory/${latestMonth.slice(0, 4)}/${latestMonth.slice(5, 7)}` : undefined,
    latestMonthLabel: latestMonth ? `翻到 ${formatMonth(latestMonth)}` : undefined,
  };
}

function photoQualityScore(
  photo: MediaRef,
  label: PhotoTopicLabel | undefined,
  privilege: FamilyArchive["privilege"],
  isCuratedLead: boolean,
): number | null {
  const c = label?.carousel;
  if (c) {
    if (!c.qualified || !c.childMain || !c.faceClear || c.faceUnblocked === false || c.motionBlur || c.sensitive) {
      return null;
    }
    const base = (c.clarity * 0.55 + c.expression * 0.45) / 100;
    return base + (isScreenShaped(photo) ? -0.15 : 0.2);
  }

  if (label && label.childInFrame === false) return null;

  if (label && label.value >= 0.72 && label.confidence >= 0.6) {
    return label.value + (isScreenShaped(photo) ? -0.15 : 0.1);
  }

  if (privilege.confirmed.has(photo.id) || privilege.checked?.has(photo.id) || isCuratedLead) {
    if (isScreenShaped(photo)) return null;
    return 0.68 + (privilege.confirmed.has(photo.id) ? 0.08 : 0);
  }

  return null;
}

export function selectTimeCapsules(
  archive: FamilyArchive,
  days: readonly PublishedDayRecord[],
  topics: PhotoTopicLookup,
  today: string,
  limit = 4,
  options?: {
    excludePhotoIds?: ReadonlySet<string>;
    softExcludePhotoIds?: ReadonlySet<string>;
    excludeDays?: ReadonlySet<string>;
  },
): BentoTimeCapsule[] {
  const currentMonth = today.slice(0, 7);
  const todayMonthDay = today.slice(5, 10);
  const hardExcludeIds = options?.excludePhotoIds ?? new Set<string>();
  const softExcludeIds = options?.softExcludePhotoIds ?? new Set<string>();
  const excludeDays = options?.excludeDays ?? new Set<string>();

  const hardExcludeDisplayKeys = new Set<string>();
  if (hardExcludeIds.size > 0) {
    for (const m of archive.media) {
      if (!hardExcludeIds.has(m.id)) continue;
      const dk = (m as { displayKey?: string }).displayKey;
      if (dk) hardExcludeDisplayKeys.add(dk);
    }
  }

  type ScoredCapsule = BentoTimeCapsule & {
    score: number;
    daysAgo: number;
    topic?: string;
  };

  const inferCapsuleTopic = (photoTopic: string | undefined, title: string): string | undefined => {
    if (/笑/.test(title)) return "笑";
    if (photoTopic && photoTopic !== "其他") return photoTopic;
    if (/泳|玩水|水花|洗澡|海边|沙滩|踩水/.test(title)) return "玩水";
    if (/公园|草坪|散步|湖边|晒太阳|落叶|户外|出门/.test(title)) return "户外";
    if (/绘本|看书|翻书|积木|摇铃|玩具|小车|拓印|画/.test(title)) return "玩玩具";
    if (/睡/.test(title)) return "睡觉";
    if (/吃|辅食|粥|米糊/.test(title)) return "吃饭";
    return undefined;
  };

  const monthByTopic = new Map<string, Map<string, ScoredCapsule>>();

  for (const record of days) {
    if (record.month >= currentMonth) continue;
    if (excludeDays.has(record.day)) continue;
    const ago = daysBetween(record.day, today);
    if (ago < 45) continue;
    if (!record.hasExplicitTitle && !record.milestone) continue;
    if (record.photos.length === 0) continue;

    const ageDisplay = record.ageDisplay;
    if (!ageDisplay) continue;

    let bestPhoto: MediaRef | undefined;
    let bestPhotoScore = -Infinity;
    for (const photo of record.photos) {
      if (hardExcludeIds.has(photo.id)) continue;
      if (photo.displayKey && hardExcludeDisplayKeys.has(photo.displayKey)) continue;
      const label = topics(photo.id);
      const q = photoQualityScore(
        photo,
        label,
        archive.privilege,
        record.curatedLeadIds.has(photo.id) && record.kind === "story",
      );
      if (q === null) continue;
      const adjusted = q - (softExcludeIds.has(photo.id) ? 0.55 : 0);
      if (adjusted > bestPhotoScore) {
        bestPhotoScore = adjusted;
        bestPhoto = photo;
      }
    }
    if (!bestPhoto) continue;

    // 判断时间胶囊的关系类型：去年同月/同日、半年前、成长里程碑、早先季节
    const sameMonthLastYear =
      Number(today.slice(0, 4)) - Number(record.day.slice(0, 4)) >= 1 &&
      Math.abs(
        (Number(record.day.slice(5, 7)) - Number(today.slice(5, 7)) + 12) % 12,
      ) === 0;
    const nearAnniversaryDay = Math.abs(ago - 365) <= 24 || record.day.slice(5, 10) === todayMonthDay;
    const isHalfYear = ago >= 155 && ago <= 220;

    let reason: TimeCapsuleReason = "season";
    let relationBoost = 0;
    if (sameMonthLastYear || nearAnniversaryDay) {
      reason = "anniversary";
      relationBoost = 0.35;
    } else if (record.milestone) {
      reason = "milestone";
      relationBoost = 0.3;
    } else if (isHalfYear) {
      reason = "half_year";
      relationBoost = 0.22;
    }

    const badgeLabel =
      record.milestone?.kind === "birthday"
        ? `满 ${record.milestone.badge.replace(/\s*岁?生日$/, "").trim()} 周岁`
        : ageDisplay;

    const photoTopic = topics(bestPhoto.id)?.topic;
    const resolvedTopic = inferCapsuleTopic(photoTopic, record.title);
    const totalScore = bestPhotoScore + relationBoost + (record.excerpt ? 0.08 : 0);
    const candidate: ScoredCapsule = {
      day: record.day,
      month: record.month,
      monthLabel: formatMonth(record.month),
      shortDateLabel: record.shortDateLabel,
      fullDateLabel: record.fullDateLabel,
      ageDisplay,
      badgeLabel,
      title: record.title,
      photo: bestPhoto,
      href: record.href,
      reason,
      score: totalScore,
      daysAgo: ago,
      topic: resolvedTopic,
    };

    const topicKey = resolvedTopic ?? "__unclassified__";
    let perTopic = monthByTopic.get(record.month);
    if (!perTopic) {
      perTopic = new Map<string, ScoredCapsule>();
      monthByTopic.set(record.month, perTopic);
    }
    const prev = perTopic.get(topicKey);
    if (!prev || candidate.score > prev.score) {
      perTopic.set(topicKey, candidate);
    }
  }

  // 原则六：至少需要 2 个不同过往月份的合格瞬间，否则整节收起，绝不凑数或显示空占位
  if (monthByTopic.size < 2) return [];

  const candidates = [...monthByTopic.values()].flatMap((perTopic) => [...perTopic.values()]);
  const MAX_CAPSULES_PER_TOPIC = 2;

  const picked: ScoredCapsule[] = [];
  const usedMonths = new Set<string>();
  const topicCounts = new Map<string, number>();
  const usedCapsulePhotos = new Set<string>();
  const priorityOrder: TimeCapsuleReason[] = ["anniversary", "half_year", "milestone", "season"];

  const effectiveScore = (c: ScoredCapsule): number => {
    const count = c.topic ? (topicCounts.get(c.topic) ?? 0) : 0;
    return c.score - (count >= 1 ? 0.28 * count : 0);
  };

  const isUnderTopicCap = (c: ScoredCapsule): boolean =>
    !c.topic || (topicCounts.get(c.topic) ?? 0) < MAX_CAPSULES_PER_TOPIC;

  const commitPick = (c: ScoredCapsule) => {
    picked.push(c);
    usedMonths.add(c.month);
    usedCapsulePhotos.add(c.photo.id);
    if (c.topic) {
      topicCounts.set(c.topic, (topicCounts.get(c.topic) ?? 0) + 1);
    }
  };

  for (const reason of priorityOrder) {
    if (picked.length >= limit) break;
    const reasonPool = candidates.filter(
      (c) => c.reason === reason && !usedMonths.has(c.month) && !usedCapsulePhotos.has(c.photo.id),
    );
    const uncapped = reasonPool.filter(isUnderTopicCap);
    // 若该关系槽位所有候选都撞上已满 2 张的主题上限，留给后续全局循环从其他不同主题月份挑选
    const match = uncapped.sort((a, b) => effectiveScore(b) - effectiveScore(a))[0];
    if (match) commitPick(match);
  }

  while (picked.length < limit) {
    const remaining = candidates.filter(
      (c) => !usedMonths.has(c.month) && !usedCapsulePhotos.has(c.photo.id),
    );
    if (remaining.length === 0) break;
    const uncapped = remaining.filter(isUnderTopicCap);
    const pool = uncapped.length > 0 ? uncapped : remaining;
    const next = pool.sort((a, b) => effectiveScore(b) - effectiveScore(a))[0];
    if (!next) break;
    commitPick(next);
  }

  // 按时间倒序排列（从较近的过往阶段一路回看更小的时候，像翻相机胶卷）
  return picked
    .sort((a, b) => b.day.localeCompare(a.day))
    .map(({ score: _score, daysAgo: _daysAgo, topic: _topic, ...capsule }) => capsule);
}

function collectSyncedTrips(monthContents: readonly MonthContent[], today: string): Trip[] {
  const trips = [...TRIPS];
  for (const place of PLACES) {
    const dates = place.livedIn?.match(/^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/);
    if (!dates || trips.some((trip) => trip.placeIds.includes(place.id) && trip.from <= dates[1] && trip.to >= dates[1])) continue;
    trips.push({
      id: `stay-${dates[1]}-${place.id}`,
      title: `住在${place.name}的日子`,
      kind: place.hometown ? "hometown" : "travel",
      from: dates[1],
      to: dates[2],
      placeIds: [place.id],
      summary: `这段时间住在${place.name}。`,
      evidence: [`地点档案的居住记录：${place.livedIn}`],
    });
  }
  for (const content of monthContents) {
    for (const day of content.days) {
      const title = day.title ?? "";
      if (/准备|计划|打算|想去|明天|下周|可能|如果|没去|没有|取消|不去|爸爸|妈妈|爷爷|奶奶|外公|外婆|[？?]|说要/.test(title)) continue;
      for (const place of PLACES.filter((item) => item.level === "city" && !item.home)) {
        const names = [place.name, ...(place.aliases ?? [])].filter((name) => name.length >= 2);
        const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
        if (!new RegExp(`(?:出发(?:回|去|到)?|回到|到了|抵达|到达|来到)(?:${escaped})`).test(title)) continue;
        if (trips.some((trip) => trip.placeIds.includes(place.id) && trip.from <= day.day && trip.to >= day.day)) continue;
        trips.push({
          id: `record-${day.day}-${place.id}`,
          title,
          kind: place.hometown || place.name === "温州" ? "hometown" : "travel",
          from: day.day,
          to: day.day,
          placeIds: [place.id],
          coverDay: day.day,
          recordOnly: true,
          summary: day.paragraphs[0] ?? title,
          evidence: [`已发布日页：${day.day}`, ...(day.sourceIds ?? [])],
        });
      }
    }
  }
  try {
    return mergeReviewedTravelRecords(monthContents, trips, today);
  } catch {
    return trips.sort((a, b) => b.from.localeCompare(a.from) || a.id.localeCompare(b.id));
  }
}

function stripRedundantTripLead(title: string, rawSummary: string | undefined): string {
  const cleanTitle = cleanDisplayText(title) || title;
  const cleanSummary = cleanDisplayText(rawSummary);
  if (!cleanSummary) return "";
  if (norm(cleanSummary) === norm(cleanTitle)) return "";

  const sentences = cleanSummary
    .split(/(?<=[。！？；])(?![」”])\s*|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (sentences.length >= 2 && hasSemanticEcho(sentences[0], cleanTitle)) {
    return trimExcerpt(sentences.slice(1).join(" "), 64);
  }

  if (sentences.length === 1 && hasSemanticEcho(sentences[0], cleanTitle)) {
    const nSent = norm(sentences[0]);
    const nTitle = norm(cleanTitle);
    if (nSent.length <= nTitle.length + 6) {
      return "";
    }
    const clauses = sentences[0].split(/[，,]\s*/).filter(Boolean);
    if (
      clauses.length >= 2 &&
      hasSemanticEcho(clauses[0], cleanTitle) &&
      norm(clauses[0]).length <= nTitle.length + 4
    ) {
      return trimExcerpt(clauses.slice(1).join("，"), 64);
    }
  }

  return trimExcerpt(cleanSummary, 64);
}

function stampDisplayName(stampKey: string, fallbackName: string): string {
  if (stampKey === "us:us-ca-losangeles") return "洛杉矶";
  if (stampKey === "cn:510100") return "成都 · 川西";
  return fallbackName;
}

export function selectTravelFootprint(
  birthDay: string | undefined,
  monthContents: readonly MonthContent[],
  today: string,
): BentoTravelFootprint {
  const allTrips = collectSyncedTrips(monthContents, today).filter((trip) => trip.from <= today);
  const stats = travelStats(allTrips);
  const cityCount = stampCount(allTrips);
  const latest = allTrips[0];

  const latestStamps = new Set<string>();
  if (latest) {
    for (const placeId of latest.placeIds) {
      const place = placeById(placeId);
      const unit = unitOf(placeId);
      if (!place || place.home || !unit) continue;
      latestStamps.add(stampKeyOf(unit.key));
    }
  }

  const citiesByStamp = new Map<string, BentoTravelCity>();
  for (const trip of allTrips) {
    for (const placeId of trip.placeIds) {
      const place = placeById(placeId);
      const unit = unitOf(placeId);
      if (!place || place.home || !unit) continue;
      const key = stampKeyOf(unit.key);
      if (citiesByStamp.has(key)) continue;
      citiesByStamp.set(key, {
        key,
        name: stampDisplayName(key, unit.name),
        tripId: trip.id,
        href: `/travel/${trip.id}`,
        isLatest: latestStamps.has(key),
      });
    }
  }

  const latestAge = latest ? tripAge(latest, birthDay) : undefined;
  const latestAgeDisplay = latestAge
    ? latestAge === "出生的那天"
      ? "出生那天"
      : `当时 ${latestAge}`
    : undefined;

  const latestTitle = latest ? cleanDisplayText(latest.title) || latest.title : "";

  return {
    countryCount: stats.countries.length,
    cityCount,
    latestTrip: latest
      ? {
          id: latest.id,
          from: latest.from,
          title: latestTitle,
          summary: stripRedundantTripLead(latestTitle, latest.summary),
          rangeLabel: tripRange(latest),
          ageDisplay: latestAgeDisplay,
          href: `/travel/${latest.id}`,
        }
      : undefined,
    cities: [...citiesByStamp.values()],
  };
}

export function buildHomeClockHeader(birthDay: string | undefined, today: string): HomeClockHeader {
  const todayLabel = formatDay(today);
  const age = ageOn(birthDay, today);
  const currentAgeLabel = age ? (age === "出生的那天" ? "出生那天" : `现在 ${age}`) : undefined;
  return {
    today,
    todayLabel,
    currentAgeLabel,
    kickerText: currentAgeLabel ? `${todayLabel} · ${currentAgeLabel}` : todayLabel,
  };
}

export function buildHomeBentoModel({
  archive,
  monthContents = [],
  topics = NO_TOPICS,
  today,
  activeLeadDay,
  answerLine,
  excludePhotoIds,
  memorySlidePhotoIds,
}: BuildHomeBentoInput): HomeBentoModel {
  const clock = buildHomeClockHeader(archive.birthDay, today);
  const photoTracker = createPhotoTracker({
    topics,
    privilege: archive.privilege,
    excludePhotoIds,
    softExcludePhotoIds: memorySlidePhotoIds,
    archiveMedia: archive.media,
  });

  const days = collectPublishedDays(archive, monthContents, today, topics);
  const latestDay = selectLatestDaySlice(days, activeLeadDay, photoTracker);

  const excludeJournalDays = new Set<string>();
  if (activeLeadDay) excludeJournalDays.add(activeLeadDay);
  if (latestDay) excludeJournalDays.add(latestDay.day);

  const journal = selectRecentJournalDays(archive, days, today, excludeJournalDays, 3, photoTracker);

  const displayedDays = [latestDay, ...journal.days].filter(
    (d): d is BentoDayCard => d !== null && d !== undefined,
  );

  const growth = selectGrowthHighlight(archive, monthContents, days, today, answerLine, {
    displayedDays,
  });

  const voices = selectFamilyVoices(archive, days, today, 3, {
    answerLine,
    avoidTexts: [
      growth?.headline ?? "",
      ...displayedDays.flatMap((d) => [d.title, d.excerpt]),
    ],
  });

  const excludeCapsuleDays = new Set<string>(displayedDays.map((d) => d.day));
  if (activeLeadDay) excludeCapsuleDays.add(activeLeadDay);

  const capsules = selectTimeCapsules(archive, days, topics, today, 4, {
    excludePhotoIds: photoTracker.hardExcludeIds,
    softExcludePhotoIds: photoTracker.softExcludeIds,
    excludeDays: excludeCapsuleDays,
  });

  const travel = selectTravelFootprint(archive.birthDay, monthContents, today);

  return {
    clock,
    latestDay,
    growth,
    voices,
    journal,
    capsules,
    travel,
  };
}
