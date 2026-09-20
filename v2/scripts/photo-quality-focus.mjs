// DATA-0920-PHOTO-QUALITY-R1：够大但拍糊的照片，单独扫一遍（只读）。
//
// 尺寸只能解释一种糊：源图本来就只有缩略图那么大。另一种是源图够大但当时手抖/失焦，家人点开
// 同样会觉得「这张怎么这么糊」。这两种要分开算，因为处置不同——前者永远救不回来，后者只是这一
// 张拍坏了。
//
// 为什么不直接用 data/photo-quality.json 里现成的 sharpness：那份缓存是在**各自原尺寸**的 web
// 变体上算的，而 sharp 的 sharpness 随分辨率变化很大（实测同一天：90×120 的小图 3.82，
// 1080×1254 的清楚大图只有 1.68）。拿它跨尺寸排序会把最清楚的大图排到最糊的位置。所以这里全部
// 先归一化到同一个短边再算，数值才可比。缓存仍然保留，只是不作跨尺寸比较用。
//
// 只下载 thumbnail 变体（几十 KB），不碰原图，不写库，不调模型。
//
//   node scripts/photo-quality-focus.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const OUT_DIR = process.env.PHOTO_QUALITY_OUT ?? "C:/Users/teddy/NianlifeOps/photo-quality-2026-09-20";
const BASE = process.env.BASE ?? "https://nianlife.cn";
const NORMALIZED_SHORT_SIDE = Number(process.env.FOCUS_SHORT_SIDE ?? 360);
const CONCURRENCY = Number(process.env.FOCUS_CONCURRENCY ?? 8);

const audit = JSON.parse(readFileSync(path.join(OUT_DIR, "audit.json"), "utf8"));
const displayed = JSON.parse(readFileSync(path.join(OUT_DIR, "displayed.json"), "utf8"));
const byId = new Map(audit.entries.map((e) => [e.id, e]));
const shortSide = (e) => (e.web?.width && e.web?.height ? Math.min(e.web.width, e.web.height) : Math.min(e.assetWidth ?? 0, e.assetHeight ?? 0));

const targets = displayed.entries
  .map((d) => byId.get(d.id))
  .filter((e) => e && shortSide(e) >= 240);

const cacheDir = path.join(OUT_DIR, "images", "focus");
mkdirSync(cacheDir, { recursive: true });
const fileFor = (id) => path.join(cacheDir, `${id.replace(/[^A-Za-z0-9]/g, "_")}.webp`);

const scores = {};
const failed = [];
let done = 0;
let i = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
  while (i < targets.length) {
    const entry = targets[i++];
    const file = fileFor(entry.id);
    try {
      if (!existsSync(file)) {
        const res = await fetch(`${BASE}/api/media/${encodeURIComponent(entry.id)}?variant=thumbnail`, { headers: { "User-Agent": "nianlife-photo-quality-audit" } });
        if (!res.ok) { failed.push({ id: entry.id, status: res.status }); continue; }
        writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      }
      const meta = await sharp(file).metadata();
      const scale = NORMALIZED_SHORT_SIDE / Math.min(meta.width, meta.height);
      const normalized = scale < 1
        ? sharp(file).resize({ width: Math.round(meta.width * scale), height: Math.round(meta.height * scale) })
        : sharp(file);
      const stats = await normalized.clone().stats();
      scores[entry.id] = {
        sharpness: Number((stats.sharpness ?? 0).toFixed(3)),
        entropy: Number((stats.entropy ?? 0).toFixed(3)),
        thumbShort: Math.min(meta.width, meta.height),
        sourceShort: shortSide(entry),
      };
    } catch (error) {
      failed.push({ id: entry.id, status: String(error?.message ?? error) });
    }
    done += 1;
    if (done % 500 === 0) console.log(`  …${done}/${targets.length}`);
  }
}));

writeFileSync(path.join(OUT_DIR, "focus.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  method: `thumbnail 变体统一缩到短边 ${NORMALIZED_SHORT_SIDE}px 后 sharp.stats()，跨尺寸可比`,
  scope: "线上展示中短边 >= 240 的照片",
  total: targets.length, scanned: Object.keys(scores).length, failed,
  scores,
}, null, 1));

const values = Object.entries(scores).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.sharpness - b.sharpness);
const quantile = (q) => values[Math.floor(q * (values.length - 1))]?.sharpness;
console.log(`\n目标 ${targets.length}，扫描成功 ${values.length}，失败 ${failed.length}`);
console.log(`归一化 sharpness 分位: p1=${quantile(0.01)} p5=${quantile(0.05)} p10=${quantile(0.1)} p50=${quantile(0.5)} p90=${quantile(0.9)}`);
for (const cut of [0.3, 0.4, 0.5, 0.6, 0.8]) console.log(`  sharpness < ${cut}: ${values.filter((v) => v.sharpness < cut).length} 张`);
console.log(`明细写入 ${path.join(OUT_DIR, "focus.json")}`);
