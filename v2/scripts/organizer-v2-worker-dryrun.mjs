#!/usr/bin/env node
// Worker-level dry run for the NEW-INPUT V2 cutover.
//
// Proves the production chain end to end without writing a row or spending a model call:
//
//   worker's own router (getOrganizerForJob)
//     → production selector (boundary + versions)
//       → EvidenceOrganizerV2
//         → Repository.getOrganizerWindowInput  (the real read, by source id)
//           → Evidence Builder + window fingerprint
//             → production adapter planArtifacts()
//               → the exact set of Repository writes that WOULD run
//
// Two guards make the "no writes" claim checkable rather than asserted:
//   * every write method of the repository is replaced by one that THROWS, so an accidental write
//     is a crash, not a silent mutation;
//   * the pipeline is a FIXTURE, so no Judgment or Writer call is made and no cost is incurred. Its
//     prose is obviously synthetic and never reaches the database — dry runs write nothing.
//
// The sources named on the command line are read only. This is deliberately NOT a substitute for the
// live-model evidence: Judgment, Writer and the real Memory write were proven by the RC-12 canary
// (docs/organizer-memory-canary-2026-09-03.md). What is proven here is the WIRING.
//
//   node --import tsx -r dotenv/config scripts/organizer-v2-worker-dryrun.mjs \
//     --sources=<id,id> [--route=memory|trace|store_only] [--after=<ISO>] dotenv_config_path=.env.local
import { selectProductionOrganizer, describeSelection, jobUsesV2 } from "../lib/organizer/production-selector.ts";
import { getOrganizerForJob, productionArtifactRepository } from "../lib/organizer/index.ts";
import { EvidenceOrganizerV2 } from "../lib/organizer/v2-organizer.ts";
import { FROZEN_V6_JUDGMENT } from "../lib/organizer/judgment-policy.ts";
import { closePool } from "../lib/db/client.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const SOURCE_IDS = (argOf("sources", "") || "").split(",").map((s) => s.trim()).filter(Boolean);
const ROUTE = argOf("route", "memory");
const AFTER = argOf("after", new Date(Date.now() - 60_000).toISOString());
if (!SOURCE_IDS.length) { console.error("Need --sources=<raw source id>[,<id>...]"); process.exit(1); }

// The cutover configuration, supplied here instead of read from the environment: this script must
// describe the configuration it is testing, and must never depend on production already being
// switched over.
const ENV = {
  ...process.env,
  ORGANIZER_V2_ENABLED: "true",
  ORGANIZER_V2_JUDGMENT_POLICY: FROZEN_V6_JUDGMENT.id,
  ORGANIZER_V2_WRITER_VERSION: "writer-v2",
  ORGANIZER_V2_PROMPT_VERSION: "memory-editor-v4",
  ORGANIZER_V2_MODEL: "deepseek-v4-pro",
  ORGANIZER_V2_NEW_INPUT_AFTER: AFTER,
  ORGANIZER_V2_SOURCE_ALLOWLIST: "",
};

const selection = selectProductionOrganizer(ENV);
console.log(`selector          ${describeSelection(selection)}`);
console.log(`real env selector ${describeSelection(selectProductionOrganizer(process.env))}`);

// 1. The worker's own routing decision, for a job created now and for one created before the cutover.
const newJob = { sourceIds: SOURCE_IDS, createdAt: new Date().toISOString(), force: false };
const oldJob = { sourceIds: SOURCE_IDS, createdAt: "2026-08-31T07:01:49.656Z", force: false };
const routedNew = getOrganizerForJob(newJob, ENV);
const routedOld = getOrganizerForJob(oldJob, ENV);
console.log(`route new job     ${routedNew.useV2 ? "V2" : "legacy"} (${routedNew.organizer.constructor.name})  ${routedNew.description}`);
console.log(`route old job     ${routedOld.useV2 ? "V2" : "legacy"} (${routedOld.organizer.constructor.name})`);
console.log(`route forced job  ${jobUsesV2(selection, SOURCE_IDS, { ...newJob, force: true }) ? "V2" : "legacy"} (a re-organization of existing evidence)`);
if (!routedNew.useV2) { console.error("the new job did not route to V2; nothing further to prove"); await closePool(); process.exit(2); }

// 2. A repository whose write methods refuse. Reads are the real ones.
const attempted = [];
const refuse = (method) => async () => { attempted.push(method); throw new Error(`DRY RUN: ${method} must not be called`); };
const readOnlyRepository = {
  getOrganizerWindowInput: (ids) => productionArtifactRepository.getOrganizerWindowInput(ids),
  findOrganizerRun: (fp) => productionArtifactRepository.findOrganizerRun(fp),
  persistOrganization: refuse("persistOrganization"),
  persistDailyTrace: refuse("persistDailyTrace"),
  persistOrganizerRun: refuse("persistOrganizerRun"),
  markSourcesOrganized: refuse("markSourcesOrganized"),
  persistQualityReview: refuse("persistQualityReview"),
};

// 3. A fixture pipeline: the plumbing under test is persistence, not judgement, so no model is called.
const fixturePipeline = {
  async judge(window) {
    const base = { sourceIds: [...new Set(window.items.map((item) => item.sourceId))], windowId: window.windowId, policyVersion: selection.adapterPolicy.policyVersion, modelVersion: selection.adapterPolicy.model, selectionReason: "dry-run fixture", worthinessScore: 42 };
    const outcome = ROUTE === "memory"
      ? { ...base, action: "life_event_candidate", occurredAt: window.activityDate, eventType: "moment", contentTypes: ["daily"], coreFacts: [], quotableLines: [], worthinessDimensions: {}, uncertainty: {}, sensitivityFlags: [], prohibitedInferences: [], reviewRequirement: "needs_review", confidence: 0.8 }
      : ROUTE === "trace"
        ? { ...base, action: "daily_trace", occurredAt: window.activityDate, scopes: ["family"], contentTypes: ["daily"], traceLines: [{ text: "(FIXTURE trace line — never written)", evidenceRefs: [] }], evidenceStrength: 1 }
        : { ...base, action: "store_only" };
    return { outcome, reasonCodes: [], verdict: { subjectRelevance: "primary", quotableLines: [] }, grounding: { claims: [] }, subjectLevel: "explicit", routingPolicyId: selection.judgment.routingPolicyId, latencyMs: 0 };
  },
  async write() {
    return { wrote: true, title: "(FIXTURE title — never written)", story: "(FIXTURE story — never written)", usedMediaIds: [], promptVersion: "fixture", validatorVersion: "fixture", latencyMs: 0 };
  },
};

const organizer = new EvidenceOrganizerV2({ selection, pipeline: fixturePipeline, repository: readOnlyRepository });

// 4. The window the worker would build for this job, and the exact writes it would make.
const { window, fingerprint, input } = await organizer.buildWindow(SOURCE_IDS);
console.log(`\nwindow            ${window.windowId}  items=${window.items.length}  activityDate=${window.activityDate}  media=${window.mediaBindings.length}`);
console.log(`read              sources=${input.sources.length} media=${input.media.length} assets=${input.mediaAssets.length} locations=${input.mediaLocations.length} profile=${input.profile?.id ?? "(none)"}`);
console.log(`fingerprint       ${fingerprint}`);
console.log(`existing run      ${(await productionArtifactRepository.findOrganizerRun(fingerprint))?.id ?? "(none — this evidence has not been organized under V2)"}`);

const result = await organizer.organize(SOURCE_IDS, { dryRun: true });
console.log(`\nPLANNED (nothing written)`);
console.log(`  action          ${result.action}  run.action=${result.run.action}`);
console.log(`  artifact        ${result.eventId ?? result.traceId ?? "(none — the run is the record)"}`);
console.log(`  sources         ${result.sourceIds.length}`);
console.log(`  run             id=${result.run.id} type=${result.run.organizerType} version=${result.run.organizerVersion} provider=${result.run.provider} model=${result.run.model} prompt=${result.run.promptVersion}`);
console.log(`  repository writes attempted: ${attempted.length === 0 ? "none" : attempted.join(", ")}`);
console.log(`\n${attempted.length === 0 ? "WORKER DRY RUN CLEAN — repository-backed V2 path reachable, no raw SQL, no writes." : "DRY RUN FAILED — a write was attempted."}`);
await closePool();
process.exit(attempted.length === 0 ? 0 : 4);
