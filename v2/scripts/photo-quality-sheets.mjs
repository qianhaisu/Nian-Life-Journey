// DATA-0920-PHOTO-QUALITY-R1：把候选照片拉下来拼成联系表（contact sheet），供人眼复核。
//
// 验收明确要求「候选要看过，不能只凭一个清晰度阈值批量删」。所以候选清单出来之后必须有这一步：
// 把每一张按**线上真正投递的那个 web 变体**下载下来，按原始像素拼进联系表，看到的就是家人点开
// 大图时能拿到的全部信息量。小图在联系表里会明显比同表的大图糊、比自己的格子小。
//
// 图片只写到仓库外的私有目录，不进 Git；联系表文件名只含批次序号，不含任何家庭信息。
//
//   node scripts/photo-quality-sheets.mjs --set=small     短边 < 240 的候选
//   node scripts/photo-quality-sheets.mjs --set=band      240-719 中间带（逐张看）
//   node scripts/photo-quality-sheets.mjs --set=softbig   >=720 但 sharpness 最低的一批
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = process.env.PHOTO_QUALITY_OUT ?? "C:/Users/teddy/NianlifeOps/photo-quality-2026-09-20";
const BASE = process.env.BASE ?? "https://nianlife.cn";
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const SET = arg("set", "small");
const CONCURRENCY = Number(arg("concurrency", "8"));
const TILE = Number(arg("tile", "160"));
const COLS = Number(arg("cols", "10"));
const ROWS = Number(arg("rows", "10"));

const audit = JSON.parse(readFileSync(path.join(OUT_DIR, "audit.json"), "utf8"));
const displayed = JSON.parse(readFileSync(path.join(OUT_DIR, "displayed.json"), "utf8"));
const byId = new Map(audit.entries.map((e) => [e.id, e]));
const shownIds = new Set(displayed.entries.map((e) => e.id));
const shortSide = (e) => (e.web?.width && e.web?.height ? Math.min(e.web.width, e.web.height) : Math.min(e.assetWidth ?? 0, e.assetHeight ?? 0));

// 归一化清晰度（scripts/photo-quality-focus.mjs 产出）。不用 data/photo-quality.json 的数值排序：
// 那份是各自原尺寸上算的，跨尺寸不可比，详见 focus 脚本顶部说明。
let quality = {};
const focusPath = path.join(OUT_DIR, "focus.json");
if (existsSync(focusPath)) quality = JSON.parse(readFileSync(focusPath, "utf8")).scores ?? {};

const shown = audit.entries.filter((e) => shownIds.has(e.id));
let targets;
if (SET === "small") targets = shown.filter((e) => shortSide(e) < 240);
// 边界带：刚好在门槛之上、但还没到「正常大图」的那些。数量很少，逐张看，不靠抽样。
else if (SET === "band") targets = shown.filter((e) => shortSide(e) >= Number(arg("from", "160")) && shortSide(e) < Number(arg("to", "720")));
else if (SET === "softbig") {
  targets = shown
    .filter((e) => shortSide(e) >= 720 && quality[e.id]?.sharpness !== undefined)
    .sort((a, b) => quality[a.id].sharpness - quality[b.id].sharpness)
    .slice(0, Number(arg("top", "200")));
} else throw new Error(`unknown --set=${SET}`);
targets.sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));

const imgDir = path.join(OUT_DIR, "images", SET);
mkdirSync(imgDir, { recursive: true });

const fileFor = (id) => path.join(imgDir, `${id.replace(/[^A-Za-z0-9]/g, "_")}.webp`);
let fetched = 0; let cached = 0; const failed = [];
async function ensure(entry) {
  const file = fileFor(entry.id);
  if (existsSync(file)) { cached += 1; return file; }
  const res = await fetch(`${BASE}/api/media/${encodeURIComponent(entry.id)}?variant=web`, { headers: { "User-Agent": "nianlife-photo-quality-audit" } });
  if (!res.ok) { failed.push({ id: entry.id, status: res.status }); return null; }
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  fetched += 1;
  return file;
}

let i = 0;
const files = new Array(targets.length).fill(null);
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
  while (i < targets.length) { const idx = i++; files[idx] = await ensure(targets[idx]); }
}));
console.log(`目标 ${targets.length} 张：新下载 ${fetched}，已缓存 ${cached}，失败 ${failed.length}`);

// —— 拼联系表：每格按原始像素居中贴，不放大，所以小图在格子里就是小的，一眼看得出信息量 ——
const perSheet = COLS * ROWS;
const sheetDir = path.join(OUT_DIR, "sheets");
mkdirSync(sheetDir, { recursive: true });
const manifestRows = [];
for (let s = 0; s * perSheet < targets.length; s += 1) {
  const slice = targets.slice(s * perSheet, (s + 1) * perSheet);
  const composites = [];
  for (let k = 0; k < slice.length; k += 1) {
    const file = files[s * perSheet + k];
    if (!file) continue;
    const col = k % COLS; const row = Math.floor(k / COLS);
    const meta = await sharp(file).metadata();
    // 不放大：比格子大的缩到格子里，比格子小的保持原样居中——两种情况都如实反映像素量。
    const buffer = (meta.width > TILE || meta.height > TILE)
      ? await sharp(file).resize(TILE, TILE, { fit: "inside" }).png().toBuffer()
      : await sharp(file).png().toBuffer();
    const m2 = await sharp(buffer).metadata();
    composites.push({ input: buffer, left: col * TILE + Math.floor((TILE - m2.width) / 2), top: row * TILE + Math.floor((TILE - m2.height) / 2) });
    manifestRows.push({ sheet: s + 1, cell: k + 1, id: slice[k].id, takenAt: slice[k].takenAt, px: `${slice[k].web?.width ?? slice[k].assetWidth}x${slice[k].web?.height ?? slice[k].assetHeight}`, sharpness: quality[slice[k].id]?.sharpness ?? null });
  }
  const out = path.join(sheetDir, `${SET}-${String(s + 1).padStart(2, "0")}.png`);
  await sharp({ create: { width: COLS * TILE, height: ROWS * TILE, channels: 3, background: { r: 24, g: 24, b: 26 } } })
    .composite(composites).png().toFile(out);
  console.log(`联系表 ${out}（${composites.length} 格）`);
}
writeFileSync(path.join(OUT_DIR, `sheets-${SET}.json`), JSON.stringify({ set: SET, tile: TILE, cols: COLS, rows: ROWS, total: targets.length, failed, cells: manifestRows }, null, 1));
console.log(`格位对照表写入 sheets-${SET}.json`);
