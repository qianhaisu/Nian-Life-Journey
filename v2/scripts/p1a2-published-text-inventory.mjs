#!/usr/bin/env node
// READ-ONLY: the full renderable text inventory — every publishable DailyTrace's entries (short
// snippets) + the 3 published memories' stories, with ledger detail. This is what composition can use.
import pg from "pg";
import { indexReviews, isTracePublishable, containsTechnicalPlaceholder } from "../lib/organizer/quality-review.ts";
import { isArchiveCountNote } from "../lib/memory-chapters.ts";

const PROFILE_ID = "profile-zhangnian";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: reviewRows } = await client.query(
  `select id, profile_id, target_kind, target_id, decision, subject_relevance, worthiness_score, reason_codes, provider, prompt_version, policy_version, review_fingerprint, reviewed_at::text
   from content_quality_reviews where profile_id = $1`, [PROFILE_ID]);
const reviews = indexReviews(reviewRows.map((r) => ({
  id: r.id, profileId: r.profile_id, targetKind: r.target_kind, targetId: r.target_id, decision: r.decision,
  reasonCodes: r.reason_codes ?? [], provider: r.provider, promptVersion: r.prompt_version,
  policyVersion: r.policy_version, reviewFingerprint: r.review_fingerprint, reviewedAt: r.reviewed_at,
})));
const detail = new Map(reviewRows.map((r) => [`${r.target_kind}:${r.target_id}`, r]));

const { rows: traces } = await client.query(
  `select id, occurred_at::text, entries, source_ids, visibility, organizer_run from daily_traces where profile_id = $1 order by occurred_at`, [PROFILE_ID]);
const trPub = (t) => isTracePublishable({ id: t.id, organizerRun: t.organizer_run ?? null }, reviews) && t.visibility !== "private";

const snip = (t, n = 64) => { const s = String(t).replace(/\s+/g, " ").trim(); return [...s].length <= n ? s : [...s].slice(0, n).join("") + "…"; };

console.log("== ALL PUBLISHABLE TRACES (day | worth | subj | entries) ==");
for (const t of traces.filter(trPub)) {
  const d = detail.get(`daily_trace:${t.id}`);
  console.log(`\n${t.occurred_at.slice(0, 10)} | worth=${d?.worthiness_score ?? "-"} | subj=${d?.subject_relevance ?? "-"} | reasons=${JSON.stringify(d?.reason_codes ?? [])}`);
  for (const e of t.entries ?? []) console.log(`   ${isArchiveCountNote(e) ? "[count] " : ""}${containsTechnicalPlaceholder(e) ? "[placeholder] " : ""}${snip(e)}`);
}

console.log("\n== 3 PUBLISHED MEMORIES: full story ==");
const { rows: evs } = await client.query(
  `select e.id, e.title, e.story, e.story_sections, e.occurred_at::text from life_events e
   join content_quality_reviews r on r.target_kind='life_event' and r.target_id = e.id and r.decision='approved'
   where e.profile_id = $1 order by e.occurred_at`, [PROFILE_ID]);
for (const e of evs) {
  console.log(`\n${e.occurred_at.slice(0, 10)} "${e.title}"`);
  console.log(`   story: ${snip(e.story, 200)}`);
  if (e.story_sections?.length) for (const s of e.story_sections) console.log(`   section: ${snip(s, 120)}`);
}

// The 40 suspicious "msg N" wechat rows: confirm provenance without printing more text.
const { rows: sus } = await client.query(
  `select provider, source_label, min(captured_at)::text as first, max(captured_at)::text as last, count(*)::int as n,
          min(imported_at)::text as imported, min(status) as status
   from raw_sources where profile_id = $1 and text ~ '^msg \\d+ \\d{13}$' group by provider, source_label order by n desc`, [PROFILE_ID]);
console.log("\n== SYNTHETIC 'msg N <epoch>' ROWS ==");
for (const r of sus) console.log(`  ${r.provider}/${r.source_label}: n=${r.n} captured ${r.first.slice(0,16)}..${r.last.slice(0,16)} imported=${r.imported.slice(0,16)} status=${r.status}`);
const { rows: susTrace } = await client.query(
  `select id, occurred_at::text, visibility from daily_traces where profile_id = $1 and occurred_at >= '2026-08-31' order by occurred_at`, [PROFILE_ID]);
for (const t of susTrace) console.log(`  fed trace: ${t.id} @${t.occurred_at.slice(0, 10)} vis=${t.visibility}`);

await client.end();
console.log("\nDONE (read-only).");
