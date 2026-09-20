// DATA-0920-PHOTO-QUALITY-R1/R2：闸门开起来之后，家人少看见什么？（纯本地计算，不连库不连网）
//
// 「统一去掉」这句话的代价必须先算清楚再交付：按月少多少张，多少个日页会一张照片都不剩。判定用
// 的是线上闸门的同一条规则（lib/media-quality.ts），不在这里另写一份阈值——两份阈值早晚会分叉。
//
// 输入：audit.json（库里三层尺寸）、displayed.json（线上实际展示）。输出：impact.json + 终端汇总。
//
//   node --import tsx scripts/photo-quality-impact.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { photoQualityTier, READABLE_MIN_SHORT_SIDE } from "../lib/media-quality.ts";

const OUT_DIR = process.env.PHOTO_QUALITY_OUT ?? "C:/Users/teddy/NianlifeOps/photo-quality-2026-09-20";
const audit = JSON.parse(readFileSync(path.join(OUT_DIR, "audit.json"), "utf8"));
const displayed = JSON.parse(readFileSync(path.join(OUT_DIR, "displayed.json"), "utf8"));
const byId = new Map(audit.entries.map((e) => [e.id, e]));

const evidenceOf = (e) => ({
  type: "photo",
  width: e.displayWidth, height: e.displayHeight,
  asset: { width: e.assetWidth, height: e.assetHeight },
  locations: [e.web, e.thumbnail].filter(Boolean),
});
const tierOf = (e) => {
  const tier = photoQualityTier(evidenceOf(e));
  return tier === "readable" || tier === "unknown" ? null : tier;
};

const dayOf = (page) => /\/memory\/(\d{4})\/(\d{2})\/(\d{2})$/.exec(page ?? "");
const perDay = new Map();
const shown = [];
for (const d of displayed.entries) {
  const entry = byId.get(d.id);
  if (!entry) continue; // 视频：本规则不管
  shown.push({ ...entry, surfaces: d.surfaces, pages: d.pages });
  for (const page of d.pages) {
    const m = dayOf(page);
    if (!m) continue;
    const key = `${m[1]}-${m[2]}-${m[3]}`;
    if (!perDay.has(key)) perDay.set(key, []);
    perDay.get(key).push(entry.id);
  }
}

const TIER_LABELS = {
  thumbnail_only: "短边 <=120（被举报的 90×120 在这一档）",
  below_grid_floor: `短边 121-${READABLE_MIN_SHORT_SIDE - 1}（主要是 157×210 的托班转发图）`,
};
const report = { generatedAt: new Date().toISOString(), shownPhotos: shown.length, tiers: {}, months: {}, emptiedDays: {} };

for (const tier of Object.keys(TIER_LABELS)) {
  const set = shown.filter((e) => tierOf(e) === tier);
  report.tiers[tier] = { label: TIER_LABELS[tier], count: set.length, subjectApproved: set.filter((e) => e.subjectDecision === "approved").length, neverReviewed: set.filter((e) => !e.subjectDecision).length };
}

const months = new Map();
for (const e of shown) {
  const m = String(e.takenAt ?? "").slice(0, 7);
  if (!months.has(m)) months.set(m, { total: 0, thumbnail_only: 0, below_grid_floor: 0 });
  const bucket = months.get(m);
  bucket.total += 1;
  const tier = tierOf(e);
  if (tier) bucket[tier] += 1;
}
report.months = Object.fromEntries([...months].sort());

for (const [name, drop] of [["仅 thumbnail_only", new Set(["thumbnail_only"])], ["全部（短边 <160）", new Set(["thumbnail_only", "below_grid_floor"])]]) {
  let emptied = 0; let reduced = 0;
  const emptiedList = [];
  for (const [day, ids] of perDay) {
    const kept = ids.filter((id) => { const t = tierOf(byId.get(id)); return !t || !drop.has(t); });
    if (kept.length === 0 && ids.length > 0) { emptied += 1; emptiedList.push({ day, had: ids.length }); }
    else if (kept.length < ids.length) reduced += 1;
  }
  report.emptiedDays[name] = { dayPagesWithPhotos: perDay.size, emptied, reduced, emptiedList: emptiedList.sort((a, b) => a.day.localeCompare(b.day)) };
}

writeFileSync(path.join(OUT_DIR, "impact.json"), JSON.stringify(report, null, 1));

console.log(`线上展示的照片（不含视频）: ${shown.length}`);
for (const [tier, v] of Object.entries(report.tiers)) console.log(`  ${tier} ${v.label}: ${v.count} 张（主体已 approved ${v.subjectApproved}，从未核验 ${v.neverReviewed}）`);
console.log("\n按月（total = 该月线上展示的照片数）:");
console.log("月份     total   <=120  121-159   闸门后剩");
for (const [m, v] of Object.entries(report.months)) {
  console.log(`${m}  ${String(v.total).padStart(6)}${String(v.thumbnail_only).padStart(8)}${String(v.below_grid_floor).padStart(9)}${String(v.total - v.thumbnail_only - v.below_grid_floor).padStart(11)}`);
}
console.log(`\n日页影响（有照片的日页共 ${perDay.size} 个）:`);
for (const [name, v] of Object.entries(report.emptiedDays)) console.log(`  ${name}: ${v.emptied} 个日页会一张照片都不剩（文字与历史仍在），${v.reduced} 个日页变少`);
console.log(`\n明细写入 ${path.join(OUT_DIR, "impact.json")}`);
