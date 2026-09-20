// DATA-0920-PHOTO-QUALITY-R1：小图还有没有更清楚的来源？（只读）
//
// 验收要求「有更高质量的授权原图就用原图，而不是一律撤下」。撤图之前必须先回答这个问题，
// 否则会把本来能救的照片当成坏照片处理掉。本脚本只问三件事：
//   1. 这些小图的 media_locations 里，除了已投递的 web/thumbnail，还有没有更大的其他变体；
//   2. 源尺寸（media_assets.width/height）都落在哪些具体数值上 —— 微信缩略图有固定尺寸特征；
//   3. 同一张 media 的资产上，是否存在 provider=quark 之类的另一条更大的记录。
// 只读，不写库、不下载原图、不打印连接串。
//
//   node .data/run-on-rds.mjs scripts/photo-quality-origins.mjs
import { openTunnel, assertRdsTarget, tunnelDatabaseUrl } from "../.data/night-rds.mjs";
import pg from "pg";

const SMALL_SHORT_SIDE = Number(process.env.SMALL_SHORT_SIDE ?? 240);

const tunnel = await openTunnel(15534);
try {
  const client = new pg.Client({ connectionString: tunnelDatabaseUrl(tunnel.env, tunnel.localPort), statement_timeout: 600000 });
  await client.connect();
  await client.query("set default_transaction_read_only = on");
  console.log("TARGET:", JSON.stringify(await assertRdsTarget(client)));

  const small = `
    with small as (
      select m.id, ma.id aid
      from media m
      join media_assets ma on ma.id = m.media_asset_id
      where m.visibility <> 'private' and m.type = 'photo'
        and least(ma.width, ma.height) < ${SMALL_SHORT_SIDE})`;

  console.log(`\n【1】短边 < ${SMALL_SHORT_SIDE} 的展示候选，其资产上所有 location 的分布`);
  const { rows: byVariant } = await client.query(`${small}
    select ml.provider, ml.variant, ml.status, count(*) n,
           count(*) filter (where ml.width is not null) has_dims,
           count(*) filter (where least(ml.width, ml.height) >= ${SMALL_SHORT_SIDE}) bigger_than_small
    from small join media_locations ml on ml.media_asset_id = small.aid
    group by 1,2,3 order by n desc`);
  console.table(byVariant);

  console.log("\n【2】源尺寸的具体取值（前 20，看是不是微信固定缩略图规格）");
  const { rows: dims } = await client.query(`
    select ma.width || 'x' || ma.height as dims, least(ma.width, ma.height) short, count(*) n
    from media m join media_assets ma on ma.id = m.media_asset_id
    where m.visibility <> 'private' and m.type = 'photo' and least(ma.width, ma.height) < ${SMALL_SHORT_SIDE}
    group by 1,2 order by n desc limit 20`);
  console.table(dims);

  console.log("\n【3】小图的 id 前缀分布（wechat-media / media-quark-sha / …），看是哪条导入链带进来的");
  const { rows: prefixes } = await client.query(`
    select split_part(m.id, '-', 1) || '-' || split_part(m.id, '-', 2) as id_prefix, count(*) n
    from media m join media_assets ma on ma.id = m.media_asset_id
    where m.visibility <> 'private' and m.type = 'photo' and least(ma.width, ma.height) < ${SMALL_SHORT_SIDE}
    group by 1 order by n desc limit 10`);
  console.table(prefixes);

  console.log("\n【4】对照：短边 >= 720 的大图，id 前缀分布");
  const { rows: bigPrefixes } = await client.query(`
    select split_part(m.id, '-', 1) || '-' || split_part(m.id, '-', 2) as id_prefix, count(*) n
    from media m join media_assets ma on ma.id = m.media_asset_id
    where m.visibility <> 'private' and m.type = 'photo' and least(ma.width, ma.height) >= 720
    group by 1 order by n desc limit 10`);
  console.table(bigPrefixes);

  await client.end();
} finally {
  tunnel.close();
}
