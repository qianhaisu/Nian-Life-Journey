#!/usr/bin/env node
// Bounded production MEMORY canary for the V2 adapter — the Memory-route half the plumbing canary
// (organizer-v2-plumbing-canary.mjs) deliberately left untested.
//
// One evidence window, the real path, every stage gated:
//   plan       rebuild the window, derive the deterministic artifact id, print exact pointer effects.
//              No model call, no write.
//   judge      ONE live Memory Editor call → Subject Resolution → Claim Grounding → frozen V6
//              routing → validator. Saves the judgment to --out. Refuses to run twice: a second
//              call would be "retry until it promotes", which is not evidence of anything.
//   write      ONE live Writer v2 call over the Evidence Package, Narrative Validator. Saved.
//   predeclare planArtifacts() over the saved judgment + story. Prints every id and pointer the
//              apply stage will touch. No write.
//   apply      applyPlan() through the real PostgreSQL repository. Before/after snapshot + delta.
//   replay     applyPlan() again with the identical plan; must be refused by the run guard with
//              zero delta.
//
// Model stages are saved rather than re-run because the editor is not deterministic across calls
// (V6 freeze record): replaying a plan must mean replaying THE plan, byte-identical.
//
// Records under --out carry family chat text: keep that directory outside the repository.
//
//   node --import tsx -r dotenv/config scripts/organizer-v2-memory-canary.mjs \
//     --window=<{caseId,windowId,sourceIds}>.json --out=<dir> --stage=plan|judge|write|predeclare|apply|replay \
//     dotenv_config_path=.env.local
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { buildEvidenceWindows, windowFingerprint } from "../lib/organizer/evidence/window.ts";
import { buildMediaIndex } from "../lib/organizer/evidence/media-index.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { FROZEN_V6_JUDGMENT, groundingOptionsFor } from "../lib/organizer/judgment-policy.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { buildEvidencePackage, packageHasAssertableMaterial } from "../lib/organizer/writer-v2.ts";
import { WRITER_V2_SYSTEM_PROMPT, WRITER_V2_TOOL_NAME, WRITER_V2_TOOL_SCHEMA, WRITER_V2_PROMPT_VERSION, buildWriterV2Prompt } from "../lib/organizer/writer-v2-prompt.ts";
import { validateNarrative, NARRATIVE_VALIDATOR_VERSION } from "../lib/organizer/narrative-validator.ts";
import { resolveSpeaker } from "../lib/organizer/identity.ts";
import { planArtifacts, applyPlan, artifactIdFor, PRODUCTION_ADAPTER_VERSION } from "../lib/organizer/production-adapter.ts";
import { selectProductionOrganizer, jobUsesV2, describeSelection } from "../lib/organizer/production-selector.ts";
import { QUALITY_REVIEW_POLICY_VERSION } from "../lib/organizer/quality-review.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const WINDOW_FILE = argOf("window", null);
const OUT = argOf("out", null);
const STAGE = argOf("stage", null);
const STAGES = ["plan", "judge", "write", "predeclare", "apply", "replay"];
if (!WINDOW_FILE || !OUT || !STAGES.includes(STAGE)) { console.error(`Need --window, --out and --stage=${STAGES.join("|")}.`); process.exit(1); }
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
if (resolve(OUT).toLowerCase().startsWith(REPO_ROOT.toLowerCase())) { console.error("--out must be outside the repository (records carry family text)."); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const BASE_OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const NOW = new Date().toISOString();
const entry = JSON.parse(readFileSync(WINDOW_FILE, "utf8"));
const JUDGMENT_FILE = join(OUT, `${entry.caseId}-judgment.json`);
const WRITER_FILE = join(OUT, `${entry.caseId}-writer.json`);
const PLAN_FILE = join(OUT, `${entry.caseId}-plan.json`);

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }

// ---------------------------------------------------------------- selector, bounded to this window
const selection = selectProductionOrganizer({
  ORGANIZER_V2_ENABLED: "true",
  ORGANIZER_V2_JUDGMENT_POLICY: FROZEN_V6_JUDGMENT.id,
  ORGANIZER_V2_WRITER_VERSION: "writer-v2",
  ORGANIZER_V2_PROMPT_VERSION: "memory-editor-v4",
  ORGANIZER_V2_MODEL: "deepseek-v4-pro",
  ORGANIZER_V2_SOURCE_ALLOWLIST: entry.sourceIds.join(","),
});
console.log(describeSelection(selection));
console.log(`stage=${STAGE}  case=${entry.caseId}  window=${entry.windowId}  sources=${entry.sourceIds.length}\n`);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();
const q = async (sql, p = []) => (await client.query(sql, p)).rows;

const snapshot = async () => (await q(
  `select (select count(*) from life_events)::int life_events,
          (select count(*) from daily_traces)::int daily_traces,
          (select count(*) from (select organization_fingerprint from daily_traces group by 1 having count(*)>1) x)::int dupe_groups,
          (select count(*) from content_quality_reviews)::int reviews,
          (select count(*) from organizer_runs)::int runs,
          (select count(*) from source_memory_links)::int links,
          (select count(*) from media)::int media,
          (select count(*) from raw_sources)::int raw_sources`))[0];

const pointerState = async (sourceIds, mediaIds) => ({
  sources: await q(`select related_life_event_id owner, status, count(*)::int n from raw_sources where id = any($1::text[]) group by 1,2 order by 1,2`, [sourceIds]),
  links: await q(`select life_event_id owner, count(*)::int n from source_memory_links where raw_source_id = any($1::text[]) group by 1 order by 1`, [sourceIds]),
  media: mediaIds.length ? await q(`select id, life_event_id owner from media where id = any($1::text[]) order by 1`, [mediaIds]) : [],
});

// ---------------------------------------------------------------- media index + window
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
const conversation = (await q(`select distinct source_label from raw_sources where id = any($1::text[])`, [entry.sourceIds])).map((r) => r.source_label);
if (conversation.length !== 1) { console.error(`window sources span ${conversation.length} conversations`); process.exit(1); }
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await client.query(`select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources where source_type='wechat' and deleted_at is null and profile_id=$1 and source_label=$2 order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID, conversation[0]]);
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}
const sources = rows.map((row) => ({ id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types, contributorId: String(row.metadata?.senderDigest ?? row.contributor_id), capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at), text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata, sourceLabel: row.source_label }));
const w = buildEvidenceWindows(conversation[0], PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] }, { mediaIndex }).find((x) => x.windowId === entry.windowId);
if (!w) { console.error("window could not be rebuilt"); await client.end(); process.exit(1); }
const windowSourceIds = [...new Set(w.items.map((i) => i.sourceId))];
const sameSet = windowSourceIds.length === entry.sourceIds.length && windowSourceIds.every((id) => entry.sourceIds.includes(id));
if (!sameSet) { console.error(`rebuilt window has ${windowSourceIds.length} sources, worksheet has ${entry.sourceIds.length}; not the same evidence`); await client.end(); process.exit(1); }
if (!jobUsesV2(selection, windowSourceIds)) { console.error("window is not fully allowlisted"); await client.end(); process.exit(1); }

const fp = windowFingerprint(w, { policyVersion: selection.adapterPolicy.policyVersion, promptVersion: selection.adapterPolicy.promptVersion, modelVersion: selection.adapterPolicy.model }, assetChecksums);
const EVENT_ID = artifactIdFor("event", fp);
const newId = (p) => `${p}-canary-${fp.slice(0, 12)}`;
const windowMediaIds = w.mediaBindings.map((b) => b.mediaId);
console.log(`fingerprint      ${fp}`);
console.log(`deterministic id ${EVENT_ID}`);
console.log(`run id           ${newId("organizer-run")}`);
console.log(`review id        ${newId("quality-review")}`);
console.log(`activityDate     ${w.activityDate}   range ${w.timeRange.from} → ${w.timeRange.to}   items ${w.items.length}`);
console.log(`media bindings   ${w.mediaBindings.map((b) => `${b.mediaId} tier=${b.tier} conf=${b.confidence}`).join("\n                 ") || "(none)"}`);
console.log(`adapter tiers    ${selection.adapterPolicy.allowedMediaTiers.join(",")}`);

const identityOf = (digest) => { const s = resolveSpeaker(digest, FAMILY_REGISTRY); return { speakerDigest: digest, known: s.known, canonicalPersonId: s.canonicalPersonId, narrativeLabel: s.narrativeLabel, relationshipToSubject: s.relationshipToSubject }; };

// ---------------------------------------------------------------- stages
if (STAGE === "plan") {
  console.log("\npointer state now:", JSON.stringify(await pointerState(windowSourceIds, windowMediaIds), null, 1));
  console.log("existing rows under this identity:", JSON.stringify({
    event: await q(`select id from life_events where id=$1 or organization_fingerprint=$2`, [EVENT_ID, fp]),
    run: await q(`select id from organizer_runs where organization_fingerprint=$1`, [fp]),
    review: await q(`select id from content_quality_reviews where target_id=$1`, [EVENT_ID]),
  }));
}

if (STAGE === "judge") {
  if (existsSync(JUDGMENT_FILE)) { console.error(`REFUSED: ${JUDGMENT_FILE} exists — the single live Judgment attempt has already been spent.`); await client.end(); process.exit(1); }
  if (!process.env.DEEPSEEK_API_KEY) { console.error("Need DEEPSEEK_API_KEY."); await client.end(); process.exit(1); }
  const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...BASE_OPTS });
  console.log(`\neditor ${editor.name} ${editor.model} ${editor.promptVersion}  — ONE live call`);
  const started = Date.now();
  const raw = (await editor.organize(w)).verdict;
  const latencyMs = Date.now() - started;
  const verdict = validateMemoryEditorVerdict(raw, w);
  const axes = editor.axesByWindowId.get(w.windowId);
  const bounded = editor.subjectResolutionByWindowId.get(w.windowId);
  if (!axes || !bounded) throw new Error("missing axes");
  const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
  const grounding = groundClaims(w, verdictWithAxis, SUBJECT, groundingOptionsFor(selection.judgment, BASE_OPTS));
  const lookup = () => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding });
  const result = validate(w, verdictWithAxis, {
    now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [],
    routingPolicy: selection.judgment.createRoutingPolicy(lookup, () => {}),
    expectedRoutingPolicyId: selection.judgment.routingPolicyId,
    claimGrounding: grounding,
  });
  const record = { caseId: entry.caseId, windowId: w.windowId, fingerprint: fp, attemptedAt: NOW, latencyMs, editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion }, routingPolicyId: selection.judgment.routingPolicyId, verdict, worthinessAxis: axes.worthinessAxis, evidenceAxis: axes.evidenceAxis, bounded, grounding, outcome: result.outcome, reasonCodes: result.reasonCodes };
  writeFileSync(JUDGMENT_FILE, JSON.stringify(record, null, 2));
  console.log(`\nLIVE JUDGMENT: action=${result.outcome.action} worthiness=${result.outcome.worthinessScore ?? 0} latency=${latencyMs}ms`);
  console.log(`  subject: level=${bounded.level} relevance=${verdict.subjectRelevance} blockers=${(bounded.blockers ?? []).join(",") || "-"}  temporal=${verdict.temporalStatus}`);
  console.log(`  grounding: claims=${grounding.claims.length} promotable=${grounding.promotableGroundedFactCount} trace=${grounding.traceEvidenceCount}`);
  console.log(`  reasonCodes: ${result.reasonCodes.join(", ") || "-"}`);
  console.log(`  outcome.sourceIds=${result.outcome.sourceIds?.length ?? 0}  occurredAt=${result.outcome.occurredAt ?? "-"}  eventType=${result.outcome.eventType ?? "-"}`);
  console.log(`saved -> ${JUDGMENT_FILE}`);
  if (result.outcome.action !== "life_event_candidate") { console.log("\nRC-12 MEMORY CANARY BLOCKED — LIVE JUDGMENT DID NOT PROMOTE"); await client.end(); process.exit(2); }
}

const loadJudgment = () => { if (!existsSync(JUDGMENT_FILE)) { console.error("no saved judgment; run --stage=judge first"); process.exit(1); } const j = JSON.parse(readFileSync(JUDGMENT_FILE, "utf8")); if (j.fingerprint !== fp) { console.error("saved judgment fingerprint differs from the rebuilt window"); process.exit(1); } return j; };

if (STAGE === "write") {
  if (existsSync(WRITER_FILE)) { console.error(`REFUSED: ${WRITER_FILE} exists — the single Writer call has already been spent.`); await client.end(); process.exit(1); }
  const j = loadJudgment();
  if (j.outcome.action !== "life_event_candidate") { console.error("saved judgment is not a Memory route"); await client.end(); process.exit(2); }
  const apiKey = process.env.DEEPSEEK_API_KEY; const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "").replace(/\/$/, "");
  if (!apiKey || !baseUrl) { console.error("Need DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL."); await client.end(); process.exit(1); }
  const pkg = buildEvidencePackage({
    window: w, windowFingerprint: fp, grounding: j.grounding,
    selectedBy: { policyId: j.routingPolicyId, action: j.outcome.action, worthinessScore: j.outcome.worthinessScore ?? 0 },
    subject: { ...SUBJECT, narrativeLabel: "张年" }, identityOf,
    quotableLines: (j.verdict.quotableLines ?? []).map((x) => ({ text: x.text, evidenceRef: x.evidenceRef, speakerRole: x.speakerRole })),
    longitudinal: [], lifeDate: shanghaiCalendarDate(w.timeRange.from),
  });
  console.log(`\npackage: claims=${pkg.claims.length} assertable=${pkg.claims.filter((c) => c.assertable).length} quotes=${pkg.quotes.length} media=${pkg.media.map((m) => `${m.mediaId}:${m.tier}`).join(",") || "-"} people=${pkg.identity.people.map((p) => p.narrativeLabel ?? "?").join("/")}`);
  if (!packageHasAssertableMaterial(pkg)) { console.log("nothing assertable — Writer not called"); writeFileSync(WRITER_FILE, JSON.stringify({ fingerprint: fp, skipped: "nothing_assertable", package: pkg }, null, 2)); await client.end(); process.exit(3); }
  const body = JSON.stringify({ model: selection.adapterPolicy.model, max_tokens: 3000, temperature: 0, thinking: { type: "disabled" }, system: WRITER_V2_SYSTEM_PROMPT, tools: [{ name: WRITER_V2_TOOL_NAME, description: "输出这一页的标题、正文和逐句依据", input_schema: WRITER_V2_TOOL_SCHEMA }], tool_choice: { type: "tool", name: WRITER_V2_TOOL_NAME }, messages: [{ role: "user", content: buildWriterV2Prompt(pkg) }] });
  const started = Date.now();
  const res = await fetch(`${baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`writer http ${res.status}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === WRITER_V2_TOOL_NAME);
  if (!tool) throw new Error("writer returned no tool_use");
  const output = { contractVersion: "writer-v2-output-contract-v1", ...tool.input };
  const validation = validateNarrative({ pkg, output });
  writeFileSync(WRITER_FILE, JSON.stringify({ fingerprint: fp, writtenAt: NOW, latencyMs: Date.now() - started, promptVersion: WRITER_V2_PROMPT_VERSION, validatorVersion: NARRATIVE_VALIDATOR_VERSION, model: selection.adapterPolicy.model, usage: payload.usage, package: pkg, output, validation }, null, 2));
  console.log(`\nWRITER: insufficient=${output.insufficient} validator=${validation.ok ? "ACCEPT" : "REJECT"} ${validation.issues.map((i) => `${i.code}${i.detail ? `(${i.detail})` : ""}`).join(", ")}`);
  console.log(`title: ${output.title ?? "-"}`);
  console.log(`story: ${output.story ?? "-"}`);
  console.log(`narrativeClaims: ${JSON.stringify(output.narrativeClaims ?? [], null, 1)}`);
  console.log(`usedClaimIds=${(output.usedClaimIds ?? []).join(",")} usedQuoteIds=${(output.usedQuoteIds ?? []).join(",")} usedMediaIds=${(output.usedMediaIds ?? []).join(",") || "-"}`);
  console.log(`saved -> ${WRITER_FILE}`);
  if (output.insufficient || !validation.ok) { console.log("\nRC-12 WRITER VALIDATION FAILED"); await client.end(); process.exit(3); }
}

const buildPlan = () => {
  const j = loadJudgment();
  if (!existsSync(WRITER_FILE)) { console.error("no saved writer output; run --stage=write first"); process.exit(1); }
  const wr = JSON.parse(readFileSync(WRITER_FILE, "utf8"));
  if (wr.fingerprint !== fp || wr.skipped || wr.output.insufficient || !wr.validation.ok) { console.error("saved writer output is not an accepted story"); process.exit(3); }
  const plan = planArtifacts({ window: w, outcome: j.outcome, windowFingerprint: fp, policy: selection.adapterPolicy, story: { title: wr.output.title, story: wr.output.story, usedMediaIds: wr.output.usedMediaIds ?? [] }, judgment: { reasonCodes: j.reasonCodes, subjectRelevance: j.verdict.subjectRelevance, gateA: j.bounded.level }, now: NOW, newId, latencyMs: (j.latencyMs ?? 0) + (wr.latencyMs ?? 0) });
  return { plan, j, wr };
};

const describePlan = (plan) => {
  const ev = plan.lifeEvent?.event;
  console.log(`\nPLAN action=${plan.action} fingerprint=${plan.organizationFingerprint}`);
  console.log(`  event.id        ${ev?.id}`);
  console.log(`  title           ${ev?.title}`);
  console.log(`  occurredAt      ${ev?.occurredAt}   eventType=${ev?.eventType} weight=${ev?.memoryWeight} createdBy=${ev?.createdBy} visibility=${ev?.visibility} organizerVersion=${ev?.organizerVersion}`);
  console.log(`  sourceIds       ${plan.sourceIds.length} (window has ${windowSourceIds.length})`);
  console.log(`  links           ${plan.lifeEvent?.links.length} (primary=${plan.lifeEvent?.links.filter((l) => l.role === "primary").length})`);
  console.log(`  mediaIds        ${ev?.mediaIds.length ? ev.mediaIds.join(",") : "(none)"}   hero=${ev?.heroMediaId ?? "(none)"}`);
  console.log(`  mediaDecisions  ${plan.mediaDecisions.map((d) => `${d.mediaId} ${d.tier} ${d.linked ? "LINK" : "refuse"} (${d.reason})`).join("; ") || "(none requested)"}`);
  console.log(`  review          id=${newId("quality-review")} target=${plan.review?.targetKind}:${plan.review?.targetId} decision=${plan.review?.decision} prompt=${plan.review?.promptVersion} policy=${plan.review?.policyVersion} fp=${plan.review?.reviewFingerprint}`);
  console.log(`  run             id=${plan.run.id} action=${plan.run.action} type=${plan.run.organizerType} version=${plan.run.organizerVersion} provider=${plan.run.provider} model=${plan.run.model} prompt=${plan.run.promptVersion} sources=${plan.run.sourceCount} mediaInput=${plan.run.mediaInputCount}`);
  if (plan.notes.length) console.log(`  notes           ${plan.notes.join(" | ")}`);
};

if (STAGE === "predeclare") {
  const { plan } = buildPlan();
  describePlan(plan);
  const ev = plan.lifeEvent.event;
  const before = await pointerState(plan.sourceIds, ev.mediaIds);
  console.log("\nPOINTERS TO BE REPOINTED (exact):");
  console.log(`  raw_sources.related_life_event_id → ${ev.id}: ${plan.sourceIds.length} rows, currently ${JSON.stringify(before.sources)}`);
  console.log(`  source_memory_links (+${plan.lifeEvent.links.length} rows; existing links to other events are NOT removed): currently ${JSON.stringify(before.links)}`);
  console.log(`  media.life_event_id → ${ev.id}: ${ev.mediaIds.length} rows, currently ${JSON.stringify(before.media)}`);
  for (const owner of new Set(before.sources.map((s) => s.owner).filter(Boolean))) {
    const legacy = (await q(`select jsonb_array_length(source_ids) n_src, jsonb_array_length(media_ids) n_media from life_events where id=$1`, [owner]))[0];
    const movingSrc = before.sources.filter((s) => s.owner === owner).reduce((a, s) => a + s.n, 0);
    const movingMedia = before.media.filter((m) => m.owner === owner).length;
    console.log(`  legacy ${owner}: source_ids array stays ${legacy.n_src} (array untouched), pointer-owned sources ${legacy.n_src} → ${legacy.n_src - movingSrc}; media_ids array stays ${legacy.n_media}, pointer-owned media ${legacy.n_media} → ${legacy.n_media - movingMedia}`);
  }
  console.log("existing rows under this identity:", JSON.stringify({ event: await q(`select id from life_events where id=$1 or organization_fingerprint=$2`, [ev.id, fp]), run: await q(`select id from organizer_runs where organization_fingerprint=$1`, [fp]), review: await q(`select id from content_quality_reviews where target_id=$1`, [ev.id]) }));
  console.log("\nTHIS IS PRODUCTION-PATH VALIDATION. THIS IS NOT FRESH RECALL / GENERALISATION EVIDENCE.");
  console.log(`expected publication state: unpublished — createdBy=ai fails closed and the review decision "${plan.review.decision}" is not "approved".`);
  writeFileSync(PLAN_FILE, JSON.stringify({ predeclaredAt: NOW, plan, pointersBefore: before }, null, 2));
  console.log(`saved -> ${PLAN_FILE}`);
}

if (STAGE === "apply" || STAGE === "replay") {
  const { plan } = buildPlan();
  describePlan(plan);
  const ev = plan.lifeEvent.event;
  const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
  const { closePool } = await import("../lib/db/client.ts");
  const real = createPostgresRepository();
  // The production Repository has no persistQualityReview yet; the ledger upsert is the table's own
  // unique key, same statement deepseek-family-writer.mjs uses.
  const repo = {
    findOrganizerRun: (x) => real.findOrganizerRun(x),
    persistOrganization: (a, b, c) => real.persistOrganization(a, b, c),
    persistDailyTrace: () => { throw new Error("Memory canary must not write a DailyTrace"); },
    persistOrganizerRun: (r) => real.persistOrganizerRun(r),
    markSourcesOrganized: () => { throw new Error("Memory canary must not take the store_only branch"); },
    async persistQualityReview(r) {
      await client.query(
        `insert into content_quality_reviews (id, profile_id, target_kind, target_id, decision, gate_a, subject_relevance, worthiness_score, reason_codes, provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15)
         on conflict (target_kind, target_id, prompt_version) do nothing`,
        [r.id, r.profileId, r.targetKind, r.targetId, r.decision, r.gateA ?? null, r.subjectRelevance ?? null, r.worthinessScore ?? null, JSON.stringify(r.reasonCodes), r.provider, r.model ?? null, r.promptVersion, r.policyVersion, r.reviewFingerprint, r.reviewedAt]);
    },
  };
  const before = await snapshot();
  const pointersBefore = await pointerState(plan.sourceIds, ev.mediaIds);
  console.log(`\nBEFORE ${JSON.stringify(before)}`);
  const applied = await applyPlan(plan, repo, { newId, now: NOW });
  console.log(`${STAGE.toUpperCase()}: applied=${applied.applied} (${applied.reason}) eventId=${applied.eventId ?? "-"} run=${applied.run?.id ?? "-"}`);
  const after = await snapshot();
  const delta = Object.fromEntries(Object.keys(before).map((k) => [k, after[k] - before[k]]));
  const pointersAfter = await pointerState(plan.sourceIds, ev.mediaIds);
  console.log(`AFTER  ${JSON.stringify(after)}`);
  console.log(`DELTA  ${JSON.stringify(delta)}`);
  console.log(`pointers after: ${JSON.stringify(pointersAfter)}`);
  const written = await q(`select id, title, occurred_at, memory_weight, created_by, organizer_version, organization_fingerprint, jsonb_array_length(source_ids) n_src, media_ids, hero_media_id, visibility from life_events where id=$1`, [ev.id]);
  console.log(`event row: ${JSON.stringify(written)}`);
  console.log(`review rows: ${JSON.stringify(await q(`select id, decision, prompt_version, policy_version, provider, model, review_fingerprint from content_quality_reviews where target_id=$1`, [ev.id]))}`);
  console.log(`run rows: ${JSON.stringify(await q(`select id, action, organizer_type, organizer_version, target_id, source_count from organizer_runs where organization_fingerprint=$1`, [fp]))}`);
  writeFileSync(join(OUT, `${entry.caseId}-${STAGE}.json`), JSON.stringify({ at: NOW, stage: STAGE, applied, before, after, delta, pointersBefore, pointersAfter, plan }, null, 2));
  await closePool();
  const expectReplay = STAGE === "replay";
  const ok = expectReplay ? (!applied.applied && Object.values(delta).every((v) => v === 0)) : applied.applied;
  await client.end();
  process.exit(ok ? 0 : 4);
}

await client.end();
