#!/usr/bin/env node
// 迷雾地图的底图生成（旅行模块第 2 期，docs/travel-module-plan.md §5）。只在本机跑，产物随代码发布。
//
// 输入（原始边界，--raw 指向的目录，不进 Git）：
//   100000_full.json 与各「去过的省」的 <adcode>_full.json —— 阿里云 DataV GeoAtlas 行政区划边界
//     （https://geo.datav.aliyun.com/areas_v3/bound/<adcode>_full.json，标准地图数据，含台湾、港澳、南海诸岛与九段线）
//   states-10m.json —— us-atlas@3（美国人口普查局边界的 TopoJSON），只取加州
// 输出（lib/travel/geo/，进 Git）：
//   china.json      全国：省级区域路径、九段线、南海诸岛小图的取景框
//   <adcode>.json   每个去过的省：地级市路径、该省里去处的针脚
//   us-ca.json      加州轮廓与针脚
//   regions.json    每个去处落在哪个省、哪个地级市（点在多边形内判断，不猜）
//
// 页面不做任何投影或地理计算，只画这里算好的路径。简化容差故意偏大：Teddy 2026-09-25 要「可爱的风格，
// 不要像高德地图那么正式」，边线圆一点、细节少一点，读起来像手绘。
//   node scripts/travel-geo-build.mjs --raw .data/travel/geo-raw
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const option = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const RAW = path.resolve(option("--raw") ?? path.join(__dirname, "../.data/travel/geo-raw"));
const OUT = path.join(__dirname, "../lib/travel/geo");
const places = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/travel/places.json"), "utf8")).places;
const trips = JSON.parse(fs.readFileSync(path.join(__dirname, "../lib/travel/trips.json"), "utf8")).trips;
const readRaw = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), "utf8"));
fs.mkdirSync(OUT, { recursive: true });

// ── 几何小工具 ────────────────────────────────────────────────────────────────
const rad = Math.PI / 180;
// Albers 等积圆锥（中国常用：标准纬线 25°N、47°N，中央经线 105°E）
function albers(lon0 = 105, lat1 = 25, lat2 = 47) {
  const n = (Math.sin(lat1 * rad) + Math.sin(lat2 * rad)) / 2;
  const C = Math.cos(lat1 * rad) ** 2 + 2 * n * Math.sin(lat1 * rad);
  const rho = (lat) => Math.sqrt(C - 2 * n * Math.sin(lat * rad)) / n;
  const rho0 = rho(0);
  return ([lon, lat]) => { const t = n * (lon - lon0) * rad, r = rho(lat); return [r * Math.sin(t), -(rho0 - r * Math.cos(t))]; };
}
// 局部等距投影（省、加州这种尺度够用）
const local = (lonC, latC) => ([lon, lat]) => [(lon - lonC) * Math.cos(latC * rad), -(lat - latC)];

function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pointInFeature = (pt, f) => ringsOf(f.geometry).some((poly) => pointInRing(pt, poly[0]) && !poly.slice(1).some((hole) => pointInRing(pt, hole)));

function dp(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let idx = -1, max = 0;
    const [ax, ay] = points[a], [bx, by] = points[b]; const dx = bx - ax, dy = by - ay; const len = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * points[i][0] - dx * points[i][1] + bx * ay - by * ax) / len; if (d > max) { max = d; idx = i; } }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// 闭合环的首尾是同一个点，直接做 DP 会把整条线当成长度为零、只留两个端点。
// 先从离起点最远的点把环切成两段，各自简化再拼回去。
function simplifyRing(pts, tol) {
  const ring = pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1] ? pts.slice(0, -1) : pts;
  if (ring.length < 4) return ring;
  let far = 1, best = 0;
  for (let i = 1; i < ring.length; i++) { const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]); if (d > best) { best = d; far = i; } }
  const a = dp(ring.slice(0, far + 1), tol), b = dp([...ring.slice(far), ring[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

function makeFitter(projectedPts, width, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of projectedPts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const s = (width - 2 * pad) / (x1 - x0);
  const height = Math.round((y1 - y0) * s + 2 * pad);
  return { width, height, toPx: ([x, y]) => [(x - x0) * s + pad, (y - y0) * s + pad] };
}
const r1 = (v) => Math.round(v * 10) / 10;
function pathOf(geom, project, fit, tol, minArea = 0) {
  let d = "";
  for (const poly of ringsOf(geom)) for (const ring of poly) {
    const px = simplifyRing(ring.map((p) => fit.toPx(project(p))), tol);
    if (px.length < 3) continue;
    let area = 0; for (let i = 0, j = px.length - 1; i < px.length; j = i++) area += (px[j][0] + px[i][0]) * (px[j][1] - px[i][1]);
    if (Math.abs(area / 2) < minArea) continue;
    d += "M" + px.map(([x, y]) => `${r1(x)} ${r1(y)}`).join("L") + "Z";
  }
  return d;
}

// ── 1. 去处 → 省、地级市（点在多边形内） ─────────────────────────────────────────
const national = readRaw("100000_full.json");
const isProvince = (f) => /^\d{6}$/.test(String(f.properties.adcode));
const regions = {};
const cn = places.filter((p) => p.country === "CN" && (p.level === "city" || p.level === "spot"));
const provinceFiles = new Map();
for (const p of cn) {
  const prov = national.features.find((f) => isProvince(f) && pointInFeature([p.lng, p.lat], f));
  if (!prov) { regions[p.id] = { error: "不在任何省内" }; continue; }
  const code = String(prov.properties.adcode);
  if (!provinceFiles.has(code)) {
    const file = `${code}_full.json`;
    if (!fs.existsSync(path.join(RAW, file))) { regions[p.id] = { province: code, provinceName: prov.properties.name, error: `缺 ${file}` }; continue; }
    provinceFiles.set(code, readRaw(file));
  }
  const pref = provinceFiles.get(code).features.find((f) => pointInFeature([p.lng, p.lat], f));
  regions[p.id] = { province: code, provinceName: prov.properties.name, prefecture: pref ? String(pref.properties.adcode) : undefined, prefectureName: pref?.properties.name };
}
for (const p of places.filter((p) => p.country === "US" && (p.level === "city" || p.level === "spot"))) regions[p.id] = { state: "us-ca" };

// 只有被旅程用到、或者是家的地方才出针脚
const usedIds = new Set(trips.flatMap((t) => t.placeIds));
const homeId = places.find((p) => p.home)?.id;
const pinned = (p) => usedIds.has(p.id) || p.id === homeId;

// ── 2. 全国 ───────────────────────────────────────────────────────────────────
const proj = albers();
const mainland = [];
for (const f of national.features) for (const poly of ringsOf(f.geometry)) for (const [lon, lat] of poly[0]) if (lat >= 17.5) mainland.push(proj([lon, lat]));
const fitCN = makeFitter(mainland, 1000, 14);
const provinces = national.features.filter(isProvince).map((f) => {
  const [lx, ly] = fitCN.toPx(proj(f.properties.center ?? f.properties.centroid));
  return { adcode: String(f.properties.adcode), name: f.properties.name, d: pathOf(f.geometry, proj, fitCN, 1.6, 4), label: [r1(lx), r1(ly)] };
});
const jd = national.features.find((f) => String(f.properties.adcode).endsWith("_JD"));
const jdPath = pathOf(jd.geometry, proj, fitCN, 0.2);
// 南海诸岛小图：同一投影空间里取 105°–123°E、2.5°–24°N 这一块，页面缩小放在右下角
const box = [];
for (let lon = 105; lon <= 123; lon += 1) for (const lat of [2.5, 24]) box.push(fitCN.toPx(proj([lon, lat])));
const bx0 = Math.min(...box.map((p) => p[0])), bx1 = Math.max(...box.map((p) => p[0])), by0 = Math.min(...box.map((p) => p[1])), by1 = Math.max(...box.map((p) => p[1]));
const hainanFine = pathOf(national.features.find((f) => String(f.properties.adcode) === "460000").geometry, proj, fitCN, 0.15);
const pinCN = (p) => { const [x, y] = fitCN.toPx(proj([p.lng, p.lat])); return { placeId: p.id, x: r1(x), y: r1(y) }; };
fs.writeFileSync(path.join(OUT, "china.json"), JSON.stringify({
  _source: "DataV GeoAtlas 100000_full（标准地图数据，含南海诸岛与九段线），Albers 25°N/47°N/105°E，DP 简化 1.6px",
  width: fitCN.width, height: fitCN.height, provinces, jd: jdPath,
  inset: { x: r1(bx0), y: r1(by0), w: r1(bx1 - bx0), h: r1(by1 - by0), provinces: ["440000", "450000", "460000", "350000", "710000", "810000", "820000"], hainanFine },
  pins: cn.filter(pinned).map(pinCN),
}));

// ── 3. 每个去过的省：地级市 ──────────────────────────────────────────────────────
for (const [code, fc] of provinceFiles) {
  const feats = fc.features.filter((f) => f.geometry);
  const pts = feats.flatMap((f) => ringsOf(f.geometry).flatMap((poly) => poly[0]));
  const lonC = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
  const latC = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
  const pr = local(lonC, latC);
  const fit = makeFitter(pts.map(pr), 640, 18);
  const units = feats.map((f) => {
    const [lx, ly] = fit.toPx(pr(f.properties.center ?? f.properties.centroid));
    return { adcode: String(f.properties.adcode), name: f.properties.name, d: pathOf(f.geometry, pr, fit, 1.1, 6), label: [r1(lx), r1(ly)] };
  });
  const pins = cn.filter((p) => pinned(p) && regions[p.id]?.province === code).map((p) => { const [x, y] = fit.toPx(pr([p.lng, p.lat])); return { placeId: p.id, x: r1(x), y: r1(y) }; });
  fs.writeFileSync(path.join(OUT, `${code}.json`), JSON.stringify({ _source: `DataV GeoAtlas ${code}_full`, width: fit.width, height: fit.height, units, pins }));
}

// ── 4. 加州（us-atlas TopoJSON，手工解码 arcs） ─────────────────────────────────
const topo = readRaw("states-10m.json");
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * scale[0] + translate[0], y * scale[1] + translate[1]]; }); });
const arcPts = (i) => (i >= 0 ? arcs[i] : [...arcs[~i]].reverse());
const ringFrom = (idxs) => idxs.flatMap((i, k) => (k ? arcPts(i).slice(1) : arcPts(i)));
const ca = topo.objects.states.geometries.find((g) => g.id === "06");
const caGeom = ca.type === "Polygon" ? { type: "Polygon", coordinates: ca.arcs.map(ringFrom) } : { type: "MultiPolygon", coordinates: ca.arcs.map((poly) => poly.map(ringFrom)) };
const caPts = ringsOf(caGeom).flatMap((poly) => poly[0]);
const prCA = local(-119.5, 37);
const fitUS = makeFitter(caPts.map(prCA), 640, 18);
const us = places.filter((p) => p.country === "US" && (p.level === "city" || p.level === "spot") && pinned(p));
fs.writeFileSync(path.join(OUT, "us-ca.json"), JSON.stringify({
  _source: "us-atlas@3 states-10m（California, FIPS 06）", width: fitUS.width, height: fitUS.height,
  outline: pathOf(caGeom, prCA, fitUS, 1.1, 6),
  pins: us.map((p) => { const [x, y] = fitUS.toPx(prCA([p.lng, p.lat])); return { placeId: p.id, x: r1(x), y: r1(y) }; }),
}));

fs.writeFileSync(path.join(OUT, "regions.json"), JSON.stringify(regions, null, 1));
// 省地图按需加载的清单（地图点进某个省才下载那个省的路径）。多去了一个省：下载它的边界、重跑本脚本即可。
const codes = [...provinceFiles.keys()].sort();
fs.writeFileSync(path.join(OUT, "index.ts"), [
  "// 由 scripts/travel-geo-build.mjs 生成，不要手改。",
  'import type { ProvinceGeo } from "@/lib/travel/geo-types";',
  "",
  "export const PROVINCE_GEO_LOADERS: Record<string, () => Promise<ProvinceGeo>> = {",
  ...codes.map((c) => `  "${c}": () => import("./${c}.json").then((m) => (m.default ?? m) as ProvinceGeo),`),
  "};",
  "",
].join("\n"));
console.log(fs.readdirSync(OUT).map((f) => `${f} ${(fs.statSync(path.join(OUT, f)).size / 1024).toFixed(1)}KB`).join("\n"));
console.log(Object.entries(regions).map(([id, r]) => `${id}: ${r.provinceName ?? r.state ?? ""} ${r.prefectureName ?? ""} ${r.error ?? ""}`).join("\n"));
