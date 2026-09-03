#!/usr/bin/env node
// Writer v2 FINAL SHADOW on fresh, V6-approved Memory candidates (Phase D/E, 2026-09-03).
//
// Unlike writer-v2-shadow.mjs, which draws from LifeEvents the rule organizer already made, this
// script asks frozen V6 itself which fresh windows are Memories — exactly the production route:
// Memory Editor v4 → contract → claim grounding → V6 routing → `life_event_candidate` — and hands
// only those to the Writer. The Memory threshold is V6's, untouched: a low candidate yield is a
// finding to report, never a reason to loosen anything here.
//
// Read-only against production, zero writes: no LifeEvent, no DailyTrace, no organizer run, no
// ledger row. persist is hard-wired false.
//
//   node --import tsx -r dotenv/config scripts/writer-v2-fresh-shadow.mjs \
//     --exclude=<v6 corpus>.json --exclude=<writer shadow>.json --exclude=<continuity corpus>.json \
//     --target=20 --max-scored=120 --out=<path>.json dotenv_config_path=.env.local
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate, shanghaiDateSqlFromInstant } from "../lib/organizer/life-date.ts";
import { DEVELOPMENT_SET, HOLDOUT_SET } from "../lib/organizer/calibration-sets.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";
import { HOLDOUT_V3_SET } from "../lib/organizer/calibration-sets-v3.ts";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { createV6RoutingPolicy } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { resolveSpeaker } from "../lib/organizer/identity.ts";
import { buildEvidencePackage, packageHasAssertableMaterial } from "../lib/organizer/writer-v2.ts";
import { WRITER_V2_SYSTEM_PROMPT, WRITER_V2_TOOL_NAME, WRITER_V2_TOOL_SCHEMA, WRITER_V2_PROMPT_VERSION, buildWriterV2Prompt } from "../lib/organizer/writer-v2-prompt.ts";
import { NARRATIVE_VALIDATOR_VERSION, validateNarrative } from "../lib/organizer/narrative-validator.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const OUT = argOf("out", null);
const TARGET = Number(argOf("target", "20"));
const MAX_SCORED = Number(argOf("max-scored", "120"));
const EXCLUDE = args.filter((a) => a.startsWith("--exclude=")).map((a) => a.slice(10));
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";
const NOW = new Date().toISOString();

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "").replace(/\/$/, "");
if (!dbUrl || !apiKey) { console.error("Need DATABASE_URL and DEEPSEEK_API_KEY."); process.exit(1); }

// ---------------------------------------------------------------- spent material (never re-used)
const spentDays = new Set();
const spentAnchors = new Set();
for (const c of DEVELOPMENT_SET) { spentDays.add(`${c.conversation}|${c.day}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V2_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); if (c.anchorSourceId) spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_V3_SET) { spentDays.add(`${c.conversation}|${c.lifeDate}`); spentAnchors.add(c.anchorSourceId); }
for (const c of HOLDOUT_SET) { spentDays.add(`${MAIN}|${c.day}`); spentDays.add(`${MAIN}|${c.dayAsOriginallyRecorded}`); }
for (const file of EXCLUDE) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  for (const w of data.manifest?.windows ?? []) { for (const id of w.sourceIds ?? []) spentAnchors.add(id); spentDays.add(`${w.conversationId}|${w.activityDate}`); if (w.lifeDate) spentDays.add(`${w.conversationId}|${w.lifeDate}`); }
  for (const c of data.cases ?? []) if (c.lifeDate) spentDays.add(`${MAIN}|${c.lifeDate}`);
}
console.log(`Spent material excluded: ${spentDays.size} (conversation, day) pairs, ${spentAnchors.size} sourceIds, ${EXCLUDE.length} exclusion files.`);

// ---------------------------------------------------------------- load
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await client.query(`select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources where source_type='wechat' and deleted_at is null and profile_id=$1 order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID]);
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}
// Days that already hold a LifeEvent are not "fresh" either: a Writer page for them would be a
// rewrite of an existing Memory, which this task does not authorise.
const { rows: eventDays } = await client.query(`select distinct ${shanghaiDateSqlFromInstant("occurred_at")} as d from life_events where profile_id=$1`, [PROFILE_ID]);
for (const r of eventDays) spentDays.add(`${MAIN}|${r.d}`);
await client.end();

const byConversation = new Map();
for (const row of rows) {
  const conv = row.source_label;
  if (!byConversation.has(conv)) byConversation.set(conv, []);
  byConversation.get(conv).push({ id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types, contributorId: String(row.metadata?.senderDigest ?? row.contributor_id), capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at), text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata, sourceLabel: row.source_label });
}

// ---------------------------------------------------------------- fresh pool
// Only windows that could ever be a Memory under V6 are worth a model call: the child named in the
// window, or resolvable through the ±5 neighbours. This is selection of what to SCORE, not of what
// to accept — V6 still decides.
const NAMES = SUBJECT.aliases.concat(SUBJECT.primaryName);
const names = (t) => NAMES.some((n) => t.includes(n));
const fingerprint = (w) => createHash("sha256").update(`${w.conversationId}|${w.activityDate}|${w.items.map((i) => i.sourceId).sort().join(",")}`).digest("hex").slice(0, 32);
const lifeDateOf = (w) => shanghaiCalendarDate(w.timeRange.from);
const pool = [];
let built = 0, spent = 0;
for (const [conversation, sources] of byConversation) {
  for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] })) {
    built += 1;
    const dayKeys = [`${w.conversationId}|${w.activityDate}`, `${w.conversationId}|${lifeDateOf(w)}`];
    if (w.items.some((i) => spentAnchors.has(i.sourceId)) || dayKeys.some((k) => spentDays.has(k))) { spent += 1; continue; }
    if (w.stats.messageCount < 4) continue;
    const text = w.items.map((i) => i.text).join("\n");
    const shape = names(text) ? "named" : [...w.neighbors.before, ...w.neighbors.after].some((i) => names(i.text)) ? "resolvable_now" : null;
    if (!shape) continue;
    pool.push({ w, shape, fp: fingerprint(w) });
  }
}
pool.sort((a, b) => a.fp.localeCompare(b.fp));
console.log(`Built ${built} windows; ${spent} spent; fresh scorable pool ${pool.length} (named ${pool.filter((p) => p.shape === "named").length}, resolvable_now ${pool.filter((p) => p.shape === "resolvable_now").length}).`);

// ---------------------------------------------------------------- V6 route (production behaviour)
const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...OPTS });
console.log(`Editor: ${editor.name} ${editor.model} ${editor.promptVersion}  Writer prompt: ${WRITER_V2_PROMPT_VERSION}  Validator: ${NARRATIVE_VALIDATOR_VERSION}\npersist: FALSE (hard-wired)\n`);
const baseContext = { now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] };
const identityOf = (digest) => {
  const s = resolveSpeaker(digest, FAMILY_REGISTRY);
  return { speakerDigest: digest, known: s.known, canonicalPersonId: s.canonicalPersonId, narrativeLabel: s.narrativeLabel, relationshipToSubject: s.relationshipToSubject };
};

function judge(window, raw) {
  const verdict = validateMemoryEditorVerdict(raw, window);
  const axes = editor.axesByWindowId.get(window.windowId);
  const bounded = editor.subjectResolutionByWindowId.get(window.windowId);
  if (!axes || !bounded) throw new Error("missing axes");
  const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
  const grounding = groundClaims(window, verdictWithAxis, SUBJECT, OPTS);
  const policy = createV6RoutingPolicy(() => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding }), () => {});
  const outcome = validate(window, verdictWithAxis, { ...baseContext, routingPolicy: policy, claimGrounding: grounding });
  return { verdict, grounding, outcome, worthinessScore: outcome.outcome.worthinessScore ?? 0 };
}

async function callWriter(pkg) {
  const body = JSON.stringify({
    model: editor.model, max_tokens: 3000, temperature: 0, thinking: { type: "disabled" },
    system: WRITER_V2_SYSTEM_PROMPT,
    tools: [{ name: WRITER_V2_TOOL_NAME, description: "输出这一页的标题、正文和逐句依据", input_schema: WRITER_V2_TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: WRITER_V2_TOOL_NAME },
    messages: [{ role: "user", content: buildWriterV2Prompt(pkg) }],
  });
  const started = Date.now();
  const res = await fetch(`${baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`writer http ${res.status}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === WRITER_V2_TOOL_NAME);
  if (!tool) throw new Error("writer returned no tool_use");
  return { output: { contractVersion: "writer-v2-output-contract-v1", ...tool.input }, latencyMs: Date.now() - started, usage: payload.usage };
}

// ---------------------------------------------------------------- run
const scored = [];
const cases = [];
let editorErrors = 0;
for (const { w, shape, fp } of pool) {
  if (cases.length >= TARGET || scored.length >= MAX_SCORED) break;
  const lifeDate = lifeDateOf(w);
  const label = `[${scored.length + 1}] ${w.windowId.slice(0, 24)} ${lifeDate} ${shape} n=${w.stats.messageCount}`;
  let judged;
  try {
    const raw = (await editor.organize(w)).verdict;
    judged = judge(w, raw);
  } catch (error) {
    editorErrors += 1;
    console.log(`${label}  ERROR ${String(error?.message ?? error).slice(0, 80)}`);
    scored.push({ windowId: w.windowId, fingerprint: fp, lifeDate, shape, error: String(error?.message ?? error) });
    continue;
  }
  const action = judged.outcome.outcome.action;
  scored.push({ windowId: w.windowId, fingerprint: fp, lifeDate, shape, action, reasonCodes: judged.outcome.reasonCodes, claims: judged.grounding.claims.length, promotable: judged.grounding.promotableGroundedFactCount });
  if (action !== "life_event_candidate") { console.log(`${label}  ${action}`); continue; }

  const pkg = buildEvidencePackage({
    window: w, windowFingerprint: fp, grounding: judged.grounding,
    selectedBy: { policyId: "worthiness-v6-grounded", action, worthinessScore: judged.worthinessScore },
    subject: { ...SUBJECT, narrativeLabel: "张年" },
    identityOf,
    quotableLines: (judged.verdict.quotableLines ?? []).map((q) => ({ text: q.text, evidenceRef: q.evidenceRef, speakerRole: q.speakerRole })),
    longitudinal: [], lifeDate,
  });
  if (!packageHasAssertableMaterial(pkg)) {
    console.log(`${label}  life_event_candidate but NOTHING ASSERTABLE — Writer not called`);
    cases.push({ windowId: w.windowId, fingerprint: fp, lifeDate, shape, skipped: "nothing_assertable", package: pkg });
    continue;
  }
  let writer;
  try { writer = await callWriter(pkg); }
  catch (error) { console.log(`${label}  WRITER ERROR ${String(error?.message ?? error).slice(0, 80)}`); cases.push({ windowId: w.windowId, fingerprint: fp, lifeDate, shape, error: String(error?.message ?? error), package: pkg }); continue; }
  const validation = validateNarrative({ pkg, output: writer.output });
  console.log(`${label}  life_event_candidate → ${validation.ok ? "ACCEPT" : "REJECT"} ${writer.output.insufficient ? "(insufficient)" : `「${writer.output.title ?? ""}」`} ${validation.ok ? "" : validation.issues.map((i) => i.code).join(",")}`);
  cases.push({ windowId: w.windowId, fingerprint: fp, lifeDate, shape, stats: w.stats, package: pkg, v2: writer.output, validation, latencyMs: writer.latencyMs, usage: writer.usage });
}

// ---------------------------------------------------------------- summary
const actions = scored.reduce((a, s) => { if (s.action) a[s.action] = (a[s.action] ?? 0) + 1; return a; }, {});
const written = cases.filter((c) => c.v2);
const accepted = written.filter((c) => c.validation.ok);
const issues = {};
for (const c of written) for (const i of c.validation.issues) issues[i.code] = (issues[i.code] ?? 0) + 1;
console.log(`\n${"=".repeat(70)}\nWRITER V2 FRESH SHADOW (V6-approved candidates only)\n${"=".repeat(70)}`);
console.log(`fresh pool             : ${pool.length}`);
console.log(`windows scored by V6   : ${scored.length}  (editor errors ${editorErrors})`);
console.log(`V6 actions             : ${JSON.stringify(actions)}`);
console.log(`life_event_candidates  : ${cases.length}  (target ${TARGET})`);
console.log(`  nothing assertable   : ${cases.filter((c) => c.skipped).length}`);
console.log(`  writer runs          : ${written.length}`);
console.log(`  accepted by validator: ${accepted.length}`);
console.log(`  declined (insufficient): ${written.filter((c) => c.v2.insufficient).length}`);
console.log(`  rejected             : ${written.length - accepted.length}`);
console.log(`failure taxonomy:`);
for (const [k, v] of Object.entries(issues).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log(`model stats: ${JSON.stringify(editor.stats ?? {})}`);
console.log(`\nprompt=${WRITER_V2_PROMPT_VERSION} validator=${NARRATIVE_VALIDATOR_VERSION} model=${editor.model} persist=false`);

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    generatedAt: NOW, promptVersion: WRITER_V2_PROMPT_VERSION, validatorVersion: NARRATIVE_VALIDATOR_VERSION, model: editor.model, persist: false,
    manifest: { target: TARGET, maxScored: MAX_SCORED, poolSize: pool.length, excluded: { spentDayPairs: spentDays.size, spentSourceIds: spentAnchors.size, files: EXCLUDE }, windows: scored.map((s) => ({ ...s, conversationId: MAIN, activityDate: s.lifeDate, sourceIds: pool.find((p) => p.w.windowId === s.windowId)?.w.items.map((i) => i.sourceId) ?? [] })) },
    scored, cases,
  }, null, 2), "utf8");
  console.log(`\nWritten to ${OUT}  (contains family chat text — keep outside the repository)`);
}
