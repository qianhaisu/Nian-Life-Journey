// 旅行页的服务端读取：把旅程接到已经发布的日页和照片上。
//
// 读两样东西，都是页面已经在用、有缓存的读取：
//   - loadFamilyArchiveOnDemand()：和 /memory、/mom-reports 共用同一份 300 s 记忆，不另起一次整库读取
//     （它的使用边界见 lib/family-archive.ts；getStore()/getOrganizerStore() 这里一个都不碰）；
//   - loadMonthContent(month)：月内容文件，300 s 缓存，一条旅程最多跨两个月。
// 照片过的门和日页完全一样：resolveMonthContentMedia 用可发布的媒体 + 最新的 store_only 排除，
// 旅行页不会多露出一张日页上不给看的照片。
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { toMediaRef, type MediaRef } from "@/lib/memory-chapters";
import { loadMonthContent, dayForDate, resolveMonthContentMedia, type MonthContent } from "@/lib/month-content";
import { ageOn } from "@/lib/time-signature";
import { loadTopicCache } from "@/lib/home-memory-topics-load";
import { coverScore, daysOf, TRIPS, tripById, type CoverScore, type Trip } from "./model";

export type TripDay = {
  day: string; href: string; dateLabel: string; ageLabel?: string;
  title: string; lead?: string; photos: MediaRef[];
};
export type TripCard = { trip: Trip; cover?: MediaRef; ageLabel?: string };

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
  const cards = TRIPS.map((trip) => ({ trip, cover: pickCover(trip, months, photosOf, scores), ageLabel: ageOn(archive.birthDay, trip.from) }));
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
  for (const day of range) {
    const entry = dayForDate(months.get(day.slice(0, 7)) ?? null, day);
    if (!entry) continue;
    const title = entry.title ?? dateLabelOf(day);
    days.push({
      day, href: hrefOf(day), dateLabel: dateLabelOf(day), ageLabel: ageOn(archive.birthDay, day) ?? entry.ageLabel,
      title, lead: entry.paragraphs[0], photos: photosOf(entry.firstScreenMediaIds, title),
    });
  }
  const cover = pickCover(trip, months, photosOf, scores);
  return { trip, ageLabel: ageOn(archive.birthDay, trip.from), cover, days };
}
