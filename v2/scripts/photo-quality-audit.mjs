// DATA-0920-PHOTO-QUALITY-R1：清晰度体检（只读）。
//
// 起因：Teddy 2026-09-20 指出 https://nianlife.cn/memory/2025/07/24 第 3 张照片糊得没法看，
// 要求把这类照片统一从展示里去掉。第一步不是删，是先分清楚三种「糊」：
//   (a) 源图本身就小 —— 微信只留下了缩略图级别的像素（90×120 这种），放大到全屏必然糊；
//   (b) 派生图做小了 —— 源图清楚，但 web 变体被生成得太小，属于管线 bug，应重做派生图而不是撤图；
//   (c) 投递问题 —— 派生图存在且够大，但页面请求到了错的变体。
// 三种的处置完全不同，所以本脚本不给任何结论，只把判断依据拉齐：每张图的 media 记录尺寸、
// media_assets 源尺寸、每个 media_locations 变体的尺寸与字节数。
//
// 只读保证：连上就 `set default_transaction_read_only = on`，先证明目标是生产 RDS 再查；
// 不写库、不改图、不打印连接串。
//
// 输出落在仓库外的私有目录（家庭照片标识不进 Git）：
//   C:\Users\teddy\NianlifeOps\photo-quality-2026-09-20\audit.json
// stdout 只有脱敏的计数和分布。
//
//   node .data/run-on-rds.mjs scripts/photo-quality-audit.mjs
import { openTunnel, assertRdsTarget, tunnelDatabaseUrl } from "../.data/night-rds.mjs";
import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT_DIR = process.env.PHOTO_QUALITY_OUT ?? "C:/Users/teddy/NianlifeOps/photo-quality-2026-09-20";

const tunnel = await openTunnel(15533);
let media = [];
let locations = [];
let excluded = [];
try {
  const client = new pg.Client({ connectionString: tunnelDatabaseUrl(tunnel.env, tunnel.localPort), statement_timeout: 600000 });
  await client.connect();
  await client.query("set default_transaction_read_only = on");
  console.log("TARGET:", JSON.stringify(await assertRdsTarget(client)));

  // 展示候选全集：非 private 的照片，且至少有一个 ready 的 hot/oss 派生图（= 能投递）。
  // 这是 lib/media/deliverability.ts 的同一条件；主体核验与 store_only 另算，见下面两列。
  ({ rows: media } = await client.query(`
    select m.id,
           m.width  as display_width,
           m.height as display_height,
           m.taken_at,
           m.type,
           ma.id as asset_id,
           ma.width  as asset_width,
           ma.height as asset_height,
           ma.mime_type as asset_mime,
           ma.archive_status,
           (select r.decision from content_quality_reviews r
             where r.target_kind = 'media_subject_check' and r.target_id = m.id
             order by r.reviewed_at desc limit 1) as subject_decision
    from media m
    join media_assets ma on ma.id = m.media_asset_id
    where m.visibility <> 'private' and m.type = 'photo'
      and exists (select 1 from media_locations ml
                  where ml.media_asset_id = ma.id and ml.status = 'ready'
                    and ml.provider in ('hot','oss') and ml.variant in ('web','thumbnail')
                    and ml.provider_ref like 'media/%')`));

  ({ rows: locations } = await client.query(`
    select ml.media_asset_id, ml.provider, ml.variant, ml.status, ml.width, ml.height, ml.file_size
    from media_locations ml
    where exists (select 1 from media m where m.media_asset_id = ml.media_asset_id and m.visibility <> 'private' and m.type = 'photo')`));

  // 已经被撤下阅读层的（最新 media_subject_check = store_only）——本轮不重复处理。
  ({ rows: excluded } = await client.query(`
    select target_id from (
      select target_id, decision, row_number() over (partition by target_id order by reviewed_at desc) rn
      from content_quality_reviews where target_kind = 'media_subject_check') t
    where rn = 1 and decision = 'store_only'`));

  await client.end();
} finally {
  tunnel.close();
}

const byAsset = new Map();
for (const loc of locations) {
  if (!byAsset.has(loc.media_asset_id)) byAsset.set(loc.media_asset_id, []);
  byAsset.get(loc.media_asset_id).push(loc);
}
const excludedIds = new Set(excluded.map((row) => row.target_id));

const shortSide = (w, h) => (w && h ? Math.min(w, h) : null);
const entries = media.map((row) => {
  const locs = byAsset.get(row.asset_id) ?? [];
  const pick = (variant) => locs.find((l) => l.variant === variant && l.status === "ready" && (l.provider === "hot" || l.provider === "oss")) ?? null;
  const web = pick("web");
  const thumb = pick("thumbnail");
  const original = locs.find((l) => l.variant === "original") ?? null;
  return {
    id: row.id,
    takenAt: row.taken_at,
    displayWidth: row.display_width,
    displayHeight: row.display_height,
    assetWidth: row.asset_width,
    assetHeight: row.asset_height,
    assetMime: row.asset_mime,
    archiveStatus: row.archive_status,
    subjectDecision: row.subject_decision,
    excluded: excludedIds.has(row.id),
    web: web ? { width: web.width, height: web.height, bytes: web.file_size, provider: web.provider } : null,
    thumbnail: thumb ? { width: thumb.width, height: thumb.height, bytes: thumb.file_size, provider: thumb.provider } : null,
    hasOriginalLocation: Boolean(original),
    originalProvider: original?.provider ?? null,
  };
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), scope: "visibility<>private, type=photo, 至少一个 ready 的 hot/oss web|thumbnail 派生图", total: entries.length, entries }, null, 1));

// —— 脱敏汇总：只有计数，没有 id、没有画面内容 ——
const withWeb = entries.filter((e) => e.web);
const webDims = withWeb.filter((e) => e.web.width && e.web.height);
const missingWebDims = withWeb.length - webDims.length;
const buckets = [
  ["短边 <=120（缩略图级）", (s) => s <= 120],
  ["短边 121-239", (s) => s > 120 && s < 240],
  ["短边 240-479", (s) => s >= 240 && s < 480],
  ["短边 480-719", (s) => s >= 480 && s < 720],
  ["短边 >=720", (s) => s >= 720],
];
console.log(`\n展示候选照片总数: ${entries.length}`);
console.log(`  其中最新 media_subject_check=approved: ${entries.filter((e) => e.subjectDecision === "approved").length}`);
console.log(`  其中已被 store_only 撤下: ${entries.filter((e) => e.excluded).length}`);
console.log(`  有 ready web 变体: ${withWeb.length}；web 变体缺尺寸列: ${missingWebDims}`);
console.log(`  media_assets 缺源尺寸: ${entries.filter((e) => !e.assetWidth || !e.assetHeight).length}`);
console.log("\nweb 变体短边分布（实际投递给查看器的那张）:");
for (const [label, test] of buckets) {
  const n = webDims.filter((e) => test(shortSide(e.web.width, e.web.height))).length;
  console.log(`  ${label.padEnd(24)} ${String(n).padStart(5)}  ${((n / Math.max(1, webDims.length)) * 100).toFixed(1)}%`);
}
const upscaled = webDims.filter((e) => e.assetWidth && e.assetHeight && shortSide(e.web.width, e.web.height) > shortSide(e.assetWidth, e.assetHeight));
const shrunk = webDims.filter((e) => e.assetWidth && e.assetHeight && shortSide(e.assetWidth, e.assetHeight) >= 720 && shortSide(e.web.width, e.web.height) < 480);
console.log(`\n派生图比源图还大（说明管线放大过）: ${upscaled.length}`);
console.log(`源图 >=720 但 web 变体 <480（派生图做小了，属管线问题）: ${shrunk.length}`);
console.log(`\n明细已写入 ${path.join(OUT_DIR, "audit.json")}（仓库外，不进 Git）`);
