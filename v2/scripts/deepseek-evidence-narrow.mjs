#!/usr/bin/env node
// Re-reviews ONLY the currently published LifeEvents (not the whole archive) and fixes two things
// the first pass got wrong:
//
//  1. Evidence linking. An event was linked to every source in its evidence window — 107 messages
//     for one of them, including shift swaps, flights, taxis and shopping. The story never cited
//     that material, but the event page renders each linked RawSource, so the whole family group
//     chat was on display underneath the memory. An event is now linked only to the sources the
//     model actually cited, clamped to a small range.
//  2. Worthiness. Constipation, allergy-elimination schedules, teething and scalp scratching are
//     care topics, not life events. Care-dominated events are downgraded out of publication.
//
// Nothing is deleted: source_memory_links keeps the full audit relation, and the ledger row is
// updated in place so any decision can be revisited.
//
//   node --import tsx scripts/deepseek-evidence-narrow.mjs --out=<report.json> [--dry-run]
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

const { buildEvidenceWindows, windowFingerprint, WINDOW_POLICY_VERSION } = await import("../lib/organizer/evidence/window.ts");
const { runPipeline } = await import("../lib/organizer/pipeline.ts");
const { createDeepSeekMemoryEditor } = await import("../lib/organizer/deepseek-editor.ts");
const { QUALITY_REVIEW_POLICY_VERSION } = await import("../lib/organizer/quality-review.ts");
const { classifyCareTopics } = await import("../lib/organizer/care-topics.ts");
const { FAMILY_WRITER_PROMPT_VERSION, FAMILY_WRITER_SYSTEM_PROMPT, FAMILY_WRITER_TOOL_NAME, FAMILY_WRITER_TOOL_SCHEMA, buildFamilyWriterPrompt, validateFamilyWriterOutput } = await import("../lib/organizer/family-writer.ts");

// The story is rewritten from the SAME window the narrowed evidence comes from. Keeping the old
// story while narrowing to a freshly chosen window is how a memory about learning to stand ends up
// citing an afternoon about sleep and teeth.
async function writeStory(input) {
  const res = await fetch(`${(process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "")}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.DEEPSEEK_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.AI_MODEL, max_tokens: 2000, temperature: 0.3, thinking: { type: "disabled" },
      system: FAMILY_WRITER_SYSTEM_PROMPT,
      tools: [{ name: FAMILY_WRITER_TOOL_NAME, description: "输出标题和正文", input_schema: FAMILY_WRITER_TOOL_SCHEMA }],
      tool_choice: { type: "tool", name: FAMILY_WRITER_TOOL_NAME },
      messages: [{ role: "user", content: buildFamilyWriterPrompt(input) }],
    }),
  });
  if (res.status === 402) { console.error("DeepSeek 402 insufficient balance — stopping."); process.exit(2); }
  if (!res.ok) throw new Error(`http_${res.status}`);
  const body = await res.json();
  const block = body.content?.find((b) => b.type === "tool_use" && b.name === FAMILY_WRITER_TOOL_NAME);
  if (!block) throw new Error("no_tool_use");
  return block.input;
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
if (!outArg) { console.error("--out=<absolute path outside the repo> is required"); process.exit(1); }
const outPath = path.resolve(outArg);
if (!path.relative(path.resolve(process.cwd(), ".."), outPath).startsWith("..")) { console.error("Refusing to write real chat content inside the repository."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年年", "小年", "崽崽", "崽", "宝宝", "宝贝", "年年"] };
const MIN_SOURCES = 2;
const MAX_SOURCES = 12;

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT);
console.log(`Provider: ${JSON.stringify(editor.describe())}`);

const { rows: events } = await client.query(
  `select e.id, e.title, e.story, e.occurred_at, e.source_ids, e.media_ids
   from life_events e join content_quality_reviews r on r.target_kind='life_event' and r.target_id=e.id
   where r.decision = 'approved' order by e.occurred_at`);
console.log(`Re-reviewing ${events.length} published life events (no full-archive re-audit).`);

const results = [];
for (const event of events) {
  const { rows } = await client.query(
    `select id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids,
            source_label, visibility, metadata
     from raw_sources where id = any($1::text[]) and deleted_at is null order by captured_at limit 200`,
    [event.source_ids]);
  const sources = rows.map((row) => ({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: row.contributor_id, capturedAt: row.captured_at.toISOString(), text: row.text ?? "",
    mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata,
    sourceLabel: row.source_label, contributorRole: "family",
  }));

  const conversationId = sources[0]?.sourceLabel ?? `artifact:${event.id}`;
  const windows = buildEvidenceWindows(conversationId, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
  const ranked = [...windows].sort((a, b) => b.items.length - a.items.length).slice(0, 3);

  // Chosen by worthiness score, not by "first window with the best action". Action-rank-then-first
  // is unstable across runs, and picking a different window than the published story came from is
  // how the story and its evidence end up describing different afternoons.
  let best = null;
  for (const window of ranked) {
    const fingerprint = windowFingerprint(window, { policyVersion: WINDOW_POLICY_VERSION, promptVersion: editor.promptVersion, modelVersion: editor.model }, new Map());
    const result = await runPipeline(window, {
      subject: SUBJECT, provider: editor, windowFingerprint: fingerprint, persist: false,
      context: { existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] },
    });
    const rank = { life_event_candidate: 4, daily_trace: 3, care_observation: 2, plan_marker: 1, store_only: 0, failed: 0, attach_existing: 3 };
    const better = !best
      || (rank[result.outcome.action] ?? 0) > (rank[best.outcome.action] ?? 0)
      || ((rank[result.outcome.action] ?? 0) === (rank[best.outcome.action] ?? 0)
          && (result.outcome.worthinessScore ?? 0) > (best.outcome.worthinessScore ?? 0));
    if (better) best = result;
  }

  // Map the refs the model actually cited back to their RawSource ids. evidenceRefs are
  // "<itemId>#<spanId>" and every item in the window carries its own sourceId, so this is exact.
  const window = best.window;
  const sourceByItem = new Map(window.items.map((item) => [item.itemId, item.sourceId]));
  const citedRefs = [
    ...(best.verdict?.coreFacts ?? []).flatMap((fact) => fact.evidenceRefs),
    ...(best.verdict?.quotableLines ?? []).map((line) => line.evidenceRef),
    ...(best.verdict?.emotionalAnchor ? [best.verdict.emotionalAnchor.evidenceRef] : []),
    ...(best.verdict?.occurredAtProposal?.evidenceRefs ?? []),
  ];
  const citedSources = [...new Set(citedRefs.map((ref) => sourceByItem.get(String(ref).split("#")[0])).filter(Boolean))];
  // Keep them in the original chronological order of the event.
  const ordered = event.source_ids.filter((id) => citedSources.includes(id)).slice(0, MAX_SOURCES);

  const statements = (best.verdict?.coreFacts ?? []).map((fact) => fact.statement);
  const care = classifyCareTopics(statements);

  let decision = "approved";
  let reason = "evidence_narrowed";
  if (care.careDominated) { decision = "downgrade_to_daily_trace"; reason = "care_dominated_not_a_life_event"; }
  else if (ordered.length < MIN_SOURCES) { decision = "needs_human_review"; reason = "too_few_cited_sources"; }

  // Rewrite from this window's verified facts so story and evidence describe the same afternoon.
  let rewritten = null;
  const writerIssues = [];
  if (decision === "approved") {
    const input = { occurredAt: event.occurred_at.toISOString().slice(0, 10), coreFacts: best.verdict?.coreFacts ?? [], quotableLines: best.verdict?.quotableLines ?? [], mediaCount: 0 };
    for (let attempt = 0; attempt < 2 && !rewritten; attempt += 1) {
      let output;
      try { output = await writeStory(input); } catch (error) { writerIssues.push(`call_failed:${error.message}`); continue; }
      if (output.insufficient) { writerIssues.push("model_declared_insufficient"); break; }
      const validation = validateFamilyWriterOutput({ title: output.title ?? "", story: output.story ?? "", quotableLines: input.quotableLines, evidenceTexts: window.items.map((i) => i.text) });
      if (validation.ok) rewritten = output; else writerIssues.push(...validation.issues);
    }
    if (!rewritten) { decision = "needs_human_review"; reason = "writer_rejected_after_narrowing"; }
  }

  results.push({
    id: event.id, title: event.title, occurredAt: event.occurred_at.toISOString().slice(0, 10),
    before: event.source_ids.length, after: ordered.length, decision, reason,
    care: { careCount: care.careCount, milestoneCount: care.milestoneCount, total: care.total, ratio: Number(care.ratio.toFixed(2)) },
    action: best.outcome.action, worthinessScore: best.outcome.worthinessScore ?? 0,
    newTitle: rewritten?.title, newStory: rewritten?.story, previousTitle: event.title, writerIssues,
    _detail: { statements, citedTexts: window.items.filter((i) => ordered.includes(i.sourceId)).map((i) => i.text) },
  });
  console.log(`  ${String(event.source_ids.length).padStart(3)} -> ${String(ordered.length).padStart(2)} sources | care ${care.careCount}/${care.total} | ${decision.padEnd(24)} | ${event.title}`);

  if (!dryRun) {
    if (decision === "approved" && rewritten) {
      await client.query(`update life_events set source_ids = $2::jsonb, title = $3, story = $4, organizer_version = $5 where id = $1`,
        [event.id, JSON.stringify(ordered), rewritten.title, rewritten.story, `deepseek-${FAMILY_WRITER_PROMPT_VERSION}`]);
    }
    const fingerprint = createHash("sha256").update(`life_event:${event.id}:${editor.promptVersion}:${QUALITY_REVIEW_POLICY_VERSION}:${decision}`).digest("hex");
    await client.query(
      `update content_quality_reviews set decision = $2, reason_codes = (reason_codes::jsonb || $3::jsonb),
         review_fingerprint = $4, reviewed_at = now()
       where target_kind = 'life_event' and target_id = $1 and prompt_version = $5`,
      [event.id, decision, JSON.stringify([reason]), fingerprint, editor.promptVersion]);
  }
}

await client.end();

const summary = {
  provider: editor.describe(),
  reviewed: results.length,
  stillApproved: results.filter((r) => r.decision === "approved").length,
  downgraded: results.filter((r) => r.decision === "downgrade_to_daily_trace").length,
  needsHuman: results.filter((r) => r.decision === "needs_human_review").length,
  sourcesBefore: results.reduce((n, r) => n + r.before, 0),
  sourcesAfter: results.filter((r) => r.decision === "approved").reduce((n, r) => n + r.after, 0),
  calls: editor.stats.length,
  failedCalls: editor.stats.filter((s) => !s.ok).length,
  retries: editor.stats.reduce((n, s) => n + s.retries, 0),
  inputTokens: editor.stats.reduce((n, s) => n + s.inputTokens, 0),
  outputTokens: editor.stats.reduce((n, s) => n + s.outputTokens, 0),
};
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
await writeFile(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(`\nDetailed report written to: ${outPath}`);
