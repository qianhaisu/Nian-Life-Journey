// DATA-0920-PHOTO-QUALITY-R1/R2：闸门开起来之后，线上会少掉哪些照片（纯本地计算，不连库不连网）。
//
// 这份清单不是「待写入的审核决定」。撤下完全由代码里的闸门完成（lib/media-quality.ts +
// lib/media/deliverability.ts），数据库一行不写、主体账本一行不动、原件一个字节不删。清单的用处
// 只有两个：
//   1. 上线前的 dry-run —— 在不部署的情况下，逐张看清楚闸门会让哪些照片离开阅读面；
//   2. 回滚对照 —— 回滚就是把那段代码改回去，改回去之后应当**恰好**是这份清单里的照片重新出现。
//      没有账本行要撤，没有数据要还原，所以清单是核对回滚是否干净的唯一依据。
//
// 判定用的证据和线上闸门完全一致：展示层 media 行、media_assets 源尺寸、每条派生图尺寸，取其中
// 最大的短边。任何一层证明这张图够大，就不撤。
//
//   node --import tsx scripts/photo-quality-manifest.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { photoQualityTier, photoQualityReasonCodes, bestKnownShortSide, READABLE_MIN_SHORT_SIDE } from "../lib/media-quality.ts";

const OUT_DIR = process.env.PHOTO_QUALITY_OUT ?? "C:/Users/teddy/NianlifeOps/photo-quality-2026-09-20";
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const TIER = arg("tier", "all");

const audit = JSON.parse(readFileSync(path.join(OUT_DIR, "audit.json"), "utf8"));
const displayed = JSON.parse(readFileSync(path.join(OUT_DIR, "displayed.json"), "utf8"));
const byId = new Map(audit.entries.map((e) => [e.id, e]));

// audit.json 的每条记录已经带齐三层证据，这里按闸门的同一形状喂给同一个规则函数。
const evidenceOf = (e) => ({
  type: "photo",
  width: e.displayWidth, height: e.displayHeight,
  asset: { width: e.assetWidth, height: e.assetHeight },
  locations: [e.web, e.thumbnail].filter(Boolean),
});

const rows = [];
const skipped = { readable: 0, unknownSize: 0, alreadyExcludedBySubject: 0, videos: 0 };
for (const d of displayed.entries) {
  const entry = byId.get(d.id);
  if (!entry) { skipped.videos += 1; continue; } // audit 范围是照片；线上引用到的视频不归本规则管
  const evidence = evidenceOf(entry);
  const tier = photoQualityTier(evidence);
  if (tier === "unknown") { skipped.unknownSize += 1; continue; }
  if (tier === "readable") { skipped.readable += 1; continue; }
  if (entry.excluded) { skipped.alreadyExcludedBySubject += 1; continue; }
  if (TIER !== "all" && tier !== TIER) continue;
  rows.push({
    id: entry.id,
    tier,
    takenAt: entry.takenAt,
    month: String(entry.takenAt ?? "").slice(0, 7),
    bestKnownShortSide: bestKnownShortSide(evidence),
    deliveredPx: entry.web ? `${entry.web.width}x${entry.web.height}` : null,
    sourcePx: `${entry.assetWidth}x${entry.assetHeight}`,
    displayRowPx: `${entry.displayWidth}x${entry.displayHeight}`,
    hasLargerAuthorizedOriginal: false, // 见 photo-quality-origins.mjs：同资产下没有更大的 location
    surfaces: d.surfaces,
    subjectDecision: entry.subjectDecision ?? null, // 原样记录，本次不读也不改
    reasonCodes: photoQualityReasonCodes(evidence),
  });
}
rows.sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.id.localeCompare(b.id));

const byTier = {};
const byMonth = {};
const bySurface = {};
for (const r of rows) {
  byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  byMonth[r.month] = (byMonth[r.month] ?? 0) + 1;
  for (const s of r.surfaces) bySurface[s] = (bySurface[s] ?? 0) + 1;
}

const manifest = {
  generatedAt: new Date().toISOString(),
  task: "DATA-0920-PHOTO-QUALITY-R1 / R2",
  kind: "dry-run-impact-and-code-rollback-reference",
  rule: `lib/media-quality.ts：三层尺寸证据中最大的短边 < ${READABLE_MIN_SHORT_SIDE}px 的照片不进阅读面（= 既有的 THUMBNAIL_MIN_SIDE）`,
  finding: "这些是原生分辨率不足（微信只留下缩略图），不是拍糊；同资产下没有更大的授权原图可换。",
  mechanism: {
    where: "lib/media/deliverability.ts deliverableMediaIds —— 所有阅读面共用的唯一一道闸门",
    databaseWrites: "none",
    subjectLedger: "untouched",
    originals: "untouched",
    rollback: "把 lib/media-quality.ts 与 lib/media/deliverability.ts 的这段改回去即可；没有账本行要撤，没有数据要还原。回滚后重新出现的应当恰好是本清单里的照片。",
  },
  basis: {
    auditGeneratedAt: audit.generatedAt,
    displayedGeneratedAt: displayed.generatedAt,
    displayedMediaReferences: displayed.entries.length,
  },
  counts: { candidates: rows.length, byTier, byMonth, bySurface, skipped },
  entries: rows,
};

const file = path.join(OUT_DIR, TIER === "all" ? "manifest.json" : `manifest-${TIER}.json`);
writeFileSync(file, JSON.stringify(manifest, null, 1));

console.log(`闸门会挡下 ${rows.length} 张（tier 过滤: ${TIER}）`);
console.log("  分档:", JSON.stringify(byTier));
console.log("  按出现位置:", JSON.stringify(bySurface));
console.log("  跳过:", JSON.stringify(skipped));
console.log(`清单写入 ${file}`);
