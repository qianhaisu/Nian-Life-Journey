#!/usr/bin/env node
// One month, read-only: subject gate → Memory Editor → claim grounding → Writer v2 → narrative
// validator, printing the day-by-day text it WOULD publish and writing nothing at all.
//
// Why this exists (T7, 2026-09-04). The rule organizer writes a day's first chat line into the
// archive verbatim, which is how "你几点下班" and a car-price negotiation became records of a
// child's life. The V2 chain already knows better, but it had no driver that runs a whole month and
// reports rather than persists. This is that driver. It never writes: no trace, no life event, no
// organizer run, no ledger row, no raw_sources status change.
//
//   node --import tsx scripts/organizer-month-dryrun.mjs --month=2026-09 --out=<abs path outside repo>.json
//     [--max-calls=60] [--max-days=31]
//
// What it deliberately does NOT do:
//   - It produces day paragraphs only. No Memory, no LifeEvent, ever (T7 hard boundary).
//   - It does not use V6 worthiness as the publication gate. The gate is the subject gate below.
//     The writer's own per-sentence evidence constraints and the narrative validator are untouched:
//     a sentence still has to be supported by the evidence package or the page is refused.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

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

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const MONTH = argOf("month", null);
const OUT = argOf("out", null);
const MAX_CALLS = Number(argOf("max-calls", "60"));
const MAX_DAYS = Number(argOf("max-days", "31"));
const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: SUBJECT_NAMES.filter((n) => n !== "张年") };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };

if (!MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) { console.error("--month=YYYY-MM is required"); process.exit(1); }
if (!OUT) { console.error("--out=<absolute path outside the repository>.json is required"); process.exit(1); }
const outPath = path.resolve(OUT);
if (!path.relative(path.resolve(process.cwd(), ".."), outPath).startsWith("..")) { console.error("Refusing to write real chat content inside the repository."); process.exit(1); }

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (!apiKey) { console.error("Need DEEPSEEK_API_KEY."); process.exit(1); }

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

// Every wechat source, not just the month's: a window's neighbours are what let a pronoun resolve,
// and they can sit either side of a month boundary.
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const rows = [];
for (let offset = 0; ; offset += 1000) {
  const page = await client.query(
    `select ${COLS}, ${SHANGHAI_LIFE_DATE_SQL} as life_date from raw_sources
     where source_type='wechat' and deleted_at is null and profile_id=$1 order by captured_at, id limit 1000 offset ${offset}`, [PROFILE_ID]);
  rows.push(...page.rows);
  if (page.rows.length < 1000) break;
}
await client.end();
console.log(`Loaded ${rows.length} wechat sources.`);

// The speaker's family label is what the model is shown. It used to be told every speaker's role was
// literally "family", which is why every sentence it wrote began 家人 — the model was repeating what
// it had been handed. An unresolved speaker keeps its per-speaker pseudonym, so the writer can tell
// two unknown people apart without being able to name either.
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

// The one word that must never reach a page. Teddy, 2026-09-04: a speaker who cannot be resolved is
// left out of the sentence, never flattened into "家人". This is the deterministic backstop for the
// prompt rule, because a prompt is a request and this is a guarantee.
const FORBIDDEN = /家人/;

const results = [];
let calls = 0;
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

  // The window the model reads is the whole conversation, because that is what lets a pronoun
  // resolve. What it may ASSERT is narrower: a claim survives only if some message the gate let
  // through supports it. Without this, a car-price line sitting in the same window as a naming
  // message could still become a fact about him — the acceptance rule is that every published
  // sentence traces back to a message that passed the gate, so it is enforced here rather than hoped for.
  const kept = new Set(item.keptSourceIds);
  const groundedInKept = grounding.claims.filter((claim) => (claim.sourceIds ?? []).some((id) => kept.has(id)));
  entry.claimsFromGatedSources = groundedInKept.length;
  if (groundedInKept.length === 0) { entry.skipped = "no grounded claim traces back to a message that passed the gate"; console.log(`  ${item.lifeDate} — no claim from gated sources`); continue; }
  grounding = { ...grounding, claims: groundedInKept };

  const pkg = buildEvidencePackage({
    window: item.w, windowFingerprint: item.fp, grounding,
    selectedBy: { policyId: "t7-subject-gate", action: "daily_trace", worthinessScore: 0 },
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
}

const publishable = results.filter((r) => r.proposed);
const summary = {
  month: MONTH, generatedAt: new Date().toISOString(),
  editor: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion },
  writerPromptVersion: WRITER_V2_PROMPT_VERSION, validatorVersion: NARRATIVE_VALIDATOR_VERSION,
  deepseekCalls: calls, gate: gateStats,
  daysConsidered: days.length, windowsProcessed: results.length, daysWithText: new Set(publishable.map((r) => r.lifeDate)).size,
  refused: results.filter((r) => r.skipped).length,
};
console.log(`\n=== SUMMARY ===\n${JSON.stringify(summary, null, 2)}`);
writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(`\nDRY RUN — nothing was written to the database. Report: ${outPath} (contains family chat text; keep it outside the repository)`);
