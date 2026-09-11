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
// NOT A REQUIRED FOLLOW-UP any more (2026-09-11). This used to read:
//   "REQUIRED FOLLOW-UP for every month written here (T18, 2026-09-04):
//    node --import tsx scripts/t18-backfill-media-binding.mjs --commit"
// It was wrong twice over, and following it would have undone this script's own work.
//
// First, the premise stopped being true: this script does NOT leave media_ids empty. planArtifacts
// writes the media the Writer actually named, at the tiers this run permits — `confirmed` by
// default (photo and text in the same WeChat message, the strongest binding the archive has), and
// whatever ORGANIZER_V2_MEDIA_TIERS says when a run opts into more.
//
// Second, t18 selected by calendar day, not by this story's sources, and it updated every row with
// this exact organizer_version unconditionally — so running it afterwards replaced each confirmed
// binding with a same-day pick. In the 2025 rows it had already processed, 204 of 205 heroes came
// from somewhere other than their own story's sources.
//
// t18 has since been narrowed: it only fills a row that has NO binding, only from that row's own
// sources, and it never touches the NO_HERO_MEDIA_ID review sentinel. Run it if you want, or don't
// — this script's output no longer depends on it.
//
// TWO THINGS THAT USED TO HAPPEN AUTOMATICALLY AND ARE NOW OPT-IN (2026-09-11, Teddy).
//
// --self-approve (was: always on). This script used to overwrite plan.review.decision with
//   "approved" before applyPlan persisted it, on the grounds that Cowork's "通过" in docs/STATUS.md
//   was the human review. There is no Cowork any more (docs/DIRECT-COORDINATION.md), and the note
//   below always said the override "must never fire without a 通过 having happened first" — so the
//   safe reading of that sentence is that it must not fire by default. Without the flag a new
//   Memory keeps ADAPTER_REVIEW_DECISION ("needs_human_review") and therefore does not publish:
//   requiresQualityReview() fails CLOSED for any artifact whose organizerRun.organizerType is "ai".
//   Read the output first, then decide; the flag exists for after that decision, not before it.
//
// --grade (was: always on with --commit). T20-C grading (P1-3, 2026-09-05) does not grade the rows
//   this run wrote — it grades EVERY T7 event in the month, and for anything it calls low tier it
//   sets that event's existing content_quality_reviews decision to "store_only". On a month with
//   already-published stories that silently takes them off the site, which is a publication
//   decision this script has no business making as a side effect of writing one new day. Its API
//   calls also sit OUTSIDE --max-calls (one per 12 events), so with it on the ceiling is not a
//   ceiling. Off by default; t20c-regrade-memories.mjs still exists for a deliberate re-grade.
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
const { FAMILY_REGISTRY, OTHER_NAMED_PEOPLE } = await import("../lib/organizer/family-registry.ts");
const { resolveSpeaker } = await import("../lib/organizer/identity.ts");
const { buildEvidencePackage, packageHasAssertableMaterial, usedSourceIdsFor } = await import("../lib/organizer/writer-v2.ts");
const { WRITER_V2_SYSTEM_PROMPT, WRITER_V2_TOOL_NAME, WRITER_V2_TOOL_SCHEMA, WRITER_V2_PROMPT_VERSION, buildWriterV2Prompt } = await import("../lib/organizer/writer-v2-prompt.ts");
const { NARRATIVE_VALIDATOR_VERSION, validateNarrative } = await import("../lib/organizer/narrative-validator.ts");
const { subjectGateFor, passesSubjectGate, subjectRelevanceMayProceed, claimPassesSubjectGate, coreFactMayBeWritten, editorActionMayBeWritten, SUBJECT_NAMES } = await import("../lib/organizer/subject-gate.ts");
const { STORY_MEDIA_TIERS } = await import("../lib/organizer/writer-v2.ts");
const { planArtifacts, applyPlan } = await import("../lib/organizer/production-adapter.ts");
const { persistDailyTrace, persistOrganizerRun, findOrganizerRun, persistOrganization, markSourcesOrganized, persistQualityReview } = await import("../lib/db/repository.ts");
const { gradeMonthEvents } = await import("./t20c-grade-events.mjs");

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const hasFlag = (name) => args.includes(`--${name}`);
const MONTH = argOf("month", null);
const OUT = argOf("out", null);
const MAX_CALLS = Number(argOf("max-calls", "60"));
const MAX_DAYS = Number(argOf("max-days", "31"));
const COMMIT = hasFlag("commit");
// --force: bypass the findOrganizerRun early-exit below (only that check — applyPlan's own
// upsert-by-fingerprint idempotency downstream is untouched, so a forced rerun still can't
// duplicate a row, it can only replace one). Needed to redo a month under a different model:
// the fingerprint is window identity (conversationId|day|sourceIds), not model or prompt
// version, so a plain rerun after switching AI_MODEL silently no-ops on every already-written
// window instead of regenerating it — found 2026-09-05 when P1-0's flash months needed a pro
// redo. Use deliberately: this re-spends a DeepSeek call on every window in scope.
const FORCE = hasFlag("force");
// See the header. Both default to OFF: writing a Memory and publishing it are different decisions,
// and re-grading a month's existing stories is a third one.
const SELF_APPROVE = hasFlag("self-approve");
const GRADE = hasFlag("grade");
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
// --fingerprints=<32hex>[,<32hex>…] narrows a run to named windows, the same way --day narrows it to
// one day and for the same reason: a day holds several windows, so re-running one window to check a
// change otherwise re-spends a model call on every other window that shares its date. Added
// 2026-09-11 to verify the subject-gate and media-binding fixes on eight chosen windows inside a
// 30-request ceiling. Filters BEFORE any editor call, like every other filter here.
const FINGERPRINTS = (argOf("fingerprints", "") || "").split(",").map((f) => f.trim()).filter(Boolean);
if (FINGERPRINTS.some((f) => !/^[0-9a-f]{32}$/.test(f))) { console.error("--fingerprints takes comma-separated 32-character hex window fingerprints"); process.exit(1); }
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: SUBJECT_NAMES.filter((n) => n !== "张年") };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
// Zero-anaphora subject resolution, DECOUPLED from judgment-v7-coupled-za-promotion (2026-09-11).
// That policy bundles it with a changed promotion rule and is frozen for that reason; this pipeline
// does not consult promotion routing at all — the subject gate is its publication gate — so the
// grounding option is taken on its own and nothing about promotion moves. What it buys: a claim
// whose span drops the subject entirely ("放到床上就睡着了") takes the same bounded antecedent walk a
// claim saying 他 already takes, behind the same competing-person check, and never past the window.
const GROUNDING_OPTS = { ...OPTS, zeroAnaphoraAntecedent: true, otherNamedPeople: OTHER_NAMED_PEOPLE };
// Media tiers this RUN permits, read from the environment instead of hardcoded, so the tier policy
// and the binding code can be changed together in one process without touching production config.
// Default stays `confirmed`: a deployment opts into strong_contextual deliberately or not at all.
const MEDIA_TIERS = (process.env.ORGANIZER_V2_MEDIA_TIERS ?? "confirmed").split(",").map((t) => t.trim()).filter(Boolean);

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

// A scoped registry entry (identity.ts) resolves only inside the conversations it was confirmed
// for, so every lookup has to say which conversation it is reading.
const roleOf = (metadata, contributorId, conversationId) => {
  const digest = String(metadata?.senderDigest ?? contributorId ?? "");
  const speaker = resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId });
  return speaker.known ? speaker.narrativeLabel : undefined;
};

const byConversation = new Map();
for (const row of rows) {
  if (!byConversation.has(row.source_label)) byConversation.set(row.source_label, []);
  byConversation.get(row.source_label).push({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: String(row.metadata?.senderDigest ?? row.contributor_id),
    contributorRole: roleOf(row.metadata, row.contributor_id, row.source_label),
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
const inRange = selected.filter((s) => inDayRange(s.lifeDate) && (FINGERPRINTS.length === 0 || FINGERPRINTS.includes(s.fp)));
const days = [...new Set(inRange.map((s) => s.lifeDate))].slice(0, MAX_DAYS);
const work = inRange.filter((s) => days.includes(s.lifeDate));
console.log(`Gate: ${gateStats.windowsInMonth} window(s) in ${MONTH}, ${gateStats.windowsPassed} passed, over ${days.length} day(s)${DAY || FROM || TO ? ` (day filter: ${DAY ?? `${FROM ?? "start"}..${TO ?? "end"}`})` : ""}. Messages kept ${gateStats.messagesKept}, rejected ${gateStats.messagesRejected}.`);

// ---------------------------------------------------------------- the writer (T7 step 2)
const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...OPTS });
console.log(`Editor ${editor.name} ${editor.model} ${editor.promptVersion} · Writer ${WRITER_V2_PROMPT_VERSION} · Validator ${NARRATIVE_VALIDATOR_VERSION}`);
console.log(`Grounding zeroAnaphoraAntecedent=${GROUNDING_OPTS.zeroAnaphoraAntecedent === true} · media tiers [${MEDIA_TIERS.join(",")}] (ORGANIZER_V2_MEDIA_TIERS${process.env.ORGANIZER_V2_MEDIA_TIERS ? "" : " unset, default"})`);

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

const identityOf = (digest, conversationId) => {
  const s = resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId });
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
  const prior = FORCE ? null : await findOrganizerRun(item.fp);
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
    grounding = groundClaims(item.w, { ...verdict, worthinessAxis: axes?.worthinessAxis }, SUBJECT, GROUNDING_OPTS);
  } catch (error) {
    entry.skipped = `editor: ${String(error?.message ?? error)}`;
    console.log(`  ${item.lifeDate} EDITOR ERROR ${entry.skipped}`);
    return entry;
  }
  entry.subjectRelevance = verdict.subjectRelevance;
  entry.groundedClaims = grounding.claims.length;
  // The Editor's own Gate A verdict, as a stop condition rather than a field in a report. Fails
  // closed on a missing or unrecognised verdict — see subjectRelevanceMayProceed.
  const relevance = subjectRelevanceMayProceed(verdict.subjectRelevance);
  entry.subjectRelevanceDecision = relevance;
  // Kept even when the window stops here, so the refusal can be re-read against its own evidence.
  entry.editorVerdict = verdict;
  if (!relevance.proceed) {
    entry.skipped = `editor gate: ${relevance.reason}`;
    console.log(`  ${item.lifeDate} — STOPPED before the writer (${relevance.reason})`);
    return entry;
  }

  // The Editor's own action, respected rather than overwritten. `care_observation`,
  // `attach_existing` and `store_only` have no target implemented here, so they are held as pending
  // — writing them as a story is what turned a fall off the sofa into an ordinary trace-weight page.
  const editorAction = editorActionMayBeWritten(verdict.proposedAction);
  entry.editorAction = { proposedAction: verdict.proposedAction, sensitivityFlags: verdict.sensitivityFlags ?? [], ...editorAction };
  if (!editorAction.proceed) {
    entry.pending = editorAction.reason;
    entry.skipped = `editor action: ${editorAction.reason}`;
    console.log(`  ${item.lifeDate} — PENDING, not written (${editorAction.reason})`);
    return entry;
  }

  const kept = new Set(item.keptSourceIds);
  // groundClaims builds claim-N from coreFacts[N] (claim-grounding.ts), so the Editor's per-fact
  // subjectRole travels with the claim. Two independent questions, both asked before the Writer:
  // is this sentence about him (the subject gate), and is this HIS event (the Editor's role).
  const claimGate = grounding.claims.map((claim, index) => {
    const fact = verdict.coreFacts?.[index];
    const gate = claimPassesSubjectGate(claim, kept);
    const role = coreFactMayBeWritten(fact ?? {});
    return { claim, gate, role, subjectRole: fact?.subjectRole, passes: gate.passes && role.passes };
  });
  const groundedInKept = claimGate.filter((c) => c.passes).map((c) => c.claim);
  entry.claimsFromGatedSources = groundedInKept.length;
  entry.claimGate = claimGate.map((c) => ({
    claimId: c.claim.claimId, passes: c.passes, subjectRole: c.subjectRole,
    gateReason: c.gate.reason, roleReason: c.role.reason,
    basis: c.claim.subject?.basis, resolved: Boolean(c.claim.subject?.resolved),
  }));
  entry.coreFactRoles = (verdict.coreFacts ?? []).reduce((acc, f) => { const k = f.subjectRole ?? "(absent)"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  if (groundedInKept.length === 0) { entry.skipped = "no grounded claim traces back to a message that passed the gate"; console.log(`  ${item.lifeDate} — no claim from gated sources`); return entry; }
  grounding = { ...grounding, claims: groundedInKept };

  // A quote may only come from material that survived both gates. The Editor's quotableLines are
  // its own summary of the window, not a subset of the claims, and `quoteIsAssertable` lets a line
  // through on the strength of naming the child — so an excluded claim could walk back into the
  // page as a quotation. Cut here, once, on the evidence items the surviving claims rest on.
  const survivingItemIds = new Set(groundedInKept.flatMap((claim) => (claim.evidenceRefs ?? []).map((ref) => String(ref).split("#")[0])));
  const allQuotes = verdict.quotableLines ?? [];
  const keptQuotes = allQuotes.filter((q) => survivingItemIds.has(String(q.evidenceRef).split("#")[0]));
  entry.quoteGate = { offered: allQuotes.length, kept: keptQuotes.length, dropped: allQuotes.length - keptQuotes.length };

  const pkg = buildEvidencePackage({
    window: item.w, windowFingerprint: item.fp, grounding,
    selectedBy: { policyId: T7_POLICY_ID, action: "life_event_candidate", worthinessScore: 0 },
    subject: { ...SUBJECT, narrativeLabel: "张年" }, identityOf: (digest) => identityOf(digest, item.w.conversationId),
    quotableLines: keptQuotes.map((q) => ({ text: q.text, evidenceRef: q.evidenceRef, speakerRole: q.speakerRole })),
    longitudinal: [], lifeDate: item.lifeDate, otherNamedPeople: OTHER_NAMED_PEOPLE,
  });
  // Private run evidence: every photograph this window bound, HOW it was bound and WHICH message it
  // was bound to, so an adoption (or a refusal) can be checked offline without re-deriving the
  // window. `offeredToWriter` is what the prompt actually listed; `attachableUnderPolicy` is what
  // this run's tier configuration would allow if the Writer named it. The two are separate on
  // purpose — being shown a photograph is not being allowed to keep it.
  entry.mediaCandidates = item.w.mediaBindings.map((b) => ({
    mediaId: b.mediaId, rule: b.rule, tier: b.tier, confidence: b.confidence, basis: b.basis,
    boundItemId: b.boundItemId,
    boundSourceId: b.boundItemId ? item.w.items.find((i) => i.itemId === b.boundItemId)?.sourceId : undefined,
    belongsToSubject: pkg.media.find((m) => m.mediaId === b.mediaId)?.belongsToSubject,
    offeredToWriter: STORY_MEDIA_TIERS.has(b.tier) && pkg.media.find((m) => m.mediaId === b.mediaId)?.belongsToSubject?.allowed !== false,
    attachableUnderPolicy: MEDIA_TIERS.includes(b.tier) && pkg.media.find((m) => m.mediaId === b.mediaId)?.belongsToSubject?.allowed !== false,
  }));
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

  // Every offered photograph has to come back with a stance: adopted, or declined with a reason.
  // Not adopting is a legitimate answer and is never forced — what is not allowed is silence, which
  // is what the previous prompt produced (39 candidates offered, 1 adopted, no reason given for the
  // other 38). A candidate the Writer says nothing about is recorded as an unanswered offer.
  const stanceById = new Map((writer.output.mediaDecisions ?? []).map((d) => [d.mediaId, d]));
  const offered = (entry.mediaCandidates ?? []).filter((c) => c.offeredToWriter);
  const usedIds = new Set(writer.output.usedMediaIds ?? []);
  entry.mediaStance = offered.map((c) => {
    const stance = stanceById.get(c.mediaId);
    const used = usedIds.has(c.mediaId) || stance?.used === true;
    return {
      mediaId: c.mediaId, tier: c.tier, rule: c.rule, basis: c.basis, boundSourceId: c.boundSourceId,
      used,
      // Adoption has to say WHICH sentence it belongs to; a declined photograph has to say why.
      supportsFact: used ? (stance?.supportsFact ?? null) : undefined,
      reason: used ? undefined : (stance?.reason ?? null),
      answered: Boolean(stance),
      // A contextual binding places a picture beside the page. It never licenses a claim about what
      // the picture shows, whatever the Writer wrote next to it.
      mayNarrateAsDepicting: c.tier === "confirmed",
    };
  });
  entry.mediaStanceSummary = {
    offered: offered.length,
    answered: entry.mediaStance.filter((m) => m.answered).length,
    adopted: entry.mediaStance.filter((m) => m.used).length,
    declinedWithReason: entry.mediaStance.filter((m) => !m.used && m.reason).length,
    unanswered: entry.mediaStance.filter((m) => !m.answered).length,
    adoptedWithoutFact: entry.mediaStance.filter((m) => m.used && !m.supportsFact).length,
  };

  // What the Writer asked to keep, and whether this run's tier policy would let it — the same test
  // planMedia applies at persistence, recorded here so a dry run carries the identical evidence.
  entry.mediaAdoption = (writer.output.usedMediaIds ?? []).map((mediaId) => {
    const candidate = entry.mediaCandidates?.find((c) => c.mediaId === mediaId);
    if (!candidate) return { mediaId, linked: false, reason: "not present in this window's evidence" };
    const stance = stanceById.get(mediaId);
    return { mediaId, tier: candidate.tier, basis: candidate.basis, boundSourceId: candidate.boundSourceId, supportsFact: stance?.supportsFact ?? null, linked: candidate.attachableUnderPolicy, reason: candidate.attachableUnderPolicy ? `tier ${candidate.tier} permitted` : `tier ${candidate.tier} is not attachable under this policy` };
  });
  if (offered.length && (writer.output.usedMediaIds ?? []).length === 0) {
    entry.mediaNote = `${offered.length} photograph(s) offered, none adopted; declined with a reason: ${entry.mediaStanceSummary.declinedWithReason}, no stance given: ${entry.mediaStanceSummary.unanswered}`;
  }
  console.log(`  ${item.lifeDate} OK  ${story.slice(0, 60)}…`);

  if (!COMMIT) return entry;

  // ---------------------------------------------------------------- persist (T7 step 3, real write)
  const contentTypes = [...new Set(item.w.items.map((i) => i.contentTypes ?? []).flat())];
  const now = new Date().toISOString();
  // Provenance is what the story RESTS ON, not what the gate happened to keep. The gate decides
  // whether this window gets written at all; once it does, every message the finished page cites or
  // quotes has to be in the trail, or the evidence chain leads somewhere other than the words.
  // Gated sources stay FIRST so the primary source_memory_link is still a gated message.
  const windowSourceIds = new Set(item.w.items.map((i) => i.sourceId));
  const usedSourceIds = usedSourceIdsFor(pkg, writer.output).filter((id) => windowSourceIds.has(id));
  const provenanceSourceIds = [...new Set([...item.keptSourceIds, ...usedSourceIds])];
  entry.provenance = {
    gatedSources: item.keptSourceIds.length,
    addedByUse: provenanceSourceIds.length - item.keptSourceIds.length,
    total: provenanceSourceIds.length,
  };
  const outcome = {
    action: "life_event_candidate",
    sourceIds: provenanceSourceIds,
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
    allowedMediaTiers: MEDIA_TIERS,
  };
  const writerStory = { title: writer.output.title, story, usedMediaIds: writer.output.usedMediaIds ?? [] };
  let applied;
  try {
    const plan = planArtifacts({ window: item.w, outcome, windowFingerprint: item.fp, policy, story: writerStory, now, newId: newIdOf, editor: { proposedAction: verdict.proposedAction, sensitivityFlags: verdict.sensitivityFlags ?? [] } });
    // Publication is a separate decision from writing, and it is not this script's to make unless
    // a human has said so on this run. Default: keep ADAPTER_REVIEW_DECISION, which is fail-closed.
    plan.review.reasonCodes = [...plan.review.reasonCodes, "t7-subject-gate"];
    if (SELF_APPROVE) {
      plan.review.decision = "approved";
      plan.review.reasonCodes = [...plan.review.reasonCodes, "self-approved-by-flag"];
    }
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
// Token usage from BOTH halves. The writer's usage was already carried on each entry; the editor's
// only ever lived in editor.stats and never reached the report, so a run's real cost could not be
// added up afterwards — it had to be estimated, which is not good enough when there is a budget.
const editorUsage = editor.stats.reduce((acc, s) => {
  acc.calls += 1;
  acc.inputTokens += s.inputTokens ?? 0;
  acc.outputTokens += s.outputTokens ?? 0;
  if (!s.ok) acc.failed += 1;
  return acc;
}, { calls: 0, inputTokens: 0, outputTokens: 0, failed: 0 });
const writerUsage = results.reduce((acc, r) => {
  if (!r.usage) return acc;
  acc.calls += 1;
  acc.inputTokens += r.usage.input_tokens ?? 0;
  acc.outputTokens += r.usage.output_tokens ?? 0;
  return acc;
}, { calls: 0, inputTokens: 0, outputTokens: 0 });
const summary = {
  month: MONTH, generatedAt: new Date().toISOString(), commit: COMMIT,
  editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion },
  writerPromptVersion: WRITER_V2_PROMPT_VERSION, validatorVersion: NARRATIVE_VALIDATOR_VERSION,
  deepseekCalls: calls,
  tokenUsage: {
    editor: editorUsage, writer: writerUsage,
    totalInputTokens: editorUsage.inputTokens + writerUsage.inputTokens,
    totalOutputTokens: editorUsage.outputTokens + writerUsage.outputTokens,
  },
  gate: gateStats,
  daysConsidered: days.length, windowsProcessed: results.length, daysWithText: new Set(publishable.map((r) => r.lifeDate)).size,
  refused: results.filter((r) => r.skipped).length, written,
};
console.log(`\n=== SUMMARY ===\n${JSON.stringify(summary, null, 2)}`);
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(`\n${COMMIT ? `Wrote ${written} life_event row(s).` : "DRY RUN — nothing was written to the database."} Report: ${outPath} (contains family chat text; keep it outside the repository)`);

// T20-C grading, only when asked for. It reaches every T7 event in the month, including ones this
// run did not write and ones already published, and it spends calls --max-calls does not count.
if (COMMIT && GRADE) {
  console.log(`\n--- T20-C grade (--grade given; this also re-grades the month's EXISTING events) ---`);
  const gradeModel = process.env.AI_MODEL || "deepseek-v4-pro";
  await gradeMonthEvents(MONTH, { dbUrl, apiKey, baseUrl, model: gradeModel, persistQualityReview, commit: true });
} else if (COMMIT) {
  console.log(`\nT20-C grading skipped (pass --grade to re-grade this whole month, existing events included).`);
};
