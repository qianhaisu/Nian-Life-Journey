#!/usr/bin/env node
// Fresh shadow corpus builder — deterministic, READ-ONLY, zero model calls.
//
// Selects EvidenceWindows that have never been used to tune anything, so a shadow run over them
// measures generalisation rather than memory. Everything already spent is excluded by construction:
// the V1 development set, the spent Holdout 1, and the spent Holdout V2. Exclusion is by
// (conversation, day) AND by anchorSourceId, because a window is contaminated if ANY part of the day
// it came from was ever looked at while tuning.
//
// Selection is mechanical and reproducible: windows are stratified across month, density and sender
// composition, and inside each stratum they are ordered by a stable fingerprint hash rather than by
// anything about their content. Nothing here reads what a window SAYS, so this file cannot
// cherry-pick windows that would make a router look good.
//
// Writes a manifest to a caller-supplied path. Family chat text never enters the manifest — only
// ids, counts and fingerprints — so the manifest itself is safe to keep. Use --out to place the
// evidence-bearing corpus outside the repository.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { DEVELOPMENT_SET, HOLDOUT_SET } from "../lib/organizer/calibration-sets.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const TARGET = Number(argOf("target", "30"));
const OUT = argOf("out", null);
const PROFILE_ID = argOf("profile", "profile-zhangnian");

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Set CONTRACT_DATABASE_URL or DATABASE_URL."); process.exit(1); }

const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";

// ---------------------------------------------------------------- spent material

const spentDays = new Set();     // `${conversation}|${day}`
const spentAnchors = new Set();
const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";

for (const c of DEVELOPMENT_SET) { spentDays.add(`${c.conversation}|${c.day}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V2_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
// Holdout 1 records a day but not a conversation; it was drawn from the main conversation.
for (const c of HOLDOUT_SET) spentDays.add(`${MAIN}|${c.day}`);

console.log(`Spent material excluded: ${spentDays.size} (conversation, day) pairs, ${spentAnchors.size} anchor sourceIds.`);

// ---------------------------------------------------------------- load

// Neon drops a long single result set, so the corpus is paged. Order is stable and the pages are
// disjoint by captured_at, so the assembled list is identical to one unpaged query.
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

const PAGE = 1000;
const rows = [];
for (let offset = 0; ; offset += PAGE) {
  const page = await client.query(
    `select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date
       from raw_sources
      where source_type='wechat' and deleted_at is null and profile_id=$1
      order by captured_at, id
      limit ${PAGE} offset ${offset}`, [PROFILE_ID]);
  rows.push(...page.rows);
  if (page.rows.length < PAGE) break;
}
await client.end();
console.log(`Loaded ${rows.length} WeChat sources.`);

const byConversation = new Map();
for (const row of rows) {
  const conv = row.source_label;
  if (!byConversation.has(conv)) byConversation.set(conv, []);
  byConversation.get(conv).push({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: String(row.metadata?.senderDigest ?? row.contributor_id),
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
    text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility,
    metadata: row.metadata, sourceLabel: row.source_label, contributorRole: undefined,
    lifeDate: row.life_date,
  });
}

// ---------------------------------------------------------------- build + filter

function fingerprint(window) {
  const ids = window.items.map((i) => i.sourceId).slice().sort();
  return createHash("sha256").update(`${window.conversationId}|${window.activityDate}|${ids.join(",")}`).digest("hex").slice(0, 32);
}

const all = [];
for (const [conversation, sources] of byConversation) {
  const windows = buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
  for (const w of windows) all.push(w);
}
console.log(`Built ${all.length} EvidenceWindows across ${byConversation.size} conversations.`);

const lifeDateOf = (w) => shanghaiCalendarDate(w.timeRange.from);

const fresh = all.filter((w) => {
  if (spentDays.has(`${w.conversationId}|${w.activityDate}`)) return false;
  if (spentDays.has(`${w.conversationId}|${lifeDateOf(w)}`)) return false;
  if (w.items.some((i) => spentAnchors.has(i.sourceId))) return false;
  return true;
});
console.log(`Fresh (never tuned on): ${fresh.length} windows; ${all.length - fresh.length} excluded as spent.`);

// A window with almost nothing in it cannot exercise judgement either way.
const usable = fresh.filter((w) => w.stats.messageCount >= 3);
console.log(`Usable (>= 3 messages): ${usable.length}.`);

// ---------------------------------------------------------------- stratify

const densityOf = (w) => (w.stats.messageCount >= 40 ? "dense" : w.stats.messageCount >= 12 ? "medium" : "sparse");
const sendersOf = (w) => (w.stats.senderCount >= 3 ? "multi" : w.stats.senderCount === 2 ? "pair" : "single");
const monthOf = (w) => w.activityDate.slice(0, 7);
const stratumOf = (w) => `${monthOf(w)}|${densityOf(w)}|${sendersOf(w)}`;

const strata = new Map();
for (const w of usable) {
  const key = stratumOf(w);
  if (!strata.has(key)) strata.set(key, []);
  strata.get(key).push(w);
}
// Deterministic order inside each stratum: by fingerprint, which depends only on identity.
for (const list of strata.values()) list.sort((a, b) => fingerprint(a).localeCompare(fingerprint(b)));

// Round-robin across strata so no month or density can dominate. Strata are visited in a fixed
// order; nothing about the selection depends on window content.
//
// The visit order is by a hash of the stratum key, NOT alphabetically. Alphabetical order is
// "YYYY-MM|density|senders", so when there are more strata than the target, round 0 never reaches
// the end of the list and the sample silently becomes "the earliest months only" — which is a
// selection bias, not a sample. Hashing the key removes that without introducing randomness: the
// order is fixed and reproducible, it just carries no calendar information.
const keyRank = (key) => createHash("sha256").update(`stratum-order|${key}`).digest("hex");
const keys = [...strata.keys()].sort((a, b) => keyRank(a).localeCompare(keyRank(b)));
console.log(`${strata.size} strata available for a target of ${TARGET}.`);
const picked = [];
for (let round = 0; picked.length < TARGET; round += 1) {
  let addedThisRound = 0;
  for (const key of keys) {
    if (picked.length >= TARGET) break;
    const list = strata.get(key);
    if (round < list.length) { picked.push(list[round]); addedThisRound += 1; }
  }
  if (addedThisRound === 0) break;
}

console.log(`\nSelected ${picked.length} windows across ${new Set(picked.map(stratumOf)).size} strata.`);
const tally = (fn) => picked.reduce((acc, w) => { const k = fn(w); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
console.log(`  by month:        ${JSON.stringify(tally(monthOf))}`);
console.log(`  by density:      ${JSON.stringify(tally(densityOf))}`);
console.log(`  by senders:      ${JSON.stringify(tally(sendersOf))}`);
console.log(`  by conversation: ${JSON.stringify(tally((w) => w.conversationId.slice(-8)))}`);
console.log(`  images present:  ${picked.filter((w) => w.stats.imageCount > 0).length}`);

// ---------------------------------------------------------------- manifest

const manifest = {
  generatedAt: new Date().toISOString(),
  builder: "organizer-fresh-shadow-corpus",
  profileId: PROFILE_ID,
  target: TARGET,
  totals: { built: all.length, fresh: fresh.length, usable: usable.length, selected: picked.length },
  excluded: { spentDayPairs: spentDays.size, spentAnchors: spentAnchors.size },
  windows: picked.map((w) => ({
    windowId: w.windowId,
    fingerprint: fingerprint(w),
    conversationId: w.conversationId,
    activityDate: w.activityDate,
    lifeDate: lifeDateOf(w),
    stratum: stratumOf(w),
    messageCount: w.stats.messageCount,
    imageCount: w.stats.imageCount,
    senderCount: w.stats.senderCount,
    sourceIds: w.items.map((i) => i.sourceId),
  })),
};

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ manifest, windows: picked }, null, 2), "utf8");
  console.log(`\nCorpus (with evidence) written to ${OUT}`);
} else {
  console.log("\nNo --out given; manifest only:");
  console.log(JSON.stringify(manifest, null, 2));
}
