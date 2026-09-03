#!/usr/bin/env node
// READ-ONLY P1-A2 Phase 0 audit: "where did the text go?"
// For the target days/months, walks every layer that could carry trusted publication text —
// published LifeEvents, DailyTraces (+ quality ledger), RawSource/WeChat text (+ speaker identity),
// organizer coverage, media binding — and reports what exists, what is published, and what the
// pages actually render. SELECTs only; prints at most a handful of short evidence snippets.
//
//   cd v2 && node --import tsx -r dotenv/config scripts/p1a2-text-audit.mjs dotenv_config_path=.env.local
import pg from "pg";
import { indexReviews, isEventPublishable, isTracePublishable, containsTechnicalPlaceholder } from "../lib/organizer/quality-review.ts";
import { presentableEvidenceText } from "../lib/organizer/evidence-text.ts";
import { resolveSpeaker, displayLabelFor } from "../lib/organizer/identity.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { isArchiveCountNote } from "../lib/memory-chapters.ts";

const PROFILE_ID = "profile-zhangnian";
const DAYS = ["2026-08-26", "2026-08-27"];
const MONTHS = ["2026-08", "2025-10"];

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const dayOf = (ts) => (ts ? String(ts).slice(0, 10) : null);
const monthOf = (ts) => (ts ? String(ts).slice(0, 7) : null);
const snip = (t, n = 42) => { const s = presentableEvidenceText(t).replace(/\s+/g, " ").trim(); return [...s].length <= n ? s : [...s].slice(0, n).join("") + "…"; };

// ---- quality ledger, indexed once ----
const { rows: reviewRows } = await client.query(
  `select id, profile_id, target_kind, target_id, decision, subject_relevance, worthiness_score, reason_codes, provider, prompt_version, policy_version, review_fingerprint, reviewed_at
   from content_quality_reviews where profile_id = $1`, [PROFILE_ID]);
const reviews = indexReviews(reviewRows.map((r) => ({
  id: r.id, profileId: r.profile_id, targetKind: r.target_kind, targetId: r.target_id, decision: r.decision,
  reasonCodes: r.reason_codes ?? [], provider: r.provider, promptVersion: r.prompt_version,
  policyVersion: r.policy_version, reviewFingerprint: r.review_fingerprint, reviewedAt: String(r.reviewed_at),
})));
const reviewDetail = new Map(reviewRows.map((r) => [`${r.target_kind}:${r.target_id}`, r]));

// ---- full tables (small): events, traces, runs ----
const { rows: events } = await client.query(
  `select id, title, story, story_sections, occurred_at::text, source_ids, media_ids, hero_media_id, created_by, organizer_version, organizer_run, visibility, memory_weight, event_type
   from life_events where profile_id = $1 order by occurred_at`, [PROFILE_ID]);
const { rows: traces } = await client.query(
  `select id, occurred_at::text, entries, source_ids, visibility, organizer_run, organization_fingerprint, created_at::text
   from daily_traces where profile_id = $1 order by occurred_at`, [PROFILE_ID]);
const { rows: runs } = await client.query(
  `select id, action, source_ids, target_id, organizer_type, processed_at from organizer_runs where profile_id = $1`, [PROFILE_ID]);

const evPub = (e) => isEventPublishable({ id: e.id, visibility: e.visibility, createdBy: e.created_by, organizerVersion: e.organizer_version, organizerRun: e.organizer_run ?? null }, reviews) && e.visibility !== "private";
const trPub = (t) => isTracePublishable({ id: t.id, organizerRun: t.organizer_run ?? null, createdBy: t.organizer_run?.organizerType === "ai" ? "ai" : "rule" }, reviews) && t.visibility !== "private";

// organizer coverage: raw source id -> covered by which layer
const covered = new Map(); // id -> Set<layer>
const cover = (ids, layer) => { for (const id of ids ?? []) { if (!covered.has(id)) covered.set(id, new Set()); covered.get(id).add(layer); } };
for (const e of events) cover(e.source_ids, "event");
for (const t of traces) cover(t.source_ids, "trace");
for (const r of runs) cover(r.source_ids, `run:${r.action}`);

// ---- per-target raw sources + media ----
async function auditRange(label, from, to) {
  console.log(`\n${"=".repeat(70)}\n== ${label}  [${from} .. ${to})\n${"=".repeat(70)}`);

  const { rows: sources } = await client.query(
    `select id, source_type, captured_at::text, text, source_label, provider, status, visibility, metadata, media_ids, content_types
     from raw_sources where profile_id = $1 and deleted_at is null and captured_at >= $2 and captured_at < $3
     order by captured_at`, [PROFILE_ID, from, to]);

  // -- RawSource text layer --
  const textual = [];
  const bySpeaker = new Map();
  const byType = new Map();
  for (const s of sources) {
    byType.set(s.source_type, (byType.get(s.source_type) ?? 0) + 1);
    const clean = presentableEvidenceText(s.text ?? "");
    const isText = clean.length >= 4 && !containsTechnicalPlaceholder(clean);
    const digest = s.metadata?.senderDigest;
    const speaker = digest ? displayLabelFor(resolveSpeaker(digest, FAMILY_REGISTRY)) : "(no digest)";
    if (isText) {
      textual.push({ ...s, clean, speaker });
      bySpeaker.set(speaker, (bySpeaker.get(speaker) ?? 0) + 1);
    }
  }
  console.log(`rawSources: ${sources.length} | by type: ${JSON.stringify(Object.fromEntries(byType))}`);
  const byLabel = new Map();
  for (const s of textual) { const k = `${s.provider ?? "-"}/${s.source_label}`; byLabel.set(k, (byLabel.get(k) ?? 0) + 1); }
  console.log(`textual by provider/label: ${JSON.stringify(Object.fromEntries(byLabel))}`);
  console.log(`textual (presentable, non-placeholder, >=4 chars): ${textual.length}`);
  console.log(`textual by speaker: ${JSON.stringify(Object.fromEntries(bySpeaker))}`);
  const lens = textual.map((s) => [...s.clean].length).sort((a, b) => a - b);
  if (lens.length) console.log(`textual length p50=${lens[Math.floor(lens.length / 2)]} p90=${lens[Math.floor(lens.length * 0.9)]} max=${lens[lens.length - 1]}`);

  // coverage of textual sources by organizer layers
  const covCount = new Map();
  for (const s of textual) {
    const layers = covered.get(s.id);
    const key = layers ? [...layers].sort().join("+") : "UNCOVERED";
    covCount.set(key, (covCount.get(key) ?? 0) + 1);
  }
  console.log(`textual source organizer coverage: ${JSON.stringify(Object.fromEntries(covCount))}`);

  // -- DailyTrace layer --
  const trs = traces.filter((t) => { const d = String(t.occurred_at); return d >= from && d < to; });
  console.log(`\ndailyTraces: ${trs.length} | publishable: ${trs.filter(trPub).length}`);
  for (const t of trs) {
    const rd = reviewDetail.get(`daily_trace:${t.id}`);
    const entries = t.entries ?? [];
    const clean = entries.filter((e) => !containsTechnicalPlaceholder(e));
    const archiveCount = entries.filter((e) => isArchiveCountNote(e));
    console.log(`  trace ${t.id.slice(0, 18)} @${dayOf(t.occurred_at)} vis=${t.visibility} entries=${entries.length} clean=${clean.length} archiveCountNotes=${archiveCount.length} publishable=${trPub(t)} decision=${rd?.decision ?? "NO_ROW"} subj=${rd?.subject_relevance ?? "-"} worth=${rd?.worthiness_score ?? "-"} sources=${(t.source_ids ?? []).length}`);
  }

  // -- LifeEvent layer --
  const evs = events.filter((e) => { const d = String(e.occurred_at); return d >= from && d < to; });
  console.log(`\nlifeEvents: ${evs.length} | publishable: ${evs.filter(evPub).length}`);
  for (const e of evs) {
    const rd = reviewDetail.get(`life_event:${e.id}`);
    console.log(`  event ${e.id.slice(0, 18)} @${dayOf(e.occurred_at)} vis=${e.visibility} createdBy=${e.created_by} weight=${e.memory_weight} titleLen=${[...(e.title ?? "")].length} storyLen=${[...(e.story ?? "")].length} media=${(e.media_ids ?? []).length} hero=${e.hero_media_id ? "y" : "-"} publishable=${evPub(e)} decision=${rd?.decision ?? "NO_ROW"}`);
  }

  // -- media binding --
  const { rows: media } = await client.query(
    `select id, type, life_event_id, raw_source_id, width, height, taken_at::text, visibility from media
     where profile_id = $1 and taken_at >= $2 and taken_at < $3`, [PROFILE_ID, from, to]);
  const bound = media.filter((m) => m.life_event_id).length;
  const tiny = media.filter((m) => m.width && m.height && (Math.max(m.width, m.height) < 200 || Math.min(m.width, m.height) < 100));
  console.log(`\nmedia (takenAt in range): ${media.length} | event-bound: ${bound} | with rawSource: ${media.filter((m) => m.raw_source_id).length} | tiny(<200 long or <100 short side): ${tiny.length}`);
  if (tiny.length) console.log(`  tiny dims: ${tiny.slice(0, 12).map((m) => `${m.width}x${m.height}`).join(", ")}${tiny.length > 12 ? " …" : ""}`);

  return { sources, textual, trs, evs };
}

const results = {};
for (const d of DAYS) {
  const to = new Date(Date.parse(d + "T00:00:00Z") + 86400e3).toISOString().slice(0, 10);
  results[d] = await auditRange(`DAY ${d}`, d, to);
}
for (const m of MONTHS) {
  const [y, mo] = m.split("-").map(Number);
  const to = `${mo === 12 ? y + 1 : y}-${String((mo % 12) + 1).padStart(2, "0")}-01`;
  results[m] = await auditRange(`MONTH ${m}`, `${m}-01`, to);
}

// ---- representative evidence samples (short, capped) ----
console.log(`\n${"=".repeat(70)}\n== REPRESENTATIVE TEXT EVIDENCE (short snippets, capped)\n${"=".repeat(70)}`);
for (const key of [...DAYS, ...MONTHS]) {
  const t = results[key].textual;
  console.log(`\n-- ${key}: ${t.length} textual sources; up to 6 samples (speaker | capturedAt | len | covered | snippet)`);
  // spread samples across the range rather than head-of-list
  const step = Math.max(1, Math.floor(t.length / 6));
  for (let i = 0; i < t.length && i / step < 6; i += step) {
    const s = t[i];
    const layers = covered.get(s.id);
    console.log(`  ${s.speaker} | ${String(s.captured_at).slice(0, 16)} | ${[...s.clean].length} | ${layers ? [...layers].join("+") : "UNCOVERED"} | ${snip(s.clean)}`);
  }
}

// ---- published trace entries actually rendered for target months ----
console.log(`\n${"=".repeat(70)}\n== PUBLISHED TRACE ENTRIES IN TARGET MONTHS (what month pages can render)\n${"=".repeat(70)}`);
for (const m of MONTHS) {
  const pub = results[m].trs.filter(trPub);
  console.log(`\n-- ${m}: ${pub.length} publishable trace rows`);
  for (const t of pub) for (const e of (t.entries ?? []).slice(0, 4)) console.log(`  @${dayOf(t.occurred_at)} ${isArchiveCountNote(e) ? "[archive-count] " : ""}${snip(e, 60)}`);
}

// ---- named events ----
console.log(`\n${"=".repeat(70)}\n== NAMED EVENTS\n${"=".repeat(70)}`);
const { rows: named } = await client.query(
  `select id, title, story, occurred_at::text, media_ids, hero_media_id, source_ids, created_by, visibility, memory_weight
   from life_events where profile_id = $1 and (title like '%站起来%' or title like '%西红柿%')`, [PROFILE_ID]);
for (const e of named) {
  const rd = reviewDetail.get(`life_event:${e.id}`);
  console.log(`\nevent "${e.title}" (${e.id})`);
  console.log(`  occurredAt=${String(e.occurred_at).slice(0, 16)} weight=${e.memory_weight} publishable=${evPub(e)} decision=${rd?.decision ?? "NO_ROW"} storyLen=${[...(e.story ?? "")].length} sources=${(e.source_ids ?? []).length} mediaIds=${(e.media_ids ?? []).length} hero=${e.hero_media_id ?? "none"}`);
  if ((e.media_ids ?? []).length) {
    const { rows: ms } = await client.query(`select id, type, width, height, taken_at::text, raw_source_id, life_event_id from media where id = any($1)`, [e.media_ids]);
    for (const m of ms) console.log(`    media ${m.id.slice(0, 18)} ${m.type} ${m.width}x${m.height} takenAt=${String(m.taken_at).slice(0, 16)} eventDayMatch=${dayOf(m.taken_at) === dayOf(e.occurred_at)} boundToEvent=${m.life_event_id === e.id}`);
  }
  const { rows: links } = await client.query(`select raw_source_id, role from source_memory_links where life_event_id = $1`, [e.id]);
  console.log(`  source_memory_links: ${links.length} (${links.map((l) => l.role).join(",")})`);
}

// ---- home / recency layer ----
console.log(`\n${"=".repeat(70)}\n== HOME / RECENCY\n${"=".repeat(70)}`);
const pubEvents = events.filter(evPub);
const pubTraces = traces.filter(trPub);
console.log(`published events total: ${pubEvents.length} / ${events.length}`);
for (const e of pubEvents) console.log(`  ${String(e.occurred_at).slice(0, 10)} "${e.title}" weight=${e.memory_weight} storyLen=${[...(e.story ?? "")].length}`);
console.log(`published traces total: ${pubTraces.length} / ${traces.length}`);
const lastPubTrace = pubTraces.map((t) => dayOf(t.occurred_at)).sort().at(-1);
console.log(`latest published trace day: ${lastPubTrace}`);
const trByMonth = new Map();
for (const t of pubTraces) { const m = monthOf(t.occurred_at); trByMonth.set(m, (trByMonth.get(m) ?? 0) + 1); }
console.log(`published traces by month: ${JSON.stringify(Object.fromEntries([...trByMonth.entries()].sort()))}`);
const evByMonth = new Map();
for (const e of events) { const m = monthOf(e.occurred_at); evByMonth.set(m, (evByMonth.get(m) ?? 0) + 1); }
console.log(`ALL events by month (incl. unpublished): ${JSON.stringify(Object.fromEntries([...evByMonth.entries()].sort()))}`);
const trAllByMonth = new Map();
for (const t of traces) { const m = monthOf(t.occurred_at); trAllByMonth.set(m, (trAllByMonth.get(m) ?? 0) + 1); }
console.log(`ALL traces by month (incl. unpublished): ${JSON.stringify(Object.fromEntries([...trAllByMonth.entries()].sort()))}`);

// unpublished-but-clean traces in target months: the "text that exists but is hidden" number
console.log(`\nunpublished traces in target months whose entries look clean (no placeholder):`);
for (const m of MONTHS.concat(["2026-07", "2026-06"])) {
  const rows = traces.filter((t) => monthOf(t.occurred_at) === m && !trPub(t));
  const cleanRows = rows.filter((t) => (t.entries ?? []).length > 0 && (t.entries ?? []).every((e) => !containsTechnicalPlaceholder(e)));
  const partly = rows.filter((t) => (t.entries ?? []).some((e) => !containsTechnicalPlaceholder(e)));
  console.log(`  ${m}: unpublished=${rows.length} fullyClean=${cleanRows.length} withSomeCleanEntry=${partly.length}`);
  for (const t of cleanRows.slice(0, 3)) {
    const rd = reviewDetail.get(`daily_trace:${t.id}`);
    console.log(`     e.g. @${dayOf(t.occurred_at)} decision=${rd?.decision ?? "NO_ROW"} entries=${(t.entries ?? []).length}: ${snip((t.entries ?? [])[0] ?? "", 50)}`);
  }
}

// ---- 张年 page staleness inputs ----
console.log(`\n${"=".repeat(70)}\n== 张年 PAGE INPUTS (growth/care recency)\n${"=".repeat(70)}`);
const { rows: gcount } = await client.query(`select count(*)::int as n from growth_records where profile_id = $1`, [PROFILE_ID]);
const { rows: ccount } = await client.query(`select count(*)::int as n from care_records where profile_id = $1`, [PROFILE_ID]);
console.log(`growth_records total: ${gcount[0].n} | care_records total: ${ccount[0].n}`);
const { rows: growth } = await client.query(`select kind, observed_at::text, source, visibility from growth_records where profile_id = $1 order by observed_at desc limit 12`, [PROFILE_ID]);
for (const g of growth) console.log(`  growth ${g.kind} @${String(g.observed_at).slice(0, 10)} src=${g.source} vis=${g.visibility}`);
const { rows: care } = await client.query(`select kind, observed_at::text, status, visibility from care_records where profile_id = $1 order by observed_at desc limit 8`, [PROFILE_ID]);
for (const c of care) console.log(`  care ${c.kind} @${String(c.observed_at).slice(0, 10)} status=${c.status} vis=${c.visibility}`);
const { rows: snaps } = await client.query(`select month, length(summary) as len, visibility from monthly_snapshot where profile_id = $1`, [PROFILE_ID]);
console.log(`monthly_snapshot rows: ${snaps.map((s) => `${s.month}(len ${s.len}, ${s.visibility})`).join(", ") || "none"}`);

await client.end();
console.log("\nDONE (read-only).");
