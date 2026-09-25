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
  cover?: MediaRef; unitKeys: string[]; provinces: string[];
};
export type AtlasUnit = { key: string; name: string; kind: "cn" | "us"; province?: string; color: string; firstMonth: string; firstAge?: string; visits: number };
export type AtlasPlace = { id: string; name: string; unitKey?: string; home?: boolean };

type View = { kind: "china" } | { kind: "province"; code: string } | { kind: "us" };
type Selection = { kind: "recent" } | { kind: "province"; code: string } | { kind: "unit"; key: string } | { kind: "us" };

export function TravelAtlas({ trips, units, places, provinceColors, provinceNames, homeUnitKey }: {
  trips: AtlasTrip[]; units: AtlasUnit[]; places: AtlasPlace[];
  provinceColors: Record<string, string>; provinceNames: Record<string, string>; homeUnitKey?: string;
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

  // 下面那一栏：标题 + 旅程
  const panel = useMemo(() => {
    const newest = (list: AtlasTrip[]) => [...list].sort((a, b) => b.from.localeCompare(a.from));
    if (sel.kind === "unit") {
      const unit = unitByKey.get(sel.key);
      return { title: unit?.name ?? "", sub: unit ? `第一次来：${unit.firstMonth}${unit.firstAge ? ` · ${unit.firstAge}` : ""}` : "", trips: newest(trips.filter((t) => t.unitKeys.includes(sel.key))) };
    }
    if (sel.kind === "province") return { title: provinceNames[sel.code] ?? "", sub: "", trips: newest(trips.filter((t) => t.provinces.includes(sel.code))) };
    if (sel.kind === "us") return { title: "美国", sub: "", trips: newest(trips.filter((t) => t.unitKeys.some((k) => k.startsWith("us:")))) };
    return { title: "最近去的地方", sub: "", trips: newest(trips).slice(0, 3) };
  }, [sel, trips, unitByKey, provinceNames]);

  const selectedUnitKey = sel.kind === "unit" ? sel.key : undefined;
  const pinsFor = (geoPins: { placeId: string; x: number; y: number }[]): MapPin[] => geoPins.flatMap((gp) => {
    const place = placeById.get(gp.placeId);
    if (!place) return [];
    const unit = place.unitKey ? unitByKey.get(place.unitKey) : undefined;
    // 中国地图上城市本身已经亮了、有名字，不再插旗；旗子只给城市里的小地方（莫干山、千岛湖、川西……）
    if (!place.home && unit?.kind === "cn" && unit.name === place.name) return [];
    return [{ ...gp, name: place.name, home: place.home, color: unit?.color ?? "#A85D43" }];
  });
  const activePinsOf = (pins: MapPin[]) => new Set(pins.filter((p) => placeById.get(p.placeId)?.unitKey === selectedUnitKey).map((p) => p.placeId));

  const homePin = CHINA.pins.find((p) => placeById.get(p.placeId)?.home);
  const provinceGeo = provinceCode ? geo[provinceCode] : undefined;

  return (
    <div className="travel-atlas">
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
            selected={sel.kind === "unit" ? unitByKey.get(sel.key)?.province : sel.kind === "province" ? sel.code : undefined}
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
          {panel.trips.map((t) => (
            <li key={t.id}>
              <Link href={`/travel/${t.id}`} className="travel-postcard">
                <span className="travel-postcard-photo">{t.cover ? <Photo media={t.cover} variant="thumbnail" fit="crop" sizes="220px" /> : null}</span>
                <span className="travel-postcard-body">
                  {t.tag ? <span className="travel-tag">{t.tag}</span> : null}
                  <strong>{t.title}</strong>
                  <span className="travel-postcard-when">{t.rangeLabel}</span>
                  {t.ageText ? <span className="travel-postcard-age">{t.ageText.replace(/^ · /, "")}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="travel-stamps-wrap" aria-labelledby="travel-stamps-title">
        <h2 id="travel-stamps-title" className="travel-section-title">足迹</h2>
        <ul className="travel-stamps">
          {units.map((u) => (
            <li key={u.key}>
              <button type="button" className={`travel-stamp${selectedUnitKey === u.key ? " is-on" : ""}`} style={{ "--stamp": u.color } as React.CSSProperties}
                onClick={() => { pickUnit(u.key); mapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
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
