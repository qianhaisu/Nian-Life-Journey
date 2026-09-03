#!/usr/bin/env node
// Fresh shadow evaluation of the COUPLED candidate against frozen V6.
//
// Method, and the one rule that makes the result mean anything: ONE Memory Editor call per window,
// and that single verdict is routed through BOTH judgment policies. The editor is not deterministic
// across calls, so scoring the two policies in separate runs would confound the policy difference
// with model noise. Sharing the verdict makes every delta attributable to the policy.
//
// The two policies are whole policies, not switches — see judgment-policy.ts. The coupled candidate
// is zero-anaphora subject resolution AND grounded promotion eligibility together, because each is
// inert alone.
//
// Capture is resumable: a verdict already on disk is never re-requested, so a timeout costs nothing
// but time. Comparison re-runs offline at zero cost against the saved verdicts.
//
// persist is hard-wired false. Read-only against production. Saved verdicts and the audit file
// contain FAMILY TEXT and must stay outside the repository.
//
//   node --import tsx -r dotenv/config scripts/organizer-coupled-shadow.mjs \
//     --corpus=<corpus>.json --store=<dir> --out=<report>.json --audit=<audit>.json \
//     dotenv_config_path=.env.local
//
//   --capture-only / --compare-only   run one phase; default runs capture then compare.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL } from "../lib/organizer/life-date.ts";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims, applyGroundingToAxis } from "../lib/organizer/claim-grounding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { resolveSpeaker } from "../lib/organizer/identity.ts";
import { effectiveCapabilityScore } from "../lib/organizer/worthiness-v4.ts";
import { effectiveTransitionScore } from "../lib/organizer/worthiness-v2.ts";
import { FROZEN_V6_JUDGMENT, COUPLED_CANDIDATE_JUDGMENT, groundingOptionsFor } from "../lib/organizer/judgment-policy.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const has = (n) => args.includes(`--${n}`);
const CORPUS = argOf("corpus", null);
const STORE = argOf("store", null);
const OUT = argOf("out", null);
const AUDIT = argOf("audit", null);
const LIMIT = Number(argOf("limit", "0"));
const CAPTURE = !has("compare-only");
const COMPARE = !has("capture-only");
if (!CORPUS || !STORE) { console.error("Need --corpus and --store."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const BASE_OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const NOW = new Date().toISOString();
const POLICIES = [FROZEN_V6_JUDGMENT, COUPLED_CANDIDATE_JUDGMENT];

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (CAPTURE && !process.env.DEEPSEEK_API_KEY) { console.error("Need DEEPSEEK_API_KEY to capture."); process.exit(1); }

const corpusDoc = JSON.parse(readFileSync(CORPUS, "utf8"));
const worksheet = LIMIT > 0 ? corpusDoc.worksheet.slice(0, LIMIT) : corpusDoc.worksheet;
mkdirSync(STORE, { recursive: true });

// ---------------------------------------------------------------- windows, cached
const CACHE = join(STORE, "_windows.json");
const wanted = new Map(worksheet.map((c) => [c.windowId, c]));
const windows = new Map();
if (existsSync(CACHE)) {
  for (const w of JSON.parse(readFileSync(CACHE, "utf8")).windows) windows.set(w.windowId, w);
  console.log(`windows: ${windows.size} from cache`);
}
if ([...wanted.keys()].some((id) => !windows.has(id))) {
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
  console.log(`windows: rebuilt and cached ${windows.size}`);
}

const fileFor = (caseId) => join(STORE, `${caseId}.json`);

// ---------------------------------------------------------------- capture (the only model phase)
if (CAPTURE) {
  const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...BASE_OPTS });
  const todo = worksheet.filter((c) => !existsSync(fileFor(c.caseId)));
  console.log(`\nCAPTURE  editor=${editor.name} ${editor.model} ${editor.promptVersion}`);
  console.log(`corpus=${worksheet.length}  already captured=${worksheet.length - todo.length}  to call=${todo.length}  persist=FALSE\n`);
  let ok = 0, failed = 0;
  for (const entry of todo) {
    const w = windows.get(entry.windowId);
    if (!w) { console.log(`${entry.caseId} -> window_not_rebuilt`); failed += 1; continue; }
    try {
      const raw = (await editor.organize(w)).verdict;
      const verdict = validateMemoryEditorVerdict(raw, w);
      const axes = editor.axesByWindowId.get(w.windowId);
      const bounded = editor.subjectResolutionByWindowId.get(w.windowId);
      if (!axes || !bounded) throw new Error("missing axes");
      writeFileSync(fileFor(entry.caseId), JSON.stringify({
        caseId: entry.caseId, windowId: w.windowId, lifeDate: entry.lifeDate, stratum: entry.stratum,
        capturedAt: new Date().toISOString(),
        editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion },
        verdict, worthinessAxis: axes.worthinessAxis, evidenceAxis: axes.evidenceAxis, boundedLevel: bounded.level,
      }, null, 2));
      ok += 1;
      console.log(`${entry.caseId} ok  facts=${verdict.coreFacts.length} rel=${verdict.subjectRelevance} temporal=${verdict.temporalStatus}`);
    } catch (error) {
      failed += 1;
      console.log(`${entry.caseId} ERROR ${String(error?.message ?? error).slice(0, 90)}`);
    }
  }
  console.log(`\ncaptured=${ok} failed=${failed}`);
}

if (!COMPARE) process.exit(0);

// ---------------------------------------------------------------- compare (zero model calls)
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
const speakerOf = (digest) => {
  const s = resolveSpeaker(digest, FAMILY_REGISTRY);
  return s.known ? (s.narrativeLabel ?? s.relationshipToSubject ?? "known") : `未知(${String(digest).slice(0, 6)})`;
};

const rows = [];
for (const entry of worksheet) {
  const file = fileFor(entry.caseId);
  if (!existsSync(file)) continue;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  const w = windows.get(saved.windowId);
  if (!w) continue;
  const verdictWithAxis = { ...saved.verdict, worthinessAxis: saved.worthinessAxis };

  const cells = {};
  for (const policy of POLICIES) {
    const grounding = groundClaims(w, verdictWithAxis, SUBJECT, groundingOptionsFor(policy, BASE_OPTS));
    const gated = applyGroundingToAxis(saved.worthinessAxis, grounding);
    const lookup = () => ({ worthiness: saved.worthinessAxis, evidence: saved.evidenceAxis, subjectResolution: saved.boundedLevel, grounding });
    const result = validate(w, verdictWithAxis, {
      now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [],
      routingPolicy: policy.createRoutingPolicy(lookup, () => {}), claimGrounding: grounding,
    });
    const judged = signalsOf(gated.axis);
    cells[policy.id] = { grounding, gated, result, judged, action: result.outcome.action };
  }

  const v6 = cells[FROZEN_V6_JUDGMENT.id];
  const cp = cells[COUPLED_CANDIDATE_JUDGMENT.id];
  rows.push({ entry, saved, window: w, v6, cp, changed: v6.action !== cp.action });
  const delta = v6.action !== cp.action ? `   *** ${v6.action} -> ${cp.action} ***` : "";
  console.log(`${`${entry.caseId} ${entry.stratum}`.padEnd(40)} label=${String(entry.label ?? "?").padEnd(14)} v6=${String(v6.action).padEnd(20)} coupled=${String(cp.action).padEnd(20)}${delta}`);
}

// ---------------------------------------------------------------- audit every NEW Memory
const newMemories = rows.filter((r) => r.cp.action === "life_event_candidate" && r.v6.action !== "life_event_candidate");
const lostMemories = rows.filter((r) => r.v6.action === "life_event_candidate" && r.cp.action !== "life_event_candidate");
const lostTraces = rows.filter((r) => r.v6.action === "daily_trace" && r.cp.action === "store_only");

const auditRecords = newMemories.map((r) => {
  const g = r.cp.grounding;
  const qualifying = g.claims.filter((c) => c.mayGroundPromotion);
  const v6g = r.v6.grounding;
  return {
    caseId: r.entry.caseId, windowId: r.entry.windowId, lifeDate: r.entry.lifeDate,
    stratum: r.entry.stratum, preModelLabel: r.entry.label ?? null, preModelRationale: r.entry.rationale ?? null,
    sourceIds: r.entry.sourceIds,
    temporalStatus: r.saved.verdict.temporalStatus,
    subjectRelevance: r.saved.verdict.subjectRelevance, boundedLevel: r.saved.boundedLevel,
    strongSignalAfterGrounding: r.cp.judged.strong, mediumAfterGrounding: r.cp.judged.medium,
    noveltyBasis: {
      milestoneScore: r.saved.verdict.worthinessDimensions?.milestone?.score ?? 0,
      transitionSupport: r.saved.verdict.transitionSupport?.basis ?? null,
      eventType: r.cp.result.outcome.eventType ?? null,
      capabilityKind: r.saved.worthinessAxis.newCapabilityOrIndependence.kind,
      capabilityScore: r.saved.worthinessAxis.newCapabilityOrIndependence.score,
    },
    whyV6Rejected: {
      action: r.v6.action,
      promotableGroundedFactCount: v6g.promotableGroundedFactCount,
      traceEvidenceCount: v6g.traceEvidenceCount,
      zeroedDimensions: r.v6.gated.zeroed,
      strongAfterGrounding: r.v6.judged.strong,
      reasonCodes: r.v6.result.reasonCodes,
      perClaimBlockers: v6g.claims.map((c) => ({ statement: c.text, blockers: c.promotionBlockers, subjectBasis: c.subject.basis })),
    },
    whyCoupledAccepts: {
      promotionEligibleFactCount: g.promotionEligibleFactCount,
      traceEvidenceCount: g.traceEvidenceCount,
      groundingVersion: g.version,
      qualifyingClaims: qualifying.map((c, i) => ({
        claimId: c.claimId, statement: c.text,
        assertionKind: r.saved.verdict.coreFacts[g.claims.indexOf(c)]?.assertionKind ?? null,
        claimant: r.saved.verdict.coreFacts[g.claims.indexOf(c)]?.claimant ?? null,
        subjectBasis: c.subject.basis, subjectResolved: c.subject.resolved,
        antecedentSourceIds: c.subject.supportingSourceIds,
        assertionStatus: c.assertionStatus, observationMode: c.observationMode,
        speechActs: c.supportingSpans.map((s) => s.speechAct),
        polarity: c.polarity, epistemicStatus: c.epistemicStatus, epistemicMarkers: c.epistemicMarkers,
        speakers: c.speakers.map((s) => ({ label: speakerOf(s.digest), relationshipToSubject: s.relationshipToSubject ?? null })),
        evidenceRefs: c.evidenceRefs,
        supportingSpanText: c.supportingSpans.map((s) => s.text),
        index: i,
      })),
      // The exact antecedent messages that resolved a zero-anaphora claim, verbatim, so the
      // attribution can be checked by eye rather than trusted.
      antecedentMessages: [...new Set(qualifying.flatMap((c) => c.subject.supportingSourceIds))]
        .map((sid) => { const it = r.window.items.find((i) => i.sourceId === sid); return it ? { sourceId: sid, speaker: speakerOf(it.senderDigest), text: it.text } : { sourceId: sid, missing: true }; }),
    },
    windowMessages: r.window.items.map((i) => ({ speaker: speakerOf(i.senderDigest), at: i.sentAt, text: i.text, media: (i.mediaRefs ?? []).length })),
    outcome: { title: r.cp.result.outcome.title ?? null, coreFacts: r.cp.result.outcome.coreFacts?.map((f) => ({ statement: f.statement, assertionKind: f.assertionKind, evidenceRefs: f.evidenceRefs })) ?? [] },
  };
});

const byLabel = (pick) => rows.reduce((a, r) => { const k = `${r.entry.label ?? "unlabelled"}/${pick(r)}`; a[k] = (a[k] ?? 0) + 1; return a; }, {});
const promotedUnder = (pick) => rows.filter((r) => pick(r) === "life_event_candidate").map((r) => `${r.entry.caseId}:${r.entry.label ?? "?"}`);

const summary = {
  generatedAt: new Date().toISOString(), corpus: CORPUS,
  corpusManifest: { exclusionRule: corpusDoc.manifest?.exclusionRule, generatedAt: corpusDoc.manifest?.generatedAt, candidatesOnPreviouslyVisitedDay: corpusDoc.manifest?.candidatesOnPreviouslyVisitedDay },
  policies: POLICIES.map((p) => ({ id: p.id, routingPolicyId: p.routingPolicyId, grounding: p.grounding })),
  persist: false, modelCallsPerWindow: 1,
  scored: rows.length,
  byLabelV6: byLabel((r) => r.v6.action),
  byLabelCoupled: byLabel((r) => r.cp.action),
  promotions: { v6: promotedUnder((r) => r.v6.action), coupled: promotedUnder((r) => r.cp.action) },
  newMemories: newMemories.map((r) => `${r.entry.caseId}:${r.entry.label ?? "?"}`),
  lostMemories: lostMemories.map((r) => `${r.entry.caseId}:${r.entry.label ?? "?"}`),
  lostTraces: lostTraces.map((r) => `${r.entry.caseId}:${r.entry.label ?? "?"}`),
  routeChanges: rows.filter((r) => r.changed).map((r) => ({ caseId: r.entry.caseId, label: r.entry.label ?? null, stratum: r.entry.stratum, from: r.v6.action, to: r.cp.action })),
  // Retention monotonicity, checked on real data rather than only in unit tests.
  retentionMonotone: (() => {
    const rank = { store_only: 0, daily_trace: 1, life_event_candidate: 2 };
    const violations = rows.filter((r) => rank[r.cp.action] < rank[r.v6.action]).map((r) => `${r.entry.caseId}:${r.v6.action}->${r.cp.action}`);
    return { ok: violations.length === 0, violations };
  })(),
};

console.log(`\n${"=".repeat(78)}\nFRESH SHADOW — frozen V6 vs coupled candidate (one verdict, two policies)\n${"=".repeat(78)}`);
console.log(JSON.stringify(summary, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify({ summary, rows: rows.map((r) => ({ caseId: r.entry.caseId, label: r.entry.label ?? null, stratum: r.entry.stratum, v6: r.v6.action, coupled: r.cp.action, changed: r.changed })) }, null, 2)); console.log(`\nReport -> ${OUT}`); }
if (AUDIT) { writeFileSync(AUDIT, JSON.stringify({ generatedAt: new Date().toISOString(), newMemories: auditRecords }, null, 2)); console.log(`Audit of ${auditRecords.length} new Memories (FAMILY TEXT — keep outside the repository) -> ${AUDIT}`); }
