#!/usr/bin/env node
// Routes the human-labelled recall corpus through FROZEN V6 and the candidate promotion policy
// (worthiness-v7-promotion-grounded) and reports the delta.
//
// The one methodological rule this script exists to enforce: ONE editor verdict per window, routed
// through BOTH policies. The Memory Editor is not deterministic across calls — the V6 freeze record
// says so and the recall corpus reproduced it (RC-05 changed miss layer between two runs of the same
// input) — so scoring the two policies in separate runs would confound the policy difference with
// model noise. Sharing the verdict makes every delta attributable to the promotion gate and nothing
// else. Same editor, prompt, contract, grounding, axis, thresholds and subject resolver on both
// sides; zero-anaphora stays OFF, because it is a separate, unadopted experiment.
//
// persist is hard-wired false. Read-only against production.
//
//   node --import tsx -r dotenv/config scripts/organizer-promotion-policy-run.mjs \
//     --corpus=<worksheet>.json --labels=<labels>.json --out=<path>.json dotenv_config_path=.env.local
import { readFileSync, writeFileSync } from "node:fs";
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
const OUT = argOf("out", null);
const CORPUS = argOf("corpus", null);
const LABELS = argOf("labels", null);
const ONLY = argOf("only", null);
const REPEAT = Number(argOf("repeat", "1"));
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

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...OPTS });
console.log(`Editor: ${editor.name} ${editor.model} ${editor.promptVersion}`);
console.log(`Policies: worthiness-v6-grounded  vs  worthiness-v7-promotion-grounded   zeroAnaphora: OFF   persist: FALSE (hard-wired)`);
console.log(`Repeats per window: ${REPEAT}\n`);
const baseContext = { now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] };

// Mirrors routeV4's signal definitions (worthiness-v4.ts) over the GROUNDED axis, read-only.
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
  return { strong, medium, effectiveTransition: transition, effectiveCapability: capability, capabilityKind: axis.newCapabilityOrIndependence.kind, distinctiveness: axis.distinctiveFamilyMoment.score, relationship: axis.relationshipSignificance.score, futureRecall: axis.futureRecallValue.score };
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

  for (let attempt = 1; attempt <= REPEAT; attempt += 1) {
    try {
      const raw = (await editor.organize(w)).verdict;
      const verdict = validateMemoryEditorVerdict(raw, w);
      const axes = editor.axesByWindowId.get(w.windowId);
      const bounded = editor.subjectResolutionByWindowId.get(w.windowId);
      if (!axes || !bounded) throw new Error("missing axes");
      const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };

      // ONE grounding result. Both policies read it; they differ only in WHICH count they feed to
      // routeV5, so the axis, the zeroing and the trace count are literally the same objects.
      const grounding = groundClaims(w, verdictWithAxis, SUBJECT, OPTS);
      const gated = applyGroundingToAxis(axes.worthinessAxis, grounding);
      const lookup = () => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding });
      const runPolicy = (policy) => validate(w, verdictWithAxis, { ...baseContext, routingPolicy: policy, claimGrounding: grounding });
      const v6 = runPolicy(createV6RoutingPolicy(lookup, () => {}));
      const v7 = runPolicy(createV7PromotionRoutingPolicy(lookup, () => {}));
      const judged = signalsOf(gated.axis);

      const claimDetail = grounding.claims.map((c, i) => ({
        text: c.text, assertionKind: verdict.coreFacts?.[i]?.assertionKind, claimant: verdict.coreFacts?.[i]?.claimant,
        assertionStatus: c.assertionStatus, observationMode: c.observationMode, polarity: c.polarity,
        subjectBasis: c.subject?.basis, subjectResolved: c.subject?.resolved,
        epistemicStatus: c.epistemicStatus, epistemicMarkers: c.epistemicMarkers,
        speakers: c.speakers, evidenceRefs: c.evidenceRefs,
        spanText: c.supportingSpans.map((s) => s.text),
        mayContributeToWorthiness: c.mayContributeToWorthiness, mayGroundDevelopmentalSignal: c.mayGroundDevelopmentalSignal,
        mayGroundPromotion: c.mayGroundPromotion, promotionBlockers: c.promotionBlockers,
      }));

      results.push({
        caseId: entry.caseId, attempt, windowId: w.windowId, lifeDate: entry.lifeDate, stratum: entry.stratum,
        label, cleanPositive: clean,
        gateA: { level: bounded.level, relevance: verdict.subjectRelevance }, temporalStatus: verdict.temporalStatus,
        promotableV6: grounding.promotableGroundedFactCount,
        promotionEligibleV7: grounding.promotionEligibleFactCount,
        traceEvidence: grounding.traceEvidenceCount,
        zeroed: gated.zeroed, strongJudged: judged.strong, mediumJudged: judged.medium,
        v6: { action: v6.outcome.action, score: v6.outcome.worthinessScore ?? 0, reasonCodes: v6.reasonCodes },
        v7: { action: v7.outcome.action, score: v7.outcome.worthinessScore ?? 0, reasonCodes: v7.reasonCodes },
        changed: v6.outcome.action !== v7.outcome.action,
        claimDetail,
      });
      const r = results[results.length - 1];
      const delta = r.changed ? `   *** ${r.v6.action} -> ${r.v7.action} ***` : "";
      console.log(`${tag.padEnd(34)}${REPEAT > 1 ? `#${attempt} ` : ""}v6=${String(r.v6.action).padEnd(20)} v7=${String(r.v7.action).padEnd(20)} promV6=${r.promotableV6} promV7=${r.promotionEligibleV7} trace=${r.traceEvidence} strong=[${judged.strong.join(",")}]${delta}`);
    } catch (error) {
      errors += 1;
      console.log(`${tag.padEnd(34)} -> ERROR ${String(error?.message ?? error).slice(0, 90)}`);
      results.push({ caseId: entry.caseId, attempt, windowId: entry.windowId, label, cleanPositive: clean, error: String(error?.message ?? error) });
    }
  }
}

// ---------------------------------------------------------------- summary
const scored = results.filter((r) => !r.error);
const tally = (pick) => scored.reduce((a, r) => { const k = `${r.label}/${pick(r).action}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
const promotedBy = (pick) => scored.filter((r) => pick(r).action === "life_event_candidate");
const v6p = promotedBy((r) => r.v6);
const v7p = promotedBy((r) => r.v7);
const clean = scored.filter((r) => r.cleanPositive);
const summary = {
  generatedAt: new Date().toISOString(), corpus: CORPUS, labels: LABELS,
  editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion },
  policies: ["worthiness-v6-grounded", "worthiness-v7-promotion-grounded"],
  zeroAnaphora: false, persist: false, repeats: REPEAT,
  attempted: results.length, scored: scored.length, errors,
  byLabelV6: tally((r) => r.v6),
  byLabelV7: tally((r) => r.v7),
  promotions: { v6: v6p.map((r) => `${r.caseId}:${r.label}`), v7: v7p.map((r) => `${r.caseId}:${r.label}`) },
  cleanPositiveRecall: { total: clean.length, v6: clean.filter((r) => r.v6.action === "life_event_candidate").length, v7: clean.filter((r) => r.v7.action === "life_event_candidate").length },
  falsePromotions: {
    v6: v6p.filter((r) => r.label === "negative" || r.label === "daily_trace").map((r) => `${r.caseId}:${r.label}`),
    v7: v7p.filter((r) => r.label === "negative" || r.label === "daily_trace").map((r) => `${r.caseId}:${r.label}`),
  },
  routeChanges: scored.filter((r) => r.changed).map((r) => ({ caseId: r.caseId, label: r.label, cleanPositive: r.cleanPositive, from: r.v6.action, to: r.v7.action, promotableV6: r.promotableV6, promotionEligibleV7: r.promotionEligibleV7, strong: r.strongJudged })),
  eligibilityTotals: {
    claims: scored.reduce((a, r) => a + r.claimDetail.length, 0),
    rawFact: scored.reduce((a, r) => a + r.claimDetail.filter((c) => c.assertionKind === "raw_fact").length, 0),
    attributed: scored.reduce((a, r) => a + r.claimDetail.filter((c) => c.assertionKind === "attributed_claim").length, 0),
    devGroundable: scored.reduce((a, r) => a + r.claimDetail.filter((c) => c.mayGroundDevelopmentalSignal).length, 0),
    promotionEligible: scored.reduce((a, r) => a + r.claimDetail.filter((c) => c.mayGroundPromotion).length, 0),
    hedgedBlocked: scored.reduce((a, r) => a + r.claimDetail.filter((c) => c.mayGroundDevelopmentalSignal && c.epistemicStatus === "hedged").length, 0),
    unknownSpeakerBlocked: scored.reduce((a, r) => a + r.claimDetail.filter((c) => c.promotionBlockers?.includes("reported_by_unknown_speaker")).length, 0),
  },
};
if (REPEAT > 1) {
  const byCase = new Map();
  for (const r of scored) { if (!byCase.has(r.caseId)) byCase.set(r.caseId, []); byCase.get(r.caseId).push(r); }
  summary.nondeterminism = {
    cases: byCase.size,
    v6RouteVaried: [...byCase].filter(([, rs]) => new Set(rs.map((r) => r.v6.action)).size > 1).map(([id]) => id),
    v7RouteVaried: [...byCase].filter(([, rs]) => new Set(rs.map((r) => r.v7.action)).size > 1).map(([id]) => id),
    strongSignalVaried: [...byCase].filter(([, rs]) => new Set(rs.map((r) => JSON.stringify(r.strongJudged))).size > 1).map(([id]) => id),
    promotionCountVaried: [...byCase].filter(([, rs]) => new Set(rs.map((r) => r.promotionEligibleV7)).size > 1).map(([id]) => id),
  };
}
console.log(`\n${"=".repeat(78)}\nV6 vs V7-PROMOTION ON THE LABELLED RECALL CORPUS (one verdict, two policies)\n${"=".repeat(78)}`);
console.log(JSON.stringify(summary, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify({ summary, results }, null, 2)); console.log(`\nPer-case detail (FAMILY TEXT — keep outside the repository) -> ${OUT}`); }
