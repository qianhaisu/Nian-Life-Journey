// DATA-0920-PHOTO-QUALITY-R1：线上到底在展示哪些照片（只读爬取）。
//
// 为什么不能只看库：库里「可投递」的候选有一万多张，但家人实际能看到的是另一回事——日页只放
// 当月内容里挑过的那几张，月相册按天展开，首页只有一张封面。把「候选」当成「在展示」会把清理
// 范围放大好几倍。所以这里按家人真实的浏览路径走一遍线上页面，把出现过的 /api/media/<id> 收集
// 起来，并记下它出现在哪一类位置（首页封面 / 月页 / 日页 / 月相册展开）。
//
// 全部是 GET，读只读边缘（nianlife.cn），不带凭据、不触发任何写入。输出写到仓库外私有目录。
//
//   node scripts/photo-quality-crawl.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "https://nianlife.cn";
const OUT_DIR = process.env.PHOTO_QUALITY_OUT ?? "C:/Users/teddy/NianlifeOps/photo-quality-2026-09-20";
const CONCURRENCY = Number(process.env.CRAWL_CONCURRENCY ?? 6);

const seen = new Map(); // mediaId -> { surfaces:Set, pages:Set }
const failures = [];

const note = (id, surface, page) => {
  if (!seen.has(id)) seen.set(id, { surfaces: new Set(), pages: new Set() });
  const entry = seen.get(id);
  entry.surfaces.add(surface);
  if (entry.pages.size < 8) entry.pages.add(page);
};

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "nianlife-photo-quality-audit" } });
  if (!res.ok) { failures.push({ url, status: res.status }); return null; }
  return res.text();
}

const MEDIA_RE = /\/api\/media\/([A-Za-z0-9_:.%-]+?)(?=[?"'\\ ])/g;
const collect = (text, surface, page) => {
  for (const m of text.matchAll(MEDIA_RE)) note(decodeURIComponent(m[1]), surface, page);
};

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      await worker(item);
    }
  }));
}

// —— 1. 首页 ——
const home = await get(`${BASE}/`);
if (home) collect(home, "home", "/");

// —— 2. /memory 索引 → 年 → 月 ——
const index = await get(`${BASE}/memory`);
if (index) collect(index, "memory-index", "/memory");
const monthHrefs = new Set();
for (const text of [home ?? "", index ?? ""]) {
  for (const m of text.matchAll(/\/memory\/(\d{4})\/(\d{2})(?![\d/])/g)) monthHrefs.add(`${m[1]}/${m[2]}`);
}
// 年页也可能只在那里才列出某些月份
const years = new Set([...monthHrefs].map((v) => v.slice(0, 4)));
await pool([...years], async (year) => {
  const text = await get(`${BASE}/memory/${year}`);
  if (!text) return;
  collect(text, "year", `/memory/${year}`);
  for (const m of text.matchAll(/\/memory\/(\d{4})\/(\d{2})(?![\d/])/g)) monthHrefs.add(`${m[1]}/${m[2]}`);
});

// —— 3. 每个月页 + 月相册（按天展开，家人点「这个月的日子」看到的就是它）——
const dayHrefs = new Set();
await pool([...monthHrefs], async (ym) => {
  const [year, month] = ym.split("/");
  const page = await get(`${BASE}/memory/${year}/${month}`);
  if (page) {
    collect(page, "month", `/memory/${ym}`);
    for (const m of page.matchAll(/\/memory\/(\d{4})\/(\d{2})\/(\d{2})/g)) dayHrefs.add(`${m[1]}/${m[2]}/${m[3]}`);
  }
  const listing = await get(`${BASE}/api/memory/${year}/${month}/album`);
  if (!listing) return;
  let days = [];
  try { days = JSON.parse(listing).days ?? []; } catch { failures.push({ url: `album ${ym}`, status: "bad-json" }); return; }
  await pool(days.map((d) => (typeof d === "string" ? d : d.day)).filter(Boolean), async (day) => {
    const album = await get(`${BASE}/api/memory/${year}/${month}/album?day=${day}`);
    if (album) collect(album, "month-album", `/memory/${ym} album ${day}`);
  });
});

// —— 4. 每个有独立地址的日页 ——
await pool([...dayHrefs], async (ymd) => {
  const text = await get(`${BASE}/memory/${ymd}`);
  if (text) collect(text, "day", `/memory/${ymd}`);
});

// —— 5. 其他会出照片的页面 ——
for (const route of ["/archive", "/timeline", "/about"]) {
  const text = await get(`${BASE}${route}`);
  if (text) collect(text, route.slice(1), route);
}

mkdirSync(OUT_DIR, { recursive: true });
const entries = [...seen].map(([id, v]) => ({ id, surfaces: [...v.surfaces], pages: [...v.pages] }));
writeFileSync(path.join(OUT_DIR, "displayed.json"), JSON.stringify({
  generatedAt: new Date().toISOString(), base: BASE,
  months: [...monthHrefs].sort(), dayPages: [...dayHrefs].sort(),
  failures, total: entries.length, entries,
}, null, 1));

const bySurface = {};
for (const e of entries) for (const s of e.surfaces) bySurface[s] = (bySurface[s] ?? 0) + 1;
console.log(`月份 ${monthHrefs.size}，日页 ${dayHrefs.size}，抓取失败 ${failures.length}`);
console.log(`线上实际引用到的不同照片: ${entries.length}`);
console.table(Object.entries(bySurface).map(([surface, n]) => ({ surface, n })));
console.log(`明细写入 ${path.join(OUT_DIR, "displayed.json")}`);
