"use client";

// 旅行页的主体：迷雾地图 + 选中地方的旅程明信片 + 足迹印章（docs/travel-module-plan.md §4–5，2026-09-25 重做）。
//
// 按「地方」而不是按「时间」组织——这是它和记忆页的根本区别（Teddy：第一期「和记忆页的形式太像了」）。
//   · 全国图上，去过的省亮着；点一个省放大，省里去过的地级市亮着、每个去处插一面旗；
//   · 点一格城市或一面旗，下面换成在那里的旅程明信片，点明信片进旅程页；
//   · 不点任何东西时，下面放的是最近去的地方（原则一：不用操作就读得出他最近去了哪）。
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Photo } from "@/components/photo";
import { ChinaSvg, ProvinceSvg, UsSvg, type MapPin } from "@/components/travel-map-svg";
import type { MediaRef } from "@/lib/memory-chapters";
import chinaGeoFile from "@/lib/travel/geo/china.json";
import usGeoFile from "@/lib/travel/geo/us-ca.json";
import { PROVINCE_GEO_LOADERS } from "@/lib/travel/geo/index";
import type { ChinaGeo, ProvinceGeo, UsGeo } from "@/lib/travel/geo-types";

const CHINA = chinaGeoFile as ChinaGeo;
const US = usGeoFile as UsGeo;

export type AtlasTrip = {
  id: string; title: string; kind: string; tag?: string; from: string; rangeLabel: string; ageText: string;
  cover?: MediaRef; scenery?: MediaRef; unitKeys: string[]; provinces: string[];
  /** P6.1：「回老家 / 常住」组里的行程默认折叠，不和真正的旅行混排。 */
  group: "travel" | "home";
  summary?: string; places?: string;
};
export type AtlasUnit = { key: string; name: string; kind: "cn" | "us"; province?: string; color: string; firstMonth: string; firstAge?: string; visits: number };
/** 足迹印章：一枚章可以盖住几格（美国几处 → 洛杉矶，成都 + 阿坝 → 成都）。 */
export type AtlasStamp = { key: string; name: string; unitKeys: string[]; color: string; firstMonth: string; firstAge?: string; visits: number };
export type AtlasPlace = { id: string; name: string; unitKey?: string; home?: boolean };

/** 一张旅程明信片：总览默认列表、「回老家」折叠组、按地点筛出来的列表共用同一个样子。 */
function TripPostcard({ t }: { t: AtlasTrip }) {
  const photo = t.cover ?? t.scenery;
  return (
    <Link href={`/travel/${t.id}`} className={photo ? "travel-postcard" : "travel-postcard travel-postcard--text"}>
      {photo ? <span className="travel-postcard-photo">
        <Photo media={photo} variant="thumbnail" fit="crop" sizes="220px" />
        {t.cover && t.scenery ? <span className="travel-postcard-scenery"><Photo media={t.scenery} variant="thumbnail" fit="crop" sizes="96px" /></span> : null}
      </span> : null}
      <span className="travel-postcard-body">
        {t.tag ? <span className="travel-tag">{t.tag}</span> : null}
        <strong>{t.title}</strong>
        <span className="travel-postcard-when">{t.rangeLabel}</span>
        {t.ageText ? <span className="travel-postcard-age">{t.ageText.replace(/^ · /, "")}</span> : null}
      </span>
    </Link>
  );
}

type View = { kind: "china" } | { kind: "province"; code: string } | { kind: "us" };
type Selection = { kind: "recent" } | { kind: "province"; code: string } | { kind: "unit"; key: string } | { kind: "stamp"; key: string } | { kind: "us" };

export function TravelAtlas({ trips, units, stamps, places, provinceColors, provinceNames, homeUnitKey, featuredId }: {
  trips: AtlasTrip[]; units: AtlasUnit[]; stamps: AtlasStamp[]; places: AtlasPlace[];
  provinceColors: Record<string, string>; provinceNames: Record<string, string>; homeUnitKey?: string;
  /** P6.2：首屏精选行程（trips.json 的 featured，或最近一次有照片的非回老家行程）。 */
  featuredId?: string;
}) {
  const [view, setView] = useState<View>({ kind: "china" });
  const [sel, setSel] = useState<Selection>({ kind: "recent" });
  const [geo, setGeo] = useState<Record<string, ProvinceGeo>>({});
  const mapRef = useRef<HTMLDivElement>(null);

  const unitByKey = useMemo(() => new Map(units.map((u) => [u.key, u])), [units]);
  const placeById = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const litProvinces = useMemo(() => new Map(Object.entries(provinceColors)), [provinceColors]);

  const provinceCode = view.kind === "province" ? view.code : undefined;
  useEffect(() => {
    if (!provinceCode || geo[provinceCode]) return;
    const load = PROVINCE_GEO_LOADERS[provinceCode];
    if (!load) return;
    let live = true;
    load().then((g) => { if (live) setGeo((prev) => ({ ...prev, [provinceCode]: g })); });
    return () => { live = false; };
  }, [provinceCode, geo]);

  const municipal = (code: string) => unitByKey.has(`cn:${code}`);
  const pickProvince = (code: string) => {
    if (municipal(code)) { setSel({ kind: "unit", key: `cn:${code}` }); return; }
    setView({ kind: "province", code });
    setSel({ kind: "province", code });
  };
  const pickUnit = (key: string) => {
    const unit = unitByKey.get(key);
    if (!unit) return;
    if (unit.kind === "us") setView({ kind: "us" });
    else if (unit.province && !municipal(unit.province)) setView({ kind: "province", code: unit.province });
    else setView({ kind: "china" });
    setSel({ kind: "unit", key });
  };
  const pickStamp = (stamp: AtlasStamp) => {
    const first = unitByKey.get(stamp.unitKeys[0]);
    if (!first) return;
    if (first.kind === "us") setView({ kind: "us" });
    else if (first.province && !municipal(first.province)) setView({ kind: "province", code: first.province });
    else setView({ kind: "china" });
    setSel({ kind: "stamp", key: stamp.key });
  };
  const stampByKey = useMemo(() => new Map(stamps.map((s) => [s.key, s])), [stamps]);

  // 下面那一栏：标题 + 旅程。一个地方的旅程从第一次排到最新（Teddy 2026-09-25）；
  // 只有默认的「最近去的地方」是最新的在前——它回答的就是「最近」。
  const panel = useMemo(() => {
    const oldest = (list: AtlasTrip[]) => [...list].sort((x, y) => x.from.localeCompare(y.from));
    const newest = (list: AtlasTrip[]) => [...list].sort((x, y) => y.from.localeCompare(x.from));
    const firstLine = (x: { firstMonth: string; firstAge?: string }) => "最早收录：" + x.firstMonth + (x.firstAge ? " · " + x.firstAge : "");
    if (sel.kind === "unit") {
      const unit = unitByKey.get(sel.key);
      return { title: unit?.name ?? "", sub: unit ? firstLine(unit) : "", trips: oldest(trips.filter((t) => t.unitKeys.includes(sel.key))) };
    }
    if (sel.kind === "stamp") {
      const stamp = stampByKey.get(sel.key);
      return { title: stamp?.name ?? "", sub: stamp ? firstLine(stamp) : "", trips: oldest(trips.filter((t) => t.unitKeys.some((k) => stamp?.unitKeys.includes(k)))) };
    }
    if (sel.kind === "province") return { title: provinceNames[sel.code] ?? "", sub: "", trips: oldest(trips.filter((t) => t.provinces.includes(sel.code))) };
    if (sel.kind === "us") return { title: "美国", sub: "", trips: oldest(trips.filter((t) => t.unitKeys.some((k) => k.startsWith("us:")))) };
    // 默认视图只放真正的旅行；首屏已经单独放大的精选行程不在这里再重复一次。
    return { title: "最近去的地方", sub: "", trips: newest(trips.filter((t) => t.group === "travel" && t.id !== featuredId)).slice(0, 3) };
  }, [sel, trips, unitByKey, stampByKey, provinceNames, featuredId]);
  const featured = featuredId ? trips.find((t) => t.id === featuredId && t.cover) : undefined;
  const homeTrips = useMemo(() => [...trips.filter((t) => t.group === "home")].sort((x, y) => y.from.localeCompare(x.from)), [trips]);

  // 选中的格子：点格子是一格，点印章是这枚章盖住的所有格子
  const selectedUnits = new Set(sel.kind === "unit" ? [sel.key] : sel.kind === "stamp" ? stampByKey.get(sel.key)?.unitKeys ?? [] : []);
  const selectedUnitKey = [...selectedUnits][0];
  const pinsFor = (geoPins: { placeId: string; x: number; y: number }[]): MapPin[] => geoPins.flatMap((gp) => {
    const place = placeById.get(gp.placeId);
    if (!place) return [];
    const unit = place.unitKey ? unitByKey.get(place.unitKey) : undefined;
    // 中国地图上城市本身已经亮了、有名字，不再插旗；旗子只给城市里的小地方（莫干山、千岛湖、川西……）
    if (!place.home && unit?.kind === "cn" && unit.name === place.name) return [];
    return [{ ...gp, name: place.name, home: place.home, color: unit?.color ?? "#A85D43", unit: place.unitKey?.startsWith("cn:") ? place.unitKey.slice(3) : undefined }];
  });
  const activePinsOf = (pins: MapPin[]) => new Set(pins.filter((p) => selectedUnits.has(placeById.get(p.placeId)?.unitKey ?? "")).map((p) => p.placeId));

  const homePin = CHINA.pins.find((p) => placeById.get(p.placeId)?.home);
  const provinceGeo = provinceCode ? geo[provinceCode] : undefined;

  return (
    <div className="travel-atlas">
      {featured ? (
        <Link href={`/travel/${featured.id}`} className="travel-featured" aria-label={`精选行程：${featured.title}`}>
          <span className="travel-featured-photo"><Photo media={featured.cover!} variant="web" fit="crop" priority sizes="(max-width: 760px) 100vw, 760px" /></span>
          <span className="travel-featured-body">
            <span className="travel-featured-kicker">精选行程</span>
            <strong>{featured.title}</strong>
            <span className="travel-featured-when">{featured.rangeLabel}{featured.ageText}</span>
            {featured.summary ? <span className="travel-featured-summary">{featured.summary}</span> : null}
            <span className="travel-featured-go">翻开这一程 →</span>
          </span>
        </Link>
      ) : null}
      <div className="travel-map-tabs" role="tablist" aria-label="地图">
        <button type="button" role="tab" aria-selected={view.kind !== "us"} className={view.kind !== "us" ? "is-on" : ""}
          onClick={() => { setView({ kind: "china" }); setSel({ kind: "recent" }); }}>中国</button>
        <button type="button" role="tab" aria-selected={view.kind === "us"} className={view.kind === "us" ? "is-on" : ""}
          onClick={() => { setView({ kind: "us" }); setSel({ kind: "us" }); }}>美国</button>
      </div>

      <div className="travel-map" ref={mapRef}>
        {view.kind === "province" ? (
          <button type="button" className="travel-map-back" onClick={() => { setView({ kind: "china" }); setSel({ kind: "recent" }); }}>← 全国</button>
        ) : null}
        {view.kind === "china" ? (
          <ChinaSvg geo={CHINA} id="atlas-cn" lit={litProvinces} home={homePin} homeProvince={homeUnitKey ? unitByKey.get(homeUnitKey)?.province : undefined} onPick={pickProvince}
            selected={selectedUnitKey ? unitByKey.get(selectedUnitKey)?.province : sel.kind === "province" ? sel.code : undefined}
            title="张年去过的中国省份" />
        ) : view.kind === "us" ? (
          (() => {
            const pins = pinsFor(US.pins);
            const active = selectedUnitKey ? activePinsOf(pins) : new Set(pins.map((p) => p.placeId));
            return <UsSvg geo={US} id="atlas-us" pins={pins} activePins={active} onPickPin={(p) => { const k = placeById.get(p.placeId)?.unitKey; if (k) pickUnit(k); }} title="张年去过的美国加州" />;
          })()
        ) : provinceGeo ? (
          (() => {
            const lit = new Map<string, string>();
            for (const u of units) if (u.province === provinceCode) lit.set(u.key.slice(3), u.color);
            const pins = pinsFor(provinceGeo.pins);
            return (
              <ProvinceSvg geo={provinceGeo} id={`atlas-${provinceCode}`} lit={lit}
                homeUnit={homeUnitKey?.startsWith("cn:") ? homeUnitKey.slice(3) : undefined}
                selected={selectedUnitKey?.slice(3)} onPickUnit={(code) => pickUnit(`cn:${code}`)}
                pins={pins} activePins={activePinsOf(pins)}
                onPickPin={(p) => { const k = placeById.get(p.placeId)?.unitKey; if (k && unitByKey.has(k)) pickUnit(k); }}
                title={`张年去过的${provinceNames[provinceCode!] ?? ""}`} />
            );
          })()
        ) : (
          <div className="travel-map-loading" aria-live="polite" />
        )}
      </div>

      <section className="travel-panel" aria-live="polite" aria-label={panel.title}>
        <header className="travel-panel-head">
          <h2>{panel.title}</h2>
          {panel.sub ? <p>{panel.sub}</p> : null}
        </header>
        <ul className="travel-postcards">
          {panel.trips.map((t) => <li key={t.id}><TripPostcard t={t} /></li>)}
        </ul>
        {sel.kind === "recent" && homeTrips.length > 0 ? (
          <details className="travel-home-group">
            <summary>回老家 · {homeTrips.length} 次</summary>
            <p className="travel-home-note">回温州、回西安，以及在温州住的那段日子，单独收在这里。</p>
            <ul className="travel-postcards travel-postcards--grid">
              {homeTrips.map((t) => <li key={t.id}><TripPostcard t={t} /></li>)}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="travel-stamps-wrap" aria-labelledby="travel-stamps-title">
        <h2 id="travel-stamps-title" className="travel-section-title">足迹</h2>
        <ul className="travel-stamps">
          {stamps.map((u) => (
            <li key={u.key}>
              <button type="button" className={`travel-stamp${u.unitKeys.some((k) => selectedUnits.has(k)) ? " is-on" : ""}`} style={{ "--stamp": u.color } as React.CSSProperties}
                onClick={() => { pickStamp(u); mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                <span className="travel-stamp-name">{u.name}</span>
                <span className="travel-stamp-first">{u.firstMonth}</span>
                {u.firstAge ? <span className="travel-stamp-age">{u.firstAge}</span> : null}
                <span className="travel-stamp-dots" aria-hidden="true">{Array.from({ length: Math.min(u.visits, 6) }, (_, i) => <i key={i} />)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
