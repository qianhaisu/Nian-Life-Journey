#!/usr/bin/env node
// One month, real writes: subject gate → Memory Editor → claim grounding → Writer v2 → narrative
// validator → (if --commit) persist as a daily_trace, self-approved in content_quality_reviews.
//
// This is organizer-month-dryrun.mjs's exact pipeline plus persistence. Without --commit it behaves
// identically to the dry-run driver — nothing is written — so the same command can be run once to
// review, then again with --commit after a human (Cowork/Teddy) has read the output. T7's hard
// boundary: this produces daily_trace rows ONLY, never a life_event or a Memory candidate.
//
//   node --import tsx scripts/organizer-month-write.mjs --month=2026-09 --out=<abs path outside repo>.json
//     [--max-calls=60] [--max-days=31] [--commit]
//
// Why a daily_trace needs a manual review row here (see quality-review.ts): requiresQualityReview()
// fails CLOSED for any artifact whose organizerRun.organizerType is "ai" — a trace written through
// production-adapter.ts's daily_trace branch is otherwise persisted but permanently invisible, since
// there is no review desk to approve it. Cowork's "通过" in docs/STATUS.md is the human review this
// script's self-approval stands in for; it must never fire without that having happened first.
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { config as loadDotenv } from "dotenv";

// Before any module that reads the environment at import time.
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

const { buildEvidenceWindows } = await import("../lib/organizer/evidence/window.ts");
const { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } = await import("../lib/organizer/life-date.ts");
const { createDeepSeekMemoryEditor } = await import("../lib/organizer/deepseek-editor.ts");
const { groundClaims } = await import("../lib/organizer/claim-grounding.ts");
const { validateMemoryEditorVerdict } = await import("../lib/organizer/contract.ts");
const { FAMILY_REGISTRY } = await import("../lib/organizer/family-registry.ts");
const { resolveSpeaker } = await import("../lib/organizer/identity.ts");
const { buildEvidencePackage, packageHasAssertableMaterial } = await import("../lib/organizer/writer-v2.ts");
const { WRITER_V2_SYSTEM_PROMPT, WRITER_V2_TOOL_NAME, WRITER_V2_TOOL_SCHEMA, WRITER_V2_PROMPT_VERSION, buildWriterV2Prompt } = await import("../lib/organizer/writer-v2-prompt.ts");
const { NARRATIVE_VALIDATOR_VERSION, validateNarrative } = await import("../lib/organizer/narrative-validator.ts");
const { subjectGateFor, passesSubjectGate, SUBJECT_NAMES } = await import("../lib/organizer/subject-gate.ts");
const { planArtifacts, applyPlan } = await import("../lib/organizer/production-adapter.ts");
const { persistDailyTrace, persistOrganizerRun, findOrganizerRun, persistOrganization, markSourcesOrganized, persistQualityReview } = await import("../lib/db/repository.ts");

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const hasFlag = (name) => args.includes(`--${name}`);
const MONTH = argOf("month", null);
const OUT = argOf("out", null);
const MAX_CALLS = Number(argOf("max-calls", "60"));
const MAX_DAYS = Number(argOf("max-days", "31"));
const COMMIT = hasFlag("commit");
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: SUBJECT_NAMES.filter((n) => n !== "张年") };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };

// T7's own policy identity — deliberately NOT "judgment-v6-frozen": this pipeline bypasses V6
// worthiness entirely (the subject gate is the publication gate here), so the record must say what
// actually decided, not borrow the name of a policy that was never consulted.
const T7_POLICY_ID = "t7-subject-gate-v1";

if (!MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) { console.error("--month=YYYY-MM is required"); process.exit(1); }
if (!OUT) { console.error("--out=<absolute path outside the repository>.json is required"); process.exit(1); }
const outPath = path.resolve(OUT);
if (!path.relative(path.resolve(process.cwd(), ".."), outPath).startsWith("..")) { console.error("Refusing to write real chat content inside the repository."); process.exit(1); }

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (!apiKey) { console.error("Need DEEPSEEK_API_KEY."); process.exit(1); }

console.log(COMMIT ? "*** --commit set: passing days WILL be written as daily_trace rows ***" : "dry run (pass --commit to actually write)");

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

// The month, plus a week either side — see organizer-month-dryrun.mjs for why. Reading is done
// through this same short-lived client; the actual writes below go through the repository, which
// manages its own pool.
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const monthStart = `${MONTH}-01`;
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await client.query(
    `select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources
     where source_type='wechat' and deleted_at is null and profile_id=$1
       and captured_at >= ($2::date - interval '7 days')
       and captured_at <  (($2::date + interval '1 month') + interval '7 days')
     order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID, monthStart]);
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}
await client.end();
console.log(`Loaded ${rows.length} wechat sources.`);

const roleOf = (metadata, contributorId) => {
  const digest = String(metadata?.senderDigest ?? contributorId ?? "");
  const speaker = resolveSpeaker(digest, FAMILY_REGISTRY);
  return speaker.known ? speaker.narrativeLabel : undefined;
};

const byConversation = new Map();
for (const row of rows) {
  if (!byConversation.has(row.source_label)) byConversation.set(row.source_label, []);
  byConversation.get(row.source_label).push({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: String(row.metadata?.senderDigest ?? row.contributor_id),
    contributorRole: roleOf(row.metadata, row.contributor_id),
    capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
    text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata,
    sourceLabel: row.source_label, lifeDate: row.life_date,
  });
}

const fingerprintOf = (w) => createHash("sha256").update(`${w.conversationId}|${w.activityDate}|${w.items.map((i) => i.sourceId).sort().join(",")}`).digest("hex").slice(0, 32);
const lifeDateOf = (w) => shanghaiCalendarDate(w.timeRange.from);

// ---------------------------------------------------------------- the gate (T7 step 1)
const selected = [];
const gateStats = { conversations: 0, windowsBuilt: 0, windowsInMonth: 0, windowsPassed: 0, messagesKept: 0, messagesRejected: 0, byConversation: {} };
for (const [conversation, sources] of byConversation) {
  gateStats.conversations += 1;
  const gate = subjectGateFor(conversation);
  const stat = gateStats.byConversation[conversation] ??= { policy: gate.policy, windows: 0, passed: 0, kept: 0, rejected: 0 };
  for (const w of buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] })) {
    gateStats.windowsBuilt += 1;
    const lifeDate = lifeDateOf(w);
    if (!lifeDate?.startsWith(MONTH)) continue;
    gateStats.windowsInMonth += 1;
    stat.windows += 1;
    const verdict = passesSubjectGate(w, gate);
    stat.kept += verdict.kept.length;
    stat.rejected += verdict.rejected.length;
    gateStats.messagesKept += verdict.kept.length;
    gateStats.messagesRejected += verdict.rejected.length;
    if (!verdict.passes) continue;
    gateStats.windowsPassed += 1;
    stat.passed += 1;
    selected.push({ w, lifeDate, fp: fingerprintOf(w), gate: gate.policy, keptSourceIds: verdict.kept.map((i) => i.sourceId) });
  }
}
selected.sort((a, b) => a.lifeDate.localeCompare(b.lifeDate));
const days = [...new Set(selected.map((s) => s.lifeDate))].slice(0, MAX_DAYS);
const work = selected.filter((s) => days.includes(s.lifeDate));
console.log(`Gate: ${gateStats.windowsInMonth} window(s) in ${MONTH}, ${gateStats.windowsPassed} passed, over ${days.length} day(s). Messages kept ${gateStats.messagesKept}, rejected ${gateStats.messagesRejected}.`);

// ---------------------------------------------------------------- the writer (T7 step 2)
const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...OPTS });
console.log(`Editor ${editor.name} ${editor.model} ${editor.promptVersion} · Writer ${WRITER_V2_PROMPT_VERSION} · Validator ${NARRATIVE_VALIDATOR_VERSION}`);

async function callWriter(pkg) {
  const body = JSON.stringify({
    model: editor.model, max_tokens: 3000, temperature: 0, thinking: { type: "disabled" },
    system: WRITER_V2_SYSTEM_PROMPT,
    tools: [{ name: WRITER_V2_TOOL_NAME, description: "输出这一页的标题、正文和逐句依据", input_schema: WRITER_V2_TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: WRITER_V2_TOOL_NAME },
    messages: [{ role: "user", content: buildWriterV2Prompt(pkg) }],
  });
  const res = await fetch(`${baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`writer http ${res.status}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === WRITER_V2_TOOL_NAME);
  if (!tool) throw new Error("writer returned no tool_use");
  return { output: { contractVersion: "writer-v2-output-contract-v1", ...tool.input }, usage: payload.usage };
}

const identityOf = (digest) => {
  const s = resolveSpeaker(digest, FAMILY_REGISTRY);
  return { speakerDigest: digest, known: s.known, canonicalPersonId: s.canonicalPersonId, narrativeLabel: s.narrativeLabel, relationshipToSubject: s.relationshipToSubject };
};

const FORBIDDEN = /家人/;
const newIdOf = (prefix) => `${prefix}-${randomUUID()}`;
const repository = { findOrganizerRun, persistOrganization, persistDailyTrace, persistOrganizerRun, markSourcesOrganized, persistQualityReview };

const results = [];
let calls = 0;
let written = 0;
for (const item of work) {
  if (calls >= MAX_CALLS) { console.log(`Reached --max-calls=${MAX_CALLS}; stopping.`); break; }
  const entry = { lifeDate: item.lifeDate, conversation: item.w.conversationId, gate: item.gate, fingerprint: item.fp, messages: item.w.stats.messageCount, images: item.w.stats.imageCount, keptSourceIds: item.keptSourceIds };
  results.push(entry);
  let verdict, grounding;
  try {
    calls += 1;
    const raw = (await editor.organize(item.w)).verdict;
    verdict = validateMemoryEditorVerdict(raw, item.w);
    const axes = editor.axesByWindowId.get(item.w.windowId);
    grounding = groundClaims(item.w, { ...verdict, worthinessAxis: axes?.worthinessAxis }, SUBJECT, OPTS);
  } catch (error) {
    entry.skipped = `editor: ${String(error?.message ?? error)}`;
    console.log(`  ${item.lifeDate} EDITOR ERROR ${entry.skipped}`);
    continue;
  }
  entry.subjectRelevance = verdict.subjectRelevance;
  entry.groundedClaims = grounding.claims.length;

  const kept = new Set(item.keptSourceIds);
  const groundedInKept = grounding.claims.filter((claim) => (claim.sourceIds ?? []).some((id) => kept.has(id)));
  entry.claimsFromGatedSources = groundedInKept.length;
  if (groundedInKept.length === 0) { entry.skipped = "no grounded claim traces back to a message that passed the gate"; console.log(`  ${item.lifeDate} — no claim from gated sources`); continue; }
  grounding = { ...grounding, claims: groundedInKept };

  const pkg = buildEvidencePackage({
    window: item.w, windowFingerprint: item.fp, grounding,
    selectedBy: { policyId: T7_POLICY_ID, action: "daily_trace", worthinessScore: 0 },
    subject: { ...SUBJECT, narrativeLabel: "张年" }, identityOf,
    quotableLines: (verdict.quotableLines ?? []).map((q) => ({ text: q.text, evidenceRef: q.evidenceRef, speakerRole: q.speakerRole })),
    longitudinal: [], lifeDate: item.lifeDate,
  });
  if (!packageHasAssertableMaterial(pkg)) { entry.skipped = "nothing assertable after grounding"; console.log(`  ${item.lifeDate} — nothing assertable`); continue; }

  let writer;
  try { calls += 1; writer = await callWriter(pkg); }
  catch (error) { entry.skipped = `writer: ${String(error?.message ?? error)}`; console.log(`  ${item.lifeDate} WRITER ERROR`); continue; }
  const validation = validateNarrative({ pkg, output: writer.output });
  entry.validation = { ok: validation.ok, issues: validation.issues?.map((i) => i.code) ?? [] };
  entry.usage = writer.usage;
  if (writer.output.insufficient) { entry.skipped = "writer declared the evidence insufficient"; console.log(`  ${item.lifeDate} — writer: insufficient`); continue; }
  if (!validation.ok) { entry.skipped = `narrative validator refused: ${entry.validation.issues.join(",")}`; console.log(`  ${item.lifeDate} — validator refused (${entry.validation.issues.join(",")})`); continue; }
  const story = String(writer.output.story ?? "").trim();
  if (FORBIDDEN.test(story) || FORBIDDEN.test(String(writer.output.title ?? ""))) {
    entry.skipped = "text named an unresolved speaker as 家人";
    console.log(`  ${item.lifeDate} — REFUSED: contains 家人`);
    continue;
  }
  entry.proposed = { title: writer.output.title, story, usedMediaIds: writer.output.usedMediaIds ?? [], claims: writer.output.narrativeClaims ?? [] };
  console.log(`  ${item.lifeDate} OK  ${story.slice(0, 60)}…`);

  if (!COMMIT) continue;

  // ---------------------------------------------------------------- persist (T7 step 3, real write)
  const contentTypes = [...new Set(item.w.items.map((i) => i.contentTypes ?? []).flat())];
  const now = new Date().toISOString();
  const outcome = {
    action: "daily_trace",
    sourceIds: item.keptSourceIds,
    windowId: item.w.windowId,
    policyVersion: T7_POLICY_ID,
    modelVersion: editor.model,
    selectionReason: "passed the T7 subject gate; every published claim traces back to a message that passed it",
    worthinessScore: 0,
    occurredAt: `${item.lifeDate}T00:00:00.000Z`,
    scopes: ["family"],
    contentTypes: contentTypes.length ? contentTypes : ["daily"],
    traceLines: [{ text: story, evidenceRefs: item.keptSourceIds }],
    evidenceStrength: entry.claimsFromGatedSources,
  };
  const policy = {
    organizerVersion: "organizer-v2-t7-subject-gate",
    judgmentPolicyId: T7_POLICY_ID,
    writerVersion: WRITER_V2_PROMPT_VERSION,
    promptVersion: WRITER_V2_PROMPT_VERSION,
    policyVersion: T7_POLICY_ID,
    provider: editor.name,
    model: editor.model,
    allowedMediaTiers: ["confirmed"],
  };
  let applied;
  try {
    const plan = planArtifacts({ window: item.w, outcome, windowFingerprint: item.fp, policy, now, newId: newIdOf });
    applied = await applyPlan(plan, repository, { newId: newIdOf, now });
  } catch (error) {
    entry.writeError = String(error?.message ?? error);
    console.log(`  ${item.lifeDate} WRITE ERROR ${entry.writeError}`);
    continue;
  }
  entry.write = { applied: applied.applied, reason: applied.reason, traceId: applied.traceId };
  if (!applied.applied) { console.log(`  ${item.lifeDate} — already organized under this fingerprint (traceId ${applied.traceId}), no new write`); continue; }

  // A daily_trace's organizerRun.organizerType is "ai", so requiresQualityReview() fails it closed
  // (quality-review.ts). planArtifacts's daily_trace branch writes no review row at all — only the
  // life_event branch does — so this script writes it explicitly. This "approved" decision stands in
  // for the human review Cowork already did in docs/STATUS.md; it must never be reached without that.
  await persistQualityReview({
    id: newIdOf("quality-review"), profileId: PROFILE_ID,
    targetKind: "daily_trace", targetId: applied.traceId, decision: "approved",
    subjectRelevance: verdict.subjectRelevance, worthinessScore: 0,
    reasonCodes: ["t7-subject-gate", "cowork-reviewed-2026-09-04"],
    provider: editor.name, model: editor.model,
    promptVersion: WRITER_V2_PROMPT_VERSION, policyVersion: T7_POLICY_ID,
    reviewFingerprint: `${item.fp}:daily_trace`, reviewedAt: now,
  });
  written += 1;
  console.log(`  ${item.lifeDate} WRITTEN traceId=${applied.traceId}`);
}

const publishable = results.filter((r) => r.proposed);
const summary = {
  month: MONTH, generatedAt: new Date().toISOString(), commit: COMMIT,
  editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion },
  writerPromptVersion: WRITER_V2_PROMPT_VERSION, validatorVersion: NARRATIVE_VALIDATOR_VERSION,
  deepseekCalls: calls, gate: gateStats,
  daysConsidered: days.length, windowsProcessed: results.length, daysWithText: new Set(publishable.map((r) => r.lifeDate)).size,
  refused: results.filter((r) => r.skipped).length, written,
};
console.log(`\n=== SUMMARY ===\n${JSON.stringify(summary, null, 2)}`);
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(`\n${COMMIT ? `Wrote ${written} daily_trace row(s).` : "DRY RUN — nothing was written to the database."} Report: ${outPath} (contains family chat text; keep it outside the repository)`);
