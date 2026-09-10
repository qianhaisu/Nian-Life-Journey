#!/usr/bin/env node
// Attach a poster and a browser-playable preview to ONE already-imported video.
//
// Why this exists: lib/media/processing.ts's createDerivatives() answers a video with a placeholder
// SVG that says 视频预览稍后可用 — it has never extracted a frame, and nothing has ever produced a
// playable derivative. Production's 121 videos therefore have no poster and no preview at any
// provider, which is why every variant of every video 404s. This script is the first real one,
// deliberately for a single video at a time: it takes files ffmpeg has already produced, puts them
// where the delivery route expects them, and writes the two location rows that make them
// deliverable. It is not a migration and it must not become one.
//
// It never transcodes, never touches the original, never creates a story, never changes a review
// decision, and never widens visibility. Re-running it is a no-op: the location rows are keyed on
// (provider, provider_ref) and the media row is only filled in while it still holds the importer's
// zeros.
//
// Environment (all read, none printed): DATABASE_URL, OSS_ENDPOINT, OSS_REGION, OSS_BUCKET,
// OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET. Inputs: MEDIA_ID, POSTER_PATH, PREVIEW_PATH, and
// COMMIT=1 to write (without it the script reports what it would do and exits).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

// Mirrors lib/trusted-photo-sources.ts. Duplicated on purpose: this script runs inside the
// standalone image, which ships compiled output and no TypeScript to import. It is a guard, not the
// definition — if the two ever disagree, the library is right and this must be corrected.
const TRUSTED_WECHAT_SOURCE_LABELS = new Set([
  "conversation:2109e1e89306b57b8334d349",
  "conversation:a673c0e0563be6ecf1867094",
  "conversation:856b8ec2b8f3ec2871782ca6",
  "conversation:064d5dfbd798a5f27223c758",
]);

const MEDIA_ID = process.env.MEDIA_ID;
const POSTER_PATH = process.env.POSTER_PATH;
const PREVIEW_PATH = process.env.PREVIEW_PATH;
const COMMIT = process.env.COMMIT === "1";
if (!MEDIA_ID || !POSTER_PATH || !PREVIEW_PATH) {
  console.error("MEDIA_ID, POSTER_PATH and PREVIEW_PATH are required.");
  process.exit(1);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stop = (reason) => { console.error(`REFUSED: ${reason}`); process.exit(2); };

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: false });
await client.connect();

const { rows } = await client.query(
  `select m.id, m.type, m.visibility, m.width, m.height, m.duration_seconds, m.poster_src,
          m.media_asset_id, a.checksum, a.media_type,
          coalesce(r.source_label, r.source_type) as source, r.source_type
     from media m
     join media_assets a on a.id = m.media_asset_id
     left join raw_sources r on r.id = m.raw_source_id
    where m.id = $1`, [MEDIA_ID]);
const media = rows[0];
if (!media) stop(`no media row ${MEDIA_ID}`);

// The same gates the pages apply, checked here so a write can never put something on a surface the
// read layer would have refused.
if (media.type !== "video" || media.media_type !== "video") stop("not a video");
if (media.visibility === "private") stop("visibility is private");
const trusted = media.source_type === "family_photo" || TRUSTED_WECHAT_SOURCE_LABELS.has(media.source);
if (!trusted) stop(`source ${media.source} is not on the trusted list — a video from an unvouched conversation does not belong on a family page`);
if (!media.checksum?.startsWith("sha256:")) stop("asset has no sha256 checksum to key derivatives by");

const checksumHex = media.checksum.replace(/^sha256:/, "");
// The key convention WeChat-sourced derivatives already use (lib/ingest/wechat-worker.ts).
const keyFor = (variant, ext) => `media/derivatives/${checksumHex}/${variant}.${ext}`;

const poster = readFileSync(POSTER_PATH);
const preview = readFileSync(PREVIEW_PATH);
const plan = [
  { variant: "poster", key: keyFor("poster", "webp"), body: poster, mimeType: "image/webp" },
  { variant: "preview", key: keyFor("preview", "mp4"), body: preview, mimeType: "video/mp4" },
];

const existing = await client.query(
  `select provider, variant, status, provider_ref from media_locations
    where media_asset_id = $1 and provider = 'oss' and variant in ('poster','preview')`, [media.media_asset_id]);
const already = new Map(existing.rows.map((row) => [row.variant, row]));

console.log(JSON.stringify({
  mediaId: media.id, assetId: media.media_asset_id, source: media.source, sourceTrusted: trusted,
  checksum: media.checksum,
  files: plan.map((item) => ({ variant: item.variant, key: item.key, bytes: item.body.length, sha256: sha256(item.body) })),
  alreadyPresent: [...already.keys()],
  mediaRowNow: { width: media.width, height: media.height, durationSeconds: media.duration_seconds, posterSrc: media.poster_src },
  commit: COMMIT,
}, null, 1));

if (!COMMIT) { console.log("\nDRY RUN — nothing written. Set COMMIT=1 to apply."); await client.end(); process.exit(0); }

const s3 = new S3Client({
  endpoint: `https://${process.env.OSS_ENDPOINT}`,
  region: process.env.OSS_REGION,
  forcePathStyle: false,
  credentials: { accessKeyId: process.env.OSS_ACCESS_KEY_ID, secretAccessKey: process.env.OSS_ACCESS_KEY_SECRET },
});
const bucket = process.env.OSS_BUCKET;

const ledger = [];
for (const item of plan) {
  let present = false;
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: item.key }));
    present = Number(head.ContentLength) === item.body.length;
  } catch { present = false; }
  if (present) ledger.push({ step: `oss ${item.variant}`, action: "already there, same size" });
  else {
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: item.key, Body: item.body, ContentType: item.mimeType, ContentLength: item.body.length }));
    ledger.push({ step: `oss ${item.variant}`, action: "uploaded", key: item.key, bytes: item.body.length });
  }
}

// Deterministic ids so a second run collides with itself rather than creating a twin, and the
// unique index on (provider, provider_ref) makes that collision harmless either way.
for (const item of plan) {
  const id = `location-oss-${item.variant}-${checksumHex}`;
  const result = await client.query(
    `insert into media_locations (id, media_asset_id, provider, variant, provider_ref, mime_type, file_size, width, height, status)
     values ($1, $2, 'oss', $3, $4, $5, $6, $7, $8, 'ready')
     on conflict (provider, provider_ref) do nothing
     returning id`,
    [id, media.media_asset_id, item.variant, item.key, item.mimeType, item.body.length,
     Number(process.env.VIDEO_WIDTH), Number(process.env.VIDEO_HEIGHT)]);
  ledger.push({ step: `location ${item.variant}`, action: result.rowCount ? "inserted" : "already present", id });
}

// The importer stored 0x0 and no duration for videos because it never looked inside the file. The
// page needs a box to lay the player out in, and that box is the poster's shape. Guarded on the
// zeros so a real value is never overwritten.
const updated = await client.query(
  `update media set width = $2, height = $3, duration_seconds = $4, poster_src = $5
    where id = $1 and width = 0 and height = 0
    returning id`,
  [media.id, Number(process.env.VIDEO_WIDTH), Number(process.env.VIDEO_HEIGHT),
   Math.round(Number(process.env.VIDEO_DURATION)), `/api/media/${media.id}?variant=poster`]);
ledger.push({ step: "media row", action: updated.rowCount ? "filled in width/height/duration/posterSrc" : "left as it was (already had real values)" });

console.log("\n" + JSON.stringify({ ledger }, null, 1));
console.log(`\nTo undo exactly this:
  delete from media_locations where id in ('location-oss-poster-${checksumHex}', 'location-oss-preview-${checksumHex}');
  update media set width = 0, height = 0, duration_seconds = null, poster_src = null where id = '${media.id}';
  (and delete the two OSS objects under media/derivatives/${checksumHex}/ if you want them gone)`);
await client.end();
