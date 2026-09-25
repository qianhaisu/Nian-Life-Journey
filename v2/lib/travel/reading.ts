// 旅行页的服务端读取：把旅程接到已经发布的日页和照片上。
//
// 读两样东西，都是页面已经在用、有缓存的读取：
//   - loadFamilyArchiveOnDemand()：和 /memory、/mom-reports 共用同一份 300 s 记忆，不另起一次整库读取
//     （它的使用边界见 lib/family-archive.ts；getStore()/getOrganizerStore() 这里一个都不碰）；
//   - loadMonthContent(month)：月内容文件，300 s 缓存，一条旅程最多跨两个月。
// 照片过的门和日页一样：resolveMonthContentMedia 用可发布的媒体 + 最新的 store_only 排除。
// 唯一的例外是风景照（Teddy 2026-09-25：「可以放部分风景照，不用全部都是张年的照片」）：lib/travel/scenery.json
// 里 GLM 判为好看风景、没有陌生人大脸、没有截图单据和隐私的照片，在旅行页上不需要「是张年」这道门——
// 它们本来就不是他，store_only 正是因为这个。它们仍然必须是可发布的媒体（在 archive.media 里）。
// 这个例外只在旅行页；记忆页、首页不读这份名单。
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { toMediaRef, type MediaRef } from "@/lib/memory-chapters";
import { loadMonthContent, dayForDate, resolveMonthContentMedia, type MonthContent } from "@/lib/month-content";
import { ageOn } from "@/lib/time-signature";
import { loadTopicCache } from "@/lib/home-memory-topics-load";
import { coverScore, daysOf, TRIPS, tripById, type CoverScore, type Trip } from "./model";
import sceneryFile from "./scenery.json";
import curationFile from "./curation.json";

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
const hrefOf = (day: string) => `/memory/${day.slice(0, 4)}/${day.slice(5, 7)}/${day.slice(8, 10)}`;

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

type Scores = Map<string, CoverScore>;
async function coverScores(): Promise<Scores> {
  // 首页轮播已经用模型给照片打过分（data/photo-topics.json，随仓库发布，夜间任务更新）。复用它，
  // 不为旅行封面另外识图（CLAUDE.md：优先复用有效的解析结果）。读不到就是空表，封面退回旧规则。
  const cache = await loadTopicCache();
  const out: Scores = new Map();
  for (const [id, topic] of Object.entries(cache?.topics ?? {})) {
    const carousel = (topic as { carousel?: CoverScore }).carousel;
    if (carousel) out.set(id, carousel);
  }
  return out;
}

/**
 * 一条旅程的封面。顺序：旅程文件里手工指定的 coverMediaId → 全程月页选用的照片里评分最高的一张
 * → coverDay（缺省第一天）首屏第一张。每一步都只在过了日页同一道门的照片里挑。
 */
function pickCover(trip: Trip, months: Map<string, MonthContent | null>, photosOf: ReturnType<typeof gate>, scores: Scores): MediaRef | undefined {
  const entries = daysOf(trip).map((day) => ({ day, entry: dayForDate(months.get(day.slice(0, 7)) ?? null, day) })).filter((x) => x.entry);
  const pool = entries.flatMap(({ day, entry }) => photosOf(entry!.expandedMediaIds, trip.title).filter((m) => m.type !== "video").map((m) => ({ m, day })));
  if (trip.coverMediaId) { const chosen = pool.find((p) => p.m.id === trip.coverMediaId); if (chosen) return chosen.m; }
  let best: { m: MediaRef; score: number } | undefined;
  for (const { m, day } of pool) {
    const score = coverScore(scores.get(m.id), day === trip.coverDay);
    if (score !== undefined && (!best || score > best.score)) best = { m, score };
  }
  if (best) return best.m;
  const order = trip.coverDay ? [trip.coverDay, ...entries.map((e) => e.day).filter((d) => d !== trip.coverDay)] : entries.map((e) => e.day);
  for (const day of order) {
    const first = pool.find((p) => p.day === day && dayForDate(months.get(day.slice(0, 7)) ?? null, day)!.firstScreenMediaIds.includes(p.m.id));
    if (first) return first.m;
  }
  return pool[0]?.m;
}

/** 总览页：每条旅程一张卡。 */
export async function readTravelIndex(): Promise<{ cards: TripCard[]; birthDay?: string }> {
  const [archive, scores] = await Promise.all([loadFamilyArchiveOnDemand(), coverScores()]);
  const photosOf = gate(archive);
  const months = await monthsFor(TRIPS.flatMap((t) => daysOf(t)));
  const cards = TRIPS.map((trip) => {
    // 明信片角上叠一张这次旅行最好看的风景
    const scenery = daysOf(trip).flatMap((d) => (SCENERY_BY_DAY[d] ?? []).map((s) => ({ ...s, day: d })))
      .sort((a, b) => b.scenic - a.scenic).map((s) => sceneryOf(archive, s.day).find((m) => m.id === s.id)).find(Boolean);
    return { trip, cover: pickCover(trip, months, photosOf, scores), scenery, ageLabel: ageOn(archive.birthDay, trip.from) };
  });
  return { cards, birthDay: archive.birthDay };
}

/**
 * 一条旅程：逐日的标题、首段、首屏照片。没有日页的日子不出现——旅程只是索引，不替日页编内容。
 */
export async function readTrip(id: string): Promise<{ trip: Trip; ageLabel?: string; cover?: MediaRef; days: TripDay[] } | null> {
  const trip = tripById(id);
  if (!trip) return null;
  const [archive, scores] = await Promise.all([loadFamilyArchiveOnDemand(), coverScores()]);
  const photosOf = gate(archive);
  const range = daysOf(trip);
  const months = await monthsFor(range);
  const days: TripDay[] = [];
  const curated = CURATION[trip.id];
  const available = new Map(archive.media.map((item) => [item.id, item]));
  const curatedOf = (items: CuratedItem[], title: string): MediaRef[] => items.flatMap((it) => {
    if (it.pool === "A") return photosOf([it.id], title);
    const media = available.get(it.id);
    return media && media.type !== "video" ? [toMediaRef(media, it.caption)] : [];
  });
  for (const day of range) {
    const entry = dayForDate(months.get(day.slice(0, 7)) ?? null, day);
    if (!entry) {
      // 没有日页的日子：有沿途风景就单独占一格，只放日期和风景，不链接（没有可读的日页）
      const scenery = sceneryOf(archive, day);
      if (scenery.length) days.push({ day, dateLabel: dateLabelOf(day), ageLabel: ageOn(archive.birthDay, day), photos: scenery });
      continue;
    }
    const title = entry.title ?? dateLabelOf(day);
    days.push({
      day, href: hrefOf(day), dateLabel: dateLabelOf(day), ageLabel: ageOn(archive.birthDay, day) ?? entry.ageLabel,
      title, lead: entry.paragraphs[0], // 有精选的旅程：精选里已经包括风景候选并按场景去过重，不再叠加风景名单（否则同一片牧场会出现四次）
      photos: curated ? curatedOf(curated.byDay[day] ?? [], title) : interleave(photosOf(entry.firstScreenMediaIds, title), sceneryOf(archive, day)),
    });
  }
  const cover = pickCover(trip, months, photosOf, scores);
  return { trip, ageLabel: ageOn(archive.birthDay, trip.from), cover, days };
}
