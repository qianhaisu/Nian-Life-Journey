#!/usr/bin/env node
// Re-decides already-published rule-based artifacts through the DeepSeek quality gate and records
// the verdict in the content_quality_reviews ledger.
//
// Nothing is deleted and no `visibility` is touched: publication is decided by the ledger, so every
// decision here is reversible by deleting or updating a review row. Rule-derived artifacts are fail
// closed, so an artifact this script never reaches simply stays hidden.
//
//   node --import tsx scripts/deepseek-quality-audit.mjs --out=<abs-path.json> [--limit=N] [--fetch=N]
//                                                        [--kind=both|daily_trace|life_event] [--dry-run]
import { existsSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

const { buildEvidenceWindows, windowFingerprint, WINDOW_POLICY_VERSION } = await import("../lib/organizer/evidence/window.ts");
const { runPipeline } = await import("../lib/organizer/pipeline.ts");
const { createDeepSeekMemoryEditor } = await import("../lib/organizer/deepseek-editor.ts");
const { QUALITY_REVIEW_POLICY_VERSION, containsTechnicalPlaceholder } = await import("../lib/organizer/quality-review.ts");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limit = Number(args.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? "999");
// How many artifacts to FETCH, as distinct from how many to audit. The fetch was a fixed newest-200
// and the `done` set is applied after it, so once those 200 carried review rows every later run
// re-fetched the same 200, skipped all of them, and could never reach #201. With 2026 backfilled
// there are more than 200 traces, and the oldest months would have been permanently unreachable.
const fetchLimit = Number(args.find((a) => a.startsWith("--fetch="))?.slice("--fetch=".length) ?? "200");
if (!Number.isInteger(fetchLimit) || fetchLimit < 1 || fetchLimit > 5000) { console.error("--fetch must be an integer between 1 and 5000"); process.exit(1); }
// Which artifact kind to spend calls on. Life events are audited before traces, so a --limit small
// enough to control spend was consumed entirely by events, and the traces — the day-by-day text a
// month page actually reads, and the only rewrite that costs no further model call — were never
// reached. Defaults to both, which is the behaviour this script always had.
const kind = args.find((a) => a.startsWith("--kind="))?.slice("--kind=".length) ?? "both";
if (!["both", "daily_trace", "life_event"].includes(kind)) { console.error("--kind must be both, daily_trace or life_event"); process.exit(1); }
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
if (!outArg) { console.error("--out=<absolute path outside the repo> is required"); process.exit(1); }
const outPath = path.resolve(outArg);
const repoRoot = path.resolve(process.cwd(), "..");
const checkpointPath = `${outPath}.checkpoint.jsonl`;
if (!path.relative(repoRoot, outPath).startsWith("..")) { console.error("Refusing to write real chat content inside the repository."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年年", "小年", "崽崽", "崽", "宝宝", "宝贝", "年年"] };

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT);
console.log(`Provider: ${JSON.stringify(editor.describe())} policy=${QUALITY_REVIEW_POLICY_VERSION}`);

async function loadSources(sourceIds) {
  if (!sourceIds?.length) return [];
  const { rows } = await client.query(
    `select id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids,
            source_label, visibility, metadata
     from raw_sources where id = any($1::text[]) and deleted_at is null order by captured_at limit 60`,
    [sourceIds],
  );
  return rows.map((row) => ({
    id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
    contributorId: row.contributor_id, capturedAt: row.captured_at.toISOString(), text: row.text ?? "",
    mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata,
    sourceLabel: row.source_label, contributorRole: "family",
  }));
}

// Media-only days (the Quark photo import) carry no text to judge: there is no claim to verify and
// nothing to get wrong, so they are approved without spending a model call. Their technical entry
// text is rewritten separately by the writer stage.
function isPhotoOnly(sources) {
  return sources.length > 0 && sources.every((s) => s.sourceType === "family_photo" && !s.text.trim());
}

function decisionFor(targetKind, outcome, verdict) {
  const action = outcome.action;
  if (action === "care_observation") return "needs_human_review";
  if (action === "life_event_candidate") return "approved";
  if (action === "daily_trace") return targetKind === "life_event" ? "downgrade_to_daily_trace" : "approved";
  if (action === "failed") return "needs_human_review";
  const relevance = verdict?.subjectRelevance;
  if (relevance === "unrelated") return "rejected_unrelated";
  return "store_only";
}

// Resume support: an artifact already carrying a review row for this prompt version is skipped, so a
// killed run can be restarted without re-spending model calls on work already recorded.
const done = new Set();
if (!args.includes("--force")) {
  const { rows } = await client.query(
    `select target_kind, target_id from content_quality_reviews where profile_id = $1 and prompt_version = $2`,
    [PROFILE_ID, editor.promptVersion]);
  for (const row of rows) done.add(`${row.target_kind}:${row.target_id}`);
  if (done.size) console.log(`Resuming: ${done.size} artifact(s) already reviewed, skipping them.`);
}

const results = [];
let calls = 0;

const REVIEW_SQL = `insert into content_quality_reviews
     (id, profile_id, target_kind, target_id, decision, gate_a, subject_relevance, worthiness_score,
      reason_codes, provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at)
   values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14, now())
   on conflict (target_kind, target_id, prompt_version) do update set
     decision = excluded.decision, gate_a = excluded.gate_a, subject_relevance = excluded.subject_relevance,
     worthiness_score = excluded.worthiness_score, reason_codes = excluded.reason_codes,
     review_fingerprint = excluded.review_fingerprint, reviewed_at = now()`;

// Persisted per artifact rather than in one batch at the end: a run that dies at 90% must keep the
// 90% it already paid for.
async function persistReview(entry) {
  if (dryRun) return;
  const fingerprint = createHash("sha256").update(`${entry.targetKind}:${entry.targetId}:${editor.promptVersion}:${QUALITY_REVIEW_POLICY_VERSION}:${entry.decision}`).digest("hex");
  await client.query(REVIEW_SQL, [randomUUID(), PROFILE_ID, entry.targetKind, entry.targetId, entry.decision, entry.gateA,
    entry.subjectRelevance, entry.worthinessScore ?? 0, JSON.stringify(entry.reasonCodes ?? []), editor.name, editor.model,
    editor.promptVersion, QUALITY_REVIEW_POLICY_VERSION, fingerprint]);
  await appendFile(checkpointPath, JSON.stringify({ ...entry, _detail: undefined }) + String.fromCharCode(10), "utf8");
}

async function audit(targetKind, rows, textOf) {
  for (const row of rows) {
    if (results.length >= limit) break;
    if (done.has(`${targetKind}:${row.id}`)) continue;
    const sources = await loadSources(row.source_ids);
    const currentText = textOf(row);
    const base = {
      targetKind, targetId: row.id, occurredAt: row.occurred_at.toISOString(),
      sourceCount: sources.length, currentTextHasPlaceholder: containsTechnicalPlaceholder(currentText),
    };

    if (sources.length === 0) {
      const entry = { ...base, decision: "needs_human_review", gateA: null, subjectRelevance: null, worthinessScore: 0, reasonCodes: ["no_sources"], _detail: { currentText } };
      results.push(entry); await persistReview(entry);
      continue;
    }

    if (isPhotoOnly(sources)) {
      const entry = { ...base, decision: "approved", gateA: "photo_only", subjectRelevance: null, worthinessScore: 0, reasonCodes: ["photo_only_no_text_claim"], _detail: { currentText } };
      results.push(entry); await persistReview(entry);
      continue;
    }

    const conversationId = sources[0].sourceLabel ?? `artifact:${row.id}`;
    const windows = buildEvidenceWindows(conversationId, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
    // One artifact can span several windows; it survives only if its strongest window survives.
    // Capped at MAX_WINDOWS (largest first) so a single sprawling artifact cannot eat the call budget.
    const MAX_WINDOWS = 2;
    const ranked = [...windows].sort((a, b) => b.items.length - a.items.length).slice(0, MAX_WINDOWS);
    let best = null;
    for (const window of ranked) {
      const fingerprint = windowFingerprint(window, { policyVersion: WINDOW_POLICY_VERSION, promptVersion: editor.promptVersion, modelVersion: editor.model }, new Map());
      const result = await runPipeline(window, {
        subject: SUBJECT, provider: editor, windowFingerprint: fingerprint, persist: false,
        context: { existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] },
      });
      calls += result.skippedByRecall ? 0 : 1;
      const rank = { life_event_candidate: 4, daily_trace: 3, care_observation: 2, plan_marker: 1, store_only: 0, failed: 0, attach_existing: 3 };
      if (!best || (rank[result.outcome.action] ?? 0) > (rank[best.outcome.action] ?? 0)) best = result;
    }

    const decision = decisionFor(targetKind, best.outcome, best.verdict);
    const entry = {
      ...base, decision,
      gateA: best.verdict?.selectionReason?.startsWith("gate_a_") ? best.verdict.selectionReason.split(":")[0] : null,
      subjectRelevance: best.verdict?.subjectRelevance ?? null,
      worthinessScore: best.outcome.worthinessScore ?? 0,
      reasonCodes: best.reasonCodes ?? [],
      action: best.outcome.action,
      _detail: { currentText, coreFacts: best.verdict?.coreFacts ?? [], quotableLines: best.verdict?.quotableLines ?? [], evidenceTexts: best.window.items.map((i) => i.text) },
    };
    results.push(entry);
    await persistReview(entry);
    const label = `${targetKind === "life_event" ? "EVT" : "TRC"} ${row.id.slice(0, 18)}`;
    console.log(`  ${label.padEnd(24)} -> ${decision.padEnd(26)} action=${best.outcome.action} score=${best.outcome.worthinessScore ?? 0}`);
  }
}

const events = (await client.query(
  `select id, occurred_at, title, story, source_ids from life_events
   where profile_id = $1 and created_by = 'rule' order by occurred_at desc limit $2`, [PROFILE_ID, fetchLimit])).rows;
const traces = (await client.query(
  `select id, occurred_at, entries, source_ids from daily_traces
   where profile_id = $1 and organizer_run->>'organizerType' = 'rule' order by occurred_at desc limit $2`, [PROFILE_ID, fetchLimit])).rows;

console.log(`Auditing ${kind === "daily_trace" ? 0 : events.length} life events and ${kind === "life_event" ? 0 : traces.length} daily traces (kind=${kind}, fetch=${fetchLimit}, limit=${limit}).`);
if (kind !== "daily_trace") await audit("life_event", events, (row) => [row.title, row.story].filter(Boolean).join(" — "));
if (kind !== "life_event") await audit("daily_trace", traces, (row) => (row.entries ?? []).join(" — "));

// Review rows are already persisted per artifact by persistReview(); nothing is batched at the end.
console.log(dryRun ? "\nDry run: no review rows written." : `\nWrote ${results.length} review row(s) incrementally.`);

await client.end();

const tally = results.reduce((acc, r) => ({ ...acc, [r.decision]: (acc[r.decision] ?? 0) + 1 }), {});
const summary = {
  provider: editor.describe(), policyVersion: QUALITY_REVIEW_POLICY_VERSION,
  audited: results.length, deepseekCalls: calls,
  failedCalls: editor.stats.filter((s) => !s.ok).length,
  retries: editor.stats.reduce((n, s) => n + s.retries, 0),
  inputTokens: editor.stats.reduce((n, s) => n + s.inputTokens, 0),
  outputTokens: editor.stats.reduce((n, s) => n + s.outputTokens, 0),
  decisions: tally,
  approvedWithPlaceholderText: results.filter((r) => r.decision === "approved" && r.currentTextHasPlaceholder).length,
};
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
await writeFile(outPath, JSON.stringify({ summary, results, callStats: editor.stats }, null, 2), "utf8");
console.log(`\nDetailed report written to: ${outPath}`);
