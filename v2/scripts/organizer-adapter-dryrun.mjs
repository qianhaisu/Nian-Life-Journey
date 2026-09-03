#!/usr/bin/env node
// READ-ONLY dry run of the V2 production adapter against real production input.
//
// Plans exactly what WOULD be written for a set of captured pipeline results, then checks every
// planned identity against the rows that already exist. Nothing is written, and no model is called:
// verdicts come from a capture store, so the same run can be repeated for free.
//
// What it is looking for is collisions. A planned artifact id, organization fingerprint or source
// link that already exists means the adapter would merge into or overwrite something the legacy
// organizer wrote, and that must stop the cutover rather than be discovered afterwards.
//
//   node --import tsx -r dotenv/config scripts/organizer-adapter-dryrun.mjs \
//     --corpus=<corpus>.json --store=<verdict dir> [--limit=5] dotenv_config_path=.env.local
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { buildEvidenceWindows, windowFingerprint } from "../lib/organizer/evidence/window.ts";
import { buildMediaIndex } from "../lib/organizer/evidence/media-index.ts";
import { SHANGHAI_LIFE_DATE_SQL } from "../lib/organizer/life-date.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { FROZEN_V6_JUDGMENT, groundingOptionsFor } from "../lib/organizer/judgment-policy.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { planArtifacts, PRODUCTION_ADAPTER_VERSION, artifactIdFor } from "../lib/organizer/production-adapter.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const CORPUS = argOf("corpus", null);
const STORE = argOf("store", null);
const LIMIT = Number(argOf("limit", "5"));
if (!CORPUS || !STORE) { console.error("Need --corpus and --store."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const BASE_OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const NOW = new Date().toISOString();

const POLICY = {
  organizerVersion: PRODUCTION_ADAPTER_VERSION,
  judgmentPolicyId: FROZEN_V6_JUDGMENT.id,
  writerVersion: "writer-v2",
  promptVersion: "memory-editor-v4",
  policyVersion: "contract-v2",
  provider: "deepseek",
  model: "deepseek-v4-pro",
  allowedMediaTiers: ["confirmed"],
};

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }

const corpus = JSON.parse(readFileSync(CORPUS, "utf8"));
const worksheet = corpus.worksheet.slice(0, LIMIT * 6);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

// ---------------------------------------------------------------- real media index
const mediaRows = await client.query(
  `select m.id as media_id, m.media_asset_id, a.media_type, a.mime_type, a.checksum, a.taken_at
     from media m left join media_assets a on a.id = m.media_asset_id
    where m.profile_id = $1`, [PROFILE_ID]);
const locationRows = await client.query(`select media_asset_id, provider, variant, status from media_locations`);
const mediaIndex = buildMediaIndex(
  mediaRows.rows.map((r) => ({ mediaId: r.media_id, mediaAssetId: r.media_asset_id, mediaType: r.media_type, mimeType: r.mime_type, checksum: r.checksum, takenAt: r.taken_at })),
  locationRows.rows.map((r) => ({ mediaAssetId: r.media_asset_id, provider: r.provider, variant: r.variant, status: r.status })),
);
console.log(`media index: ${mediaIndex.size} entries from ${locationRows.rows.length} locations`);

// ---------------------------------------------------------------- windows
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await client.query(`select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources where source_type='wechat' and deleted_at is null and profile_id=$1 order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID]);
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}
const wanted = new Map(worksheet.map((c) => [c.windowId, c]));
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

// ---------------------------------------------------------------- existing rows, for collision checks
const existingEvents = await client.query(`select id, organization_fingerprint, occurred_at from life_events`);
const existingTraces = await client.query(`select id, organization_fingerprint from daily_traces`);
const existingRuns = await client.query(`select organization_fingerprint from organizer_runs`);
const existingLinks = await client.query(`select raw_source_id, life_event_id from source_memory_links`);
const eventIds = new Set(existingEvents.rows.map((r) => r.id));
const traceIds = new Set(existingTraces.rows.map((r) => r.id));
const fingerprints = new Set([...existingEvents.rows, ...existingTraces.rows, ...existingRuns.rows].map((r) => r.organization_fingerprint).filter(Boolean));
const linkedSources = new Set(existingLinks.rows.map((r) => r.raw_source_id));
await client.end();

// ---------------------------------------------------------------- plan
const assetChecksums = new Map(mediaRows.rows.map((r) => [r.media_id, r.checksum ?? undefined]));
const files = readdirSync(STORE).filter((f) => f.startsWith("RC-") && f.endsWith(".json"));
const planned = [];
let collisions = 0;

for (const file of files) {
  if (planned.length >= LIMIT) break;
  const saved = JSON.parse(readFileSync(join(STORE, file), "utf8"));
  const w = windows.get(saved.windowId);
  if (!w) continue;
  const verdictWithAxis = { ...saved.verdict, worthinessAxis: saved.worthinessAxis };
  const grounding = groundClaims(w, verdictWithAxis, SUBJECT, groundingOptionsFor(FROZEN_V6_JUDGMENT, BASE_OPTS));
  const lookup = () => ({ worthiness: saved.worthinessAxis, evidence: saved.evidenceAxis, subjectResolution: saved.boundedLevel, grounding });
  const result = validate(w, verdictWithAxis, {
    now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [],
    routingPolicy: FROZEN_V6_JUDGMENT.createRoutingPolicy(lookup, () => {}), claimGrounding: grounding,
  });

  const fp = windowFingerprint(w, { policyVersion: POLICY.policyVersion, promptVersion: POLICY.promptVersion, modelVersion: POLICY.model }, assetChecksums);
  // A Memory route needs Writer output. The Writer is not run in a dry run, so a placeholder stands
  // in purely to let the plan be built — its text is never written anywhere.
  const story = result.outcome.action === "life_event_candidate"
    ? { title: "(writer output not produced in dry run)", story: "(writer output not produced in dry run)", usedMediaIds: w.mediaBindings.filter((b) => b.tier === "confirmed").map((b) => b.mediaId) }
    : undefined;

  let plan;
  try {
    plan = planArtifacts({ window: w, outcome: result.outcome, windowFingerprint: fp, policy: POLICY, story, judgment: { reasonCodes: result.reasonCodes }, now: NOW, newId: (p) => `${p}-dryrun` });
  } catch (error) {
    console.log(`${saved.caseId}  PLAN REFUSED: ${error.message}`);
    continue;
  }

  const issues = [];
  if (fingerprints.has(fp)) issues.push(`fingerprint ${fp.slice(0, 12)}… already exists`);
  if (plan.lifeEvent && eventIds.has(plan.lifeEvent.event.id)) issues.push(`event id collides`);
  if (plan.dailyTrace && traceIds.has(plan.dailyTrace.id)) issues.push(`trace id collides`);
  const alreadyLinked = plan.sourceIds.filter((id) => linkedSources.has(id));
  if (plan.lifeEvent && alreadyLinked.length) issues.push(`${alreadyLinked.length} source(s) already linked to an existing LifeEvent`);
  if (issues.length) collisions += 1;

  planned.push({ caseId: saved.caseId, label: saved.stratum, action: plan.action, fp, plan, issues });
  const target = plan.lifeEvent ? `event ${plan.lifeEvent.event.id}` : plan.dailyTrace ? `trace ${plan.dailyTrace.id}` : "(no artifact)";
  console.log(`\n${saved.caseId}  route=${plan.action}`);
  console.log(`   fingerprint : ${fp}`);
  console.log(`   artifact    : ${target}`);
  console.log(`   sources     : ${plan.sourceIds.length}  (${alreadyLinked.length} already linked elsewhere)`);
  console.log(`   media       : ${plan.mediaDecisions.filter((d) => d.linked).length} linked / ${plan.mediaDecisions.length} considered`);
  for (const d of plan.mediaDecisions) console.log(`                 ${d.linked ? "LINK  " : "refuse"} ${d.mediaId} [${d.tier}] ${d.reason}`);
  console.log(`   review      : ${plan.review ? `${plan.review.targetKind}/${plan.review.decision}` : "(none)"}`);
  console.log(`   run         : ${plan.run.action} organizerType=${plan.run.organizerType} version=${plan.run.organizerVersion}`);
  if (plan.notes.length) console.log(`   notes       : ${plan.notes.join(" | ")}`);
  console.log(`   collisions  : ${issues.length ? issues.join("; ") : "none"}`);
}

console.log(`\n${"=".repeat(78)}`);
console.log(`DRY RUN — ${planned.length} planned, ${collisions} with collisions. NOTHING WRITTEN.`);
console.log(`existing rows checked: ${eventIds.size} events, ${traceIds.size} traces, ${fingerprints.size} fingerprints, ${linkedSources.size} linked sources`);
const byAction = planned.reduce((a, p) => { a[p.action] = (a[p.action] ?? 0) + 1; return a; }, {});
console.log(`routes: ${JSON.stringify(byAction)}`);
if (collisions > 0) { console.log("\nSTOP: at least one planned artifact collides with production."); process.exit(2); }
console.log("\nNo collisions: every planned artifact is new.");
