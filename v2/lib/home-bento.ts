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
  /** 顶部 RecentAnswer 已经展示的核心句，成长亮点卡避免逐字重复同一句话。 */
  answerLine?: string;
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
  const slice = chars.slice(0, maxChars).join("");
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

type PublishedDayRecord = BentoDayCard & {
  month: string;
  paragraphs: string[];
  photos: MediaRef[];
  curatedLeadIds: Set<string>;
  hasExplicitTitle: boolean;
  kind: "story" | "visual-description" | "text-only" | "event";
};

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
): PublishedDayRecord[] {
  const available = new Map(
    archive.media
      .filter((item) => item.type === "photo" && item.visibility !== "private")
      .map((item) => [item.id, item]),
  );
  const excluded = archive.privilege.excluded;
  const byDay = new Map<string, PublishedDayRecord>();
  const editedMonths = new Set(monthContents.map((c) => c.month));
  const representedEventIds = new Set<string>();

  for (const content of monthContents) {
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
      const remainder =
        derived?.usedFirstClause && bodySource.startsWith(derived.title)
          ? bodySource.slice(derived.title.length).replace(/^[。！？；\s]+/, "")
          : bodySource;
      const excerpt = trimExcerpt(remainder || cleanParagraphs[0] || "");

      const [year, monthSeg, dom] = entry.day.split("-");
      const ageLabel = ageOn(archive.birthDay, entry.day) ?? entry.ageLabel;
      const milestone = detectMilestone(entry.day, [explicitTitle, ...cleanParagraphs], archive.birthDay);

      byDay.set(entry.day, {
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
        hasExplicitTitle: Boolean(explicitTitle),
        paragraphs: cleanParagraphs,
        href: `/memory/${year}/${monthSeg}/${dom}`,
        milestone,
        kind: entry.kind,
      });
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
            if (!existing.excerpt) existing.excerpt = trimExcerpt(cleanExcerpt);
          }
          const have = new Set(existing.photos.map((p) => p.id));
          for (const photo of orderedPhotos) {
            if (!have.has(photo.id)) {
              existing.photos.push(photo);
              have.add(photo.id);
            }
          }
          if (!existing.photo && existing.photos[0]) existing.photo = existing.photos[0];
          continue;
        }

        const [year, monthSeg, dom] = day.split("-");
        const href = editedMonths.has(monthChapter.month)
          ? `/memory/${year}/${monthSeg}/${dom}`
          : `/events/${memory.id}`;
        const milestone = detectMilestone(day, [cleanTitle, cleanExcerpt], archive.birthDay);

        byDay.set(day, {
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
          hasExplicitTitle: Boolean(cleanTitle && !cleanTitle.endsWith("的一天")),
          paragraphs: cleanExcerpt ? [cleanExcerpt] : [],
          href,
          milestone,
          kind: "event",
        });
      }
    }
  }

  return [...byDay.values()].sort((a, b) => b.day.localeCompare(a.day));
}

function toDayCard(record: PublishedDayRecord): BentoDayCard {
  return {
    day: record.day,
    shortDateLabel: record.shortDateLabel,
    fullDateLabel: record.fullDateLabel,
    weekdayDateLabel: record.weekdayDateLabel,
    ageLabel: record.ageLabel,
    ageDisplay: record.ageDisplay,
    title: record.title,
    excerpt: record.excerpt,
    photo: record.photo,
    href: record.href,
    milestone: record.milestone,
  };
}

export function selectLatestDaySlice(
  days: readonly PublishedDayRecord[],
  activeLeadDay?: string,
): BentoDayCard | null {
  if (days.length === 0) return null;
  const distinct = activeLeadDay ? days.filter((d) => d.day !== activeLeadDay) : [...days];
  const pool = distinct.length > 0 ? distinct : [...days];
  const rich = pool.find((d) => d.kind !== "visual-description" && (d.excerpt.length >= 8 || d.hasExplicitTitle));
  return toDayCard(rich ?? pool[0]);
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
): BentoGrowthHighlight | null {
  const currentMonth = today.slice(0, 7);
  const answerNorm = answerLine ? norm(answerLine) : "";

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

    const candidateHeadlines = [
      content?.intro,
      snapshot?.summary,
      content?.cardLine,
      ...(snapshot?.highlights ?? []),
      ...monthDays.filter((d) => d.milestone || d.hasExplicitTitle).map((d) => d.title),
    ]
      .map((line) => cleanDisplayText(line))
      .filter((line) => line.length >= 6);

    const distinctHeadline =
      candidateHeadlines.find((line) => !answerNorm || !answerNorm.includes(norm(line)) && !norm(line).includes(answerNorm)) ??
      candidateHeadlines[0];

    const tagCandidates = [
      ...(snapshot?.highlights ?? []),
      ...monthDays.filter((d) => d.milestone).map((d) => d.title),
      ...monthDays.filter((d) => d.hasExplicitTitle && d.kind === "story").map((d) => d.title),
    ];

    const tags: string[] = [];
    const seenTagNorms = new Set<string>(distinctHeadline ? [norm(distinctHeadline)] : []);
    for (const item of tagCandidates) {
      const tag = shortHighlightTag(item);
      if (!tag) continue;
      const key = norm(tag);
      if (seenTagNorms.has(key)) continue;
      seenTagNorms.add(key);
      tags.push(tag);
      if (tags.length >= 4) break;
    }

    if (!distinctHeadline && tags.length === 0) continue;

    const headline = trimExcerpt(distinctHeadline || tags[0], 58);
    const [year, monthSeg] = month.split("-");
    const ageDisplay = monthAgeLine(month, today, ageAtMonth(archive.birthDay, month));

    return {
      month,
      monthLabel: formatMonth(month),
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

  // 优先挑 10–72 字的完整对话原句，仅当完整句子不足 limit 时才用 4–9 字的短句兜底；
  // 同一档内优先让不同家人/老师的声音同场出现，再按时间新鲜度补足。
  const fuller = candidates.filter((item) => [...item.quote].length >= 10);
  const shorter = candidates.filter((item) => [...item.quote].length < 10);

  const picked: BentoFamilyVoice[] = [];
  const usedIds = new Set<string>();
  const usedSpeakers = new Set<string>();

  const fillFromTier = (tier: readonly BentoFamilyVoice[]) => {
    for (const item of tier) {
      if (picked.length >= limit) return;
      if (usedIds.has(item.id) || usedSpeakers.has(item.speaker)) continue;
      usedSpeakers.add(item.speaker);
      usedIds.add(item.id);
      picked.push(item);
    }
    for (const item of tier) {
      if (picked.length >= limit) return;
      if (usedIds.has(item.id)) continue;
      usedIds.add(item.id);
      picked.push(item);
    }
  };

  fillFromTier(fuller);
  if (picked.length < limit) {
    fillFromTier(shorter);
  }

  return picked;
}

export function selectRecentJournalDays(
  archive: FamilyArchive,
  days: readonly PublishedDayRecord[],
  today: string,
  excludeDays: ReadonlySet<string>,
  limit = 3,
): HomeBentoModel["journal"] {
  const eligible = days.filter(
    (d) => !excludeDays.has(d.day) && (d.excerpt.length > 0 || d.photo !== undefined),
  );
  // 优先在近 45 天内选片（与「过去的张年」≥45 天严格错开），且同窗口内带公开照片的日子优先；
  // 仅当近 45 天总篇数不足 limit 时才向更早的候选窗口回退。
  const nearDays = eligible.filter((d) => daysBetween(d.day, today) < 45).slice(0, 30);
  const recentWindow = nearDays.length >= limit ? nearDays : eligible.slice(0, 30);

  const withPhoto = recentWindow.filter((d) => d.photo !== undefined);
  const textOnly = recentWindow.filter((d) => d.photo === undefined);

  const chosen =
    withPhoto.length >= limit
      ? withPhoto.slice(0, limit)
      : [...withPhoto, ...textOnly.slice(0, limit - withPhoto.length)].sort((a, b) =>
          b.day.localeCompare(a.day),
        );

  const filtered = chosen.map(toDayCard);

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
): BentoTimeCapsule[] {
  const currentMonth = today.slice(0, 7);
  const todayMonthDay = today.slice(5, 10);

  type ScoredCapsule = BentoTimeCapsule & {
    score: number;
    daysAgo: number;
  };

  const monthBest = new Map<string, ScoredCapsule>();

  for (const record of days) {
    if (record.month >= currentMonth) continue;
    const ago = daysBetween(record.day, today);
    if (ago < 45) continue;
    if (!record.hasExplicitTitle && !record.milestone) continue;
    if (record.photos.length === 0) continue;

    const ageDisplay = record.ageDisplay;
    if (!ageDisplay) continue;

    let bestPhoto: MediaRef | undefined;
    let bestPhotoScore = -1;
    for (const photo of record.photos) {
      const q = photoQualityScore(
        photo,
        topics(photo.id),
        archive.privilege,
        record.curatedLeadIds.has(photo.id) && record.kind === "story",
      );
      if (q === null) continue;
      if (q > bestPhotoScore) {
        bestPhotoScore = q;
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

    const totalScore = bestPhotoScore + relationBoost + (record.excerpt ? 0.08 : 0);
    const candidate: ScoredCapsule = {
      day: record.day,
      month: record.month,
      monthLabel: formatMonth(record.month),
      shortDateLabel: record.shortDateLabel,
      ageDisplay,
      badgeLabel,
      title: record.title,
      photo: bestPhoto,
      href: record.href,
      reason,
      score: totalScore,
      daysAgo: ago,
    };

    const prev = monthBest.get(record.month);
    if (!prev || candidate.score > prev.score) {
      monthBest.set(record.month, candidate);
    }
  }

  const candidates = [...monthBest.values()];
  // 原则六：不足 2 张经核实的过往瞬间时整节收起，绝不凑数或显示空占位
  if (candidates.length < 2) return [];

  const picked: ScoredCapsule[] = [];
  const usedMonths = new Set<string>();
  const priorityOrder: TimeCapsuleReason[] = ["anniversary", "half_year", "milestone", "season"];

  for (const reason of priorityOrder) {
    if (picked.length >= limit) break;
    const match = candidates
      .filter((c) => c.reason === reason && !usedMonths.has(c.month))
      .sort((a, b) => b.score - a.score)[0];
    if (match) {
      picked.push(match);
      usedMonths.add(match.month);
    }
  }

  if (picked.length < limit) {
    const rest = candidates
      .filter((c) => !usedMonths.has(c.month))
      .sort((a, b) => b.score - a.score);
    for (const item of rest) {
      if (picked.length >= limit) break;
      picked.push(item);
      usedMonths.add(item.month);
    }
  }

  // 按时间倒序排列（从较近的过往阶段一路回看更小的时候，像翻相机胶卷）
  return picked
    .sort((a, b) => b.day.localeCompare(a.day))
    .map(({ score: _score, daysAgo: _daysAgo, ...capsule }) => capsule);
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

  return {
    countryCount: stats.countries.length,
    cityCount,
    latestTrip: latest
      ? {
          id: latest.id,
          from: latest.from,
          title: cleanDisplayText(latest.title) || latest.title,
          summary: trimExcerpt(latest.summary, 64),
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
}: BuildHomeBentoInput): HomeBentoModel {
  const clock = buildHomeClockHeader(archive.birthDay, today);
  const days = collectPublishedDays(archive, monthContents, today);
  const latestDay = selectLatestDaySlice(days, activeLeadDay);
  const growth = selectGrowthHighlight(archive, monthContents, days, today, answerLine);
  const voices = selectFamilyVoices(archive, days, today, 3);

  const excludeJournalDays = new Set<string>();
  if (activeLeadDay) excludeJournalDays.add(activeLeadDay);
  if (latestDay) excludeJournalDays.add(latestDay.day);

  const journal = selectRecentJournalDays(archive, days, today, excludeJournalDays, 3);
  const capsules = selectTimeCapsules(archive, days, topics, today, 4);
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
