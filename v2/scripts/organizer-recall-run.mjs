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
// Which policy's outcome is reported as THE result. Both are always computed and both are recorded
// per case, so `--policy` only chooses the headline, never what gets measured.
const POLICY = argOf("policy", "v6");
if (!["v6", "v7"].includes(POLICY)) { console.error("--policy must be v6|v7"); process.exit(1); }
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

    // ONE editor call, routed through both grounding policies. The editor is not deterministic
    // across calls (the V6 freeze record says so, and this corpus reproduced it: a window's miss
    // layer moved between two runs of the same input), so scoring V6 and V7 in separate runs would
    // confound the policy difference with model noise. Sharing the verdict makes every delta below
    // attributable to zero-anaphora subject resolution and nothing else.
    const judgeWith = (groundingOptions) => {
      const grounding = groundClaims(w, verdictWithAxis, SUBJECT, groundingOptions);
      const gated = applyGroundingToAxis(axes.worthinessAxis, grounding);
      const policy = createV6RoutingPolicy(() => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding }), () => {});
      const outcome = validate(w, verdictWithAxis, { ...baseContext, routingPolicy: policy, claimGrounding: grounding });
      return { grounding, gated, outcome, action: outcome.outcome.action };
    };
    const v6 = judgeWith(OPTS);
    const v7 = judgeWith({ ...OPTS, zeroAnaphoraAntecedent: true });
    const active = POLICY === "v7" ? v7 : v6;
    const { grounding, gated, outcome, action } = active;

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
      // assertionKind comes from the editor's own coreFact, not from grounding, and it gates
      // promotion independently: promotableGroundedFactCount counts only `raw_fact`. A claim can be
      // a supported assertion about a resolved subject and still not count.
      claimDetail: grounding.claims.map((c, i) => ({ text: c.text?.slice(0, 140), assertionKind: verdict.coreFacts?.[i]?.assertionKind, assertionStatus: c.assertionStatus, polarity: c.polarity, subjectBasis: c.subject?.basis, subjectResolved: c.subject?.resolved, mayContributeToWorthiness: c.mayContributeToWorthiness, mayGroundDevelopmentalSignal: c.mayGroundDevelopmentalSignal, reasons: c.reasons })),
      // Both policies, always, on the one shared verdict.
      policies: {
        v6: { action: v6.action, score: v6.outcome.outcome.worthinessScore ?? 0, promotable: v6.grounding.promotableGroundedFactCount, traceEvidence: v6.grounding.traceEvidenceCount, strong: signalsOf(v6.gated.axis).strong, zeroed: v6.gated.zeroed, version: v6.grounding.version },
        v7: { action: v7.action, score: v7.outcome.outcome.worthinessScore ?? 0, promotable: v7.grounding.promotableGroundedFactCount, traceEvidence: v7.grounding.traceEvidenceCount, strong: signalsOf(v7.gated.axis).strong, zeroed: v7.gated.zeroed, version: v7.grounding.version },
      },
      zeroAnaphoraResolutions: v7.grounding.claims.filter((c) => c.subject?.basis === "antecedent_in_window_zero_anaphora").length,
      changed: v6.action !== v7.action,
    });
    const r = results[results.length - 1];
    const delta = r.changed ? `  V6=${v6.action} -> V7=${v7.action}` : "";
    console.log(`${tag.padEnd(34)} -> ${String(action).padEnd(20)} score=${String(r.worthinessScore).padStart(3)} promotable=${r.grounding.promotable} strong=[${judged.strong.join(",")}] miss=${r.missLayer ?? "-"}${delta}`);
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
  router: "worthiness-v6-grounded", reportedPolicy: POLICY, persist: false,
  attempted: results.length, scored: scored.length, errors,
  byLabel: {},
  cleanPositives: { total: by((r) => r.cleanPositive).length, kept: by((r) => r.cleanPositive && r.action === "life_event_candidate").length, missed: by((r) => r.cleanPositive && r.action !== "life_event_candidate").map((r) => ({ caseId: r.caseId, action: r.action, missLayer: r.missLayer, strongEmitted: r.signalsEmitted.strong, strongJudged: r.signalsAfterGrounding.strong, score: r.worthinessScore, promotable: r.grounding.promotable })) },
  falsePromotions: by((r) => r.action === "life_event_candidate" && (r.label === "negative" || r.label === "daily_trace")).map((r) => ({ caseId: r.caseId, label: r.label, strong: r.signalsAfterGrounding.strong })),
  missLayers: {},
  strongSignalRate: { emitted: by((r) => r.signalsEmitted.strong.length > 0).length, afterGrounding: by((r) => r.signalsAfterGrounding.strong.length > 0).length },
  // The V6 vs V7 comparison, on the shared verdict. `byLabelV6/V7` is the precision-and-recall
  // table; `changes` names every window whose route moved, so nothing is hidden inside an average.
  comparison: (() => {
    const tally = (pick) => scored.reduce((a, r) => { const k = `${r.label}/${pick(r).action}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
    const promotedBy = (pick) => scored.filter((r) => pick(r).action === "life_event_candidate");
    const v6p = promotedBy((r) => r.policies.v6);
    const v7p = promotedBy((r) => r.policies.v7);
    const clean = scored.filter((r) => r.cleanPositive);
    return {
      byLabelV6: tally((r) => r.policies.v6),
      byLabelV7: tally((r) => r.policies.v7),
      promotions: { v6: v6p.map((r) => `${r.caseId}:${r.label}`), v7: v7p.map((r) => `${r.caseId}:${r.label}`) },
      cleanPositiveRecall: { total: clean.length, v6: clean.filter((r) => r.policies.v6.action === "life_event_candidate").length, v7: clean.filter((r) => r.policies.v7.action === "life_event_candidate").length },
      falsePromotions: {
        v6: v6p.filter((r) => r.label === "negative" || r.label === "daily_trace").map((r) => `${r.caseId}:${r.label}`),
        v7: v7p.filter((r) => r.label === "negative" || r.label === "daily_trace").map((r) => `${r.caseId}:${r.label}`),
      },
      routeChanges: scored.filter((r) => r.changed).map((r) => ({ caseId: r.caseId, label: r.label, cleanPositive: r.cleanPositive, from: r.policies.v6.action, to: r.policies.v7.action, zeroAnaphoraResolutions: r.zeroAnaphoraResolutions })),
      windowsWithZeroAnaphoraResolutions: scored.filter((r) => r.zeroAnaphoraResolutions > 0).length,
      totalZeroAnaphoraResolutions: scored.reduce((a, r) => a + (r.zeroAnaphoraResolutions ?? 0), 0),
    };
  })(),
};
for (const r of scored) {
  const b = (summary.byLabel[r.label] ??= { n: 0, actions: {} });
  b.n += 1; b.actions[r.action] = (b.actions[r.action] ?? 0) + 1;
  if (r.missLayer) summary.missLayers[r.missLayer] = (summary.missLayers[r.missLayer] ?? 0) + 1;
}
console.log(`\n${"=".repeat(78)}\nFROZEN V6 ON LABELLED RECALL CORPUS\n${"=".repeat(78)}`);
console.log(JSON.stringify(summary, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2)); console.log(`\nPer-case detail (FAMILY TEXT in claims — keep outside the repository) -> ${OUT}`); }
