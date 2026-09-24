#!/usr/bin/env node
// 旅程候选（旅行模块第 0 期，docs/travel-module-plan.md §6 的 A 步）。
//
// 本地程序只做一件事：把「可能离开了杭州」的日子找出来、并成窗口、把证据摆在一起，写成给人看的候选表。
// 它不判断一次出行是否成立——那是模型（B 步）和 Teddy（D 步）的事。三种证据分开列：
//   geo      当天有带坐标的照片落在杭州市区框（lib/travel/places.json homeZone）之外   ← 最硬
//   arrival  家人当天说了「到了 / 落地 / 到家 / 回杭州了」这类已发生的话（原句 + 时间）
//   text     月度正文（标题 / 段落）里出现地名册里的地名或交通词                     ← 最软
// 「要去 / 打算 / 想去 / 商量」这类未来时的话单独标 plan，提醒读的人这可能只是提议（合肥的教训，
// Teddy 2026-09-24：「这只是对话里的提议，并没有真的去」）。
//
//   node --import tsx scripts/editor/travel-candidates.mjs --content-dir <月内容目录> [--out <目录>]
//   （经 .data/run-on-rds.mjs 跑，才读得到 media_geo 和 raw_sources；只读，不写库）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const CONTENT_DIR = option("--content-dir");
const OUT_DIR = option("--out") ?? path.resolve(__dirname, "../../.data/travel");
const STAMP = new Date().toISOString().slice(0, 10).replace(/-/g, "");
if (!CONTENT_DIR || !fs.existsSync(CONTENT_DIR)) { console.error("--content-dir <月内容目录> 是必需的"); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required (经 .data/run-on-rds.mjs 跑)"); process.exit(2); }

const gazetteer = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../lib/travel/places.json"), "utf8"));
const HOME = gazetteer.homeZone;
const PLACES = gazetteer.places.filter((p) => p.level === "city" || p.level === "spot");
const inHome = (lat, lng) => lat >= HOME.latMin && lat <= HOME.latMax && lng >= HOME.lngMin && lng <= HOME.lngMax;
const km = (a, b, c, d) => { const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r; const s = Math.sin(x / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) ** 2; return 12742 * Math.asin(Math.sqrt(s)); };
const nearest = (lat, lng) => {
  let best = null;
  for (const p of PLACES) { const d = km(lat, lng, p.lat, p.lng); if (!best || d < best.d) best = { p, d }; }
  return best && best.d <= 60 ? { id: best.p.id, name: best.p.name, km: Math.round(best.d) } : { id: "unknown-place", name: `未知(${lat.toFixed(2)},${lng.toFixed(2)})`, km: 0 };
};

// 地名词 → place id（只认地名册里的别名；「熊猫」「飞机」这种不进地名册，因为误报太多）
const aliasIndex = [];
for (const p of PLACES) for (const a of p.aliases ?? []) if (!(p.home && a === "回杭")) aliasIndex.push({ alias: a, id: p.id, name: p.name, home: !!p.home });
aliasIndex.sort((a, b) => b.alias.length - a.alias.length);
const TRANSPORT = /(高铁|动车|火车|飞机|机场|航班|登机|起飞|落地|酒店|民宿|露营|回杭)/g;
// 只认明确「人不在杭州家里」的说法。「到家了」「出发了」是每天接送托班也会说的话，2026-09-24 第一次跑
// 时它们把 82 个窗口里的 32 个撑成了假的 arrival，所以不认。
const ARRIVAL = /(落地|回到杭州|回杭州了|到杭州了|到酒店|在酒店|住酒店|民宿|在机场|到机场|在飞机上|在高铁上|上飞机了|登机了|起飞了|出发去|到(温州|西安|上海|苏州|南京|宁波|成都|绍兴|安吉|德清|莫干山|千岛湖|兰溪|舟山|嘉兴|广州|深圳)了)/;
const PLAN = /(要去|打算|想去|准备去|计划|商量|下周|下个月|国庆|过年去|要不要去)/;

const addDay = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── 1. 月度正文：每一天的标题 + 段落里的地名与交通词 ───────────────────────────────
const textHits = new Map(); // day → { title, places:Set, transport:Set, planLines:[], kind }
const contentDays = new Map();
for (const file of fs.readdirSync(CONTENT_DIR).filter((n) => /^\d{4}-\d{2}\.json$/.test(n)).sort()) {
  const month = JSON.parse(fs.readFileSync(path.join(CONTENT_DIR, file), "utf8"));
  for (const d of month.days ?? []) {
    contentDays.set(d.day, d);
    const text = [d.title ?? "", ...(d.paragraphs ?? [])].join("\n");
    const places = new Set();
    for (const a of aliasIndex) if (!a.home && text.includes(a.alias)) places.add(a.id);
    const transport = new Set((text.match(TRANSPORT) ?? []));
    const planLines = text.split(/[。\n]/).filter((s) => PLAN.test(s) && (aliasIndex.some((a) => !a.home && s.includes(a.alias)) || /去.*玩|出游|旅/.test(s))).map((s) => s.trim()).slice(0, 3);
    if (places.size || transport.size) textHits.set(d.day, { title: d.title, places, transport, planLines, kind: d.kind, mediaCount: (d.expandedMediaIds ?? []).length });
  }
}

// ── 2. 库：带坐标的照片，按上海日期聚 ─────────────────────────────────────────────
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const geoRows = (await client.query(`
  select to_char(ma.taken_at at time zone 'Asia/Shanghai','YYYY-MM-DD') as day, g.latitude as lat, g.longitude as lng, g.media_asset_id as asset
  from media_geo g join media_assets ma on ma.id = g.media_asset_id where ma.taken_at is not null order by 1`)).rows;
const geoDays = new Map(); // day → { outside:[{lat,lng}], home:n }
for (const r of geoRows) {
  const e = geoDays.get(r.day) ?? { outside: [], home: 0 };
  if (inHome(r.lat, r.lng)) e.home++; else e.outside.push({ lat: r.lat, lng: r.lng, asset: r.asset });
  geoDays.set(r.day, e);
}

// ── 3. 并窗口：正文命中或当天有 ≥2 张市区外照片的日子；相邻（间隔 ≤1 天）合并 ─────────
const flagged = new Set([...textHits.keys(), ...[...geoDays].filter(([, e]) => e.outside.length >= 2).map(([d]) => d)]);
const days = [...flagged].sort();
const windows = [];
for (const day of days) {
  const last = windows[windows.length - 1];
  if (last && addDay(last.to, 1) >= day) last.to = day; else windows.push({ from: day, to: day });
}
for (const w of windows) { w.days = []; for (let d = w.from; d <= w.to; d = addDay(d, 1)) w.days.push(d); }

// ── 4. 每个窗口的「已发生」原话：只查窗口内的日子，按 captured_at 有界 ─────────────────
const allDays = windows.flatMap((w) => w.days);
const quoteRows = allDays.length ? (await client.query(`
  select to_char(captured_at at time zone 'Asia/Shanghai','YYYY-MM-DD') as day, to_char(captured_at at time zone 'Asia/Shanghai','HH24:MI') as t, left(text, 80) as text
  from raw_sources where deleted_at is null and text is not null and length(text) between 2 and 200
    and to_char(captured_at at time zone 'Asia/Shanghai','YYYY-MM-DD') = any($1)
    and text ~ $2 order by captured_at`, [allDays, ARRIVAL.source])).rows : [];
const quotesByDay = new Map();
for (const q of quoteRows) { const list = quotesByDay.get(q.day) ?? []; if (list.length < 4) list.push(q); quotesByDay.set(q.day, list); }
await client.end();

// ── 5. 汇总 ──────────────────────────────────────────────────────────────────────
const candidates = windows.map((w) => {
  const geo = [];
  const placeCount = new Map();
  for (const d of w.days) {
    const e = geoDays.get(d);
    if (!e || !e.outside.length) continue;
    const lat = e.outside.reduce((s, p) => s + p.lat, 0) / e.outside.length, lng = e.outside.reduce((s, p) => s + p.lng, 0) / e.outside.length;
    const near = nearest(lat, lng);
    geo.push({ day: d, photosOutside: e.outside.length, photosHome: e.home, near });
    placeCount.set(near.id, (placeCount.get(near.id) ?? 0) + e.outside.length);
  }
  const textPlaces = new Set(), transport = new Set(), planLines = [], titles = [];
  for (const d of w.days) {
    const t = textHits.get(d);
    if (!t) continue;
    for (const p of t.places) textPlaces.add(p);
    for (const x of t.transport) transport.add(x);
    planLines.push(...t.planLines.map((s) => `${d}：${s}`));
    titles.push(`${d}${t.title ? `「${t.title}」` : "（无题）"}`);
  }
  const arrivals = w.days.flatMap((d) => (quotesByDay.get(d) ?? []).map((q) => `${d} ${q.t}「${q.text.replace(/\s+/g, " ")}」`));
  const evidence = [geo.length ? "geo" : null, arrivals.length ? "arrival" : null, textPlaces.size || transport.size ? "text" : null].filter(Boolean);
  const nameOf = (id) => PLACES.find((p) => p.id === id)?.name ?? id;
  return { from: w.from, to: w.to, nights: w.days.length - 1, evidence, geoPlaces: [...placeCount].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${nameOf(id)}×${n}`), textPlaces: [...textPlaces].map(nameOf), transport: [...transport], titles, arrivals, planLines, geo };
});

// 三档：A = 有市区外坐标（某天 ≥3 张，或多天各 ≥2 张）；B = 有明确离家原话 + 正文地名/交通词；C = 其余（只有正文地名，或只有计划语）。
// C 档默认不成行，只作附录。
for (const c of candidates) {
  const geoStrong = c.geo.some((g) => g.photosOutside >= 3) || c.geo.length >= 2;
  c.tier = geoStrong ? "A" : c.evidence.includes("arrival") && (c.textPlaces.length || c.transport.length) ? "B" : "C";
  c.verdictHint = c.tier === "A" ? "有坐标：大概率成行" : c.tier === "B" ? "有离家原话：看原句" : c.planLines.length && !c.transport.length ? "只有计划语：可能没成行" : "只有正文地名：默认不算";
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, `travel-candidates-${STAMP}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), contentDir: CONTENT_DIR, homeZone: HOME, candidates }, null, 1), "utf8");

const L = [`# 旅程候选 ${STAMP}`, "", `来源：月度正文 ${contentDays.size} 天、带坐标照片 ${geoRows.length} 张（市区框外 ${[...geoDays.values()].reduce((s, e) => s + e.outside.length, 0)} 张）。`,
  "证据：**geo** = 当天有市区外坐标照片；**arrival** = 家人说了「到了/落地/回杭州了」；**text** = 正文有地名或交通词。", "「提议 ≠ 成行」：只有 text 且是计划语的，默认不算。", "", ""];
for (const tier of ["A", "B", "C"]) {
  L.push(`## ${tier} 档（${tier === "A" ? "有市区外坐标照片" : tier === "B" ? "有明确离家原话" : "只有正文线索，默认不算"}）`, "", "| # | 起止 | 证据 | 坐标指向 | 正文地名 | 交通词 | 初判 |", "|---|---|---|---|---|---|---|");
  candidates.forEach((c, i) => { if (c.tier === tier) L.push(`| ${i + 1} | ${c.from}${c.to !== c.from ? ` → ${c.to}` : ""} | ${c.evidence.join("+") || "—"} | ${c.geoPlaces.join("、") || "—"} | ${c.textPlaces.join("、") || "—"} | ${c.transport.join("、") || "—"} | ${c.verdictHint} |`); });
  L.push("");
}
L.push("", "## 逐条证据（A、B 档）", "");
candidates.forEach((c, i) => {
  if (c.tier === "C") return;
  L.push(`### ${i + 1}. ${c.from}${c.to !== c.from ? ` → ${c.to}` : ""}（${c.verdictHint}）`, "");
  if (c.geo.length) L.push("坐标：", ...c.geo.map((g) => `- ${g.day}：市区外 ${g.photosOutside} 张，市区内 ${g.photosHome} 张，最近 ${g.near.name}${g.near.km ? `（${g.near.km} km）` : ""}`));
  if (c.arrivals.length) L.push("到达/出发原话：", ...c.arrivals.map((a) => `- ${a}`));
  if (c.titles.length) L.push("正文标题：", ...c.titles.map((t) => `- ${t}`));
  if (c.planLines.length) L.push("计划语（可能只是提议）：", ...c.planLines.map((p) => `- ${p}`));
  L.push("");
});
fs.writeFileSync(path.join(OUT_DIR, `travel-candidates-${STAMP}.md`), L.join("\n"), "utf8");
console.log(JSON.stringify({ contentDays: contentDays.size, geoPhotos: geoRows.length, windows: candidates.length, byTier: candidates.reduce((m, c) => { m[c.tier] = (m[c.tier] ?? 0) + 1; return m; }, {}), byEvidence: candidates.reduce((m, c) => { const k = c.evidence.join("+") || "none"; m[k] = (m[k] ?? 0) + 1; return m; }, {}), out: OUT_DIR }, null, 1));
