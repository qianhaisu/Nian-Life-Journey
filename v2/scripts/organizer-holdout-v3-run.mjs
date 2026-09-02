#!/usr/bin/env node
// Holdout V3 ONE-SHOT runner. persist: false, hard-wired.
//
// This spends the holdout. Run it once. After the result is seen, nothing may be changed and the
// set re-run — no prompt, router, threshold, gate, label, anchor, fixture, subject logic or context
// retrieval. A holdout that is tuned against is a development set with a misleading name.
import { writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { HOLDOUT_V3_SET } from "../lib/organizer/calibration-sets-v3.ts";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { createV6RoutingPolicy, V6_ROUTING_POLICY_ID } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const NOW = new Date().toISOString();
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Set CONTRACT_DATABASE_URL or DATABASE_URL."); process.exit(1); }

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();
const byConversation = new Map();
for (const conversation of new Set(HOLDOUT_V3_SET.map((c) => c.conversation))) {
  const rows = []; const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.query(
      `select ${COLS} from raw_sources where source_type='wechat' and deleted_at is null
        and profile_id=$1 and source_label=$2 order by captured_at, id limit ${PAGE} offset ${offset}`,
      [PROFILE_ID, conversation]);
    rows.push(...page.rows);
    if (page.rows.length < PAGE) break;
  }
  const sources = rows.map((row) => ({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: String(row.metadata?.senderDigest ?? row.contributor_id),
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
    text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility,
    metadata: row.metadata, sourceLabel: row.source_label, contributorRole: undefined,
  }));
  byConversation.set(conversation, buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] }));
}
await client.end();

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", registry: FAMILY_REGISTRY, singleChildHousehold: true });
console.log(`HOLDOUT V3 ONE-SHOT — ${HOLDOUT_V3_SET.length} cases`);
console.log(`provider=${editor.name} model=${editor.model} prompt=${editor.promptVersion} variant=${editor.variant} router=${V6_ROUTING_POLICY_ID} persist=false\n`);

const results = [];
for (const [i, c] of HOLDOUT_V3_SET.entries()) {
  const window = byConversation.get(c.conversation).find((w) => w.items.some((it) => it.sourceId === c.anchorSourceId));
  if (!window) { console.log(`[${i + 1}] ${c.id}  ERROR window not found`); results.push({ ...c, error: "window_not_found" }); continue; }

  let verdict;
  try {
    verdict = validateMemoryEditorVerdict((await editor.organize(window)).verdict, window);
  } catch (error) {
    console.log(`[${i + 1}] ${c.id}  ERROR ${error?.code ?? ""} ${String(error?.message ?? error).slice(0, 100)}`);
    results.push({ ...c, error: String(error?.code ?? error?.message ?? error) });
    continue;
  }
  const axes = editor.axesByWindowId.get(window.windowId);
  const bounded = editor.subjectResolutionByWindowId.get(window.windowId);
  const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
  const grounding = groundClaims(window, verdictWithAxis, SUBJECT, { registry: FAMILY_REGISTRY, singleChildHousehold: true });

  let gating;
  const policy = createV6RoutingPolicy(
    () => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding }),
    (_id, d) => { gating = d; });
  const result = validate(window, verdictWithAxis, {
    now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [],
    routingPolicy: policy, expectedRoutingPolicyId: V6_ROUTING_POLICY_ID, claimGrounding: grounding,
  });

  const row = {
    id: c.id, frozenLabel: c.frozenLabel, lifeDate: c.lifeDate, rationale: c.rationale,
    windowId: window.windowId, windowLifeDate: shanghaiCalendarDate(window.timeRange.from),
    stats: window.stats,
    action: result.outcome.action,
    reviewRequirement: result.outcome.reviewRequirement,
    worthinessScore: result.outcome.worthinessScore,
    reasonCodes: result.reasonCodes,
    degradeReason: result.degradeReason,
    emittedFacts: (result.outcome.coreFacts ?? result.outcome.attributedClaims ?? []).map((f) => ({ statement: f.statement, kind: f.assertionKind, refs: f.evidenceRefs })),
    traceLines: result.outcome.traceLines,
    grounding: {
      claims: grounding.claims.length, promotable: grounding.promotableGroundedFactCount, traceEvidence: grounding.traceEvidenceCount,
      questions: grounding.claims.filter((x) => x.assertionStatus === "question").length,
      plans: grounding.claims.filter((x) => x.assertionStatus === "plan_or_hypothetical").length,
      unsupported: grounding.claims.filter((x) => x.assertionStatus === "unsupported").length,
      unresolved: grounding.claims.filter((x) => !x.subject.resolved).length,
      negated: grounding.claims.filter((x) => x.polarity === "negated").length,
      zeroed: gating?.zeroed ?? [], reasonCodes: grounding.reasonCodes,
    },
    claimDetail: grounding.claims.map((x) => ({
      claimId: x.claimId, text: x.text, status: x.assertionStatus, polarity: x.polarity,
      subjectBasis: x.subject.basis, resolved: x.subject.resolved, observationMode: x.observationMode,
      spans: x.supportingSpans.map((s) => ({ ref: s.ref, text: s.text, speechAct: s.speechAct, markers: s.markers })),
    })),
    // The subset invariant: nothing emitted may cite a source outside the window.
    evidenceSubsetOk: (result.outcome.coreFacts ?? []).every((f) => (f.evidenceRefs ?? []).every((r) => window.items.some((it) => it.itemId === String(r).split("#")[0]))),
  };
  results.push(row);
  console.log(`[${i + 1}] ${c.id.padEnd(42)} ${c.frozenLabel.padEnd(10)} -> ${row.action.padEnd(21)} score=${String(row.worthinessScore).padStart(3)} claims=${row.grounding.claims} promotable=${row.grounding.promotable} zeroed=${row.grounding.zeroed.length}`);
}

// ---------------------------------------------------------------- report
const ok = results.filter((r) => !r.error);
const isMemory = (r) => r.action === "life_event_candidate";
const group = (cls) => ok.filter((r) => r.frozenLabel === cls);

console.log(`\n${"=".repeat(72)}\nHOLDOUT V3 RESULT (SPENT)\n${"=".repeat(72)}`);
for (const cls of ["positive", "borderline", "negative"]) {
  const g = group(cls);
  const promoted = g.filter(isMemory);
  console.log(`\n${cls.toUpperCase()}  n=${g.length}  promoted to Memory: ${promoted.length}/${g.length}`);
  for (const r of g) console.log(`  ${r.id.padEnd(42)} -> ${r.action.padEnd(21)} score=${String(r.worthinessScore).padStart(3)} facts=${r.emittedFacts.length} zeroed=${r.grounding.zeroed.join(",") || "-"}`);
}

console.log(`\n-- hard failure checks --`);
const fails = [];
const check = (name, bad) => { console.log(`  ${bad.length === 0 ? "PASS" : `FAIL (${bad.length})`}  ${name}`); if (bad.length) fails.push({ name, cases: bad.map((r) => r.id) }); };
check("no negative promoted to Memory", group("negative").filter(isMemory));
check("no borderline promoted to Memory", group("borderline").filter(isMemory));
check("no question-derived claim became an emitted fact", ok.filter((r) => r.emittedFacts.length > 0 && r.claimDetail.some((c) => c.status === "question" && r.emittedFacts.some((f) => f.statement === c.text))));
check("no plan/hypothetical became an emitted fact", ok.filter((r) => r.emittedFacts.length > 0 && r.claimDetail.some((c) => c.status === "plan_or_hypothetical" && r.emittedFacts.some((f) => f.statement === c.text))));
check("no emitted fact cites evidence outside its window", ok.filter((r) => !r.evidenceSubsetOk));
check("no unresolved-subject claim became an emitted fact", ok.filter((r) => r.claimDetail.some((c) => !c.resolved && r.emittedFacts.some((f) => f.statement === c.text))));
check("no routing mismatch / fail-open", results.filter((r) => r.error));
check("window lifeDate matches the frozen lifeDate", ok.filter((r) => r.windowLifeDate !== r.lifeDate));

const stats = editor.stats;
console.log(`\n-- model run --`);
console.log(`  calls=${stats.length} ok=${stats.filter((s) => s.ok).length} retries=${stats.reduce((n, s) => n + s.retries, 0)}`);
console.log(`  tokens in=${stats.reduce((n, s) => n + (s.inputTokens || 0), 0)} out=${stats.reduce((n, s) => n + (s.outputTokens || 0), 0)}`);
const lat = stats.filter((s) => s.ok).map((s) => s.latencyMs).sort((a, b) => a - b);
if (lat.length) console.log(`  latency ms min=${lat[0]} p50=${lat[Math.floor(lat.length / 2)]} max=${lat.at(-1)}`);
console.log(`  persist=false`);

console.log(`\nVERDICT: ${fails.length === 0 ? "PASS — no hard failure" : `FAIL — ${fails.map((f) => f.name).join("; ")}`}`);
console.log(`RECALL CONFIDENCE: LIMITED — only ${group("positive").length} positives in the set.`);

if (OUT) { writeFileSync(OUT, JSON.stringify({ generatedAt: NOW, provider: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion, variant: editor.variant }, router: V6_ROUTING_POLICY_ID, persist: false, modelStats: stats, results, fails }, null, 2), "utf8"); console.log(`\nWritten to ${OUT}`); }
