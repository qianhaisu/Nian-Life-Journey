#!/usr/bin/env node
// Holdout V3 candidate drawing — deterministic, READ-ONLY, zero model calls.
//
// Draws candidate windows two mechanically reproducible ways and writes them, with their text, to a
// file OUTSIDE the repository so they can be read and labelled by hand. Neither pass looks at what
// any router would DO with a candidate, so the draw cannot be biased toward windows that pass.
//
// Everything already spent is excluded: the V1 development set, spent Holdout 1, spent Holdout V2,
// and — supplied via --spent-corpus — the fresh V6 shadow corpus, which becomes spent the moment its
// results are read. A holdout drawn from windows a router has already been measured on is not a
// holdout.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { DEVELOPMENT_SET, HOLDOUT_SET } from "../lib/organizer/calibration-sets.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const OUT = argOf("out", null);
const SPENT_CORPUS = argOf("spent-corpus", null);
const PROFILE_ID = argOf("profile", "profile-zhangnian");
const PER_MONTH = Number(argOf("per-month", "3"));
if (!OUT) { console.error("--out=<path outside the repo> is required (candidates carry family chat text)"); process.exit(1); }

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Set CONTRACT_DATABASE_URL or DATABASE_URL."); process.exit(1); }

const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";

// ---------------------------------------------------------------- spent

const spentDays = new Set(), spentAnchors = new Set(), spentWindowIds = new Set();
for (const c of DEVELOPMENT_SET) { spentDays.add(`${c.conversation}|${c.day}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V2_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_SET) spentDays.add(`${MAIN}|${c.day}`);
if (SPENT_CORPUS) {
  const { manifest } = JSON.parse(readFileSync(SPENT_CORPUS, "utf8"));
  for (const w of manifest.windows) { spentWindowIds.add(w.windowId); spentDays.add(`${w.conversationId}|${w.activityDate}`); }
  console.log(`Also excluding ${manifest.windows.length} windows from the spent shadow corpus.`);
}
console.log(`Excluded: ${spentDays.size} (conversation, day) pairs, ${spentAnchors.size} anchors, ${spentWindowIds.size} shadow windows.`);

// ---------------------------------------------------------------- load

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();
const PAGE = 1000;
const rows = [];
for (let offset = 0; ; offset += PAGE) {
  const page = await client.query(
    `select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources
      where source_type='wechat' and deleted_at is null and profile_id=$1
      order by captured_at, id limit ${PAGE} offset ${offset}`, [PROFILE_ID]);
  rows.push(...page.rows);
  if (page.rows.length < PAGE) break;
}
await client.end();

const byConversation = new Map();
for (const row of rows) {
  if (!byConversation.has(row.source_label)) byConversation.set(row.source_label, []);
  byConversation.get(row.source_label).push({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: String(row.metadata?.senderDigest ?? row.contributor_id),
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
    text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility,
    metadata: row.metadata, sourceLabel: row.source_label, contributorRole: undefined,
  });
}

const all = [];
for (const [conversation, sources] of byConversation) {
  for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] })) all.push(w);
}

const fingerprint = (w) => createHash("sha256")
  .update(`${w.conversationId}|${w.activityDate}|${w.items.map((i) => i.sourceId).slice().sort().join(",")}`)
  .digest("hex").slice(0, 32);

const fresh = all.filter((w) =>
  !spentWindowIds.has(w.windowId) &&
  !spentDays.has(`${w.conversationId}|${w.activityDate}`) &&
  !spentDays.has(`${w.conversationId}|${shanghaiCalendarDate(w.timeRange.from)}`) &&
  !w.items.some((i) => spentAnchors.has(i.sourceId)) &&
  w.stats.messageCount >= 3);
console.log(`Built ${all.length} windows; ${fresh.length} are unspent and usable.`);

// ---------------------------------------------------------------- draw A: language scan
//
// Grammar and change-of-state language, NOT topics. This decides which windows a human READS, never
// what label they get: HV2-B03 matched "第一次" and was labelled borderline anyway, because the
// "first" was about the shape of a crying face.
const SCAN = {
  capability: /会[^，。！？]{0,4}(走|站|爬|坐|说|叫|吃|喝|抓|拿|指|摇|拍|翻)|自己(会|能|可以)|能自己/,
  novelty: /第一次|首次|头一次|第一回|终于|学会|会了|开始会/,
  transition: /现在(会|能|可以)|已经(会|能)|以前.{0,8}现在|比(以前|之前)/,
  recurrence: /又(会|开始|要)|还是|每次都|老是/,
  negation: /还不会|还没(有)?|不会|尚未|没能/,
  question: /[?？]|是不是|有没有|会不会|对吧|是吗/,
  plan: /打算|准备|计划|明天|下周|等他|如果/,
};

const scanned = [];
for (const w of fresh) {
  const text = w.items.map((i) => i.text).join("\n");
  const hits = Object.entries(SCAN).filter(([, re]) => re.test(text)).map(([k]) => k);
  if (hits.length) scanned.push({ w, hits });
}
scanned.sort((a, b) => fingerprint(a.w).localeCompare(fingerprint(b.w)));
console.log(`Language scan matched ${scanned.length} windows.`);
const byHit = {};
for (const s of scanned) for (const h of s.hits) byHit[h] = (byHit[h] ?? 0) + 1;
console.log(`  by marker: ${JSON.stringify(byHit)}`);

// ---------------------------------------------------------------- draw B: per-month quantile
//
// Ordinary/dense coverage that no keyword would ever surface. Deterministic positional sampling
// inside each month, ordered by fingerprint so position carries no information about content.
const byMonth = new Map();
for (const w of fresh) {
  const m = w.activityDate.slice(0, 7);
  if (!byMonth.has(m)) byMonth.set(m, []);
  byMonth.get(m).push(w);
}
const quantile = [];
for (const [month, list] of [...byMonth.entries()].sort()) {
  list.sort((a, b) => fingerprint(a).localeCompare(fingerprint(b)));
  for (let k = 1; k <= PER_MONTH; k += 1) {
    const idx = Math.floor((list.length * k) / (PER_MONTH + 1));
    if (list[idx]) quantile.push({ w: list[idx], month, position: `${k}/${PER_MONTH + 1}` });
  }
}
console.log(`Quantile draw produced ${quantile.length} windows across ${byMonth.size} months.`);

// ---------------------------------------------------------------- emit

const seen = new Set();
const emit = (w, origin, extra) => {
  if (seen.has(w.windowId)) return null;
  seen.add(w.windowId);
  return {
    windowId: w.windowId,
    fingerprint: fingerprint(w),
    conversationId: w.conversationId,
    activityDate: w.activityDate,
    lifeDate: shanghaiCalendarDate(w.timeRange.from),
    anchorSourceId: w.items[0].sourceId,
    origin, ...extra,
    stats: w.stats,
    timeRange: w.timeRange,
    // The text a human needs in order to label honestly. Never committed to the repository.
    messages: w.items.map((i) => ({ sourceId: i.sourceId, sentAt: i.sentAt, sender: i.senderDigest.slice(0, 8), text: i.text })),
  };
};

const candidates = [];
for (const s of scanned) { const c = emit(s.w, "language_scan", { markers: s.hits }); if (c) candidates.push(c); }
for (const q of quantile) { const c = emit(q.w, "quantile", { month: q.month, position: q.position }); if (c) candidates.push(c); }

writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  builder: "organizer-holdout-v3-candidates",
  excluded: { dayPairs: spentDays.size, anchors: spentAnchors.size, shadowWindows: spentWindowIds.size },
  totals: { built: all.length, fresh: fresh.length, languageScan: scanned.length, quantile: quantile.length, candidates: candidates.length },
  candidates,
}, null, 2), "utf8");
console.log(`\n${candidates.length} unique candidates written to ${OUT}`);
console.log("This file contains family chat text. It must stay outside the repository.");
