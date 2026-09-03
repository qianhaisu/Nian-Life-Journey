#!/usr/bin/env node
// READ-ONLY structural audit of every production LifeEvent created by the legacy rule organizer.
// SELECTs only; never touches life_events, raw_sources, source_memory_links, media or the quality
// ledger. It prints no family text — only ids, dates, counts, regex-derived shape flags and pointer
// consistency — so its console output and JSON are safe to keep outside the repo as decision material.
// KEEP / REWRITE / RETIRE / UNCERTAIN is a human call; this script only supplies the evidence.
//
//   node --import tsx -r dotenv/config scripts/organizer-legacy-lifeevent-audit.mjs \
//     [--out=<path outside the repo>.json] [--overlap=<json file with {sourceIds:[...]}>] \
//     dotenv_config_path=.env.local
//
// --overlap answers the Memory-canary question "which legacy events already own these sources?"
// (the RC-12 / event-6b2dfc4d collision) without any write.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import pg from "pg";
import { containsTechnicalPlaceholder, indexReviews, isEventPublishable } from "../lib/organizer/quality-review.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const OVERLAP = argOf("overlap", null);
const PROFILE_ID = "profile-zhangnian";
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
if (OUT && (resolve(OUT) === REPO_ROOT || resolve(OUT).startsWith(REPO_ROOT + sep))) {
  console.error("--out must point outside the repository (the JSON carries source ids and dates)."); process.exit(1);
}

// Mirrors rule-based.ts: the milestone regex that promoted a batch to create_memory.
const MILESTONE = /第一次|首次|开始|学会|主动|生日|旅行|里程碑|first\s*time|milestone|birthday|travel/gi;
// Title-shape flags (taxonomy in docs/organizer-legacy-lifeevent-audit-2026-09-03.md).
const SHAPE = {
  NUM: /^\s*\d{2}\\?\.\d\s*$/,                           // temperature / bare number
  GPS: /^\s*\\?\[位置\\?\]|\(\d{2}\.\d+,\d{2,3}\.\d+\)/,
  URL: /https?:\/\/|^\s*\\?\[链接\\?\]|^\s*\[[^\]]+\]\(https?:/,
  AD: /【淘宝】|携程|拼多多|京东|\\?\[小程序\\?\]/,
  FILE: /^\s*\[(视频文件|图片文件|语音文件)\]|^\s*\\?\[视频\\?\]/,
  EMO: /^\s*(\\\[[^\]\\]{1,6}\\\]\s*)+$/,
  MEDIA: /^\s*\[media\]\s*$/,
  Q: /[？?]\s*$/,
};
const isTextual = (t) => { const s = (t ?? "").trim(); return Boolean(s) && !/^\\?\[[^\]]*\\?\]\s*$/.test(s) && !/^\[(media|视频文件)\]/.test(s); };

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: events } = await client.query(`
  select e.id, e.title, e.story, e.occurred_at, e.source_ids, e.media_ids, e.hero_media_id, e.organizer_version,
         e.created_by, e.visibility, e.memory_weight, e.event_type, e.organizer_run, e.organization_fingerprint
  from life_events e where e.profile_id = $1 order by e.occurred_at, e.id`, [PROFILE_ID]);
const { rows: reviewRows } = await client.query(`
  select id, profile_id, target_kind, target_id, decision, reason_codes, provider, prompt_version, policy_version,
         review_fingerprint, reviewed_at
  from content_quality_reviews where profile_id = $1 and target_kind = 'life_event'`, [PROFILE_ID]);
const reviews = indexReviews(reviewRows.map((r) => ({
  id: r.id, profileId: r.profile_id, targetKind: r.target_kind, targetId: r.target_id, decision: r.decision,
  reasonCodes: r.reason_codes ?? [], provider: r.provider, promptVersion: r.prompt_version,
  policyVersion: r.policy_version, reviewFingerprint: r.review_fingerprint, reviewedAt: String(r.reviewed_at),
})));
const reviewByTarget = new Map(reviewRows.map((r) => [r.target_id, r]));
const { rows: links } = await client.query(`
  select l.life_event_id, l.raw_source_id, l.role, s.captured_at, s.text, s.media_ids, s.related_life_event_id, s.status
  from source_memory_links l join raw_sources s on s.id = l.raw_source_id
  where l.life_event_id = any($1::text[])`, [events.map((e) => e.id)]);
const { rows: runs } = await client.query(`
  select organization_fingerprint, action, organizer_version, source_count, processed_at
  from organizer_runs where organization_fingerprint = any($1::text[])`, [events.map((e) => e.organization_fingerprint)]);
const runByFp = new Map(runs.map((r) => [r.organization_fingerprint, r]));
const linksByEvent = new Map();
for (const l of links) { if (!linksByEvent.has(l.life_event_id)) linksByEvent.set(l.life_event_id, []); linksByEvent.get(l.life_event_id).push(l); }
const eventsBySource = new Map();
for (const l of links) { if (!eventsBySource.has(l.raw_source_id)) eventsBySource.set(l.raw_source_id, new Set()); eventsBySource.get(l.raw_source_id).add(l.life_event_id); }

const rows = [];
for (const e of events) {
  const ls = (linksByEvent.get(e.id) ?? []).sort((a, b) => String(a.captured_at).localeCompare(String(b.captured_at)));
  const sourceIds = Array.isArray(e.source_ids) ? e.source_ids : JSON.parse(e.source_ids ?? "[]");
  const primary = ls.find((l) => l.role === "primary");
  const firstText = ls.map((l) => l.text?.trim()).find(Boolean) ?? null; // rule-based.ts: sources.find(s => s.text)
  const joined = ls.map((l) => l.text ?? "").join("\n");
  const signalHits = [...new Set((joined.match(MILESTONE) ?? []).map((s) => s.toLowerCase()))];
  const signalLines = ls.filter((l) => { MILESTONE.lastIndex = 0; return MILESTONE.test(l.text ?? ""); }).length;
  const spanHours = ls.length > 1 ? (new Date(ls[ls.length - 1].captured_at) - new Date(ls[0].captured_at)) / 36e5 : 0;
  const shape = Object.entries(SHAPE).filter(([, re]) => re.test(e.title ?? "")).map(([k]) => k);
  if (ls.length <= 2) shape.push("WEAK");
  if (spanHours >= 3 || ls.length >= 10) shape.push("DAY");
  const isRule = e.organizer_version === "rule-v2";
  const titleIsSlice = isRule && firstText != null && (e.title ?? "") === firstText.slice(0, 80);
  const storyIsSlice = isRule && firstText != null && (e.story ?? "") === firstText.slice(0, 420);
  if (titleIsSlice) shape.push("SLICE");
  const review = reviewByTarget.get(e.id);
  const run = runByFp.get(e.organization_fingerprint);
  const pointerMismatch = ls.filter((l) => l.related_life_event_id !== e.id).length;
  const multiLinked = ls.filter((l) => (eventsBySource.get(l.raw_source_id)?.size ?? 0) > 1).length;
  const publishable = isEventPublishable({ id: e.id, createdBy: e.created_by, organizerVersion: e.organizer_version, organizerRun: e.organizer_run ?? null }, reviews)
    && !containsTechnicalPlaceholder(e.title) && !containsTechnicalPlaceholder(e.story);
  rows.push({
    lifeEventId: e.id, occurredAt: String(e.occurred_at).slice(0, 10), createdBy: e.created_by, organizerVersion: e.organizer_version,
    memoryWeight: e.memory_weight, eventType: e.event_type, visibility: e.visibility,
    runAction: run?.action ?? null, runSourceCount: run?.source_count ?? null, runProcessedAt: run ? String(run.processed_at) : null,
    linkCount: ls.length, sourceIdCount: sourceIds.length, linkSourceIdMismatch: ls.length !== sourceIds.length,
    textualCount: ls.filter((l) => isTextual(l.text)).length, mediaIdCount: Array.isArray(e.media_ids) ? e.media_ids.length : 0,
    heroIsFirstMedia: Boolean(e.hero_media_id) && Array.isArray(e.media_ids) && e.media_ids[0] === e.hero_media_id,
    spanHours: Number(spanHours.toFixed(1)), primaryIsEarliest: primary ? primary.raw_source_id === ls[0]?.raw_source_id : null,
    titleLength: (e.title ?? "").length, storyLength: (e.story ?? "").length, titleIsFirstTextSlice80: titleIsSlice, storyIsFirstTextSlice420: storyIsSlice,
    signalHits, signalLineCount: signalLines, shape,
    pointerMismatchCount: pointerMismatch, multiLinkedSourceCount: multiLinked,
    ledger: review ? { decision: review.decision, promptVersion: review.prompt_version, reasonCodes: review.reason_codes ?? [] } : null,
    publishedNow: publishable,
  });
}

const count = (f) => rows.filter(f).length;
console.log(`${rows.length} LifeEvents · ${links.length} links · ledger rows ${reviewRows.length} · visible now ${count((r) => r.publishedNow)}`);
console.log(`created by rule-v2 create_memory: ${count((r) => r.runAction === "create_memory")} · still rule-v2 text: ${count((r) => r.organizerVersion === "rule-v2")} · title==slice80: ${count((r) => r.titleIsFirstTextSlice80)} · story==slice420: ${count((r) => r.storyIsFirstTextSlice420)}`);
console.log(`signal path (memory): ${count((r) => r.memoryWeight === "memory")} · ≤2-source path (trace): ${count((r) => r.memoryWeight === "trace")} · link/source_ids mismatch: ${count((r) => r.linkSourceIdMismatch)} · pointer mismatch: ${count((r) => r.pointerMismatchCount > 0)} · sources linked to >1 event: ${count((r) => r.multiLinkedSourceCount > 0)}`);
const shapeCounts = {};
for (const r of rows) for (const s of r.shape) shapeCounts[s] = (shapeCounts[s] ?? 0) + 1;
console.log("title/batch shape flags:", shapeCounts);
const sigCounts = {};
for (const r of rows) for (const s of r.signalHits) sigCounts[s] = (sigCounts[s] ?? 0) + 1;
console.log("milestone regex tokens that fired (per event):", sigCounts);
console.log("ledger decisions:", reviewRows.reduce((a, r) => ((a[r.decision] = (a[r.decision] ?? 0) + 1), a), {}), `· no ledger row: ${count((r) => !r.ledger)}`);
for (const r of rows) {
  console.log(`  ${r.lifeEventId.slice(0, 14)} ${r.occurredAt} n=${String(r.linkCount).padStart(3)} span=${String(r.spanHours).padStart(4)}h ${r.memoryWeight.padEnd(6)} ${r.organizerVersion === "rule-v2" ? "rule" : "DSW "} ledger=${(r.ledger?.decision ?? "—").padEnd(24)} sig=[${r.signalHits.join(",")}] ${r.shape.join(" ")}`);
}

if (OVERLAP) {
  const w = JSON.parse(readFileSync(OVERLAP, "utf8"));
  const want = new Set(w.sourceIds ?? []);
  const owners = new Map();
  for (const l of links) if (want.has(l.raw_source_id)) owners.set(l.life_event_id, (owners.get(l.life_event_id) ?? 0) + 1);
  const { rows: ptr } = await client.query(`select related_life_event_id, status, count(*)::int n from raw_sources where id = any($1::text[]) group by 1,2`, [[...want]]);
  console.log(`\noverlap for ${want.size} sourceIds:`);
  for (const [id, n] of owners) { const ev = rows.find((r) => r.lifeEventId === id); console.log(`  ${id} owns ${n}/${want.size} (event has ${ev?.linkCount} links → window ⊂ event: ${n === want.size && ev.linkCount >= n})`); }
  if (owners.size === 0) console.log("  no legacy LifeEvent links any of these sources");
  console.log("  raw_sources.related_life_event_id:", ptr);
}

if (OUT) writeFileSync(OUT, JSON.stringify({ auditedAt: new Date().toISOString(), totalLifeEvents: rows.length, ledgerRows: reviewRows.length, shapeCounts, rows }, null, 2));
await client.end();
