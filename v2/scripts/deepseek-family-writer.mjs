#!/usr/bin/env node
// Gate C driver. Takes the audit report, picks the strongest child-related candidates, rewrites
// their title/story from VERIFIED facts only, and approves them in the quality ledger.
//
// A candidate is only published when the generated text passes every deterministic check in
// lib/organizer/family-writer.ts. Text that fails twice is left as needs_human_review, which keeps
// it hidden — publishing nothing is an acceptable outcome, publishing something invented is not.
//
//   node --import tsx scripts/deepseek-family-writer.mjs --audit=<report.json> --out=<report.json> [--max=30] [--dry-run]
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

const { FAMILY_WRITER_PROMPT_VERSION, FAMILY_WRITER_SYSTEM_PROMPT, FAMILY_WRITER_TOOL_NAME, FAMILY_WRITER_TOOL_SCHEMA, buildFamilyWriterPrompt, validateFamilyWriterOutput } = await import("../lib/organizer/family-writer.ts");
const { QUALITY_REVIEW_POLICY_VERSION, containsTechnicalPlaceholder } = await import("../lib/organizer/quality-review.ts");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const maxWrites = Number(args.find((a) => a.startsWith("--max="))?.slice("--max=".length) ?? "30");
const auditPath = args.find((a) => a.startsWith("--audit="))?.slice("--audit=".length);
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
if (!auditPath || !outArg) { console.error("--audit=<report.json> and --out=<report.json> are required"); process.exit(1); }
const outPath = path.resolve(outArg);
if (!path.relative(path.resolve(process.cwd(), ".."), outPath).startsWith("..")) { console.error("Refusing to write real chat content inside the repository."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const MODEL = process.env.AI_MODEL;
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
if ((process.env.AI_PROVIDER ?? "").toLowerCase() !== "deepseek" || !process.env.DEEPSEEK_API_KEY || !MODEL) {
  console.error("Fail closed: AI_PROVIDER must be deepseek with DEEPSEEK_API_KEY and AI_MODEL set.");
  process.exit(1);
}
console.log(`Provider: deepseek model=${MODEL} promptVersion=${FAMILY_WRITER_PROMPT_VERSION}`);

const audit = JSON.parse(readFileSync(auditPath, "utf8"));
const stats = [];

async function writeStory(input) {
  const body = JSON.stringify({
    model: MODEL, max_tokens: 2000, temperature: 0.3, thinking: { type: "disabled" },
    system: FAMILY_WRITER_SYSTEM_PROMPT,
    tools: [{ name: FAMILY_WRITER_TOOL_NAME, description: "输出标题和正文", input_schema: FAMILY_WRITER_TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: FAMILY_WRITER_TOOL_NAME },
    messages: [{ role: "user", content: buildFamilyWriterPrompt(input) }],
  });
  const started = Date.now();
  const response = await fetch(`${BASE_URL}/v1/messages`, { method: "POST", headers: { "x-api-key": process.env.DEEPSEEK_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (response.status === 402) { console.error("DeepSeek 402 insufficient balance — stopping."); process.exit(2); }
  if (!response.ok) throw new Error(`http_${response.status}`);
  const payload = await response.json();
  const block = payload.content?.find((b) => b.type === "tool_use" && b.name === FAMILY_WRITER_TOOL_NAME);
  if (!block) throw new Error("no_tool_use");
  stats.push({ latencyMs: Date.now() - started, inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0 });
  return block.input;
}

// Candidate selection: the child must be the confirmed subject, there must be several verified
// facts to write from, and the window must have scored above the everyday-noise floor.
const candidates = audit.results
  .filter((r) => r.targetKind === "life_event")
  .filter((r) => r.subjectRelevance === "primary")
  .filter((r) => (r._detail?.coreFacts?.length ?? 0) >= 2)
  .filter((r) => (r.worthinessScore ?? 0) >= 30)
  .sort((a, b) => (b.worthinessScore ?? 0) - (a.worthinessScore ?? 0))
  .slice(0, maxWrites);

console.log(`Selected ${candidates.length} candidates for rewriting (max ${maxWrites}).`);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const written = [];
for (const candidate of candidates) {
  const input = {
    occurredAt: candidate.occurredAt.slice(0, 10),
    coreFacts: candidate._detail.coreFacts,
    quotableLines: candidate._detail.quotableLines,
    mediaCount: 0,
  };
  let accepted = null;
  let issues = [];
  for (let attempt = 0; attempt < 2 && !accepted; attempt += 1) {
    let output;
    try { output = await writeStory(input); }
    catch (error) { issues.push(`call_failed:${error.message}`); continue; }
    if (output.insufficient) { issues.push("model_declared_insufficient"); break; }
    const validation = validateFamilyWriterOutput({
      title: output.title ?? "", story: output.story ?? "",
      quotableLines: candidate._detail.quotableLines, evidenceTexts: candidate._detail.evidenceTexts ?? [],
    });
    if (validation.ok) accepted = output;
    else issues = issues.concat(validation.issues);
  }

  const record = { targetId: candidate.targetId, occurredAt: candidate.occurredAt, worthinessScore: candidate.worthinessScore, accepted: Boolean(accepted), issues, title: accepted?.title, story: accepted?.story, previousText: candidate._detail.currentText };
  written.push(record);
  console.log(`  ${candidate.targetId.slice(0, 20)} score=${candidate.worthinessScore} ${accepted ? `OK  ${accepted.title}` : `SKIP ${issues.slice(0, 2).join(",")}`}`);

  if (accepted && !dryRun) {
    await client.query(`update life_events set title = $2, story = $3, story_sections = null, organizer_version = $4 where id = $1`,
      [candidate.targetId, accepted.title, accepted.story, `deepseek-${FAMILY_WRITER_PROMPT_VERSION}`]);
    const fingerprint = createHash("sha256").update(`life_event:${candidate.targetId}:memory-editor-v1:${QUALITY_REVIEW_POLICY_VERSION}:approved`).digest("hex");
    await client.query(
      `insert into content_quality_reviews (id, profile_id, target_kind, target_id, decision, gate_a, subject_relevance, worthiness_score, reason_codes, provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at)
       values ($1,$2,'life_event',$3,'approved',$4,'primary',$5,$6::jsonb,'deepseek',$7,'memory-editor-v1',$8,$9, now())
       on conflict (target_kind, target_id, prompt_version) do update set decision = 'approved', reason_codes = excluded.reason_codes, review_fingerprint = excluded.review_fingerprint, reviewed_at = now()`,
      [randomUUID(), PROFILE_ID, candidate.targetId, candidate.gateA, candidate.worthinessScore ?? 0, JSON.stringify(["gate_c_rewritten", ...(candidate.reasonCodes ?? [])]), MODEL, QUALITY_REVIEW_POLICY_VERSION, fingerprint],
    );
  }
}

// Quark photo-only days: keep the photos, drop the import label. No model call — the only supportable
// claim is "there are photos from this day", so that is all the text may say.
let traceRewrites = 0;
if (!dryRun) {
  const { rows } = await client.query(
    `select id, entries from daily_traces where profile_id = $1 and entries::text like '%Quark 照片初始化%' limit 200`, [PROFILE_ID]);
  for (const row of rows) {
    const count = Number(/·\s*(\d+)\s*media/.exec((row.entries ?? []).join(" "))?.[1] ?? "0");
    await client.query(`update daily_traces set entries = $2::jsonb, updated_at = now() where id = $1`,
      [row.id, JSON.stringify([count > 0 ? `这一天留下了 ${count} 张照片。` : "这一天留下了一些照片。"])]);
    traceRewrites += 1;
  }
}

// Approved WeChat-derived traces still carry their rule-era entries, which are raw group-chat lines.
// Their verified coreFacts are already evidence-bound, ≤60-char statements that survived the H1–H9
// sanitiser, so the trace text is rebuilt from those rather than from the original message text. No
// model call is needed and nothing new is asserted. A trace with no usable fact left loses its
// approval instead of being published with placeholder text.
let traceFactRewrites = 0;
let traceApprovalsRevoked = 0;
if (!dryRun) {
  const approvedTraces = audit.results.filter((r) => r.targetKind === "daily_trace" && r.decision === "approved" && r.gateA !== "photo_only");
  for (const trace of approvedTraces) {
    const lines = (trace._detail?.coreFacts ?? [])
      .map((fact) => fact.statement.trim())
      .filter((line) => line.length > 0 && !containsTechnicalPlaceholder(line))
      .slice(0, 3);
    if (lines.length === 0) {
      await client.query(
        `update content_quality_reviews set decision = 'store_only', reason_codes = $2::jsonb, reviewed_at = now()
         where target_kind = 'daily_trace' and target_id = $1 and prompt_version = 'memory-editor-v1'`,
        [trace.targetId, JSON.stringify([...(trace.reasonCodes ?? []), "no_publishable_fact_text"])]);
      traceApprovalsRevoked += 1;
      continue;
    }
    await client.query(`update daily_traces set entries = $2::jsonb, updated_at = now() where id = $1`,
      [trace.targetId, JSON.stringify(lines)]);
    traceFactRewrites += 1;
  }
}

await client.end();

const summary = {
  provider: { provider: "deepseek", model: MODEL, promptVersion: FAMILY_WRITER_PROMPT_VERSION },
  candidates: candidates.length,
  accepted: written.filter((w) => w.accepted).length,
  rejected: written.filter((w) => !w.accepted).length,
  traceRewrites,
  traceFactRewrites,
  traceApprovalsRevoked,
  calls: stats.length,
  inputTokens: stats.reduce((n, s) => n + s.inputTokens, 0),
  outputTokens: stats.reduce((n, s) => n + s.outputTokens, 0),
  rejectionIssues: written.filter((w) => !w.accepted).flatMap((w) => w.issues),
};
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));
await writeFile(outPath, JSON.stringify({ summary, written }, null, 2), "utf8");
console.log(`\nDetailed report written to: ${outPath}`);
