import type { Metadata } from "next";
import { TravelAtlas, type AtlasPlace, type AtlasTrip, type AtlasUnit } from "@/components/travel-atlas";
import { HOME_COLOR, STICKER_COLORS } from "@/components/travel-map-svg";
import { renderOnDemand } from "@/lib/render-on-demand";
import { ageOn, formatMonth } from "@/lib/time-signature";
import { productToday } from "@/lib/time-truth";
import chinaGeo from "@/lib/travel/geo/china.json";
import { KIND_LABEL, PLACES, TRIPS, formatRange, leadLine, unitOf, whenAge, type Unit } from "@/lib/travel/model";
import { readTravelIndex } from "@/lib/travel/reading";
import "./travel.css";

export const metadata: Metadata = { title: "旅行" };

// 旅行（docs/travel-module-plan.md §4–5）。2026-09-25 按 Teddy 的意见重做：第一版按年排卡片，
// 「和记忆页的形式太像了」；现在以地方为主——迷雾地图、点地方看那里的旅程、足迹印章。
// 旅程页（/travel/<id>）不变，仍是逐日指回日页的索引。
export default async function TravelPage() {
  // 与 /memory 同理：不在构建时用 mock 数据预渲染（lib/render-on-demand.ts）。
  await renderOnDemand();
  const { cards, birthDay } = await readTravelIndex();
  const today = productToday();

  // 地图上的格子：中国按地级市、美国按城市。颜色按第一次去的先后轮换；家那一格用固定的绿。
  // 家那一格（杭州市域）也放进来：千岛湖、桐庐的旅程要能在地图上点到，只是它不算进「去过几个城市」。
  const firstTrip = new Map<string, (typeof TRIPS)[number]>();
  const visits = new Map<string, number>();
  const unitMeta = new Map<string, Unit>();
  for (const trip of [...TRIPS].sort((a, b) => a.from.localeCompare(b.from))) {
    const keys = new Set<string>();
    for (const id of trip.placeIds) { const u = unitOf(id); if (u) { keys.add(u.key); unitMeta.set(u.key, u); } }
    for (const key of keys) { if (!firstTrip.has(key)) firstTrip.set(key, trip); visits.set(key, (visits.get(key) ?? 0) + 1); }
  }
  let colorIndex = 0;
  const units: AtlasUnit[] = [...firstTrip.entries()].map(([key, trip]) => {
    const meta = unitMeta.get(key)!;
    const age = ageOn(birthDay, trip.from);
    return {
      key, name: meta.name, kind: meta.kind, province: meta.province,
      color: meta.home ? HOME_COLOR : STICKER_COLORS[colorIndex++ % STICKER_COLORS.length],
      firstMonth: formatMonth(trip.from.slice(0, 7)), firstAge: age === "出生的那天" ? "出生那天" : age,
      visits: visits.get(key) ?? 1,
    };
  });
  const provinceColors: Record<string, string> = {};
  for (const u of units) if (u.province && !provinceColors[u.province] && !unitMeta.get(u.key)?.home) provinceColors[u.province] = u.color;
  // 家所在的省即使别处没去过也要亮（旅程都从那里出发）
  const homePlace = PLACES.find((p) => p.home);
  const homeUnit = homePlace ? unitOf(homePlace.id) : undefined;
  if (homeUnit?.province && !provinceColors[homeUnit.province]) provinceColors[homeUnit.province] = HOME_COLOR;

  const provinceNames: Record<string, string> = {};
  for (const p of (chinaGeo as { provinces: { adcode: string; name: string }[] }).provinces) {
    provinceNames[p.adcode] = p.name.replace(/(维吾尔自治区|壮族自治区|回族自治区|自治区|特别行政区|省|市)$/, "");
  }

  const places: AtlasPlace[] = PLACES.filter((p) => p.level === "city" || p.level === "spot")
    .map((p) => ({ id: p.id, name: p.name, unitKey: unitOf(p.id)?.key, home: p.home }));
  const cardById = new Map(cards.map((c) => [c.trip.id, c]));
  const trips: AtlasTrip[] = TRIPS.map((t) => {
    const card = cardById.get(t.id);
    const tripUnits = t.placeIds.map(unitOf).filter((u): u is Unit => !!u);
    return {
      id: t.id, title: t.title, kind: t.kind, tag: KIND_LABEL[t.kind], from: t.from,
      rangeLabel: formatRange(t.from, t.to), ageText: whenAge(card?.ageLabel), cover: card?.cover,
      unitKeys: [...new Set(tripUnits.map((u) => u.key))],
      provinces: [...new Set(tripUnits.map((u) => u.province).filter((x): x is string => !!x))],
    };
  });

  return (
    <div className="travel-page">
      <header className="reading-wrap travel-head">
        <h1 className="serif">旅行</h1>
        <p className="travel-lead">{leadLine(TRIPS, birthDay, today)}</p>
      </header>
      <div className="reading-wrap">
        <TravelAtlas trips={trips} units={units} places={places} provinceColors={provinceColors} provinceNames={provinceNames} homeUnitKey={homeUnit?.key} />
      </div>
    </div>
  );
}
