#!/usr/bin/env node
// Builds the FROZEN pronoun-recall corpus for the subject-continuity experiment (Phase A3,
// 2026-09-03). Read-only against the database, zero model calls, deterministic selection.
//
// Not a Holdout: no labels are assigned. Windows are classified by regex SHAPE only, before any
// verdict exists, so the selection cannot be steered by outcomes:
//
//   continuity_candidate  bare pronoun, no name in window±5, an earlier name inside continuity bounds
//   stale_antecedent      same, but the nearest earlier name is outside the bounds
//   competing_child       bare pronoun with another child in scope
//   adult_ambiguity       bare pronoun, no name, an adult mentioned in the third person in the window
//   resolvable_now        bare pronoun already resolvable through the ±5 neighbours (control)
//   logistics             neither pronoun nor name (control: continuity must not touch)
//   named                 the window names the child (control)
//
// Everything already spent is excluded: development set, Holdout 1, Holdout V2, Holdout V3, the V6
// fresh shadow corpus and the Writer v2 shadow days.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { DEVELOPMENT_SET, HOLDOUT_SET } from "../lib/organizer/calibration-sets.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";
import { HOLDOUT_V3_SET } from "../lib/organizer/calibration-sets-v3.ts";
import { DEFAULT_CONTINUITY_BOUNDS } from "../lib/organizer/subject-continuity.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const OUT = argOf("out", null);
const PROFILE_ID = argOf("profile", "profile-zhangnian");
// Optional extra exclusion files: JSON with manifest.windows[].sourceIds (V6 corpus) or cases[].lifeDate (writer shadow).
const EXCLUDE = args.filter((a) => a.startsWith("--exclude=")).map((a) => a.slice(10));
// continuity_probe_day_spent: the window itself was never part of any set, but another window of
// the same day was (development set / Holdout 1 / Holdout V2). Kept as a clearly labelled probe
// because the archive holds NO fully fresh continuity candidate; never a Holdout V3 / V6 / Writer day.
const QUOTA = { continuity_candidate: 10, continuity_probe_day_spent: 10, stale_antecedent: 8, competing_child: 7, adult_ambiguity: 8, resolvable_now: 5, logistics: 5, named: 3 };

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Set CONTRACT_DATABASE_URL or DATABASE_URL."); process.exit(1); }
const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";

// ---------------------------------------------------------------- spent material
const spentDays = new Set();
const spentAnchors = new Set();
// Days that must stay out even of the day-spent probe: Holdout V3 (never rerun, never tuned
// against), the V6 fresh corpus and the Writer v2 shadow days.
const hardSpentDays = new Set();
for (const c of DEVELOPMENT_SET) { spentDays.add(`${c.conversation}|${c.day}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V2_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V3_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); hardSpentDays.add(`${c.conversation}|${c.lifeDate}`); spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_SET) { spentDays.add(`${MAIN}|${c.day}`); spentDays.add(`${MAIN}|${c.dayAsOriginallyRecorded}`); }
for (const file of EXCLUDE) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const w of data.manifest?.windows ?? []) { for (const id of w.sourceIds ?? []) spentAnchors.add(id); spentDays.add(`${w.conversationId}|${w.activityDate}`); hardSpentDays.add(`${w.conversationId}|${w.activityDate}`); if (w.lifeDate) { spentDays.add(`${w.conversationId}|${w.lifeDate}`); hardSpentDays.add(`${w.conversationId}|${w.lifeDate}`); } }
  for (const c of data.cases ?? []) if (c.lifeDate) { spentDays.add(`${MAIN}|${c.lifeDate}`); hardSpentDays.add(`${MAIN}|${c.lifeDate}`); }
}
console.log(`Spent material excluded: ${spentDays.size} (conversation, day) pairs, ${spentAnchors.size} sourceIds.`);

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
await client.end();
const byConversation = new Map();
for (const row of rows) {
  const conv = row.source_label;
  if (!byConversation.has(conv)) byConversation.set(conv, []);
  byConversation.get(conv).push({ id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types, contributorId: String(row.metadata?.senderDigest ?? row.contributor_id), capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at), text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata, sourceLabel: row.source_label });
}

// ---------------------------------------------------------------- classify by shape
const NAMES = ["张年", "张小年", "小年", "年年", "宝宝"];
const PRONOUN = /他|她|娃|崽/;
const COMPETING = /其他小朋友|别的孩子|别的小朋友|另一个孩子|同学|哥哥|姐姐|弟弟|妹妹|双胞胎|同伴|小伙伴|表弟|表妹|堂弟|堂妹|小女孩|小男孩|别人家的孩子|人家的孩子|人家孩子|同龄|邻居家/;
const ADULT = /爸爸|爸比|老公|妈妈|老婆|雪姨|阿姨|育儿嫂|保姆|爷爷|奶奶|外公|外婆|姥姥|姥爷|舅舅|舅妈|叔叔|姑姑|姨妈|小姨|婆婆|公公|老师|医生|护士|师傅|快递|司机|Ted|阿静|苏静|hxx/;
const names = (t) => NAMES.some((n) => t.includes(n));
const fingerprint = (w) => createHash("sha256").update(`${w.conversationId}|${w.activityDate}|${w.items.map((i) => i.sourceId).sort().join(",")}`).digest("hex").slice(0, 32);
const lifeDateOf = (w) => shanghaiCalendarDate(w.timeRange.from);
const bounds = DEFAULT_CONTINUITY_BOUNDS;

const classified = [];
let built = 0, spent = 0;
for (const [conversation, sources] of byConversation) {
  const windows = buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
  const all = windows.flatMap((w) => w.items);
  const indexOf = new Map(all.map((it, i) => [it.itemId, i]));
  for (const w of windows) {
    built += 1;
    const dayKeys = [`${w.conversationId}|${w.activityDate}`, `${w.conversationId}|${lifeDateOf(w)}`];
    const spentByWindow = w.items.some((i) => spentAnchors.has(i.sourceId));
    const spentByHardDay = dayKeys.some((k) => hardSpentDays.has(k));
    const spentByDay = dayKeys.some((k) => spentDays.has(k));
    if (spentByWindow || spentByHardDay) { spent += 1; continue; }
    const text = w.items.map((i) => i.text).join("\n");
    const neigh = [...w.neighbors.before, ...w.neighbors.after];
    const scope = [text, ...neigh.map((i) => i.text)].join("\n");
    let shape, detail = {};
    if (names(text)) shape = "named";
    else if (!PRONOUN.test(text)) shape = "logistics";
    else if (COMPETING.test(scope)) shape = "competing_child";
    else if (neigh.some((i) => names(i.text))) shape = "resolvable_now";
    else if (ADULT.test(text)) shape = "adult_ambiguity";
    else {
      const start = indexOf.get(w.items[0].itemId);
      let found = -1;
      for (let i = start - 1; i >= 0 && start - i <= 400; i -= 1) if (names(all[i].text)) { found = i; break; }
      if (found < 0) shape = "stale_antecedent";
      else {
        const messages = start - found;
        const minutes = Math.round((Date.parse(w.items[0].sentAt) - Date.parse(all[found].sentAt)) / 60000);
        detail = { nearestNameDistance: { messages, minutes } };
        shape = messages <= bounds.maxMessages && minutes <= bounds.maxMinutes ? "continuity_candidate" : "stale_antecedent";
      }
    }
    if (spentByDay) {
      if (shape !== "continuity_candidate") { spent += 1; continue; }
      shape = "continuity_probe_day_spent";
    }
    classified.push({ w, shape, detail });
  }
}
console.log(`Built ${built} windows; ${spent} excluded as spent; ${classified.length} fresh.`);
const shapeTally = classified.reduce((acc, c) => { acc[c.shape] = (acc[c.shape] ?? 0) + 1; return acc; }, {});
console.log(`Fresh windows by shape: ${JSON.stringify(shapeTally)}`);

// ---------------------------------------------------------------- select (deterministic, by fingerprint order)
const picked = [];
for (const [shape, quota] of Object.entries(QUOTA)) {
  const pool = classified.filter((c) => c.shape === shape && c.w.stats.messageCount >= 2).sort((a, b) => fingerprint(a.w).localeCompare(fingerprint(b.w)));
  picked.push(...pool.slice(0, quota));
}
console.log(`Selected ${picked.length} windows: ${JSON.stringify(picked.reduce((acc, c) => { acc[c.shape] = (acc[c.shape] ?? 0) + 1; return acc; }, {}))}`);

const manifest = {
  generatedAt: new Date().toISOString(),
  builder: "organizer-continuity-corpus",
  profileId: PROFILE_ID,
  bounds,
  totals: { built, spent, fresh: classified.length, selected: picked.length, freshByShape: shapeTally },
  excluded: { spentDayPairs: spentDays.size, spentSourceIds: spentAnchors.size, files: EXCLUDE },
  windows: picked.map(({ w, shape, detail }) => ({
    windowId: w.windowId, fingerprint: fingerprint(w), conversationId: w.conversationId, activityDate: w.activityDate, lifeDate: lifeDateOf(w),
    stratum: shape, ...detail, messageCount: w.stats.messageCount, imageCount: w.stats.imageCount, senderCount: w.stats.senderCount, sourceIds: w.items.map((i) => i.sourceId),
  })),
};
// The shadow needs every window of each conversation to attach continuity context, so the corpus
// carries the full ordered window list per conversation alongside the selection.
const conversations = {};
for (const [conversation, sources] of byConversation) conversations[conversation] = buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
if (OUT) {
  writeFileSync(OUT, JSON.stringify({ manifest, windows: picked.map((c) => c.w), conversations }), "utf8");
  console.log(`Corpus written to ${OUT} (contains family chat text — keep outside the repository).`);
}
