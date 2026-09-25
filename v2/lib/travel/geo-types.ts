// 迷雾地图底图的形状（由 scripts/travel-geo-build.mjs 生成到 lib/travel/geo/）。
export type GeoArea = { adcode: string; name: string; d: string; label: number[] };
export type GeoPin = { placeId: string; x: number; y: number };
export type ChinaGeo = {
  width: number; height: number; provinces: GeoArea[]; jd: string;
  inset: { x: number; y: number; w: number; h: number; provinces: string[]; hainanFine: string };
  pins: GeoPin[];
};
export type ProvinceGeo = { width: number; height: number; units: GeoArea[]; pins: GeoPin[] };
export type UsGeo = { width: number; height: number; outline: string; pins: GeoPin[] };
