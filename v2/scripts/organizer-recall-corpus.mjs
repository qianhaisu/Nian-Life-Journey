#!/usr/bin/env node
// Builds a HUMAN-LABELLING WORKSHEET of fresh evidence windows for the recall investigation.
//
// This is a development/diagnosis corpus, not a holdout. The funnel
// (scripts/organizer-recall-funnel.mjs) showed 0 Memories from 110 fresh windows splitting into two
// causes: 65 lost at subject resolution and 25 that cleared every routing gate and were refused
// only because no strong worthiness signal survived. Deciding whether that second group is a real
// recall defect needs windows a human has judged BEFORE any model runs — which is what this
// produces.
//
// It makes NO model calls and issues SELECTs only. The worksheet carries family chat verbatim, so
// its output belongs in the session scratchpad, never in the repository.
//
// Selection is deliberately enriched for plausible positives (Teddy's Phase F: the point is to
// study recall, so actively look for material that might deserve a Memory). Enrichment changes
// which windows a human READS; it never changes what counts as a Memory, and the strata are
// recorded so the sample's shape is auditable rather than implied.
//
//   node --import tsx -r dotenv/config scripts/organizer-recall-corpus.mjs \
//     --exclude=<prior run>.json ... --target=50 --out=<path>.json dotenv_config_path=.env.local
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate, shanghaiDateSqlFromInstant } from "../lib/organizer/life-date.ts";
import { DEVELOPMENT_SET, HOLDOUT_SET } from "../lib/organizer/calibration-sets.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";
import { HOLDOUT_V3_SET } from "../lib/organizer/calibration-sets-v3.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { resolveSpeaker } from "../lib/organizer/identity.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const TARGET = Number(argOf("target", "50"));
const EXCLUDE = args.filter((a) => a.startsWith("--exclude=")).map((a) => a.slice(10));
// Exclusion granularity. `day` is the holdout rule: a whole calendar day is burned once any window
// on it has been scored, which is right for a generalisation test because same-day windows share
// context and would leak. `window` is the development rule: a window is spent if its fingerprint or
// ANY of its messages was used before, so no scored message is ever re-read, but an untouched
// window on a previously-visited day is still available.
//
// This corpus is explicitly a diagnosis set, not a holdout (Teddy, Phase F), and the day rule makes
// it impossible to build: of 671 windows in the archive, 652 are day-spent, leaving 9 — none of
// them capability-shaped. `window` is therefore the default here, and the manifest records which
// rule produced the sample so it can never be mistaken for a holdout later.
const EXCLUSION = argOf("exclusion", "window");
if (!["window", "day"].includes(EXCLUSION)) { console.error(`--exclusion must be window|day`); process.exit(1); }
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }

// ---------------------------------------------------------------- spent material (never re-used)
const spentDays = new Set();
const spentAnchors = new Set();
const spentFingerprints = new Set();
for (const c of DEVELOPMENT_SET) { spentDays.add(`${c.conversation}|${c.day}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V2_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V3_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_SET) { spentDays.add(`${MAIN}|${c.day}`); spentDays.add(`${MAIN}|${c.dayAsOriginallyRecorded}`); }
// Every window any earlier shadow, holdout or canary already scored, by fingerprint AND by day.
for (const file of EXCLUDE) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const rows = [...(data.results ?? []), ...(data.scored ?? []), ...(data.cases ?? []), ...(data.windows ?? []), ...(data.manifest?.windows ?? []), ...(data.records ?? [])];
  for (const w of rows) {
    if (w.fingerprint) spentFingerprints.add(w.fingerprint);
    for (const id of w.sourceIds ?? []) spentAnchors.add(id);
    for (const d of [w.activityDate, w.lifeDate, w.day, w.windowLifeDate]) if (d) spentDays.add(`${w.conversationId ?? MAIN}|${d}`);
  }
}
console.log(`Excluded as spent: ${spentDays.size} (conversation, day) pairs, ${spentAnchors.size} sourceIds, ${spentFingerprints.size} fingerprints, from ${EXCLUDE.length} files.`);

// ---------------------------------------------------------------- load
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await client.query(`select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources where source_type='wechat' and deleted_at is null and profile_id=$1 order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID]);
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}
// A day that already holds a LifeEvent is already represented in the archive; a Memory there would
// be taxonomy J (duplicate-like), which is not what this corpus is trying to measure.
const { rows: eventDays } = await client.query(`select distinct ${shanghaiDateSqlFromInstant("occurred_at")} as d from life_events where profile_id=$1`, [PROFILE_ID]);
for (const r of eventDays) spentDays.add(`${MAIN}|${r.d}`);
await client.end();
console.log(`Loaded ${rows.length} raw sources; ${eventDays.length} days already hold a LifeEvent.`);

const byConversation = new Map();
for (const row of rows) {
  const conv = row.source_label;
  if (!byConversation.has(conv)) byConversation.set(conv, []);
  byConversation.get(conv).push({ id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types, contributorId: String(row.metadata?.senderDigest ?? row.contributor_id), capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at), text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata, sourceLabel: row.source_label });
}

// ---------------------------------------------------------------- shape classification (regex only)
// Every classifier below is lexical and runs before any model call, so the strata cannot be
// contaminated by a verdict. They decide what a human READS, not what anything is labelled.
const NAMES = SUBJECT.aliases.concat(SUBJECT.primaryName);
const named = (t) => NAMES.some((n) => t.includes(n));
const PRONOUN = /他|她|宝宝|娃|小家伙/;
// Capability-shaped vocabulary: what a developmental transition or a new independence tends to
// sound like in this family's writing. Presence is a reason to READ the window, nothing more.
const CAPABILITY = /会\s*(自己|走|站|爬|坐|说|叫|翻身|扶|抓|拿|吃|喝|指)|学会|第一次|自己\s*(走|站|爬|坐|吃|喝|拿|穿|上|下|玩)|能\s*(自己|走|站|爬|坐)|终于|突然.{0,4}会|长牙|出牙|叫\s*(妈妈|爸爸|奶奶|爷爷)|扶着走|独站|放手/;
const RELATIONSHIP = /抱|亲|笑|想(妈妈|爸爸|奶奶|爷爷)|粘|喜欢|舍不得|哭着找/;
// Negative shapes: material that must never become a Memory about 张年.
const LOGISTICS = /几点|订|快递|地址|开会|加班|报销|发票|停车|打车|买单|多少钱|付款|收款/;
const ARTICLE = /\\?\[链接\\?\]|\\?\[小程序\\?\]|公众号|转发|文章/;
const AD = /优惠|团购|秒杀|拼团|领券|活动价/;
const QUESTION_PLAN = /[？?]$|打算|准备|计划|明天要|下周|以后|是不是|要不要/;
const MEDIA_ONLY = /^\s*(\\?\[(视频|图片|表情包|语音|文件|动画表情)\\?\]\s*)+$/;

const fingerprint = (w) => createHash("sha256").update(`${w.conversationId}|${w.activityDate}|${w.items.map((i) => i.sourceId).sort().join(",")}`).digest("hex").slice(0, 32);
const lifeDateOf = (w) => shanghaiCalendarDate(w.timeRange.from);

const candidates = [];
let built = 0, spent = 0, tooSmall = 0, spentByWindow = 0, spentByDay = 0, onVisitedDay = 0;
for (const [conversation, sources] of byConversation) {
  for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] })) {
    built += 1;
    const fp = fingerprint(w);
    const lifeDate = lifeDateOf(w);
    const dayKeys = [`${w.conversationId}|${w.activityDate}`, `${w.conversationId}|${lifeDate}`];
    const windowSpent = spentFingerprints.has(fp) || w.items.some((i) => spentAnchors.has(i.sourceId));
    const daySpent = dayKeys.some((k) => spentDays.has(k));
    if (windowSpent || (EXCLUSION === "day" && daySpent)) { spent += 1; if (windowSpent) spentByWindow += 1; else spentByDay += 1; continue; }
    if (w.stats.messageCount < 4) { tooSmall += 1; continue; }
    // Under the window rule a previously-visited day is still usable, but the sample must say how
    // much of it is that kind of window, because same-day context is a weaker independence claim.
    // Counted after the size filter so it describes the candidate pool, not everything inspected.
    if (daySpent) onVisitedDay += 1;

    const text = w.items.map((i) => i.text).join("\n");
    const hasName = named(text);
    const hasPronoun = PRONOUN.test(text);
    const neighbourNames = [...w.neighbors.before, ...w.neighbors.after].some((i) => named(i.text));
    const capability = CAPABILITY.test(text);
    const relationship = RELATIONSHIP.test(text);

    // Strata, most specific first. `capability_named` is the enrichment stratum that matters: the
    // child is named in-window (so subject resolution cannot be the blocker) AND the text carries
    // capability vocabulary — precisely the population where a strong-signal miss would show up.
    let stratum;
    if (capability && hasName) stratum = "capability_named";
    else if (capability && (hasPronoun || neighbourNames)) stratum = "capability_pronoun";
    else if (relationship && hasName) stratum = "relationship_named";
    else if (MEDIA_ONLY.test(text.trim())) stratum = "negative_media_only";
    else if (ARTICLE.test(text) || AD.test(text)) stratum = "negative_article_or_ad";
    else if (LOGISTICS.test(text) && !hasName && !hasPronoun) stratum = "negative_logistics";
    else if (QUESTION_PLAN.test(text) && (hasName || hasPronoun)) stratum = "ambiguous_question_or_plan";
    else if (hasName || neighbourNames) stratum = "ordinary_named";
    else stratum = "ordinary_unnamed";

    candidates.push({ w, fp, lifeDate, stratum, hasName, hasPronoun, neighbourNames, capability, relationship, onVisitedDay: daySpent });
  }
}
console.log(`Built ${built} windows; ${spent} spent (${spentByWindow} by window/message overlap, ${spentByDay} by day rule); ${tooSmall} under 4 messages; ${candidates.length} candidates (${onVisitedDay} of them on a previously-visited day).`);

// ---------------------------------------------------------------- stratified draw
// Quotas favour the strata that can answer the recall question, while keeping real negatives and
// ambiguous cases in the sample so precision damage would still be visible.
const QUOTA = {
  capability_named: 16,
  capability_pronoun: 8,
  relationship_named: 6,
  ordinary_named: 8,
  ambiguous_question_or_plan: 5,
  negative_article_or_ad: 3,
  negative_logistics: 2,
  negative_media_only: 2,
  ordinary_unnamed: 0,
};
const byStratum = new Map();
for (const c of candidates) byStratum.set(c.stratum, [...(byStratum.get(c.stratum) ?? []), c]);
// Deterministic and calendar-free: sort by fingerprint, which carries no date information.
for (const list of byStratum.values()) list.sort((a, b) => a.fp.localeCompare(b.fp));

const available = Object.fromEntries([...byStratum].map(([k, v]) => [k, v.length]));
console.log(`Available per stratum: ${JSON.stringify(available)}`);

const picked = [];
for (const [stratum, quota] of Object.entries(QUOTA)) {
  const list = byStratum.get(stratum) ?? [];
  // Spread the draw across the whole stratum rather than taking a fingerprint-adjacent clump.
  const step = Math.max(1, Math.floor(list.length / Math.max(1, quota)));
  for (let i = 0, taken = 0; i < list.length && taken < quota && picked.length < TARGET; i += step, taken += 1) picked.push(list[i]);
}
console.log(`Drew ${picked.length} windows (target ${TARGET}).`);

// ---------------------------------------------------------------- worksheet
const speakerOf = (digest) => {
  const s = resolveSpeaker(digest, FAMILY_REGISTRY);
  return s.known ? s.narrativeLabel : `未知(${String(digest).slice(0, 6)})`;
};
const worksheet = picked.map((c, index) => ({
  caseId: `RC-${String(index + 1).padStart(2, "0")}`,
  windowId: c.w.windowId,
  fingerprint: c.fp,
  conversationId: c.w.conversationId,
  lifeDate: c.lifeDate,
  activityDate: c.w.activityDate,
  stratum: c.stratum,
  onPreviouslyVisitedDay: c.onVisitedDay,
  shape: { hasName: c.hasName, hasPronoun: c.hasPronoun, neighbourNames: c.neighbourNames, capability: c.capability, relationship: c.relationship },
  stats: c.w.stats,
  sourceIds: c.w.items.map((i) => i.sourceId),
  itemIds: c.w.items.map((i) => i.itemId),
  // Verbatim, with speaker, in order — this is what the human reads to assign a label.
  messages: c.w.items.map((i) => ({ item: i.itemId, at: i.sentAt, speaker: speakerOf(i.senderDigest), text: i.text, media: (i.mediaRefs ?? []).length, tier: i.tier })),
  neighbours: {
    before: c.w.neighbors.before.slice(-3).map((i) => ({ speaker: speakerOf(i.senderDigest), text: i.text })),
    after: c.w.neighbors.after.slice(0, 3).map((i) => ({ speaker: speakerOf(i.senderDigest), text: i.text })),
  },
  // Frozen by the human BEFORE any model call.
  label: null,          // likely_memory | daily_trace | negative | ambiguous
  rationale: null,
  cleanPositive: null,  // Phase G, only for likely_memory
}));

const manifest = {
  generatedAt: new Date().toISOString(),
  purpose: "recall diagnosis / development corpus — NOT a holdout, not a generalisation test",
  exclusionRule: EXCLUSION,
  builtWindows: built, spentExcluded: spent, spentByWindowOverlap: spentByWindow, spentByDayRule: spentByDay,
  freshCandidates: candidates.length, candidatesOnPreviouslyVisitedDay: onVisitedDay,
  availablePerStratum: available, quota: QUOTA, selected: worksheet.length,
  selectedPerStratum: worksheet.reduce((a, w) => { a[w.stratum] = (a[w.stratum] ?? 0) + 1; return a; }, {}),
  excludeFiles: EXCLUDE,
};
console.log(`\nSelected per stratum: ${JSON.stringify(manifest.selectedPerStratum, null, 2)}`);
if (OUT) { writeFileSync(OUT, JSON.stringify({ manifest, worksheet }, null, 2)); console.log(`\nWorksheet (CONTAINS FAMILY TEXT — keep outside the repository) → ${OUT}`); }
