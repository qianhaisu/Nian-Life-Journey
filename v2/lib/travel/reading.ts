// 旅行页的服务端读取：把旅程接到已经发布的日页和照片上。
//
// 读两样东西，都是页面已经在用、有缓存的读取：
//   - loadFamilyArchiveOnDemand()：和 /memory、/mom-reports 共用同一份 300 s 记忆，不另起一次整库读取
//     （它的使用边界见 lib/family-archive.ts；getStore()/getOrganizerStore() 这里一个都不碰）；
//   - loadMonthContent(month)：月内容文件，300 s 缓存，只取这段旅程涉及的月份。
// 照片过的门和日页一样：resolveMonthContentMedia 用可发布的媒体 + 最新的 store_only 排除。
// 唯一的例外是风景照（Teddy 2026-09-25：「可以放部分风景照，不用全部都是张年的照片」）：lib/travel/scenery.json
// 里 GLM 判为好看风景、没有陌生人大脸、没有截图单据和隐私的照片，在旅行页上不需要「是张年」这道门——
// 它们本来就不是他，store_only 正是因为这个。它们仍然必须是可发布的媒体（在 archive.media 里）。
// 这个例外只在旅行页；记忆页、首页不读这份名单。
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { toMediaRef, type MediaRef } from "@/lib/memory-chapters";
import { loadMonthContent, dayForDate, resolveMonthContentMedia, type MonthContent, listEditedMonthContents } from "@/lib/month-content";
import { buildMonthTimeline } from "@/lib/month-timeline";
import { displayIdentity, uniqueDisplayMedia } from "@/lib/media/display-identity";
import { isSubjectChecked } from "@/lib/publication-moments";
import { calendarDayOf } from "@/lib/timeline-dates";
import { ageOn } from "@/lib/time-signature";
import { loadTopicCache } from "@/lib/home-memory-topics-load";
import { coverScore, daysOf, type CoverScore, type Trip } from "./model";
import { syncTrips } from "./sync";
import sceneryFile from "./scenery.json";
import curationFile from "./curation.json";
import { buildTripMemory } from "./memory";
import { tripEssay, type TripEssay } from "./essay";
import type { HomeMemory } from "@/lib/home-memory";

// 旅程照片精选（scripts/editor/travel-curate.mjs）：有精选的旅程，每天的照片按它来，不再用日页首屏那一组。
// 目前只有「从美国回家」有（Teddy 2026-09-25：「洛杉矶的照片不行，重复场景去掉一些，多放一些其他的」）。
// pool A = 他本人的照片，照常过主体核查那道门；pool B = 那段日子的生活画面，GLM 判过清楚、无隐私、无陌生人大脸，
// 且来自我们自己（自家相册或爸爸妈妈发的）——和风景白名单同一个道理，只在旅行页放行。
type CuratedItem = { id: string; pool: "A" | "B"; caption: string };
const CURATION = ((curationFile as { trips?: Record<string, { byDay: Record<string, CuratedItem[]> }> }).trips ?? {});

type SceneryEntry = { id: string; scenic: number; caption: string };
const SCENERY_BY_DAY = ((sceneryFile as { byDay?: Record<string, SceneryEntry[]> }).byDay ?? {});

/** href / title 为空：这一天没有日页，只有沿途风景（比如西安那次 10 月 5 日的华山和兵马俑）。 */
export type TripDay = {
  day: string; href?: string; dateLabel: string; ageLabel?: string;
  title?: string; lead?: string; photos: MediaRef[];
};
export type TripCard = { trip: Trip; cover?: MediaRef; scenery?: MediaRef; ageLabel?: string };

const dateLabelOf = (day: string) => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8, 10))} 日`;

async function monthsFor(days: string[]): Promise<Map<string, MonthContent | null>> {
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const loaded = await Promise.all(months.map((m) => loadMonthContent(m)));
  return new Map(months.map((m, i) => [m, loaded[i]]));
}

type Archive = Awaited<ReturnType<typeof loadFamilyArchiveOnDemand>>;
function gate(archive: Archive) {
  const available = new Map(archive.media.map((item) => [item.id, item]));
  return (ids: readonly string[], context: string) =>
    resolveMonthContentMedia(ids, available, archive.privilege.excluded).map((m) => toMediaRef(m, context));
}

/**
 * 当关联日在月稿里暂为 text-only（如尚未回填配图的义乌行程），从同一份已加载档案里按天回退提取
 * 通过主体核验（media_subject_check = approved 且未 store_only）的可发布静态照片。
 */
function approvedPhotosByDay(archive: Archive) {
  const byDay = new Map<string, Archive["media"]>();
  for (const media of archive.media) {
    if (media.type === "video" || !isSubjectChecked(media, archive.privilege)) continue;
    const day = calendarDayOf(media.takenAt);
    if (!day) continue;
    const list = byDay.get(day);
    if (list) list.push(media);
    else byDay.set(day, [media]);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? "") || a.id.localeCompare(b.id));
  }
  return (day: string, context: string): MediaRef[] =>
    uniqueDisplayMedia((byDay.get(day) ?? []).map((media) => toMediaRef(media, context)));
}

/** 某一天白名单里的风景照，按好看程度排；alt 用 GLM 写的那句画面描述。 */
function sceneryOf(archive: Archive, day: string): MediaRef[] {
  const available = new Map(archive.media.map((item) => [item.id, item]));
  return (SCENERY_BY_DAY[day] ?? []).flatMap((s) => {
    const media = available.get(s.id);
    return media && media.type !== "video" ? [toMediaRef(media, s.caption)] : [];
  });
}

/**
 * 他的照片里夹风景：第一张之后放一张，之后每隔两张再放一张，剩下的接在后面。
 * 放得靠前，是因为一天只先铺开六张，后面的收在「展开」里——风景排到第七张就等于没放。
 */
function interleave(child: MediaRef[], scenery: MediaRef[]): MediaRef[] {
  if (!scenery.length) return child;
  const out: MediaRef[] = [];
  const rest = [...scenery];
  child.forEach((m, i) => { out.push(m); if (i % 2 === 0 && rest.length) out.push(rest.shift()!); });
  return [...out, ...rest];
}

/**
 * 关联日相册照片回退链（纯函数，便于单测）：
 * 人工精选 → 月稿首屏照片 → 月稿展开照片 → 已发布日页照片 → 当日已审核主体照片，再与沿途风景交错。
 */
export function resolveTripDayPhotos(input: {
  curated?: readonly MediaRef[];
  firstScreen?: readonly MediaRef[];
  expanded?: readonly MediaRef[];
  published?: readonly MediaRef[];
  approvedDay?: readonly MediaRef[];
  scenery?: readonly MediaRef[];
}): MediaRef[] {
  const stills = (items: readonly MediaRef[] | undefined) => (items ?? []).filter((m) => m.type !== "video");
  if (input.curated && input.curated.length > 0) {
    return uniqueDisplayMedia(stills(input.curated));
  }
  const first = stills(input.firstScreen);
  const expanded = stills(input.expanded).slice(0, 6);
  const published = stills(input.published).slice(0, 6);
  const approved = stills(input.approvedDay).slice(0, 6);
  const child = first.length > 0 ? first : expanded.length > 0 ? expanded : published.length > 0 ? published : approved;
  return uniqueDisplayMedia(interleave(child, stills(input.scenery)));
}

type Scores = ReadonlyMap<string, CoverScore>;
async function coverScores(): Promise<Map<string, CoverScore>> {
  // 首页轮播已经用模型给照片打过分（data/photo-topics.json，随仓库发布，夜间任务更新）。复用它，
  // 不为旅行封面另外识图（CLAUDE.md：优先复用有效的解析结果）。读不到就是空表，封面退回旧规则。
  const cache = await loadTopicCache();
  const out = new Map<string, CoverScore>();
  for (const [id, topic] of Object.entries(cache?.topics ?? {})) {
    const carousel = (topic as { carousel?: CoverScore }).carousel;
    if (carousel) out.set(id, carousel);
  }
  return out;
}

export type TripDayCoverPool = {
  day: string;
  firstScreenIds?: ReadonlySet<string>;
  photos: readonly MediaRef[];
};

/**
 * 一条旅程的封面（纯函数）：
 * 旅程手工指定的 coverMediaId → 全程候选池评分最高的一张 → coverDay（缺省第一天）首屏第一张 → 候选池首张。
 * 当月稿暂未填入媒体 ID 时，候选池已自动包含关联日的已审核照片与沿途风景，避免空封面卡。
 */
export function pickTripCover(
  trip: Trip,
  dayPools: readonly TripDayCoverPool[],
  scores: Scores,
  excludeIds?: ReadonlySet<string>,
): MediaRef | undefined {
  const rawPool = dayPools.flatMap(({ day, photos }) =>
    photos.filter((m) => m.type !== "video").map((m) => ({ m, day })),
  );
  if (rawPool.length === 0) return undefined;
  if (trip.coverMediaId) {
    const chosen = rawPool.find((p) => p.m.id === trip.coverMediaId);
    if (chosen) return chosen.m;
  }
  const isExcluded = (m: MediaRef) =>
    Boolean(excludeIds && (excludeIds.has(m.id) || excludeIds.has(displayIdentity(m))));
  const nonExcluded = excludeIds && excludeIds.size > 0 ? rawPool.filter((p) => !isExcluded(p.m)) : rawPool;
  const pool = nonExcluded.length > 0 ? nonExcluded : rawPool;
  let best: { m: MediaRef; score: number } | undefined;
  for (const { m, day } of pool) {
    const score = coverScore(scores.get(m.id), day === trip.coverDay);
    if (score !== undefined && (!best || score > best.score)) best = { m, score };
  }
  if (best) return best.m;
  const firstByDay = new Map(dayPools.map((item) => [item.day, item.firstScreenIds]));
  const allDays = dayPools.map((item) => item.day);
  const order = trip.coverDay ? [trip.coverDay, ...allDays.filter((d) => d !== trip.coverDay)] : allDays;
  for (const day of order) {
    const firstIds = firstByDay.get(day);
    if (firstIds && firstIds.size > 0) {
      const first = pool.find((p) => p.day === day && firstIds.has(p.m.id));
      if (first) return first.m;
    }
  }
  for (const day of order) {
    const first = pool.find((p) => p.day === day);
    if (first) return first.m;
  }
  return pool[0]?.m;
}

/**
 * 当多段连程中的某一段（如「飞回温州 10-03..10-04」接「义乌住一晚 10-04..10-05」）自身日期内没有可投递的合格照片时，
 * 回退查找与其共享出行日的相连行程日期，并按距离本段起点的远近排序，保留照片原始日期与日页链接。
 */
export function connectedTripFallbackDays(trip: Trip, allTrips: readonly Trip[]): string[] {
  const own = new Set(daysOf(trip));
  const connected = allTrips.filter(
    (other) => other.id !== trip.id && other.from <= trip.to && trip.from <= other.to,
  );
  const fromMs = Date.parse(`${trip.from}T00:00:00Z`);
  const uniqueDays = [...new Set(connected.flatMap((other) => daysOf(other)).filter((d) => !own.has(d)))];
  return uniqueDays.sort(
    (a, b) =>
      Math.abs(Date.parse(`${a}T00:00:00Z`) - fromMs) - Math.abs(Date.parse(`${b}T00:00:00Z`) - fromMs) ||
      a.localeCompare(b),
  );
}

function buildTripDayPoolsForDays(
  targetDays: readonly string[],
  trip: Trip,
  months: Map<string, MonthContent | null>,
  photosOf: ReturnType<typeof gate>,
  approvedOfDay: ReturnType<typeof approvedPhotosByDay>,
  archive: Archive,
  publishedByDay?: ReadonlyMap<string, readonly MediaRef[]>,
): TripDayCoverPool[] {
  const available = new Map(archive.media.map((item) => [item.id, item]));
  const curated = CURATION[trip.id];
  const curatedOf = (items: CuratedItem[], title: string): MediaRef[] => items.flatMap((it) => {
    if (it.pool === "A") return photosOf([it.id], title);
    const media = available.get(it.id);
    return media && media.type !== "video" ? [toMediaRef(media, it.caption)] : [];
  });
  return targetDays.map((day) => {
    const entry = dayForDate(months.get(day.slice(0, 7)) ?? null, day);
    const curatedDay = curated ? curatedOf(curated.byDay[day] ?? [], trip.title) : [];
    const entryExpanded = entry ? photosOf(entry.expandedMediaIds, trip.title).filter((m) => m.type !== "video") : [];
    const published = (publishedByDay?.get(day) ?? []).filter((m) => m.type !== "video");
    const approved = approvedOfDay(day, trip.title);
    const scenery = sceneryOf(archive, day);
    const photos = curatedDay.length > 0
      ? curatedDay
      : entryExpanded.length > 0
        ? entryExpanded
        : published.length > 0
          ? published
          : approved.length > 0
            ? approved
            : scenery;
    return {
      day,
      firstScreenIds: entry && entry.firstScreenMediaIds.length > 0 ? new Set(entry.firstScreenMediaIds) : undefined,
      photos,
    };
  });
}

/** 总览页：每条旅程一张卡。 */
export async function readTravelIndex(): Promise<{ cards: TripCard[]; trips: Trip[]; birthDay?: string }> {
  const [archive, scores] = await Promise.all([loadFamilyArchiveOnDemand(), coverScores()]);
  const trips = syncTrips(await listEditedMonthContents());
  const photosOf = gate(archive);
  const approvedOfDay = approvedPhotosByDay(archive);
  const months = await monthsFor(trips.flatMap((t) => daysOf(t)));
  const usedCoverIds = new Set<string>();
  const recordCover = (cover?: MediaRef) => {
    if (!cover) return;
    usedCoverIds.add(cover.id);
    usedCoverIds.add(displayIdentity(cover));
  };
  const drafts = trips.map((trip) => {
    // 明信片角上叠一张这次旅行最好看的风景
    const scenery = daysOf(trip).flatMap((d) => (SCENERY_BY_DAY[d] ?? []).map((s) => ({ ...s, day: d })))
      .sort((a, b) => b.scenic - a.scenic).map((s) => sceneryOf(archive, s.day).find((m) => m.id === s.id)).find(Boolean);
    const ownPools = buildTripDayPoolsForDays(daysOf(trip), trip, months, photosOf, approvedOfDay, archive);
    const hasOwnPhotos = ownPools.some((p) => p.photos.some((m) => m.type !== "video"));
    const ownCover = hasOwnPhotos ? pickTripCover(trip, ownPools, scores) : undefined;
    recordCover(ownCover);
    return { trip, scenery, hasOwnPhotos, ownCover, ageLabel: ageOn(archive.birthDay, trip.from) };
  });
  const cards = drafts.map(({ trip, scenery, hasOwnPhotos, ownCover, ageLabel }) => {
    if (hasOwnPhotos) return { trip, cover: ownCover, scenery, ageLabel };
    const fallbackPools = buildTripDayPoolsForDays(
      connectedTripFallbackDays(trip, trips),
      trip,
      months,
      photosOf,
      approvedOfDay,
      archive,
    );
    const cover = pickTripCover(trip, fallbackPools, scores, usedCoverIds);
    recordCover(cover);
    return { trip, cover, scenery, ageLabel };
  });
  return { cards, trips, birthDay: archive.birthDay };
}

/**
 * 一条旅程：既有审核池组成精选回忆，已确认行程对应独立散文。日子保留作来源链接，不再逐日铺开。
 */
export type TripReadingData = { trip: Trip; ageLabel?: string; memory?: HomeMemory; essay: TripEssay; days: TripDay[] };

export async function readTrip(id: string): Promise<TripReadingData | null> {
  const allTrips = syncTrips(await listEditedMonthContents());
  const trip = allTrips.find((item) => item.id === id);
  if (!trip) return null;
  const [archive, scores] = await Promise.all([loadFamilyArchiveOnDemand(), coverScores()]);
  const photosOf = gate(archive);
  const approvedOfDay = approvedPhotosByDay(archive);
  const range = daysOf(trip);
  const fallbackRange = connectedTripFallbackDays(trip, allTrips);
  const months = await monthsFor([...range, ...fallbackRange]);
  const timelines = new Map(await Promise.all([...months.keys()].map(async (month) => [month, await buildMonthTimeline(archive, month.slice(0, 4), month.slice(5, 7))] as const)));
  const days: TripDay[] = [];
  const curated = CURATION[trip.id];
  const available = new Map(archive.media.map((item) => [item.id, item]));
  const curatedOf = (items: CuratedItem[], title: string): MediaRef[] => items.flatMap((it) => {
    if (it.pool === "A") return photosOf([it.id], title);
    const media = available.get(it.id);
    return media && media.type !== "video" ? [toMediaRef(media, it.caption)] : [];
  });
  const publishedByDay = new Map<string, readonly MediaRef[]>();
  const buildDayRecord = (day: string, allowCurated: boolean): TripDay | null => {
    const entry = dayForDate(months.get(day.slice(0, 7)) ?? null, day);
    const publishedDay = timelines.get(day.slice(0, 7))?.byDay.get(day);
    if (publishedDay) publishedByDay.set(day, publishedDay.photos);
    if (!publishedDay) {
      const fallbackPhotos = resolveTripDayPhotos({
        curated: allowCurated && curated ? curatedOf(curated.byDay[day] ?? [], trip.title) : undefined,
        approvedDay: approvedOfDay(day, trip.title),
        scenery: sceneryOf(archive, day),
      });
      if (!fallbackPhotos.length) return null;
      return { day, dateLabel: dateLabelOf(day), ageLabel: ageOn(archive.birthDay, day), photos: fallbackPhotos };
    }
    const title = publishedDay.title ?? dateLabelOf(day);
    return {
      day,
      href: publishedDay.href,
      dateLabel: dateLabelOf(day),
      ageLabel: ageOn(archive.birthDay, day) ?? publishedDay.ageLabel,
      title,
      lead: publishedDay.paragraphs[0],
      photos: resolveTripDayPhotos({
        curated: allowCurated && curated ? curatedOf(curated.byDay[day] ?? [], title) : undefined,
        firstScreen: entry ? photosOf(entry.firstScreenMediaIds, title) : undefined,
        expanded: entry ? photosOf(entry.expandedMediaIds, title) : undefined,
        published: publishedDay.photos,
        approvedDay: approvedOfDay(day, title),
        scenery: sceneryOf(archive, day),
      }),
    };
  };
  for (const day of range) {
    const built = buildDayRecord(day, true);
    if (built) days.push(built);
  }
  const hasOwnPhotos = days.some((d) => d.photos.some((m) => m.type === "photo" && !scores.get(m.id)?.sensitive));
  const fallbackTripDays = hasOwnPhotos
    ? []
    : fallbackRange.map((d) => buildDayRecord(d, false)).filter((d): d is TripDay => d !== null && d.photos.length > 0);
  const ownPools = buildTripDayPoolsForDays(range, trip, months, photosOf, approvedOfDay, archive, publishedByDay);
  const hasOwnPoolPhotos = ownPools.some((p) => p.photos.some((m) => m.type !== "video"));
  const effectivePools = hasOwnPoolPhotos
    ? ownPools
    : buildTripDayPoolsForDays(fallbackRange, trip, months, photosOf, approvedOfDay, archive, publishedByDay);
  const siblingUsedCoverIds = new Set<string>();
  if (!hasOwnPoolPhotos) {
    for (const other of allTrips) {
      if (other.id === trip.id || other.from > trip.to || trip.from > other.to) continue;
      const otherPools = buildTripDayPoolsForDays(daysOf(other), other, months, photosOf, approvedOfDay, archive, publishedByDay);
      if (!otherPools.some((p) => p.photos.some((m) => m.type !== "video"))) continue;
      const otherCover = pickTripCover(other, otherPools, scores);
      if (otherCover) {
        siblingUsedCoverIds.add(otherCover.id);
        siblingUsedCoverIds.add(displayIdentity(otherCover));
      }
    }
  }
  const cover = pickTripCover(trip, effectivePools, scores, siblingUsedCoverIds);
  const memoryDays = hasOwnPhotos ? days : [...days, ...fallbackTripDays];
  return { trip, ageLabel: ageOn(archive.birthDay, trip.from), memory: buildTripMemory(trip, memoryDays, scores, cover), essay: tripEssay(trip), days };
}
