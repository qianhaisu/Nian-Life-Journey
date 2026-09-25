// 旅程页顶上的小地图：这一次去了哪几处。服务端画，静态，不能点（点地图是旅行页的事）。
//   · 去过美国：画加州，插上这次的旗子；
//   · 只在一个省（直辖市除外）：画那个省，这次去过的地级市亮起来，旗子带名字；
//   · 跨了几个省或只去了直辖市：画全国，亮这几个省。
import { ChinaSvg, HOME_COLOR, ProvinceSvg, STICKER_COLORS, UsSvg, type MapPin } from "@/components/travel-map-svg";
import chinaGeoFile from "@/lib/travel/geo/china.json";
import usGeoFile from "@/lib/travel/geo/us-ca.json";
import { PROVINCE_GEO_LOADERS } from "@/lib/travel/geo/index";
import type { ChinaGeo, UsGeo } from "@/lib/travel/geo-types";
import { PLACES, placeById, unitOf, type Trip, type Unit } from "@/lib/travel/model";

const CHINA = chinaGeoFile as ChinaGeo;
const US = usGeoFile as UsGeo;

export async function TravelTripMap({ trip }: { trip: Trip }) {
  const units = trip.placeIds.map(unitOf).filter((u): u is Unit => !!u);
  const tripPlaces = new Set(trip.placeIds);
  const homePlace = PLACES.find((p) => p.home);
  const color = STICKER_COLORS[0];
  const pin = (gp: { placeId: string; x: number; y: number }): MapPin => {
    const place = placeById(gp.placeId);
    return { ...gp, name: place?.name ?? "", home: place?.home, color: "#A85D43" };
  };
  const title = `这一次去的地方`;

  if (units.some((u) => u.kind === "us")) {
    const pins = US.pins.filter((p) => tripPlaces.has(p.placeId)).map(pin);
    return <figure className="travel-trip-map"><UsSvg geo={US} id={`trip-${trip.id}`} pins={pins} activePins={new Set(pins.map((p) => p.placeId))} title={title} /></figure>;
  }

  const provinces = [...new Set(units.map((u) => u.province).filter((x): x is string => !!x))];
  const municipal = provinces.length === 1 && units.every((u) => u.key === `cn:${provinces[0]}`);
  const load = provinces.length === 1 && !municipal ? PROVINCE_GEO_LOADERS[provinces[0]] : undefined;
  if (load) {
    const geo = await load();
    const lit = new Map<string, string>();
    const homeUnit = homePlace ? unitOf(homePlace.id) : undefined;
    for (const u of units) if (!u.home) lit.set(u.key.slice(3), color);
    // 城市本身亮了就不插旗（和旅行页一致），旗子只给城市里的小地方
    const isCityItself = (id: string) => { const u = unitOf(id); return !!u && u.name === placeById(id)?.name; };
    const pins = geo.pins.filter((p) => (tripPlaces.has(p.placeId) && !isCityItself(p.placeId)) || p.placeId === homePlace?.id).map(pin);
    return (
      <figure className="travel-trip-map">
        <ProvinceSvg geo={geo} id={`trip-${trip.id}`} lit={lit}
          homeUnit={homeUnit?.province === provinces[0] ? homeUnit.key.slice(3) : undefined}
          pins={pins} activePins={new Set(pins.filter((p) => tripPlaces.has(p.placeId)).map((p) => p.placeId))} title={title} />
      </figure>
    );
  }

  const lit = new Map<string, string>(provinces.map((p) => [p, color]));
  const homeProvince = homePlace ? unitOf(homePlace.id)?.province : undefined;
  if (homeProvince && !lit.has(homeProvince)) lit.set(homeProvince, HOME_COLOR);
  const home = CHINA.pins.find((p) => p.placeId === homePlace?.id);
  return <figure className="travel-trip-map"><ChinaSvg geo={CHINA} id={`trip-${trip.id}`} lit={lit} home={home} title={title} clouds={false} /></figure>;
}
