// 由 scripts/travel-geo-build.mjs 生成，不要手改。
import type { ProvinceGeo } from "@/lib/travel/geo-types";

export const PROVINCE_GEO_LOADERS: Record<string, () => Promise<ProvinceGeo>> = {
  "310000": () => import("./310000.json").then((m) => (m.default ?? m) as ProvinceGeo),
  "320000": () => import("./320000.json").then((m) => (m.default ?? m) as ProvinceGeo),
  "330000": () => import("./330000.json").then((m) => (m.default ?? m) as ProvinceGeo),
  "510000": () => import("./510000.json").then((m) => (m.default ?? m) as ProvinceGeo),
  "610000": () => import("./610000.json").then((m) => (m.default ?? m) as ProvinceGeo),
};
