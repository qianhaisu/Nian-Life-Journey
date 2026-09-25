// 旅行模块的纯数据层（docs/travel-module-plan.md §2）：地名册、旅程、它们的校验和几种算法。
// 不读库、不读文件系统、不联网——两个 JSON 随代码发布，页面和测试都从这里拿同一份。
//
// 为什么旅程放在仓库里而不是 /srv/nianlife-content：旅程是人确认过的一小份编辑稿（Teddy 2026-09-25 逐条
// 确认），和 lib/mom-report-content.ts 同一性质；随代码走意味着它和读它的页面永远是同一版本，
// 也不需要任何线上写权限才能更新。夜间增量（第 3 期）上线时再考虑挪到内容目录。
import placesFile from "./places.json";
import tripsFile from "./trips.json";
import regionsFile from "./geo/regions.json";
import { ageOn, formatDay } from "@/lib/time-signature";

export type PlaceLevel = "country" | "province" | "city" | "spot";
export type Place = {
  id: string; name: string; level: PlaceLevel; parent?: string; country: string;
  adcode?: string; lat: number; lng: number; aliases?: string[];
  home?: boolean; hometown?: boolean; birthplace?: boolean; livedIn?: string;
};
export type TripKind = "birthplace" | "hometown" | "travel" | "daytrip";
export type Trip = {
  id: string; title: string; kind: TripKind; from: string; to: string;
  placeIds: string[]; coverDay?: string; coverMediaId?: string; summary: string; evidence: string[];
};

/** 封面候选需要的那部分视觉评分（来自 data/photo-topics.json 的 carousel 字段，夜间模型写、这里只读）。 */
export type CoverScore = {
  qualified?: boolean; childMain?: boolean; faceClear?: boolean; faceUnblocked?: boolean; motionBlur?: boolean; sensitive?: boolean; sleeping?: boolean;
  clarity?: number; expression?: number; matches?: { outdoor?: number };
};

/**
 * 旅程封面的分数；不合格返回 undefined。
 * 只收模型判为合格、张年是主体、脸清楚无遮挡、不糊、不敏感的照片——封面是这次旅程的脸，
 * 一朵花的特写或半个额头不行（2026-09-25 第一版就是这样挑出来的）。户外加分：旅行照最该看得出在外面。
 */
export function coverScore(s: CoverScore | undefined, onCoverDay: boolean): number | undefined {
  if (!s?.qualified || !s.childMain || !s.faceClear || s.faceUnblocked === false || s.motionBlur || s.sensitive || s.sleeping) return undefined;
  return (s.clarity ?? 0) + (s.expression ?? 0) + 0.8 * (s.matches?.outdoor ?? 0) + (onCoverDay ? 10 : 0);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS: ReadonlySet<string> = new Set<TripKind>(["birthplace", "hometown", "travel", "daytrip"]);

export const KIND_LABEL: Record<TripKind, string | undefined> = {
  birthplace: "出生地",
  hometown: "回老家",
  travel: undefined,
  daytrip: undefined,
};

/**
 * 把旅程文件校验成可用的列表；任何一条不合格就整份拒绝并说明原因。
 * 宁可在测试和构建时失败，也不要让页面静默少一条旅程——少掉的那条正是家人会去找的那次。
 */
export function validateTrips(raw: unknown, places: readonly Place[]): Trip[] {
  const known = new Set(places.map((p) => p.id));
  const list = (raw as { trips?: unknown })?.trips;
  if (!Array.isArray(list)) throw new Error("trips.json: trips 不是数组");
  const seen = new Set<string>();
  return list.map((item, i) => {
    const t = item as Trip;
    const where = `trips[${i}] ${t?.id ?? ""}`;
    if (!t || typeof t.id !== "string" || !/^[a-z0-9-]+$/.test(t.id)) throw new Error(`${where}: id`);
    if (seen.has(t.id)) throw new Error(`${where}: id 重复`);
    seen.add(t.id);
    if (typeof t.title !== "string" || !t.title.trim()) throw new Error(`${where}: title`);
    if (!KINDS.has(t.kind)) throw new Error(`${where}: kind`);
    if (!DAY.test(t.from) || !DAY.test(t.to) || t.from > t.to) throw new Error(`${where}: from/to`);
    if (t.coverDay !== undefined && (!DAY.test(t.coverDay) || t.coverDay < t.from || t.coverDay > t.to)) throw new Error(`${where}: coverDay 不在旅程内`);
    if (!Array.isArray(t.placeIds) || !t.placeIds.length) throw new Error(`${where}: placeIds`);
    for (const id of t.placeIds) if (!known.has(id)) throw new Error(`${where}: 地名册里没有 ${id}`);
    if (typeof t.summary !== "string" || !t.summary.trim()) throw new Error(`${where}: summary`);
    if (!Array.isArray(t.evidence) || !t.evidence.length) throw new Error(`${where}: evidence 不能为空（每条旅程都要说得出凭什么）`);
    if (t.coverMediaId !== undefined && (typeof t.coverMediaId !== "string" || !t.coverMediaId)) throw new Error(`${where}: coverMediaId`);
    return { id: t.id, title: t.title, kind: t.kind, from: t.from, to: t.to, placeIds: [...t.placeIds], coverDay: t.coverDay, coverMediaId: t.coverMediaId, summary: t.summary, evidence: [...t.evidence] };
  });
}

export const PLACES: readonly Place[] = (placesFile as { places: Place[] }).places;
const PLACE_BY_ID = new Map(PLACES.map((p) => [p.id, p]));
/** 新的在前。 */
export const TRIPS: readonly Trip[] = validateTrips(tripsFile, PLACES).sort((a, b) => b.from.localeCompare(a.from));

export function placeById(id: string): Place | undefined { return PLACE_BY_ID.get(id); }
export function tripById(id: string): Trip | undefined { return TRIPS.find((t) => t.id === id); }

/** 旅程覆盖的每一天（含首尾），按时间顺序。 */
export function daysOf(trip: Pick<Trip, "from" | "to">): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${trip.from}T00:00:00Z`), end = Date.parse(`${trip.to}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

const ymd = (day: string) => day.split("-").map(Number) as [number, number, number];

/** 「2025 年 12 月 26 日 – 2026 年 1 月 1 日」；同年省年，同月省月，一天就只写那一天。 */
export function formatRange(from: string, to: string): string {
  if (from === to) return formatDay(from);
  const [fy, fm] = ymd(from);
  const [ty, tm, td] = ymd(to);
  if (fy !== ty) return `${formatDay(from)} – ${formatDay(to)}`;
  if (fm !== tm) return `${formatDay(from)} – ${tm} 月 ${td} 日`;
  return `${formatDay(from)} – ${td} 日`;
}

/** 出发那天他几岁（原则二：每个时间都要同时读得出「当时几岁」）。 */
export function tripAge(trip: Pick<Trip, "from">, birthDay: string | undefined): string | undefined {
  return ageOn(birthDay, trip.from);
}

/** 「当时 11 个月」；出生那天读作「出生那天」，不写成「当时 出生的那天」。 */
export function whenAge(age: string | undefined): string {
  if (!age) return "";
  return age === "出生的那天" ? " · 出生那天" : ` · 当时 ${age}`;
}

/** 沿 parent 往上找，直到某一层级。 */
function ancestorAt(place: Place, level: PlaceLevel): Place | undefined {
  let p: Place | undefined = place;
  while (p && p.level !== level) p = p.parent ? PLACE_BY_ID.get(p.parent) : undefined;
  return p;
}

/**
 * 地图上「解锁」的单位（第 2 期）：中国按地级市（直辖市整个算一个），美国按城市本身。
 * 哪个去处落在哪个地级市，由 scripts/travel-geo-build.mjs 用点在多边形内算好写进 geo/regions.json，这里只查表。
 */
export type Region = { province?: string; provinceName?: string; prefecture?: string; prefectureName?: string; state?: string; error?: string };
const REGIONS = regionsFile as Record<string, Region>;
const MUNICIPALITIES = new Set(["110000", "120000", "310000", "500000", "810000", "820000"]);
export type UnitKind = "cn" | "us";
export type Unit = { key: string; name: string; kind: UnitKind; province?: string; provinceName?: string; home: boolean };

/** 「阿坝藏族羌族自治州」→「阿坝」，「湖州市」→「湖州」，「上海市」→「上海」。 */
export function shortRegionName(name: string): string {
  return name.replace(/(藏族羌族自治州|自治州|特别行政区|地区|盟|市|省)$/, "") || name;
}

export function regionOf(placeId: string): Region | undefined { return REGIONS[placeId]; }

/** 一个去处所在的解锁单位；地名册里有但没算出区域的（比如缺边界文件的省）返回 undefined。 */
export function unitOf(placeId: string): Unit | undefined {
  const place = PLACE_BY_ID.get(placeId);
  const r = REGIONS[placeId];
  if (!place || !r) return undefined;
  if (place.country === "US") return { key: `us:${place.id}`, name: place.name, kind: "us", home: false };
  if (!r.province) return undefined;
  if (MUNICIPALITIES.has(r.province)) return { key: `cn:${r.province}`, name: shortRegionName(r.provinceName ?? place.name), kind: "cn", province: r.province, provinceName: r.provinceName, home: false };
  if (!r.prefecture) return undefined;
  const homePrefecture = PLACES.find((x) => x.home) ? REGIONS[PLACES.find((x) => x.home)!.id]?.prefecture : undefined;
  return { key: `cn:${r.prefecture}`, name: shortRegionName(r.prefectureName ?? place.name), kind: "cn", province: r.province, provinceName: r.provinceName, home: r.prefecture === homePrefecture };
}

/**
 * 足迹印章按「一个去处」合并，不按行政区（Teddy 2026-09-25）：美国的几处都盖进「洛杉矶」一个章，
 * 成都和阿坝（川西）是同一次四川之行，盖一个章。地图上的格子不受影响，仍然各自亮。
 */
const STAMP_MERGE: Record<string, string> = { "cn:513200": "cn:510100" };
export function stampKeyOf(unitKey: string): string {
  if (unitKey.startsWith("us:")) return "us:us-ca-losangeles";
  return STAMP_MERGE[unitKey] ?? unitKey;
}

/**
 * 去过几个城市 = 足迹印章有几枚（Teddy 2026-09-25：「跟着印章改成 13 个」）。
 * 一枚章是一个去处：美国几处算洛杉矶一个，成都和阿坝算一个；千岛湖、桐庐那几次落在杭州这一枚上。
 */
export function stampCount(trips: readonly Trip[]): number {
  const keys = new Set<string>();
  for (const trip of trips) for (const id of trip.placeIds) {
    const place = PLACE_BY_ID.get(id);
    const unit = unitOf(id);
    if (!place || place.home || !unit) continue;
    keys.add(stampKeyOf(unit.key));
  }
  return keys.size;
}

export type TravelStats = { countries: Place[]; provinces: string[]; cities: Unit[] };

/**
 * 去过的国家、省级地区、城市。「城市」= 地图上亮起来的格子：中国的地级市（直辖市算一个）、美国的城市。
 * 家所在的地级市（杭州）不算——千岛湖、桐庐虽然出了市区，仍在杭州市域里，地图上它们是家那一格里的小旗子。
 * 景点（莫干山、川西、弗雷泽帕克）不单独算城市，它们落进所在的地级市。
 */
export function travelStats(trips: readonly Trip[]): TravelStats {
  const countries = new Map<string, Place>(), provinces = new Set<string>(), cities = new Map<string, Unit>();
  for (const trip of trips) for (const id of trip.placeIds) {
    const place = PLACE_BY_ID.get(id);
    if (!place || place.home) continue;
    const country = ancestorAt(place, "country");
    if (country) countries.set(country.id, country);
    const unit = unitOf(id);
    if (unit?.province) provinces.add(unit.province);
    if (place.country === "US") provinces.add("us-ca");
    // 中国的景点落进它的地级市（川西 → 阿坝）；美国的景点自己不是城市。
    if (unit && !unit.home && (unit.kind === "cn" || place.level !== "spot")) cities.set(unit.key, unit);
  }
  return { countries: [...countries.values()], provinces: [...provinces], cities: [...cities.values()] };
}

/** 一条旅程的去处，按名字连起来：「成都、川西」。 */
export function placeNames(trip: Pick<Trip, "placeIds">): string {
  return trip.placeIds.map((id) => PLACE_BY_ID.get(id)?.name).filter(Boolean).join("、");
}

/**
 * 总览第一句（原则一：不点任何东西就能读出张年去过哪）。数字只在这一句里出现——这一页的主题就是
 * 「去过哪」；下面全是内容，不再有计数。
 */
export function leadLine(trips: readonly Trip[], birthDay: string | undefined, today: string): string {
  const stats = travelStats(trips);
  const age = ageOn(birthDay, today);
  const latest = trips.filter((t) => t.from <= today).sort((a, b) => b.from.localeCompare(a.from))[0];
  const head = `${age ? `张年 ${age}，` : "张年"}去过 ${stats.countries.length} 个国家、${stampCount(trips)} 个城市。`;
  if (!latest) return head;
  const [y, m] = ymd(latest.from);
  const [ty] = ymd(today);
  return `${head}最近一次是 ${y === ty ? "" : `${y} 年 `}${m} 月的${latest.title}。`;
}
