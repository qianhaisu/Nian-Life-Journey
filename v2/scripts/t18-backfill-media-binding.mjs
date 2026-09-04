#!/usr/bin/env node
// T18, 2026-09-04: T7's write script never persisted media_ids/heroMediaId onto the life_event row
// — T11 Part C's same-day photo binding only ever happened transiently inside month-page
// composition (lib/publication-moments.ts). That left the event detail page and the home page
// (both of which read life_events.media_ids/hero_media_id directly, not the composed view) showing
// no photos even for days the month page displays correctly with one.
//
// This backfills every T7-written life_event (organizer_version = 'organizer-v2-t7-subject-gate')
// with the SAME binding the month page computes: hero/supporting selection via the real
// heroSized/thumbnailSized/burst-grouping functions from lib/media/hero.ts and
// lib/publication-moments.ts (imported, not re-implemented), applied to media fetched by plain SQL.
//
// Why plain SQL instead of loadFamilyArchive()/getStore(): that path's ~18 sequential queries on
// one connection repeatedly hung mid-session in this environment (confirmed: flat CPU for minutes,
// on both the pooled and unpooled Neon endpoint) — the same failure class wechat-import-all.mjs
// already works around for imports. Every plain pg.Pool script this session has run reliably, so
// the DB read here is a handful of direct queries; only the pure, DB-free selection logic is
// imported from the real modules.
//
// Idempotent and safe to re-run after every future T7 --commit (2026-08 onward): it only ever
// recomputes from current media/privilege state and overwrites media_ids/hero_media_id on rows
// this exact organizerVersion produced — it never touches rule-derived or human-authored events.
//
//   node --import tsx scripts/t18-backfill-media-binding.mjs [--dry-run]
import path from "node:path";
import pg from "pg";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const DRY_RUN = process.argv.includes("--dry-run");
const PROFILE_ID = "profile-zhangnian";
const T7_ORGANIZER_VERSION = "organizer-v2-t7-subject-gate";
const DAYCARE_CONVERSATION = "conversation:2109e1e89306b57b8334d349";
const BURST_GAP_SECONDS = 90;
const MOMENT_SUPPORTING_MAX = 2;

// Pure, DB-free — the exact functions the month page uses, not a re-implementation.
const { heroSized, thumbnailSized } = await import("../lib/media/hero.ts");
const { calendarDayOf } = await import("../lib/timeline-dates.ts");

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const pool = new pg.Pool({ connectionString: dbUrl });

function burstGroups(photos) {
  const groups = [];
  let current = [];
  let lastTime;
  for (const photo of photos) {
    const time = photo.takenAt ? Date.parse(photo.takenAt) : undefined;
    const sameBurst = time !== undefined && lastTime !== undefined && time - lastTime <= BURST_GAP_SECONDS * 1000;
    if (current.length > 0 && !sameBurst) { groups.push(current); current = []; }
    current.push(photo);
    lastTime = time ?? lastTime;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
function burstRepresentatives(photos) {
  return burstGroups(photos).map((group) => group.find(heroSized) ?? group.find(thumbnailSized)).filter(Boolean);
}

try {
  const candidates = await pool.query(
    `select id, to_char(occurred_at, 'YYYY-MM-DD') as day, media_ids, hero_media_id
     from life_events where organizer_version = $1 order by occurred_at, id`,
    [T7_ORGANIZER_VERSION],
  );
  console.log(`Found ${candidates.rows.length} T7-written life_event row(s).`);
  if (candidates.rows.length === 0) process.exit(0);

  // One query for every deliverable, family-visible media row for this profile. Production holds
  // ~1150 rows — small enough to pull once and group in JS rather than one query per day.
  const mediaRows = await pool.query(
    `select m.id, m.type, m.src, m.thumbnail_src as "thumbnailSrc", m.width, m.height,
            m.poster_src as "posterSrc", m.taken_at::text as "takenAt", m.alt, m.raw_source_id as "rawSourceId",
            rs.source_type as "sourceType", rs.source_label as "sourceLabel"
     from media m
     left join raw_sources rs on rs.id = m.raw_source_id
     where m.profile_id = $1 and m.visibility <> 'private'
       and exists (
         select 1 from media_locations ml
         where ml.media_asset_id = m.media_asset_id and ml.provider = 'hot' and ml.status = 'ready'
           and ((m.type = 'video' and ml.variant = 'poster') or (m.type <> 'video' and ml.variant in ('web', 'thumbnail')))
       )
     order by m.taken_at asc, m.id asc`,
    [PROFILE_ID],
  );
  console.log(`Loaded ${mediaRows.rows.length} deliverable, family-visible media row(s).`);

  const isTrusted = (row) => row.sourceType === "family_photo" || row.sourceLabel === DAYCARE_CONVERSATION;
  const byDay = new Map();
  for (const row of mediaRows.rows) {
    const day = calendarDayOf(row.takenAt);
    if (!day) continue;
    const bucket = byDay.get(day);
    if (bucket) bucket.push(row); else byDay.set(day, [row]);
  }

  const heroClaimedOnDay = new Map();
  let updated = 0, unchanged = 0, noPhotos = 0, noHero = 0;
  for (const candidate of candidates.rows) {
    const dayPhotos = byDay.get(candidate.day);
    if (!dayPhotos || dayPhotos.length === 0) { noPhotos += 1; continue; }
    const reps = burstRepresentatives(dayPhotos);
    const claimed = heroClaimedOnDay.get(candidate.day);
    const eligible = claimed ? reps.filter((r) => r.id !== claimed) : reps;
    const hero = eligible.find((r) => heroSized(r) && isTrusted(r));
    if (!hero) { noHero += 1; continue; }
    const supporting = eligible.filter((r) => r !== hero && isTrusted(r) && thumbnailSized(r)).slice(0, MOMENT_SUPPORTING_MAX);
    heroClaimedOnDay.set(candidate.day, hero.id);

    const newMediaIds = [hero.id, ...supporting.map((r) => r.id)];
    const currentMediaIds = Array.isArray(candidate.media_ids) ? candidate.media_ids : [];
    const same = candidate.hero_media_id === hero.id
      && currentMediaIds.length === newMediaIds.length
      && currentMediaIds.every((id, i) => id === newMediaIds[i]);
    if (same) { unchanged += 1; continue; }

    console.log(`  ${candidate.day} ${candidate.id}: hero=${hero.id} supporting=${supporting.length} (was hero=${candidate.hero_media_id ?? "null"} media_ids=${currentMediaIds.length})`);
    if (!DRY_RUN) {
      await pool.query(`update life_events set media_ids = $1, hero_media_id = $2 where id = $3`, [JSON.stringify(newMediaIds), hero.id, candidate.id]);
    }
    updated += 1;
  }
  console.log(`\n=== SUMMARY ===`);
  console.log(JSON.stringify({ dryRun: DRY_RUN, total: candidates.rows.length, updated, unchanged, noPhotos, noHero }, null, 2));
} finally {
  await pool.end();
}
