// 首页第一部分：**几段各有主题的回忆**（2026-09-16 晚，按 Teddy 线上验收的两轮反馈重做）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 主题从哪来：只能从**日期事实**里长出来
// ─────────────────────────────────────────────────────────────────────────────
//
// Teddy 给了两张 iPhone 相册「回忆」的截图：「夏天 · 2026年」是一个季节，「杭州市 · 2025年12月14日」
// 是一个地点，「周游世界 · 2019年旅程」是一段旅程——**每段有各自的主题，副标题的粒度也跟着主题走**。
// 第一版我做成了「每段 = 某一天」，六段全是同一种主题，只是日期不同，那不叫多主题。
//
// 这个档案里**能诚实支撑**的主题只有三种，因为其余的没有依据：
//
//   day    —— 有已发布记忆的那一天。标题就是那天的标题原文，副标题是具体日期 + 当时年龄。
//   season —— 一个季节。标题「2026 年的夏天」，副标题「6 月 — 8 月」。
//   year   —— 一年。标题「2025 年」，副标题用两个时钟的跨度（当时 11 个月 — 1 岁 10 个月）。
//
// **地点主题做不了**：2026-09-16 查生产，1036 条 life_event 的 `location_label` **全空**（0 条）。
// 没有依据就不做，不拿「杭州市」这种标题去套一个其实不知道在哪拍的日子。
//
// 季节按人说话的方式跨年：「2025 年的冬天」= 2025-12 → 2026-02，不是把 1 月和 12 月塞进同一个冬天。
//
// ─────────────────────────────────────────────────────────────────────────────
// 跨天主题怎么选片（Teddy 2026-09-16 裁定：从全季照片里均匀取）
// ─────────────────────────────────────────────────────────────────────────────
//
// 季节和年度不要求那一天有已发布故事——只要主体核验通过，沿时间均匀铺开。
// 但「均匀」不能退化成某个下午的十二张，所以跨天主题**每天最多取两张**再均匀抽。
// 没有这条上限时，2026-09 那种「13 天里 310 张」的月份会让一整季看起来像某一天。
//
// ─────────────────────────────────────────────────────────────────────────────
// 照片门槛：收紧过，不是放宽
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. **每一张都要有 `media_subject_check` approved**（有人开过这个文件、记下画面里是这个孩子）。
//    不再用来源担保——来源说的是「这张图来自哪」，不说画面里是谁，所以菜单牌、单词表、
//    微信截屏都能混进来，那正是 Teddy 说的「照片有的质量不高」。
//    实测：该标记已从 64 张涨到 1,049 张，收紧之后素材仍然充足。
//
// 2. **每组连拍取像素最大的那一张**。同一次快门在库里常常同时存着原图和微信压缩版
//    （3120×4160 与 1280×1706，takenAt 相同）；实测 273 个多张连拍组里有 47 组（17%）
//    原来选中的不是最大那张，平均少 6.8MP，最差一例 960×1280 顶替 3120×4160。
//
// 两条都不需要模型：一条读账本，一条比像素。**不要在这里调用视觉模型**——
// lib/home-photo-quality.ts 顶部记着生产 provider 会把图片悄悄换成 `[Unsupported Image]` 再开始编。
//
// 全部材料来自已经读好的 archive（chapters + privilege），不新增任何数据库读取。
import type { FamilyArchive } from "@/lib/family-archive";
import type { EditorialMemory, MediaRef, MonthChapter } from "@/lib/memory-chapters";
import { burstGroups, isSubjectChecked, type MediaPrivilege } from "@/lib/publication-moments";
import { thumbnailSized } from "@/lib/media/hero";
import { ageAtMonth, formatMonth } from "@/lib/time-signature";
import { moodFor, type MemoryMood } from "@/lib/home-memory-mood";

export const MEMORY_MIN_SLIDES = 6;
export const MEMORY_MAX_SLIDES = 12;
/** 首页一共准备几段可切换的回忆。 */
export const HOME_MEMORIES_MAX = 6;
/** 跨天主题里，同一天最多贡献几张——防止「一整季」变成「某个下午」。 */
export const CROSS_DAY_PER_DAY_MAX = 2;
export const SLIDE_SECONDS = 5;
export const CROSSFADE_MS = 800;

/** 三种主题。每一种的标题与副标题粒度都不同，这正是「每段有单独主题」的意思。 */
export type MemoryThemeKind = "day" | "season" | "year";

export type HomeMemorySlide = {
  key: string;
  media: MediaRef;
  /** 只可能是已发布记忆的标题原文，且只有 day 主题有——跨天主题没有逐张可依据的文字，就不写。 */
  caption?: string;
};

export type HomeMemory = {
  kind: MemoryThemeKind;
  /** React key 与切换用的稳定标识。 */
  key: string;
  /** 这段回忆的名字。day 用当天标题原文；season/year 是日期事实，不是对画面的判断。 */
  title: string;
  /** 副标题，粒度跟着主题走。 */
  subtitle: string;
  /** `<time datetime>` 用；跨天主题没有单一日期，就没有。 */
  dateTime?: string;
  href?: string;
  /** 「读读这一天」/「翻到 2025 年」——标签必须跟着去处走，不能共用一句话（原则八那条教训）。 */
  linkLabel?: string;
  slides: HomeMemorySlide[];
  durationSeconds: number;
  mood: MemoryMood;
  moodReason: string;
  /** 为什么是这一段、折叠掉多少、取的是不是最大那张。供审计，不显示。 */
  reason: string;
};

export type HomeMemoryAbsence = { kind: "empty_archive" | "no_qualified_theme"; reason: string };

const pixels = (media: MediaRef) => (media.width ?? 0) * (media.height ?? 0);
const dayOf = (media: MediaRef) => (media.takenAt ?? "").slice(0, 10);
const hourOf = (media: MediaRef) => Number((media.takenAt ?? "").slice(11, 13));

/** 能进幻灯片的照片：主体核验通过 + 画得出来。 */
function usable(photos: readonly MediaRef[], privilege: MediaPrivilege): MediaRef[] {
  return photos.filter((item) => isSubjectChecked(item, privilege) && thumbnailSized(item));
}

/** 每组连拍取**像素最大**的那一张；同样大时按 id 取定，保证确定性。 */
function representatives(photos: readonly MediaRef[]): MediaRef[] {
  return burstGroups([...photos]).map((group) =>
    [...group].sort((a, b) => pixels(b) - pixels(a) || a.id.localeCompare(b.id))[0]);
}

/** 沿序列均匀取 max 个，保住开头、中段与结尾。 */
function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}

/** 跨天主题：同一天最多留 perDay 张，避免某一天吃掉整段。 */
function capPerDay(photos: readonly MediaRef[], perDay: number): MediaRef[] {
  const seen = new Map<string, number>();
  const kept: MediaRef[] = [];
  for (const photo of photos) {
    const day = dayOf(photo);
    const used = seen.get(day) ?? 0;
    if (used >= perDay) continue;
    seen.set(day, used + 1);
    kept.push(photo);
  }
  return kept;
}

function memoriesOn(month: MonthChapter, day: string): EditorialMemory[] {
  return month.memories.filter((memory) => memory.signature.day === day);
}

/** 至多两句配文，放在约三分之一与三分之二处；开头与结尾那张不压字。 */
function captionAt(slideCount: number, titles: readonly string[]): Map<number, string> {
  const spots = new Map<number, string>();
  if (slideCount < 3 || titles.length === 0) return spots;
  const positions = [Math.floor(slideCount / 3), Math.floor((slideCount * 2) / 3)];
  titles.slice(0, 2).forEach((title, index) => {
    const at = positions[index];
    if (at !== undefined && at > 0 && at < slideCount - 1 && !spots.has(at)) spots.set(at, title);
  });
  return spots;
}

function moodOf(slides: readonly MediaRef[], pool: readonly MediaRef[], titles: readonly string[]) {
  const hours = pool.map(hourOf).filter((hour) => Number.isFinite(hour));
  return moodFor({
    slides: slides.length,
    photos: pool.length,
    firstHour: hours.length > 0 ? Math.min(...hours) : 12,
    lastHour: hours.length > 0 ? Math.max(...hours) : 12,
    titles,
  });
}

// ── 主题一：某一天 ────────────────────────────────────────────────────────────

export function buildDayMemory(input: {
  day: string; dateLabel: string; ageLabel?: string;
  photos: readonly MediaRef[]; published: readonly EditorialMemory[]; privilege: MediaPrivilege;
}): HomeMemory | undefined {
  const { day, dateLabel, ageLabel, photos, published, privilege } = input;
  // 没有已发布记忆的一天不做 day 主题：它得有真名字和能点进去的去处（原则八）。
  if (published.length === 0) return undefined;
  const pool = usable(photos, privilege);
  const reps = representatives(pool);
  if (reps.length < MEMORY_MIN_SLIDES) return undefined;

  const picked = spread(reps, MEMORY_MAX_SLIDES);
  const titles = published.map((memory) => memory.title);
  const captions = captionAt(picked.length, titles);
  const lead = published[0];
  const mood = moodOf(picked, pool, titles);
  const age = ageLabel ?? lead.signature.ageLabel;
  return {
    kind: "day",
    key: `day:${day}`,
    title: lead.title,
    subtitle: age ? `${dateLabel} · 当时 ${age}` : dateLabel,
    dateTime: day,
    href: `/events/${lead.id}`,
    linkLabel: "读读这一天",
    slides: picked.map((media, index) => ({ key: `${day}|${media.id}`, media, caption: captions.get(index) })),
    durationSeconds: picked.length * SLIDE_SECONDS,
    mood: mood.mood,
    moodReason: mood.reason,
    reason: `一天：${photos.length} 张里主体核验通过 ${pool.length} 张，折叠成 ${reps.length} 个瞬间`
      + `（每组取像素最大的），取 ${picked.length} 张；标题取自当天已发布记忆「${lead.title}」`,
  };
}

// ── 主题二 / 三：季节与年 ─────────────────────────────────────────────────────

const SEASONS = [
  { key: "spring", label: "春天", months: [3, 4, 5] },
  { key: "summer", label: "夏天", months: [6, 7, 8] },
  { key: "autumn", label: "秋天", months: [9, 10, 11] },
  // 冬天跨年：2025 年的冬天 = 2025-12 → 2026-02，这是人说话的方式。
  { key: "winter", label: "冬天", months: [12, 1, 2] },
] as const;

/** 这个月属于哪个季节的哪一年（冬天的 1、2 月归上一年）。 */
function seasonOf(month: string): { key: string; label: string; year: number } | undefined {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const season = SEASONS.find((item) => (item.months as readonly number[]).includes(m));
  if (!season) return undefined;
  const anchorYear = season.key === "winter" && m <= 2 ? year - 1 : year;
  return { key: season.key, label: season.label, year: anchorYear };
}

function buildSpanMemory(input: {
  kind: "season" | "year";
  key: string; title: string; subtitle: string;
  href?: string; linkLabel?: string;
  photos: readonly MediaRef[]; privilege: MediaPrivilege;
}): HomeMemory | undefined {
  const { kind, key, title, subtitle, href, linkLabel, photos, privilege } = input;
  const pool = usable(photos, privilege);
  // 按时间排好再折叠——跨天主题的「均匀」是沿时间的均匀。
  const ordered = [...pool].sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? "") || a.id.localeCompare(b.id));
  const reps = capPerDay(representatives(ordered), CROSS_DAY_PER_DAY_MAX);
  if (reps.length < MEMORY_MIN_SLIDES) return undefined;

  const picked = spread(reps, MEMORY_MAX_SLIDES);
  // 跨天主题没有逐张可依据的文字，所以**一句配文都不写**，不拿某一天的标题去概括一整季。
  const mood = moodOf(picked, pool, []);
  const days = new Set(picked.map(dayOf)).size;
  return {
    kind,
    key,
    title,
    subtitle,
    href,
    linkLabel,
    slides: picked.map((media) => ({ key: `${key}|${media.id}`, media })),
    durationSeconds: picked.length * SLIDE_SECONDS,
    mood: mood.mood,
    moodReason: mood.reason,
    reason: `${kind === "season" ? "一个季节" : "一年"}：主体核验通过 ${pool.length} 张，折叠后每天最多取`
      + ` ${CROSS_DAY_PER_DAY_MAX} 张得到 ${reps.length} 张，沿时间均匀取 ${picked.length} 张，来自 ${days} 个不同的日子`,
  };
}

// ── 组装 ──────────────────────────────────────────────────────────────────────

type DayEntry = { day: string; month: MonthChapter; photos: readonly MediaRef[] };

/**
 * 选出首页可以切换的那几段回忆，**三种主题混在一起**。
 *
 * 顺序：按 day / season / year 轮流取（interleave），所以「换一段」按下去换到的多半是
 * 另一种主题，而不是同一种主题的另一个日期。全程确定，无随机。
 */
export function selectHomeMemories(archive: FamilyArchive): { memories: HomeMemory[]; absence?: HomeMemoryAbsence } {
  const { chapters, privilege, birthDay } = archive;
  const today = archive.time.today;

  const dayEntries: DayEntry[] = [];
  const byMonth = new Map<string, MediaRef[]>();
  let scannedDays = 0;

  for (const year of chapters) {
    for (const month of year.months) {
      for (const photoDay of month.photoDays) {
        if (photoDay.day > today) continue;
        scannedDays += 1;
        dayEntries.push({ day: photoDay.day, month, photos: photoDay.photos });
        const bucket = byMonth.get(month.month) ?? [];
        bucket.push(...photoDay.photos);
        byMonth.set(month.month, bucket);
      }
    }
  }
  if (scannedDays === 0) {
    return { memories: [], absence: { kind: "empty_archive", reason: "档案里还没有一天带照片的记录" } };
  }

  // 天主题：按月份铺开，避免六段全挤在同一周。
  const dayMemories: HomeMemory[] = [];
  const seenMonths = new Set<string>();
  for (const entry of dayEntries) {
    const month = entry.day.slice(0, 7);
    if (seenMonths.has(month)) continue; // 每个月最多出一天，天然铺开
    const memory = buildDayMemory({
      day: entry.day,
      dateLabel: entry.month.photoDays.find((d) => d.day === entry.day)?.dateLabel ?? entry.day,
      ageLabel: entry.month.photoDays.find((d) => d.day === entry.day)?.ageLabel,
      photos: entry.photos,
      published: memoriesOn(entry.month, entry.day),
      privilege,
    });
    if (!memory) continue;
    seenMonths.add(month);
    dayMemories.push(memory);
  }

  // 季节主题
  const seasonPhotos = new Map<string, { label: string; year: number; photos: MediaRef[] }>();
  for (const [month, photos] of byMonth) {
    const season = seasonOf(month);
    if (!season) continue;
    const key = `${season.year}-${season.key}`;
    const bucket = seasonPhotos.get(key) ?? { label: season.label, year: season.year, photos: [] };
    bucket.photos.push(...photos);
    seasonPhotos.set(key, bucket);
  }
  const seasonMemories = [...seasonPhotos.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, bucket]) => buildSpanMemory({
      kind: "season",
      key: `season:${key}`,
      title: `${bucket.year} 年的${bucket.label}`,
      subtitle: seasonSubtitle(bucket.label, bucket.year),
      href: `/memory/${bucket.year}`,
      linkLabel: `翻到 ${bucket.year} 年`,
      photos: bucket.photos,
      privilege,
    }))
    .filter((memory): memory is HomeMemory => Boolean(memory));

  // 年主题
  const yearPhotos = new Map<string, MediaRef[]>();
  for (const [month, photos] of byMonth) {
    const year = month.slice(0, 4);
    yearPhotos.set(year, [...(yearPhotos.get(year) ?? []), ...photos]);
  }
  const yearMemories = [...yearPhotos.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, photos]) => buildSpanMemory({
      kind: "year",
      key: `year:${year}`,
      title: `${year} 年`,
      subtitle: yearSubtitle(year, byMonth, birthDay),
      href: `/memory/${year}`,
      linkLabel: `翻到 ${year} 年`,
      photos,
      privilege,
    }))
    .filter((memory): memory is HomeMemory => Boolean(memory));

  const memories = interleaveKinds([dayMemories, seasonMemories, yearMemories], HOME_MEMORIES_MAX);
  if (memories.length === 0) {
    return {
      memories: [],
      absence: {
        kind: "no_qualified_theme",
        reason: `往回看了 ${scannedDays} 天，没有一种主题凑得出 ${MEMORY_MIN_SLIDES} 个主体核验过的不同瞬间`,
      },
    };
  }
  return { memories };
}

/** 「6 月 — 8 月」；冬天跨年，所以写成「12 月 — 次年 2 月」。 */
function seasonSubtitle(label: string, year: number): string {
  const season = SEASONS.find((item) => item.label === label);
  if (!season) return `${year} 年`;
  const months = season.months;
  return season.key === "winter"
    ? `${year} 年 12 月 — 次年 2 月`
    : `${year} 年 ${months[0]} 月 — ${months[months.length - 1]} 月`;
}

/** 一年的副标题用两个时钟：这一年他从几岁到几岁（原则二）。拿不到出生日期就退回月份跨度。 */
function yearSubtitle(year: string, byMonth: ReadonlyMap<string, MediaRef[]>, birthDay?: string): string {
  const months = [...byMonth.keys()].filter((month) => month.startsWith(year)).sort();
  if (months.length === 0) return `${year} 年`;
  const first = months[0];
  const last = months[months.length - 1];
  const from = ageAtMonth(birthDay, first);
  const to = ageAtMonth(birthDay, last);
  if (from && to) return from === to ? `当时 ${from}` : `当时 ${from} — ${to}`;
  return `${formatMonth(first)} — ${formatMonth(last)}`;
}

/** 三种主题轮流取，所以「换一段」换到的多半是另一种主题。 */
function interleaveKinds(groups: HomeMemory[][], max: number): HomeMemory[] {
  const picked: HomeMemory[] = [];
  for (let round = 0; picked.length < max; round += 1) {
    let tookAny = false;
    for (const group of groups) {
      const item = group[round];
      if (!item) continue;
      picked.push(item);
      tookAny = true;
      if (picked.length >= max) break;
    }
    if (!tookAny) break;
  }
  return picked;
}

export const MEMORY_TIMING = { slideSeconds: SLIDE_SECONDS, crossfadeMs: CROSSFADE_MS } as const;
