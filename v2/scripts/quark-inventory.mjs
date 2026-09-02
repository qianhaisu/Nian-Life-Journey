#!/usr/bin/env node
// Quark media utilization inventory. Queries the production DB directly.
// Usage: npm run quark:inventory (or node scripts/quark-inventory.mjs from v2/)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function q(sql, params = []) {
  const { rows } = await client.query(sql, params);
  // Normalize timestamps to ISO strings so .slice(0,10) works everywhere
  return rows.map(row => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
    return out;
  });
}

console.log("=== Quark Media Inventory ===\n");

// 1. MediaAssets that came from Quark
const quarkAssets = await q(`
  SELECT id, media_type, mime_type, width, height, taken_at, checksum, original_filename, created_at
  FROM media_assets WHERE id LIKE 'asset-quark-sha-%' ORDER BY taken_at
`);
console.log(`MediaAssets (Quark): ${quarkAssets.length}`);
if (quarkAssets.length) {
  const byType = {};
  for (const a of quarkAssets) byType[a.media_type] = (byType[a.media_type] || 0) + 1;
  console.log("  by type:", byType);
  const withDims = quarkAssets.filter(a => a.width && a.height).length;
  const withTakenAt = quarkAssets.filter(a => a.taken_at).length;
  console.log(`  with dimensions: ${withDims}, with takenAt: ${withTakenAt}`);
  const dates = [...new Set(quarkAssets.map(a => a.taken_at?.slice(0,10)).filter(Boolean))].sort();
  console.log(`  date range: ${dates[0]} — ${dates[dates.length-1]}, covering ${dates.length} distinct days`);
}

// 2. MediaLocations for Quark assets
const quarkLocations = await q(`
  SELECT ml.variant, ml.provider, ml.status, ml.media_asset_id
  FROM media_locations ml WHERE ml.media_asset_id LIKE 'asset-quark-sha-%'
`);
console.log(`\nMediaLocations (Quark): ${quarkLocations.length}`);
const byVariant = {};
const byStatus = {};
for (const loc of quarkLocations) {
  byVariant[loc.variant] = (byVariant[loc.variant] || 0) + 1;
  byStatus[loc.status] = (byStatus[loc.status] || 0) + 1;
}
console.log("  by variant:", byVariant);
console.log("  by status:", byStatus);

const assetsWithWeb = new Set((await q(`SELECT media_asset_id FROM media_locations WHERE media_asset_id LIKE 'asset-quark-sha-%' AND variant='web' AND status='ready'`)).map(r => r.media_asset_id));
const assetsWithThumb = new Set((await q(`SELECT media_asset_id FROM media_locations WHERE media_asset_id LIKE 'asset-quark-sha-%' AND variant='thumbnail' AND status='ready'`)).map(r => r.media_asset_id));
const assetsNoDerivative = quarkAssets.filter(a => !assetsWithWeb.has(a.id) && !assetsWithThumb.has(a.id));
console.log(`  assets with web derivative: ${assetsWithWeb.size}`);
console.log(`  assets with thumbnail: ${assetsWithThumb.size}`);
console.log(`  assets with NO derivative at all: ${assetsNoDerivative.length}${assetsNoDerivative.length ? " → " + assetsNoDerivative.map(a=>a.original_filename).join(", ") : ""}`);

// 3. Media (display layer) for Quark sources
const quarkMedia = await q(`
  SELECT m.id, m.raw_source_id, m.media_asset_id, m.life_event_id, m.taken_at, m.width, m.height, m.visibility, m.src
  FROM media m WHERE m.raw_source_id LIKE 'source-quark-sha-%' ORDER BY m.taken_at
`);
console.log(`\nMedia display records (Quark): ${quarkMedia.length}`);
const withEvent = quarkMedia.filter(m => m.life_event_id).length;
const orphaned = quarkMedia.filter(m => !m.life_event_id).length;
console.log(`  with lifeEventId: ${withEvent}`);
console.log(`  orphaned (no lifeEventId): ${orphaned}`);

// 4. RawSources from Quark
const quarkSources = await q(`
  SELECT id, status, captured_at, media_ids, related_life_event_id
  FROM raw_sources WHERE id LIKE 'source-quark-sha-%' ORDER BY captured_at
`);
console.log(`\nRawSources (Quark): ${quarkSources.length}`);
const bySourceStatus = {};
for (const s of quarkSources) bySourceStatus[s.status] = (bySourceStatus[s.status] || 0) + 1;
console.log("  by status:", bySourceStatus);
console.log(`  with relatedLifeEventId: ${quarkSources.filter(s => s.related_life_event_id).length}`);

// 5. DailyTraces with Quark sources
const allTraces = await q(`SELECT id, occurred_at, source_ids, entries FROM daily_traces WHERE profile_id='profile-zhangnian' ORDER BY occurred_at DESC`);
const quarkTraces = allTraces.filter(dt => {
  const s = Array.isArray(dt.source_ids) ? dt.source_ids : JSON.parse(dt.source_ids || "[]");
  return s.some(id => id.startsWith("source-quark-sha-"));
});
console.log(`\nDailyTraces with Quark sourceIds: ${quarkTraces.length}`);
for (const t of quarkTraces) {
  const s = Array.isArray(t.source_ids) ? t.source_ids : JSON.parse(t.source_ids || "[]");
  const qCount = s.filter(id => id.startsWith("source-quark-sha-")).length;
  console.log(`  ${t.occurred_at?.slice(0,10)} — ${qCount} quark sources, ${(t.entries||[]).length} trace entries`);
}

// 6. LifeEvents with Quark media
const lifeEvents = await q(`SELECT id, title, occurred_at, media_ids, source_ids FROM life_events WHERE profile_id='profile-zhangnian' ORDER BY occurred_at DESC`);
const eventsWithQuark = lifeEvents.filter(e => {
  const m = Array.isArray(e.media_ids) ? e.media_ids : JSON.parse(e.media_ids || "[]");
  return m.some(id => id.startsWith("media-quark-sha-"));
});
console.log(`\nLifeEvents with Quark media: ${eventsWithQuark.length}`);
for (const e of eventsWithQuark) {
  const m = Array.isArray(e.media_ids) ? e.media_ids : JSON.parse(e.media_ids || "[]");
  const qCount = m.filter(id => id.startsWith("media-quark-sha-")).length;
  console.log(`  ${e.occurred_at?.slice(0,10)} "${e.title}" — ${qCount} quark media (total ${m.length})`);
}

// 7. OrganizerJobs for Quark batches
const allJobs = await q(`SELECT id, status, result_action, source_ids FROM organizer_jobs WHERE profile_id='profile-zhangnian' ORDER BY created_at DESC LIMIT 40`);
const quarkJobs = allJobs.filter(j => {
  const s = Array.isArray(j.source_ids) ? j.source_ids : JSON.parse(j.source_ids || "[]");
  return s.some(id => id.startsWith("source-quark-sha-"));
});
console.log(`\nOrganizerJobs with Quark sources: ${quarkJobs.length}`);
const jobByAction = {};
for (const j of quarkJobs) { const k = j.result_action || j.status; jobByAction[k] = (jobByAction[k] || 0) + 1; }
console.log("  by result_action/status:", jobByAction);

// 8. 2026-08 summary
console.log("\n=== 2026-08 Detailed Coverage ===");
const aug = quarkAssets.filter(a => a.taken_at?.startsWith("2026-08"));
const augMedia = quarkMedia.filter(m => m.taken_at?.startsWith("2026-08"));
const augByDay = {};
for (const m of augMedia) { const d = m.taken_at?.slice(0,10); if (d) augByDay[d] = (augByDay[d] || 0) + 1; }
console.log(`Quark assets in 2026-08: ${aug.length}`);
console.log(`Media display records in 2026-08: ${augMedia.length} (orphaned: ${augMedia.filter(m=>!m.life_event_id).length})`);
console.log("  per day:", augByDay);

// 9. Final utilization
const totalUsable = quarkAssets.filter(a => assetsWithWeb.has(a.id) || assetsWithThumb.has(a.id)).length;
const visibleInEvents = eventsWithQuark.reduce((sum, e) => {
  const m = Array.isArray(e.media_ids) ? e.media_ids : JSON.parse(e.media_ids || "[]");
  return sum + m.filter(id => id.startsWith("media-quark-sha-")).length;
}, 0);
console.log(`\n=== Utilization ===`);
console.log(`Total Quark assets: ${quarkAssets.length}`);
console.log(`Usable (has ready derivative): ${totalUsable}`);
console.log(`Visible via LifeEvent.mediaIds: ${visibleInEvents}`);
console.log(`Orphaned (media table, no lifeEventId): ${orphaned}`);
console.log(`Utilization rate (visible/usable): ${totalUsable > 0 ? Math.round(100*visibleInEvents/totalUsable) : 0}%`);
console.log(`Root cause: photos in daily_trace days have no media chain to the UI`);

await client.end();
