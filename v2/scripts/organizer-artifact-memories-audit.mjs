#!/usr/bin/env node
// READ-ONLY audit of production LifeEvents whose title/story is a bare WeChat exporter artifact
// ([视频], [表情包], [小程序]…, [位置]…, [链接]…). It issues SELECTs only and never touches
// life_events, the quality ledger, or visibility. The output is the decision material for a
// separate, explicitly authorised hide action — this script is not that action.
//
//   node --import tsx -r dotenv/config scripts/organizer-artifact-memories-audit.mjs \
//     --out=<path>.json dotenv_config_path=.env.local
import { writeFileSync } from "node:fs";
import pg from "pg";
import { QUALITY_REVIEW_POLICY_VERSION, containsTechnicalPlaceholder, isEventPublishable, indexReviews } from "../lib/organizer/quality-review.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const PROFILE_ID = "profile-zhangnian";

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

// A bare exporter token. The rule organizer stored the exporter's markdown-escaped form, so the
// brackets in production text are literally `\[视频\]`. Three shapes exist:
//   core     — `\[视频\]`, `\[表情包\]`, `\[小程序\]…`, `\[位置\]…`, `\[链接\]…` (the 11 in the findings doc)
//   media    — `[media]` and `[视频文件](media/…)` import placeholders
//   emoji    — `\[呲牙\]`, `\[发呆\]`, `\[其他消息\]` — a WeChat sticker code or exporter fallback
const CORE = /^\s*\\\[(视频|表情包|小程序|位置|链接)\\\]/;
const MEDIA = /^\s*\[(media|视频文件|图片文件|语音文件)\]/;
const EMOJI = /^\s*(\\\[[^\]\\]{1,6}\\\]\s*)+$/;
const kind = (text) => {
  const t = text ?? "";
  const core = CORE.exec(t);
  if (core) return { set: "core", token: core[1] };
  const media = MEDIA.exec(t);
  if (media) return { set: "media", token: media[1] };
  if (EMOJI.test(t)) return { set: "emoji", token: t.replace(/\\/g, "").slice(0, 12) };
  return null;
};

const { rows: events } = await client.query(`
  select e.id, e.title, e.story, e.occurred_at, e.source_ids, e.organizer_version, e.created_by,
         e.visibility, e.created_at, e.organizer_run
  from life_events e
  where e.profile_id = $1
  order by e.occurred_at desc, e.id`, [PROFILE_ID]);

const { rows: reviewRows } = await client.query(`
  select id, profile_id, target_kind, target_id, decision, gate_a, subject_relevance, worthiness_score,
         reason_codes, provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at
  from content_quality_reviews where profile_id = $1 and target_kind = 'life_event'`, [PROFILE_ID]);
const reviews = indexReviews(reviewRows.map((r) => ({
  id: r.id, profileId: r.profile_id, targetKind: r.target_kind, targetId: r.target_id, decision: r.decision,
  reasonCodes: r.reason_codes ?? [], provider: r.provider, promptVersion: r.prompt_version,
  policyVersion: r.policy_version, reviewFingerprint: r.review_fingerprint, reviewedAt: String(r.reviewed_at),
})));
const reviewByTarget = new Map(reviewRows.map((r) => [r.target_id, r]));

const artifacts = events.filter((e) => kind(e.title) && kind(e.story) && (e.story ?? "").trim() === (e.title ?? "").trim());

const rows = [];
for (const e of artifacts) {
  const sourceIds = Array.isArray(e.source_ids) ? e.source_ids : JSON.parse(e.source_ids ?? "[]");
  const { rows: sources } = await client.query(
    `select id, source_label, captured_at, text, content_types from raw_sources where id = any($1::text[])`, [sourceIds]);
  const review = reviewByTarget.get(e.id);
  const publishable = isEventPublishable(
    { id: e.id, createdBy: e.created_by, organizerVersion: e.organizer_version, organizerRun: e.organizer_run ?? null }, reviews);
  const rendersCleanly = !containsTechnicalPlaceholder(e.title) && !containsTechnicalPlaceholder(e.story);
  const { set, token: k } = kind(e.title);
  const why = set === "media" ? `import placeholder [${k}] — a media reference with no words; the media itself is not attached to the event`
    : set === "emoji" ? `WeChat sticker / fallback code ${k} — not a sentence`
    : k === "视频" || k === "表情包"
    ? `exporter media placeholder [${k}] with no caption — nothing happened in words`
    : k === "小程序" ? "mini-program share card — a booking tool, not a life fact"
    : k === "位置" ? "shared location card (hotel + GPS) — family location data, not a memory"
    : k === "链接" ? (/不支持展示|升级/.test(e.title) ? "WeChat version-upgrade notice — platform text, not family text"
                     : "third-party article title — about babies in general, not this child")
    : `exporter token [${k}]`;
  rows.push({
    lifeEventId: e.id,
    occurredAt: e.occurred_at,
    title: set === "core" && k === "位置" ? "\\[位置\\] <hotel name + GPS redacted>" : e.title,
    storyEqualsTitle: true,
    artifactSet: set,
    tokenKind: k,
    organizerVersion: e.organizer_version,
    createdBy: e.created_by,
    visibility: e.visibility,
    sourceIds,
    sourceCount: sources.length,
    sourceShapes: sources.map((s) => ({ id: s.id, capturedAt: s.captured_at, contentTypes: s.content_types, sameTextAsTitle: (s.text ?? "").trim() === (e.title ?? "").trim() })),
    whyArtifact: why,
    ledger: review
      ? { id: review.id, decision: review.decision, promptVersion: review.prompt_version, policyVersion: review.policy_version, reviewedAt: review.reviewed_at, reasonCodes: review.reason_codes }
      : null,
    publishedNow: publishable && rendersCleanly,
    publicationGate: !publishable ? "hidden: rule-derived with no approved ledger row" : !rendersCleanly ? "hidden: technical-placeholder text gate" : "VISIBLE to the family",
    proposedAction: review && review.decision !== "approved"
      ? `none needed — ledger already ${review.decision}`
      : `insert content_quality_reviews row {target_kind: life_event, target_id: ${e.id}, decision: rejected_unrelated, provider: human, prompt_version: artifact-audit-2026-09-03, policy_version: ${QUALITY_REVIEW_POLICY_VERSION}}; visibility untouched; no delete`,
  });
}

const bySet = (s) => rows.filter((r) => r.artifactSet === s);
console.log(`${events.length} LifeEvents; ${artifacts.length} are bare exporter artifacts (title == story == token): core ${bySet("core").length}, media ${bySet("media").length}, emoji ${bySet("emoji").length}.`);
console.log(`ledger rows for life_events: ${reviewRows.length}; decisions:`, reviewRows.reduce((a, r) => ((a[r.decision] = (a[r.decision] ?? 0) + 1), a), {}));
for (const r of rows) {
  console.log(`  ${r.artifactSet.padEnd(5)} ${r.lifeEventId} ${String(r.occurredAt).slice(0, 10)} [${r.tokenKind}] ${r.organizerVersion} sources=${r.sourceCount} ledger=${r.ledger?.decision ?? "—"} ${r.publicationGate}`);
}
const visible = rows.filter((r) => r.publishedNow).length;
console.log(`visible to the family right now: ${visible}/${rows.length}`);
const allPublishable = events.filter((e) => isEventPublishable({ id: e.id, createdBy: e.created_by, organizerVersion: e.organizer_version, organizerRun: e.organizer_run ?? null }, reviews)
  && !containsTechnicalPlaceholder(e.title) && !containsTechnicalPlaceholder(e.story));
console.log(`LifeEvents that pass the publication gate overall: ${allPublishable.length}/${events.length}`);

if (OUT) writeFileSync(OUT, JSON.stringify({ auditedAt: new Date().toISOString(), totalLifeEvents: events.length, ledgerRows: reviewRows.length, rows }, null, 2));
await client.end();
