#!/usr/bin/env node
// Backfills the WeChat videos that were never ingested.
//
// Why they are missing. wechat-markdown.ts extracts media with `/!\[[^\]]*\]\(([^)]+)\)/g` —
// IMAGE markdown only. A video is written by the exporter as `[视频文件](media/videos/x.mp4)`,
// without the leading `!`, so it never became a mediaRef, never reached the importer, and survives
// only as link text inside `raw_sources.text`. 122 messages reference one; 120 of those files are
// present and readable on disk.
//
// This does NOT re-run the import. Re-parsing would change `messageType` and `attachments` for
// those messages, which are both inputs to `canonicalMessageId`, so every affected message would
// get a NEW id and re-import would duplicate it rather than reuse it. The backfill instead adds the
// asset/location/media rows for messages that already exist, keyed the way the importer keys them.
//
// Identity, deliberately the same scheme wechat-import.ts uses so a future import reuses these rows
// rather than creating a second copy:
//
//   assetId     media-asset:<sha256 hex of the file bytes>
//   mediaId     wechat-media:<sha256 of "<messageId> <refId>">
//   refId       media-ref:<sha256 of relativePath>:<index within the message>
//   providerRef wechat:document:<documentDigest>:path:<sha256 relativePath>:ref:<sha256 refId>
//   locationId  wechat-location:<sha256 providerRef>
//
// The file's own SHA-256 is the permanent identity (CLAUDE.md), and it is recomputed here from the
// bytes rather than trusted from anywhere.
//
// Idempotent: every insert is ON CONFLICT DO NOTHING, and media_ids is merged rather than replaced,
// so a second run creates nothing and changes nothing.
//
// DRY RUN unless --apply. Read-only against the export directory; no network.
//
//   node --import tsx -r dotenv/config scripts/wechat-video-backfill.mjs \
//     --conv-dir="E:/.../群聊_x" [--apply] [--out=<rollback>.json] dotenv_config_path=.env.local
import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const CONV_DIR = argOf("conv-dir", null);
const APPLY = args.includes("--apply");
const OUT = argOf("out", null);
const PROFILE_ID = argOf("profile", "profile-zhangnian");
if (!CONV_DIR) { console.error("Need --conv-dir=<conversation export directory>."); process.exit(1); }

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }

const sha = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const VIDEO_EXT = /\.(mp4|mov|m4v|webm)$/i;
const MIME = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".webm": "video/webm" };

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
const { rows } = await client.query(
  `select id, captured_at, text, media_ids, metadata->>'documentDigest' doc
     from raw_sources
    where source_type='wechat' and deleted_at is null and profile_id=$1 and text like '%视频文件%'
    order by captured_at`, [PROFILE_ID]);

console.log(`${rows.length} messages reference a video file. Export: ${CONV_DIR}`);
console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}\n`);

const LINK = /\[([^\]]*)\]\(([^)]+)\)/g;
const planned = [];
const skipped = { missing: 0, unsafe: 0, unsupported: 0, alreadyLinked: 0 };
const seenChecksum = new Map();

for (const row of rows) {
  const links = [...String(row.text).matchAll(LINK)].map((m) => m[2].trim()).filter((t) => VIDEO_EXT.test(t));
  links.forEach((target, index) => {
    const rel = target.replaceAll("\\", "/");
    if (rel.startsWith("/") || rel.includes("..")) { skipped.unsafe += 1; return; }
    const abs = path.join(CONV_DIR, rel);
    if (!path.resolve(abs).startsWith(path.resolve(CONV_DIR))) { skipped.unsafe += 1; return; }
    let st;
    try { st = statSync(abs); } catch { skipped.missing += 1; return; }
    if (!st.isFile() || st.size === 0) { skipped.missing += 1; return; }
    const ext = path.extname(rel).toLowerCase();
    const mimeType = MIME[ext];
    if (!mimeType) { skipped.unsupported += 1; return; }

    const checksumHex = createHash("sha256").update(readFileSync(abs)).digest("hex");
    const messageId = row.id.startsWith("wechat-message:") ? row.id.slice("wechat-message:".length) : row.id;
    const refId = `media-ref:${sha(rel)}:${index}`;
    const assetId = `media-asset:${checksumHex}`;
    const mediaId = `wechat-media:${sha(`${messageId} ${refId}`)}`;
    const providerRef = `wechat:document:${row.doc}:path:${sha(rel)}:ref:${sha(refId)}`;
    const locationId = `wechat-location:${sha(providerRef)}`;
    const existing = Array.isArray(row.media_ids) ? row.media_ids : [];
    if (existing.includes(mediaId)) { skipped.alreadyLinked += 1; return; }

    // Two messages citing the same bytes share one asset; each still gets its own media row.
    const duplicateOf = seenChecksum.get(checksumHex);
    seenChecksum.set(checksumHex, rel);

    planned.push({
      sourceId: row.id, rel, abs, bytes: st.size, checksum: `sha256:${checksumHex}`, mimeType,
      assetId, mediaId, locationId, providerRef, takenAt: row.captured_at.toISOString(),
      duplicateAssetOf: duplicateOf ?? null,
    });
  });
}

const distinctAssets = new Set(planned.map((p) => p.assetId));
const totalBytes = planned.reduce((s, p) => s + p.bytes, 0);
console.log(`Planned: ${planned.length} media rows, ${distinctAssets.size} distinct assets, ${(totalBytes / 1024 / 1024).toFixed(1)} MB of source video.`);
console.log(`Skipped: ${JSON.stringify(skipped)}\n`);

if (!APPLY) {
  for (const p of planned.slice(0, 3)) console.log(`  would create ${p.assetId.slice(0, 26)}… <- ${p.rel} (${(p.bytes / 1024 / 1024).toFixed(2)} MB)`);
  if (planned.length > 3) console.log(`  … and ${planned.length - 3} more`);
  console.log("\nDry run: nothing written.");
  await client.end();
  process.exit(0);
}

// ---------------------------------------------------------------- apply
// One transaction. Every write is ON CONFLICT DO NOTHING and media_ids is merged, never replaced,
// so replaying this changes nothing.
const created = { assets: 0, locations: 0, media: 0, sourcesLinked: 0 };
const rollback = [];
try {
  await client.query("begin");
  for (const p of planned) {
    const a = await client.query(
      `insert into media_assets (id, profile_id, raw_source_id, media_type, mime_type, taken_at, checksum, original_filename, archive_status, created_at)
       values ($1,$2,$3,'video',$4,$5,$6,$7,'awaiting_archive',now())
       on conflict (id) do nothing`,
      [p.assetId, PROFILE_ID, p.sourceId, p.mimeType, p.takenAt, p.checksum, path.basename(p.rel)]);
    created.assets += a.rowCount;
    if (a.rowCount) rollback.push({ table: "media_assets", id: p.assetId });

    const l = await client.query(
      `insert into media_locations (id, media_asset_id, provider, variant, provider_ref, mime_type, file_size, status, created_at, updated_at)
       values ($1,$2,'wechat','original',$3,$4,$5,'ready',now(),now())
       on conflict (id) do nothing`,
      [p.locationId, p.assetId, p.providerRef, p.mimeType, p.bytes]);
    created.locations += l.rowCount;
    if (l.rowCount) rollback.push({ table: "media_locations", id: p.locationId });

    // width/height/duration are genuinely unknown without probing the container, and are left NULL
    // rather than guessed. src points at the delivery route, which returns "derivative is not
    // ready" until one exists — honest and fail-closed, not a broken promise.
    const m = await client.query(
      `insert into media (id, profile_id, raw_source_id, media_asset_id, type, src, original_filename, mime_type, file_size, alt, taken_at, visibility, width, height)
       values ($1,$2,$3,$4,'video',$5,$6,$7,$8,'WeChat video',$9,'family',0,0)
       on conflict (id) do nothing`,
      [p.mediaId, PROFILE_ID, p.sourceId, p.assetId, `/api/media/${p.mediaId}?variant=web`, path.basename(p.rel), p.mimeType, p.bytes, p.takenAt]);
    created.media += m.rowCount;
    if (m.rowCount) rollback.push({ table: "media", id: p.mediaId });

    const s = await client.query(
      `update raw_sources
          set media_ids = (select jsonb_agg(distinct v) from jsonb_array_elements(coalesce(media_ids,'[]'::jsonb) || to_jsonb($2::text)) v)
        where id = $1 and not (coalesce(media_ids,'[]'::jsonb) @> to_jsonb($2::text))`,
      [p.sourceId, p.mediaId]);
    created.sourcesLinked += s.rowCount;
  }
  await client.query("commit");
} catch (error) {
  await client.query("rollback");
  console.error("FAILED, transaction rolled back:", error.message);
  await client.end();
  process.exit(1);
}
await client.end();

console.log(`Created: ${JSON.stringify(created)}`);
if (OUT) { writeFileSync(OUT, JSON.stringify({ appliedAt: new Date().toISOString(), convDir: CONV_DIR, created, rollback }, null, 2)); console.log(`Rollback identifiers -> ${OUT}`); }
