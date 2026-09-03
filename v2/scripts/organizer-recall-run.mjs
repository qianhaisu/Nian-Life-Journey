#!/usr/bin/env node
// Runs FROZEN V6 over the human-labelled recall corpus and records, for the first time, the
// worthiness axis and the strong/medium signal lists alongside the routing outcome.
//
// Nothing about the judgement is changed here: same Memory Editor v4, same contract, same claim
// grounding, same V6 routing policy, same thresholds, same subject resolver. The only difference
// from writer-v2-fresh-shadow.mjs is what gets WRITTEN DOWN. Every earlier run recorded the
// decision but not the axis, which is why "no strong signal" could only ever be inferred as a
// residual; this makes the last funnel layer directly observable.
//
// persist is hard-wired false. Read-only against production: no LifeEvent, no DailyTrace, no
// organizer run, no ledger row.
//
//   node --import tsx -r dotenv/config scripts/organizer-recall-run.mjs \
//     --corpus=<worksheet>.json --labels=<labels>.json --out=<path>.json dotenv_config_path=.env.local
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { createV6RoutingPolicy } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims, applyGroundingToAxis } from "../lib/organizer/claim-grounding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { effectiveCapabilityScore } from "../lib/organizer/worthiness-v4.ts";
import { effectiveTransitionScore } from "../lib/organizer/worthiness-v2.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const CORPUS = argOf("corpus", null);
const LABELS = argOf("labels", null);
const ONLY = argOf("only", null);
if (!CORPUS || !LABELS) { console.error("Need --corpus and --labels."); process.exit(1); }
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const NOW = new Date().toISOString();

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
if (!dbUrl || !apiKey) { console.error("Need DATABASE_URL and DEEPSEEK_API_KEY."); process.exit(1); }

const { worksheet } = JSON.parse(readFileSync(CORPUS, "utf8"));
const labelDoc = JSON.parse(readFileSync(LABELS, "utf8"));
const wanted = new Map(worksheet.map((c) => [c.windowId, c]));
const only = ONLY ? new Set(ONLY.split(",")) : null;

// ---------------------------------------------------------------- rebuild the exact windows
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
const windows = new Map();
for (const [conversation, sources] of byConversation) {
  for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] })) {
    if (wanted.has(w.windowId)) windows.set(w.windowId, w);
  }
}
const missing = worksheet.filter((c) => !windows.has(c.windowId));
if (missing.length) console.log(`WARNING: ${missing.length} corpus windows could not be rebuilt: ${missing.map((m) => m.caseId).join(", ")}`);

// ---------------------------------------------------------------- frozen V6, verbatim
const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...OPTS });
console.log(`Editor: ${editor.name} ${editor.model} ${editor.promptVersion}   router: worthiness-v6-grounded   persist: FALSE (hard-wired)\n`);
const baseContext = { now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] };

// Reproduces routeV4's signal definitions exactly (worthiness-v4.ts:137-147) over the GROUNDED
// axis, so what is recorded is what routing actually saw. Kept as a read-only mirror rather than an
// export change, because V6 is frozen and this script must not be able to alter it.
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
  return {
    strong, medium, effectiveTransition: transition, effectiveCapability: capability,
    capabilityKind: axis.newCapabilityOrIndependence.kind,
    capabilityRaw: axis.newCapabilityOrIndependence.score,
    transitionRaw: axis.developmentalTransition.score ?? null,
    distinctiveness: axis.distinctiveFamilyMoment.score,
    relationship: axis.relationshipSignificance.score,
    futureRecall: axis.futureRecallValue.score,
    noDistinctiveMemorySignal: axis.noDistinctiveMemorySignal,
  };
}

const results = [];
let errors = 0;
for (const entry of worksheet) {
  if (only && !only.has(entry.caseId)) continue;
  const w = windows.get(entry.windowId);
  const label = labelDoc.labels[entry.caseId]?.label ?? "unlabelled";
  const clean = labelDoc.cleanPositiveAudit?.[entry.caseId]?.verdict === "CLEAN POSITIVE";
  const tag = `${entry.caseId} ${entry.lifeDate} ${label}${clean ? "*" : ""}`;
  if (!w) { results.push({ ...entry, label, cleanPositive: clean, error: "window_not_rebuilt" }); continue; }
  try {
    const raw = (await editor.organize(w)).verdict;
    const verdict = validateMemoryEditorVerdict(raw, w);
    const axes = editor.axesByWindowId.get(w.windowId);
    const bounded = editor.subjectResolutionByWindowId.get(w.windowId);
    if (!axes || !bounded) throw new Error("missing axes");
    const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
    const grounding = groundClaims(w, verdictWithAxis, SUBJECT, OPTS);
    const gated = applyGroundingToAxis(axes.worthinessAxis, grounding);
    const policy = createV6RoutingPolicy(() => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding }), () => {});
    const outcome = validate(w, verdictWithAxis, { ...baseContext, routingPolicy: policy, claimGrounding: grounding });
    const action = outcome.outcome.action;

    // The two axes side by side: what the editor emitted, and what routing actually judged.
    const emitted = signalsOf(axes.worthinessAxis);
    const judged = signalsOf(gated.axis);

    results.push({
      caseId: entry.caseId, windowId: w.windowId, fingerprint: entry.fingerprint, lifeDate: entry.lifeDate,
      stratum: entry.stratum, label, cleanPositive: clean,
      action, worthinessScore: outcome.outcome.worthinessScore ?? 0, reasonCodes: outcome.reasonCodes,
      gateA: { level: bounded.level, blockers: bounded.blockers ?? [], relevance: verdict.subjectRelevance },
      temporalStatus: verdict.temporalStatus,
      grounding: {
        claims: grounding.claims.length,
        promotable: grounding.promotableGroundedFactCount,
        traceEvidence: grounding.traceEvidenceCount,
        zeroed: gated.zeroed, reasonCodes: gated.reasonCodes,
      },
      signalsEmitted: emitted,
      signalsAfterGrounding: judged,
      // The whole point of this run: when nothing promoted, was it the gates, grounding, or the
      // editor never asserting a strong signal in the first place?
      missLayer: action === "life_event_candidate" ? null
        : outcome.reasonCodes?.some((c) => String(c).includes("subject")) ? "subject"
        : grounding.promotableGroundedFactCount < 1 ? "no_grounded_fact"
        : emitted.strong.length > 0 && judged.strong.length === 0 ? "grounding_zeroed_the_strong_signal"
        : emitted.strong.length === 0 ? "editor_emitted_no_strong_signal"
        : "gate_other",
      claimDetail: grounding.claims.map((c) => ({ text: c.text?.slice(0, 140), assertionStatus: c.assertionStatus, polarity: c.polarity, subjectBasis: c.subject?.basis, subjectResolved: c.subject?.resolved, mayContributeToWorthiness: c.mayContributeToWorthiness, mayGroundDevelopmentalSignal: c.mayGroundDevelopmentalSignal, reasons: c.reasons })),
    });
    const r = results[results.length - 1];
    console.log(`${tag.padEnd(34)} -> ${String(action).padEnd(20)} score=${String(r.worthinessScore).padStart(3)} promotable=${r.grounding.promotable} strong=[${judged.strong.join(",")}] miss=${r.missLayer ?? "-"}`);
  } catch (error) {
    errors += 1;
    console.log(`${tag.padEnd(34)} -> ERROR ${String(error?.message ?? error).slice(0, 90)}`);
    results.push({ caseId: entry.caseId, windowId: entry.windowId, label, cleanPositive: clean, error: String(error?.message ?? error) });
  }
}

// ---------------------------------------------------------------- summary
const scored = results.filter((r) => !r.error);
const by = (pred) => scored.filter(pred);
const promoted = by((r) => r.action === "life_event_candidate");
const summary = {
  generatedAt: new Date().toISOString(), corpus: CORPUS, labels: LABELS,
  editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion },
  router: "worthiness-v6-grounded", persist: false,
  attempted: results.length, scored: scored.length, errors,
  byLabel: {},
  cleanPositives: { total: by((r) => r.cleanPositive).length, kept: by((r) => r.cleanPositive && r.action === "life_event_candidate").length, missed: by((r) => r.cleanPositive && r.action !== "life_event_candidate").map((r) => ({ caseId: r.caseId, action: r.action, missLayer: r.missLayer, strongEmitted: r.signalsEmitted.strong, strongJudged: r.signalsAfterGrounding.strong, score: r.worthinessScore, promotable: r.grounding.promotable })) },
  falsePromotions: by((r) => r.action === "life_event_candidate" && (r.label === "negative" || r.label === "daily_trace")).map((r) => ({ caseId: r.caseId, label: r.label, strong: r.signalsAfterGrounding.strong })),
  missLayers: {},
  strongSignalRate: { emitted: by((r) => r.signalsEmitted.strong.length > 0).length, afterGrounding: by((r) => r.signalsAfterGrounding.strong.length > 0).length },
};
for (const r of scored) {
  const b = (summary.byLabel[r.label] ??= { n: 0, actions: {} });
  b.n += 1; b.actions[r.action] = (b.actions[r.action] ?? 0) + 1;
  if (r.missLayer) summary.missLayers[r.missLayer] = (summary.missLayers[r.missLayer] ?? 0) + 1;
}
console.log(`\n${"=".repeat(78)}\nFROZEN V6 ON LABELLED RECALL CORPUS\n${"=".repeat(78)}`);
console.log(JSON.stringify(summary, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2)); console.log(`\nPer-case detail (FAMILY TEXT in claims — keep outside the repository) -> ${OUT}`); }
