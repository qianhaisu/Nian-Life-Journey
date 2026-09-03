#!/usr/bin/env node
// Separates MODEL VARIANCE from POLICY EFFECT.
//
// The recall corpus cannot answer "does this policy rescue RC-09?" from ordinary repeated pipeline
// runs, because two things move at once: the Memory Editor is not deterministic across calls, and
// the policy under test changes on every run too. A case whose miss layer differs between two runs
// tells you nothing about either.
//
// So this splits the two into separate phases that never run together:
//
//   --capture   N editor calls per case. Saves every raw verdict, its worthiness/evidence axes and
//               its bounded window-level subject resolution. This is the ONLY phase that calls the
//               model, and it makes no routing claim at all.
//
//   --replay    Zero model calls. Re-grounds and re-routes SAVED verdicts through the full policy
//               grid. Every difference it reports is caused by the policy, because the verdict on
//               both sides is the same bytes.
//
// The grid is 2x2 and deliberately so, because RC-09 needs both axes to be named separately:
//
//                              promotion count fed to routeV5
//                        promotableGroundedFactCount | promotionEligibleFactCount
//   grounding  zeroAnaphora OFF   v6                 | v7-promotion
//              zeroAnaphora ON    v6+za              | v7-promotion+za
//
// Neither v7 is adopted. zeroAnaphora is a GROUNDING option (claim-grounding-v7-zero-anaphora);
// v7-promotion is a ROUTING policy (worthiness-v7-promotion-grounded). They are independent, and
// the whole point of the grid is to show which one — or which combination — a case actually needs.
//
// persist is hard-wired false. Read-only against production. Captured verdicts are FAMILY TEXT and
// must stay outside the repository.
//
//   node --import tsx -r dotenv/config scripts/organizer-verdict-replay.mjs --capture \
//     --corpus=<worksheet>.json --labels=<labels>.json --cases=RC-05,RC-08 --repeat=3 \
//     --store=<dir> dotenv_config_path=.env.local
//
//   node --import tsx -r dotenv/config scripts/organizer-verdict-replay.mjs --replay \
//     --corpus=<worksheet>.json --labels=<labels>.json --store=<dir> dotenv_config_path=.env.local
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL } from "../lib/organizer/life-date.ts";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { createV6RoutingPolicy, createV7PromotionRoutingPolicy } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims, applyGroundingToAxis } from "../lib/organizer/claim-grounding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { effectiveCapabilityScore } from "../lib/organizer/worthiness-v4.ts";
import { effectiveTransitionScore } from "../lib/organizer/worthiness-v2.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const has = (n) => args.includes(`--${n}`);
const CORPUS = argOf("corpus", null);
const LABELS = argOf("labels", null);
const STORE = argOf("store", null);
const CASES = argOf("cases", null);
const REPEAT = Number(argOf("repeat", "3"));
const OUT = argOf("out", null);
const CAPTURE = has("capture");
const REPLAY = has("replay");
if (!CORPUS || !LABELS || !STORE) { console.error("Need --corpus, --labels and --store."); process.exit(1); }
if (CAPTURE === REPLAY) { console.error("Pass exactly one of --capture or --replay."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const BASE_OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const NOW = new Date().toISOString();

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (CAPTURE && !process.env.DEEPSEEK_API_KEY) { console.error("Need DEEPSEEK_API_KEY to capture."); process.exit(1); }

const { worksheet } = JSON.parse(readFileSync(CORPUS, "utf8"));
const labelDoc = JSON.parse(readFileSync(LABELS, "utf8"));
const only = CASES ? new Set(CASES.split(",")) : null;
const selected = worksheet.filter((c) => !only || only.has(c.caseId));
if (only && selected.length !== only.size) console.log(`WARNING: asked for ${only.size} cases, matched ${selected.length}.`);

mkdirSync(STORE, { recursive: true });

// ---------------------------------------------------------------- the exact windows
//
// Rebuilding these means paging every wechat raw_source for the profile and running the Evidence
// Builder over all of them — tens of seconds, and the whole point of replay is that it is cheap
// enough to run repeatedly. So the rebuilt windows are cached beside the verdicts they belong to.
//
// The cache is keyed by the windowIds actually needed. It holds FAMILY TEXT, which is why it lives
// in the store directory (already outside the repository) and nowhere else, and why the underscore
// prefix keeps it out of the verdict listing below.
const CACHE = join(STORE, "_windows.json");
const wanted = new Map(selected.map((c) => [c.windowId, c]));
const windows = new Map();

if (existsSync(CACHE)) {
  const cached = JSON.parse(readFileSync(CACHE, "utf8"));
  for (const w of cached.windows) windows.set(w.windowId, w);
  console.log(`windows: ${windows.size} from cache (${CACHE})`);
}
const absent = [...wanted.keys()].filter((id) => !windows.has(id));
if (absent.length) {
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
  for (const [conversation, sources] of byConversation) {
    for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] })) {
      if (wanted.has(w.windowId)) windows.set(w.windowId, w);
    }
  }
  writeFileSync(CACHE, JSON.stringify({ rebuiltAt: new Date().toISOString(), windows: [...windows.values()] }, null, 2));
  console.log(`windows: rebuilt ${absent.length} from the database, cached ${windows.size} -> ${CACHE}`);
}

// ---------------------------------------------------------------- capture: the only model phase
if (CAPTURE) {
  const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...BASE_OPTS });
  console.log(`CAPTURE  editor=${editor.name} ${editor.model} ${editor.promptVersion}`);
  console.log(`cases=${selected.length} repeat=${REPEAT} calls=${selected.length * REPEAT}  persist=FALSE (hard-wired)\n`);
  let captured = 0, failed = 0;
  for (const entry of selected) {
    const w = windows.get(entry.windowId);
    if (!w) { console.log(`${entry.caseId} -> window_not_rebuilt`); failed += 1; continue; }
    for (let attempt = 1; attempt <= REPEAT; attempt += 1) {
      const file = join(STORE, `${entry.caseId}-${String(attempt).padStart(2, "0")}.json`);
      if (existsSync(file)) { console.log(`${entry.caseId} #${attempt} -> already captured, skipping`); continue; }
      try {
        const raw = (await editor.organize(w)).verdict;
        const verdict = validateMemoryEditorVerdict(raw, w);
        const axes = editor.axesByWindowId.get(w.windowId);
        const bounded = editor.subjectResolutionByWindowId.get(w.windowId);
        if (!axes || !bounded) throw new Error("missing axes");
        writeFileSync(file, JSON.stringify({
          caseId: entry.caseId, attempt, windowId: w.windowId, lifeDate: entry.lifeDate, stratum: entry.stratum,
          capturedAt: new Date().toISOString(),
          editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion },
          verdict, worthinessAxis: axes.worthinessAxis, evidenceAxis: axes.evidenceAxis, boundedLevel: bounded.level,
        }, null, 2));
        captured += 1;
        console.log(`${entry.caseId} #${attempt} -> captured  facts=${verdict.coreFacts.length} relevance=${verdict.subjectRelevance} temporal=${verdict.temporalStatus}`);
      } catch (error) {
        failed += 1;
        console.log(`${entry.caseId} #${attempt} -> ERROR ${String(error?.message ?? error).slice(0, 100)}`);
      }
    }
  }
  console.log(`\ncaptured=${captured} failed=${failed} -> ${STORE}`);
  console.log("Captured verdicts are FAMILY TEXT. Keep them outside the repository.");
  process.exit(0);
}

// ---------------------------------------------------------------- replay: zero model calls
// Mirrors routeV4's signal definitions over the GROUNDED axis, read-only.
function signalsOf(axis) {
  const transition = effectiveTransitionScore(axis.developmentalTransition);
  const capability = effectiveCapabilityScore(axis.newCapabilityOrIndependence);
  const strong = [];
  if (transition >= 2) strong.push("developmental_transition");
  if (capability >= 2) strong.push(`capability:${axis.newCapabilityOrIndependence.kind}`);
  if (axis.distinctiveFamilyMoment.score >= 3) strong.push("highly_distinctive_moment");
  const medium = [];
  if (axis.distinctiveFamilyMoment.score === 2) medium.push("distinctive_moment");
  if (axis.relationshipSignificance.score >= 2) medium.push("relationship");
  if (axis.futureRecallValue.score >= 2) medium.push("future_recall");
  if (transition === 1) medium.push("possible_transition");
  if (capability === 1) medium.push("partial_capability");
  return { strong, medium };
}

const GRID = [
  { cell: "v6", zeroAnaphora: false, policy: "v6" },
  { cell: "v7prom", zeroAnaphora: false, policy: "v7" },
  { cell: "v6+za", zeroAnaphora: true, policy: "v6" },
  { cell: "v7prom+za", zeroAnaphora: true, policy: "v7" },
];

const files = readdirSync(STORE).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
console.log(`REPLAY  saved verdicts=${files.length}  model calls=0  persist=FALSE (hard-wired)`);
console.log(`Grid: ${GRID.map((g) => g.cell).join("  ")}\n`);

const replayed = [];
for (const file of files) {
  const saved = JSON.parse(readFileSync(join(STORE, file), "utf8"));
  const w = windows.get(saved.windowId);
  if (!w) { console.log(`${file} -> window_not_rebuilt`); continue; }
  const label = labelDoc.labels[saved.caseId]?.label ?? "unlabelled";
  const clean = labelDoc.cleanPositiveAudit?.[saved.caseId]?.verdict === "CLEAN POSITIVE";
  const verdictWithAxis = { ...saved.verdict, worthinessAxis: saved.worthinessAxis };

  const cells = {};
  for (const g of GRID) {
    const opts = { ...BASE_OPTS, zeroAnaphoraAntecedent: g.zeroAnaphora };
    const grounding = groundClaims(w, verdictWithAxis, SUBJECT, opts);
    const gated = applyGroundingToAxis(saved.worthinessAxis, grounding);
    const lookup = () => ({ worthiness: saved.worthinessAxis, evidence: saved.evidenceAxis, subjectResolution: saved.boundedLevel, grounding });
    const policy = g.policy === "v6" ? createV6RoutingPolicy(lookup, () => {}) : createV7PromotionRoutingPolicy(lookup, () => {});
    const result = validate(w, verdictWithAxis, { now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [], routingPolicy: policy, claimGrounding: grounding });
    const judged = signalsOf(gated.axis);
    cells[g.cell] = {
      action: result.outcome.action,
      promotable: grounding.promotableGroundedFactCount,
      promotionEligible: grounding.promotionEligibleFactCount,
      traceEvidence: grounding.traceEvidenceCount,
      strong: judged.strong, medium: judged.medium, zeroed: gated.zeroed,
      resolvedClaims: grounding.claims.filter((c) => c.subject.resolved).length,
      // WHY nothing was promotable, by reason code. Structural only — no claim text — so this is
      // safe to read in a terminal and is the fastest way to tell a subject-resolution miss from a
      // hedge, a negation or the embedded-interrogative guard.
      blockers: grounding.claims.flatMap((c) => c.promotionBlockers).reduce((a, b) => { a[b] = (a[b] ?? 0) + 1; return a; }, {}),
    };
  }

  // Editor-side facts, recorded per call so instability is measured on the MODEL, not on a route.
  const emitted = signalsOf(saved.worthinessAxis);
  const kinds = saved.verdict.coreFacts.reduce((a, f) => { a[f.assertionKind] = (a[f.assertionKind] ?? 0) + 1; return a; }, {});
  replayed.push({
    caseId: saved.caseId, attempt: saved.attempt, label, cleanPositive: clean,
    editorFacts: saved.verdict.coreFacts.length, assertionKinds: kinds,
    subjectRelevance: saved.verdict.subjectRelevance, temporalStatus: saved.verdict.temporalStatus,
    boundedLevel: saved.boundedLevel, evidenceConfidence: saved.evidenceAxis?.evidenceConfidence,
    strongEmitted: emitted.strong, mediumEmitted: emitted.medium,
    noDistinctiveMemorySignal: saved.worthinessAxis.noDistinctiveMemorySignal,
    cells,
  });
  const row = GRID.map((g) => `${g.cell}=${cells[g.cell].action}`).join(" ");
  console.log(`${`${saved.caseId}#${saved.attempt} ${label}${clean ? "*" : ""}`.padEnd(28)} emitted=[${emitted.strong.join(",")}] ${row}`);
}

// ---------------------------------------------------------------- what varied, and because of what
const byCase = new Map();
for (const r of replayed) { if (!byCase.has(r.caseId)) byCase.set(r.caseId, []); byCase.get(r.caseId).push(r); }
const uniq = (rs, pick) => [...new Set(rs.map((r) => JSON.stringify(pick(r))))];

const perCase = [...byCase].map(([caseId, rs]) => ({
  caseId, label: rs[0].label, cleanPositive: rs[0].cleanPositive, calls: rs.length,
  // MODEL variance: same input, N calls, what did the editor itself change?
  editor: {
    strongSignalEmittedIn: rs.filter((r) => r.strongEmitted.length > 0).length,
    strongEmittedVariants: uniq(rs, (r) => r.strongEmitted),
    assertionKindVariants: uniq(rs, (r) => r.assertionKinds),
    factCountVariants: uniq(rs, (r) => r.editorFacts),
    relevanceVariants: uniq(rs, (r) => r.subjectRelevance),
    temporalVariants: uniq(rs, (r) => r.temporalStatus),
  },
  // POLICY effect: for each grid cell, how many of the N calls landed on each route.
  routes: Object.fromEntries(GRID.map((g) => [g.cell, rs.reduce((a, r) => { const k = r.cells[g.cell].action; a[k] = (a[k] ?? 0) + 1; return a; }, {})])),
  routeUnstableIn: GRID.filter((g) => new Set(rs.map((r) => r.cells[g.cell].action)).size > 1).map((g) => g.cell),
  promotionEligibleRange: GRID.map((g) => `${g.cell}:${[...new Set(rs.map((r) => r.cells[g.cell].promotionEligible))].join("/")}`),
  blockers: Object.fromEntries(GRID.map((g) => [g.cell, uniq(rs, (r) => r.cells[g.cell].blockers)])),
}));

const summary = {
  generatedAt: new Date().toISOString(), mode: "replay", modelCalls: 0, persist: false,
  store: STORE, savedVerdicts: files.length, replayed: replayed.length,
  grid: GRID.map((g) => g.cell),
  perCase,
  // A case is MODEL-unstable if the editor gave different answers to identical input; it is
  // POLICY-explained if every call lands on the same route within a cell.
  modelUnstable: perCase.filter((c) => c.editor.strongEmittedVariants.length > 1 || c.editor.assertionKindVariants.length > 1).map((c) => c.caseId),
  routeUnstable: perCase.filter((c) => c.routeUnstableIn.length > 0).map((c) => ({ caseId: c.caseId, cells: c.routeUnstableIn })),
  promotedBy: Object.fromEntries(GRID.map((g) => [g.cell, [...byCase].filter(([, rs]) => rs.every((r) => r.cells[g.cell].action === "life_event_candidate")).map(([id]) => id)])),
  promotedSometimesBy: Object.fromEntries(GRID.map((g) => [g.cell, [...byCase].filter(([, rs]) => rs.some((r) => r.cells[g.cell].action === "life_event_candidate") && !rs.every((r) => r.cells[g.cell].action === "life_event_candidate")).map(([id]) => id)])),
};

console.log(`\n${"=".repeat(78)}\nDETERMINISTIC REPLAY — one saved verdict, four policy cells, zero model calls\n${"=".repeat(78)}`);
console.log(JSON.stringify(summary, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify({ summary, replayed }, null, 2)); console.log(`\nPer-call detail (FAMILY TEXT — keep outside the repository) -> ${OUT}`); }
