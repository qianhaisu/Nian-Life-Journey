#!/usr/bin/env node
// One month, real writes: subject gate → Memory Editor → claim grounding → Writer v2 → narrative
// validator → (if --commit) persist as a life_event, self-approved in content_quality_reviews.
//
// This is organizer-month-dryrun.mjs's exact pipeline plus persistence. Without --commit it behaves
// identically to the dry-run driver — nothing is written — so the same command can be run once to
// review, then again with --commit after a human (Cowork/Teddy) has read the output.
//
//   node --import tsx scripts/organizer-month-write.mjs --month=2026-09 --out=<abs path outside repo>.json
//     [--max-calls=60] [--max-days=31] [--concurrency=8] [--commit]
//
// T17, 2026-09-04 (Cowork): the per-window work was fully serial — ~82s/window, almost all of it
// waiting on one DeepSeek HTTP round trip, so a month's ~100 passing windows took the better part of
// an hour. --concurrency=N (default 8, 1-16) runs N bounded worker loops pulling from the same work
// queue. Four things a naive "just wrap it in Promise.all" would have broken, kept intact on purpose:
//   1. The T10 fingerprint short-circuit (findOrganizerRun) still runs per item, still before any
//      model call — each worker checks its own item, so no worker ever spends a DeepSeek call on a
//      window another run (or another worker) already committed.
//   2. --max-calls stays a hard ceiling: reserveCall() below is a synchronous check-and-increment
//      (no `await` inside it), which is atomic under JS's single-threaded event loop even with many
//      in-flight workers — two workers can never both observe room for the last call and overshoot.
//   3. `work` is deduped by fingerprint before the pool starts, so two workers can never race to
//      persist the same organizationFingerprint (applyPlan's own idempotency is the backstop, not the
//      first line of defense).
//   4. Error isolation is per-item exactly as before (try/catch around each phase) — one window's
//      editor/writer failure ends that window's iteration, not its worker's loop.
//
// T11, 2026-09-04 (Teddy): this used to persist a daily_trace. DailyTrace has no title field
// (types.ts:61: entries: string[]), so it rendered folded behind TraceDisclosure while every other
// month's writer-v2 prose renders as an EditorialMemory (title + story) via life_event — a visible
// format break between 2025 and 2026 pages for no reason the writer's own output couldn't already
// fix, since it was producing a title all along and the pipeline was discarding it. Now action is
// "life_event_candidate" and memoryWeight is forced down to "trace" (see below) so T7's output reads
// the same as everything else while still sorting behind real highlights/chapters.
//
// Why a review row still needs an explicit "approved" override here (see quality-review.ts):
// requiresQualityReview() fails CLOSED for any artifact whose organizerRun.organizerType is "ai".
// planArtifacts's life_event_candidate branch already writes a review row, but ADAPTER_REVIEW_DECISION
// is "needs_human_review" — correct for the real production pipeline, which has no review desk yet
// either, but wrong here: Cowork's "通过" in docs/STATUS.md IS the human review for T7's output, so
// this script overrides plan.review.decision to "approved" before applyPlan persists it. That override
// must never fire without a Cowork "通过" having happened first.
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
const CONCURRENCY = Math.max(1, Math.min(16, Number(argOf("concurrency", "8")) || 8));
// --day and --from/--to slice which days of the month are actually processed. T10, 2026-09-04:
// Cowork's environment has a 175s hard ceiling per command and no surviving background process, so a
// month has to be committed one day (or a few days) at a time across many invocations — and without
// this filter, every rerun re-pays the DeepSeek calls for every earlier day in the month before it
// even reaches the day that still needs doing. This filters BEFORE any editor call, not after.
const DAY = argOf("day", null);
const FROM = argOf("from", null);
const TO = argOf("to", null);
if (DAY && !/^\d{4}-\d{2}-\d{2}$/.test(DAY)) { console.error("--day=YYYY-MM-DD"); process.exit(1); }
if ((FROM && !/^\d{4}-\d{2}-\d{2}$/.test(FROM)) || (TO && !/^\d{4}-\d{2}-\d{2}$/.test(TO))) { console.error("--from/--to take YYYY-MM-DD"); process.exit(1); }
if (DAY && (FROM || TO)) { console.error("--day and --from/--to are mutually exclusive"); process.exit(1); }
const inDayRange = (lifeDate) => {
  if (DAY) return lifeDate === DAY;
  if (FROM && lifeDate < FROM) return false;
  if (TO && lifeDate > TO) return false;
  return true;
};
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

console.log(COMMIT ? "*** --commit set: passing days WILL be written as life_event rows ***" : "dry run (pass --commit to actually write)");

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
const inRange = selected.filter((s) => inDayRange(s.lifeDate));
const days = [...new Set(inRange.map((s) => s.lifeDate))].slice(0, MAX_DAYS);
const work = inRange.filter((s) => days.includes(s.lifeDate));
console.log(`Gate: ${gateStats.windowsInMonth} window(s) in ${MONTH}, ${gateStats.windowsPassed} passed, over ${days.length} day(s)${DAY || FROM || TO ? ` (day filter: ${DAY ?? `${FROM ?? "start"}..${TO ?? "end"}`})` : ""}. Messages kept ${gateStats.messagesKept}, rejected ${gateStats.messagesRejected}.`);

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
  if (res.status === 429) { const err = new Error("writer http 429"); err.rateLimited = true; throw err; }
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
// Mirrors production-adapter.ts's own (unexported) MEMORY_RUN_ACTIONS — an OrganizerRun.action of
// either name means the target id on that run points at a life_event, not a daily_trace.
const MEMORY_RUN_ACTIONS = new Set(["create_memory", "life_event_candidate"]);

// Two workers must never both spend a call on the same window, and identity here is the
// organizationFingerprint, not array position — dedupe before any worker sees the list.
{
  const seen = new Set();
  const deduped = [];
  for (const item of work) { if (seen.has(item.fp)) continue; seen.add(item.fp); deduped.push(item); }
  if (deduped.length !== work.length) console.log(`Deduped ${work.length - deduped.length} window(s) sharing a fingerprint before dispatch.`);
  work.length = 0;
  work.push(...deduped);
}

const results = new Array(work.length);
let calls = 0;
let written = 0;
let maxCallsLogged = false;
let cursor = 0;
let allowedWorkers = CONCURRENCY;
let consecutive429 = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Synchronous check-and-increment: no `await` between the read and the write, so this is atomic
// under JS's single-threaded event loop no matter how many workers call it "at once".
function reserveCall() {
  if (calls >= MAX_CALLS) { if (!maxCallsLogged) { maxCallsLogged = true; console.log(`Reached --max-calls=${MAX_CALLS}; workers will finish in-flight items and stop.`); } return false; }
  calls += 1;
  return true;
}

function nextIndex() { return cursor < work.length ? cursor++ : -1; }

async function callWriterWithBackoff(pkg, lifeDate) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const result = await callWriter(pkg);
      consecutive429 = 0;
      return result;
    } catch (error) {
      if (!error?.rateLimited || attempt >= 4) throw error;
      consecutive429 += 1;
      const delayMs = Math.min(30000, 1000 * 2 ** consecutive429);
      if (allowedWorkers > 1) { allowedWorkers -= 1; console.log(`  [rate-limit] 429 on ${lifeDate}, backing off ${delayMs}ms, concurrency reduced to ${allowedWorkers}`); }
      else console.log(`  [rate-limit] 429 on ${lifeDate}, backing off ${delayMs}ms (concurrency already at floor 1)`);
      await sleep(delayMs);
    }
  }
}

async function processItem(item) {
  const entry = { lifeDate: item.lifeDate, conversation: item.w.conversationId, gate: item.gate, fingerprint: item.fp, messages: item.w.stats.messageCount, images: item.w.stats.imageCount, keptSourceIds: item.keptSourceIds };

  // T10: the same window identity (organizationFingerprint = item.fp) that applyPlan already uses
  // for replay safety, checked BEFORE the editor is called rather than after the writer has already
  // run — a rerun of a day that's already committed costs zero DeepSeek calls instead of one or two.
  const prior = await findOrganizerRun(item.fp);
  if (prior) {
    entry.skipped = "already organized under this fingerprint (checked before any model call)";
    entry.write = { applied: false, reason: "already organized under this fingerprint", eventId: MEMORY_RUN_ACTIONS.has(prior.action) ? prior.targetId : undefined };
    console.log(`  ${item.lifeDate} — already organized (eventId ${entry.write.eventId ?? "n/a"}), skipped before any DeepSeek call`);
    return entry;
  }

  if (!reserveCall()) { entry.skipped = "max-calls reached before this window's editor call"; return entry; }
  let verdict, grounding;
  try {
    const raw = (await editor.organize(item.w)).verdict;
    verdict = validateMemoryEditorVerdict(raw, item.w);
    const axes = editor.axesByWindowId.get(item.w.windowId);
    grounding = groundClaims(item.w, { ...verdict, worthinessAxis: axes?.worthinessAxis }, SUBJECT, OPTS);
  } catch (error) {
    entry.skipped = `editor: ${String(error?.message ?? error)}`;
    console.log(`  ${item.lifeDate} EDITOR ERROR ${entry.skipped}`);
    return entry;
  }
  entry.subjectRelevance = verdict.subjectRelevance;
  entry.groundedClaims = grounding.claims.length;

  const kept = new Set(item.keptSourceIds);
  const groundedInKept = grounding.claims.filter((claim) => (claim.sourceIds ?? []).some((id) => kept.has(id)));
  entry.claimsFromGatedSources = groundedInKept.length;
  if (groundedInKept.length === 0) { entry.skipped = "no grounded claim traces back to a message that passed the gate"; console.log(`  ${item.lifeDate} — no claim from gated sources`); return entry; }
  grounding = { ...grounding, claims: groundedInKept };

  const pkg = buildEvidencePackage({
    window: item.w, windowFingerprint: item.fp, grounding,
    selectedBy: { policyId: T7_POLICY_ID, action: "life_event_candidate", worthinessScore: 0 },
    subject: { ...SUBJECT, narrativeLabel: "张年" }, identityOf,
    quotableLines: (verdict.quotableLines ?? []).map((q) => ({ text: q.text, evidenceRef: q.evidenceRef, speakerRole: q.speakerRole })),
    longitudinal: [], lifeDate: item.lifeDate,
  });
  if (!packageHasAssertableMaterial(pkg)) { entry.skipped = "nothing assertable after grounding"; console.log(`  ${item.lifeDate} — nothing assertable`); return entry; }

  if (!reserveCall()) { entry.skipped = "max-calls reached before this window's writer call"; return entry; }
  let writer;
  try { writer = await callWriterWithBackoff(pkg, item.lifeDate); }
  catch (error) { entry.skipped = `writer: ${String(error?.message ?? error)}`; console.log(`  ${item.lifeDate} WRITER ERROR`); return entry; }
  const validation = validateNarrative({ pkg, output: writer.output });
  entry.validation = { ok: validation.ok, issues: validation.issues?.map((i) => i.code) ?? [] };
  entry.usage = writer.usage;
  if (writer.output.insufficient) { entry.skipped = "writer declared the evidence insufficient"; console.log(`  ${item.lifeDate} — writer: insufficient`); return entry; }
  if (!validation.ok) { entry.skipped = `narrative validator refused: ${entry.validation.issues.join(",")}`; console.log(`  ${item.lifeDate} — validator refused (${entry.validation.issues.join(",")})`); return entry; }
  const story = String(writer.output.story ?? "").trim();
  if (FORBIDDEN.test(story) || FORBIDDEN.test(String(writer.output.title ?? ""))) {
    entry.skipped = "text named an unresolved speaker as 家人";
    console.log(`  ${item.lifeDate} — REFUSED: contains 家人`);
    return entry;
  }
  entry.proposed = { title: writer.output.title, story, usedMediaIds: writer.output.usedMediaIds ?? [], claims: writer.output.narrativeClaims ?? [] };
  console.log(`  ${item.lifeDate} OK  ${story.slice(0, 60)}…`);

  if (!COMMIT) return entry;

  // ---------------------------------------------------------------- persist (T7 step 3, real write)
  const contentTypes = [...new Set(item.w.items.map((i) => i.contentTypes ?? []).flat())];
  const now = new Date().toISOString();
  const outcome = {
    action: "life_event_candidate",
    sourceIds: item.keptSourceIds,
    windowId: item.w.windowId,
    policyVersion: T7_POLICY_ID,
    modelVersion: editor.model,
    selectionReason: "passed the T7 subject gate; every published claim traces back to a message that passed it",
    worthinessScore: 0,
    occurredAt: `${item.lifeDate}T00:00:00.000Z`,
    scopes: ["family"],
    contentTypes: contentTypes.length ? contentTypes : ["daily"],
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
  const writerStory = { title: writer.output.title, story, usedMediaIds: writer.output.usedMediaIds ?? [] };
  let applied;
  try {
    const plan = planArtifacts({ window: item.w, outcome, windowFingerprint: item.fp, policy, story: writerStory, now, newId: newIdOf });
    // T7's review IS Cowork's "通过" in docs/STATUS.md, already given before this script is ever run
    // with --commit — planArtifacts's default ADAPTER_REVIEW_DECISION ("needs_human_review") is right
    // for the real production pipeline, which has no review desk, but wrong here; this override must
    // never fire without that "通过" having actually happened.
    plan.review.decision = "approved";
    plan.review.reasonCodes = [...plan.review.reasonCodes, "t7-subject-gate", "cowork-reviewed"];
    // T7's output is everyday observation, not a curated highlight — memoryWeight stays at the
    // pipeline's lowest tier so it never outranks a real chapter/highlight in curateMemories' sort.
    plan.lifeEvent.event.memoryWeight = "trace";
    applied = await applyPlan(plan, repository, { newId: newIdOf, now });
  } catch (error) {
    entry.writeError = String(error?.message ?? error);
    console.log(`  ${item.lifeDate} WRITE ERROR ${entry.writeError}`);
    return entry;
  }
  entry.write = { applied: applied.applied, reason: applied.reason, eventId: applied.eventId };
  if (!applied.applied) { console.log(`  ${item.lifeDate} — already organized under this fingerprint (eventId ${applied.eventId}), no new write`); return entry; }
  written += 1;
  console.log(`  ${item.lifeDate} WRITTEN eventId=${applied.eventId}`);
  return entry;
}

async function worker(workerIndex) {
  for (;;) {
    if (workerIndex >= allowedWorkers) return; // retired by a rate-limit downgrade
    const index = nextIndex();
    if (index === -1) return;
    results[index] = await processItem(work[index]);
  }
}

console.log(`Concurrency: ${CONCURRENCY} worker(s).`);
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

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
console.log(`\n${COMMIT ? `Wrote ${written} life_event row(s).` : "DRY RUN — nothing was written to the database."} Report: ${outPath} (contains family chat text; keep it outside the repository)`);
