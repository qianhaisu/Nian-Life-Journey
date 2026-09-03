#!/usr/bin/env node
// Bounded production plumbing canary for the V2 adapter.
//
// Runs the real production path — Evidence Builder → Claim Grounding → frozen V6 Judgment →
// Adapter → production persistence — for a SMALL, NAMED set of source ids and nothing else. The
// selector (production-selector.ts) enforces that boundary: a job whose sources are not all
// allowlisted runs on legacy.
//
// The Memory Editor is NOT called. Verdicts come from a capture store, and that is a requirement
// rather than a shortcut: the replay phase has to send byte-identical input twice, and a second
// model call would make "did replay create a duplicate?" unanswerable.
//
// DRY RUN unless --apply. Writes a before/after/rollback record either way.
//
//   node --import tsx -r dotenv/config scripts/organizer-v2-plumbing-canary.mjs \
//     --corpus=<corpus>.json --store=<verdicts> --cases=RC-04,RC-08 --out=<record>.json \
//     [--apply] dotenv_config_path=.env.local
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { buildEvidenceWindows, windowFingerprint } from "../lib/organizer/evidence/window.ts";
import { buildMediaIndex } from "../lib/organizer/evidence/media-index.ts";
import { SHANGHAI_LIFE_DATE_SQL } from "../lib/organizer/life-date.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { FROZEN_V6_JUDGMENT, groundingOptionsFor } from "../lib/organizer/judgment-policy.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { planArtifacts, applyPlan, PRODUCTION_ADAPTER_VERSION } from "../lib/organizer/production-adapter.ts";
import { selectProductionOrganizer, jobUsesV2, describeSelection } from "../lib/organizer/production-selector.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const CORPUS = argOf("corpus", null);
const STORE = argOf("store", null);
const CASES = (argOf("cases", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = argOf("out", null);
const APPLY = args.includes("--apply");
if (!CORPUS || !STORE || CASES.length === 0) { console.error("Need --corpus, --store and --cases."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const BASE_OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const NOW = new Date().toISOString();

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }

const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
const selected = CASES.map((id) => corpus.worksheet.find((c) => c.caseId === id)).filter(Boolean);
if (selected.length !== CASES.length) { console.error("Some cases not in corpus."); process.exit(1); }
const allowlist = selected.flatMap((c) => c.sourceIds);

// ---------------------------------------------------------------- selector, bounded to these ids
const selection = selectProductionOrganizer({
  ORGANIZER_V2_ENABLED: "true",
  ORGANIZER_V2_JUDGMENT_POLICY: FROZEN_V6_JUDGMENT.id,
  ORGANIZER_V2_WRITER_VERSION: "writer-v2",
  ORGANIZER_V2_PROMPT_VERSION: "memory-editor-v4",
  ORGANIZER_V2_MODEL: "deepseek-v4-pro",
  ORGANIZER_V2_SOURCE_ALLOWLIST: allowlist.join(","),
});
console.log(describeSelection(selection));
console.log(`Mode: ${APPLY ? "APPLY (production writes)" : "DRY RUN"}\n`);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

const snapshot = async () => (await client.query(
  `select (select count(*) from life_events)::int life_events,
          (select count(*) from daily_traces)::int daily_traces,
          (select count(distinct organization_fingerprint) from daily_traces)::int distinct_fp,
          (select count(*) from (select organization_fingerprint from daily_traces group by 1 having count(*)>1) x)::int dupe_groups,
          (select count(*) from content_quality_reviews)::int reviews,
          (select count(*) from organizer_runs)::int runs,
          (select count(*) from source_memory_links)::int links,
          (select count(*) from media)::int media`)).rows[0];

const before = await snapshot();
console.log("BEFORE:", JSON.stringify(before));

// Source status before, for rollback.
const sourceStateBefore = (await client.query(
  `select id, status, related_life_event_id from raw_sources where id = any($1::text[])`, [allowlist])).rows
  .map((r) => ({ id: r.id, status: r.status, relatedLifeEventId: r.related_life_event_id ?? null }));
const statusCounts = sourceStateBefore.reduce((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
console.log("source status before:", JSON.stringify(statusCounts));

// ---------------------------------------------------------------- media index + windows
const mediaRows = await client.query(
  `select m.id as media_id, m.media_asset_id, a.media_type, a.mime_type, a.checksum, a.taken_at
     from media m left join media_assets a on a.id = m.media_asset_id where m.profile_id=$1`, [PROFILE_ID]);
const locationRows = await client.query(`select media_asset_id, provider, variant, status from media_locations`);
const mediaIndex = buildMediaIndex(
  mediaRows.rows.map((r) => ({ mediaId: r.media_id, mediaAssetId: r.media_asset_id, mediaType: r.media_type, mimeType: r.mime_type, checksum: r.checksum, takenAt: r.taken_at })),
  locationRows.rows.map((r) => ({ mediaAssetId: r.media_asset_id, provider: r.provider, variant: r.variant, status: r.status })),
);
const assetChecksums = new Map(mediaRows.rows.map((r) => [r.media_id, r.checksum ?? undefined]));

const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await client.query(`select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources where source_type='wechat' and deleted_at is null and profile_id=$1 order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID]);
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}
const wanted = new Map(selected.map((c) => [c.windowId, c]));
const byConversation = new Map();
for (const row of rows) {
  const conv = row.source_label;
  if (!byConversation.has(conv)) byConversation.set(conv, []);
  byConversation.get(conv).push({ id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types, contributorId: String(row.metadata?.senderDigest ?? row.contributor_id), capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at), text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata, sourceLabel: row.source_label });
}
const windows = new Map();
for (const [conversation, sources] of byConversation) {
  for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] }, { mediaIndex })) {
    if (wanted.has(w.windowId)) windows.set(w.windowId, w);
  }
}

// ---------------------------------------------------------------- repository adapter
const repo = {
  async findOrganizerRun(fp) {
    const r = await client.query(`select * from organizer_runs where organization_fingerprint=$1 limit 1`, [fp]);
    if (!r.rows[0]) return null;
    const row = r.rows[0];
    return { id: row.id, profileId: row.profile_id, action: row.action, sourceIds: row.source_ids, targetId: row.target_id, organizerType: row.organizer_type, organizerVersion: row.organizer_version, provider: row.provider, model: row.model, promptVersion: row.prompt_version, processedAt: row.processed_at, organizationFingerprint: row.organization_fingerprint, sourceCount: row.source_count, mediaInputCount: row.media_input_count, latencyMs: row.latency_ms };
  },
  async persistOrganization() { throw new Error("Memory persistence is not part of the plumbing canary"); },
  async persistDailyTrace(trace) {
    const existing = await client.query(`select id from daily_traces where organization_fingerprint=$1 for update`, [trace.organizationFingerprint]);
    if (existing.rows[0]) return { ...trace, id: existing.rows[0].id };
    await client.query(
      `insert into daily_traces (id, profile_id, occurred_at, entries, source_ids, scopes, visibility, organizer_run, organization_fingerprint, created_at, updated_at)
       values ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9,now(),now()) on conflict (id) do nothing`,
      [trace.id, trace.profileId, trace.occurredAt, JSON.stringify(trace.entries), JSON.stringify(trace.sourceIds), JSON.stringify(trace.scopes), trace.visibility, JSON.stringify(trace.organizerRun), trace.organizationFingerprint]);
    return trace;
  },
  async persistOrganizerRun(run) {
    await client.query(
      `insert into organizer_runs (id, profile_id, organization_fingerprint, organizer_type, organizer_version, provider, model, prompt_version, action, source_ids, target_id, source_count, media_input_count, processed_at, latency_ms)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15) on conflict (id) do nothing`,
      [run.id, run.profileId, run.organizationFingerprint, run.organizerType, run.organizerVersion, run.provider, run.model ?? null, run.promptVersion ?? null, run.action, JSON.stringify(run.sourceIds), run.targetId ?? null, run.sourceCount, run.mediaInputCount, run.processedAt, run.latencyMs ?? 0]);
    return run;
  },
  async markSourcesOrganized(ids) {
    await client.query(`update raw_sources set status='organized' where id = any($1::text[]) and status <> 'organized'`, [ids]);
  },
  async persistQualityReview() { throw new Error("No review row is expected on a plumbing canary route"); },
};

// ---------------------------------------------------------------- run
const record = { startedAt: NOW, mode: APPLY ? "apply" : "dry-run", selection: describeSelection(selection), before, sourceStateBefore, cases: [] };
let failed = false;

for (const entry of selected) {
  const w = windows.get(entry.windowId);
  const file = join(STORE, `${entry.caseId}.json`);
  if (!w || !existsSync(file)) { console.log(`${entry.caseId}: SKIP (window or verdict missing)`); failed = true; continue; }
  if (!jobUsesV2(selection, w.items.map((i) => i.sourceId))) { console.log(`${entry.caseId}: SKIP (not fully allowlisted)`); failed = true; continue; }

  const saved = JSON.parse(readFileSync(file, "utf8"));
  const verdictWithAxis = { ...saved.verdict, worthinessAxis: saved.worthinessAxis };
  const grounding = groundClaims(w, verdictWithAxis, SUBJECT, groundingOptionsFor(selection.judgment, BASE_OPTS));
  const lookup = () => ({ worthiness: saved.worthinessAxis, evidence: saved.evidenceAxis, subjectResolution: saved.boundedLevel, grounding });
  const result = validate(w, verdictWithAxis, {
    now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [],
    routingPolicy: selection.judgment.createRoutingPolicy(lookup, () => {}),
    // No silent fallback: the validator throws if the active policy is not the one we named.
    expectedRoutingPolicyId: selection.judgment.routingPolicyId,
    claimGrounding: grounding,
  });

  const fp = windowFingerprint(w, { policyVersion: selection.adapterPolicy.policyVersion, promptVersion: selection.adapterPolicy.promptVersion, modelVersion: selection.adapterPolicy.model }, assetChecksums);
  const plan = planArtifacts({ window: w, outcome: result.outcome, windowFingerprint: fp, policy: selection.adapterPolicy, judgment: { reasonCodes: result.reasonCodes }, now: NOW, newId: (p) => `${p}-canary-${fp.slice(0, 12)}` });

  console.log(`\n${entry.caseId}: route=${plan.action} fingerprint=${fp.slice(0, 16)}…`);
  console.log(`   sources=${plan.sourceIds.length} artifact=${plan.dailyTrace?.id ?? plan.lifeEvent?.event.id ?? "(none)"} review=${plan.review ? "yes" : "none"}`);
  if (plan.notes.length) console.log(`   notes: ${plan.notes.join(" | ")}`);

  const caseRecord = { caseId: entry.caseId, windowId: entry.windowId, fingerprint: fp, action: plan.action, sourceIds: plan.sourceIds, artifactId: plan.dailyTrace?.id ?? plan.lifeEvent?.event.id ?? null, runId: plan.run.id, reasonCodes: result.reasonCodes };

  if (APPLY) {
    const applied = await applyPlan(plan, repo, { newId: (p) => `${p}-canary-${fp.slice(0, 12)}`, now: NOW });
    caseRecord.applied = applied.applied;
    caseRecord.appliedReason = applied.reason;
    console.log(`   APPLIED: ${applied.applied} (${applied.reason})`);
  }
  record.cases.push(caseRecord);
}

record.after = await snapshot();
console.log(`\nAFTER: ${JSON.stringify(record.after)}`);
const delta = Object.fromEntries(Object.keys(before).map((k) => [k, record.after[k] - before[k]]));
record.delta = delta;
console.log(`DELTA: ${JSON.stringify(delta)}`);
await client.end();

if (OUT) { writeFileSync(OUT, JSON.stringify(record, null, 2)); console.log(`\nRecord + rollback identities -> ${OUT}`); }
process.exit(failed ? 1 : 0);
