#!/usr/bin/env node
// Third pass over the published LifeEvents: keep only the sources that DIRECTLY SUPPORT the event's
// central fact, and re-centre the story on that fact.
//
// The previous pass narrowed each event to the sources its verdict cited, which removed the adult
// group-chat traffic but still left child-related messages that support nothing — "他三点半喝的奶"
// on a crawling memory, "我还蛮喜欢看他哭的" on a standing memory. Being about the child is not the
// same as being evidence for this event.
//
//   node --import tsx scripts/deepseek-central-fact.mjs --out=<report.json> [--dry-run]
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import pg from "pg";

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

const { selectCentralFact, reconcileSupport, meetsMinimumSupport, evidenceKindOf } = await import("../lib/organizer/central-fact.ts");
const { FAMILY_WRITER_PROMPT_VERSION, FAMILY_WRITER_SYSTEM_PROMPT, FAMILY_WRITER_TOOL_NAME, FAMILY_WRITER_TOOL_SCHEMA, buildFamilyWriterPrompt, validateFamilyWriterOutput } = await import("../lib/organizer/family-writer.ts");
const { QUALITY_REVIEW_POLICY_VERSION } = await import("../lib/organizer/quality-review.ts");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const onlyId = args.find((a) => a.startsWith("--only="))?.slice("--only=".length);
const outArg = args.find((a) => a.startsWith("--out="))?.slice("--out=".length);
if (!outArg) { console.error("--out=<absolute path outside the repo> is required"); process.exit(1); }
const outPath = path.resolve(outArg);
if (!path.relative(path.resolve(process.cwd(), ".."), outPath).startsWith("..")) { console.error("Refusing to write real chat content inside the repository."); process.exit(1); }

const PROFILE_ID = "profile-zhangnian";
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
const MODEL = process.env.AI_MODEL;
if ((process.env.AI_PROVIDER ?? "").toLowerCase() !== "deepseek" || !process.env.DEEPSEEK_API_KEY || !MODEL) {
  console.error("Fail closed: AI_PROVIDER must be deepseek with DEEPSEEK_API_KEY and AI_MODEL set.");
  process.exit(1);
}
console.log(`Provider: deepseek model=${MODEL}`);

const SUPPORT_TOOL = {
  type: "object",
  properties: {
    centralFactRestated: { type: "string", description: "用一句话复述这个事件的中心事实" },
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "候选消息的序号" },
          supports: { type: "boolean", description: "这条消息是否直接支撑中心事实" },
          reason: { type: "string", description: "不超过 40 字的理由" },
        },
        required: ["index", "supports", "reason"],
      },
    },
  },
  required: ["centralFactRestated", "decisions"],
};

const SUPPORT_SYSTEM = `你在为一个孩子的人生档案做证据筛选。

给你一个事件的「中心事实」和一组候选聊天消息。对每一条消息，判断它是否**直接支撑**这个中心事实。

判断标准非常严格：
- 直接描述、佐证、或直接引出中心事实所说的那件事 → supports=true；
- 家人对这件事的即时反应、讨论、计划（明确针对这件事）→ supports=true；
- 只是同一天、同一个孩子、但说的是别的事（喝奶时间、睡觉、哭闹、拿东西、闲聊）→ supports=false；
- 与中心事实无关的日常照护、行程、物品 → supports=false。

"提到了这个孩子" **不等于** "支撑这个中心事实"。宁可少留，不可多留。`;

async function judgeSupport(centralFact, candidates) {
  const listing = candidates.map((candidate, index) => `  ${index}. ${candidate.text.replace(/\s+/g, " ").slice(0, 160)}`).join("\n");
  const body = JSON.stringify({
    model: MODEL, max_tokens: 3000, temperature: 0, thinking: { type: "disabled" },
    system: SUPPORT_SYSTEM,
    tools: [{ name: "emit_support", description: "输出每条消息是否支撑中心事实", input_schema: SUPPORT_TOOL }],
    tool_choice: { type: "tool", name: "emit_support" },
    messages: [{ role: "user", content: `## 中心事实\n${centralFact}\n\n## 候选消息\n${listing}\n\n请对每一条消息给出 supports 与 reason。` }],
  });
  const res = await fetch(`${BASE_URL}/v1/messages`, { method: "POST", headers: { "x-api-key": process.env.DEEPSEEK_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (res.status === 402) { console.error("DeepSeek 402 insufficient balance — stopping."); process.exit(2); }
  if (!res.ok) throw new Error(`http_${res.status}`);
  const payload = await res.json();
  const block = payload.content?.find((b) => b.type === "tool_use" && b.name === "emit_support");
  if (!block) throw new Error("no_tool_use");
  return { ...block.input, usage: payload.usage };
}

async function writeStory(input) {
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": process.env.DEEPSEEK_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 2000, temperature: 0.3, thinking: { type: "disabled" },
      system: `${FAMILY_WRITER_SYSTEM_PROMPT}\n\n这次额外要求：title 和 story 必须围绕「中心事实」展开。其他细节只能作为陪衬的具体细节出现，不能喧宾夺主，也不能成为标题。`,
      tools: [{ name: FAMILY_WRITER_TOOL_NAME, description: "输出标题和正文", input_schema: FAMILY_WRITER_TOOL_SCHEMA }],
      tool_choice: { type: "tool", name: FAMILY_WRITER_TOOL_NAME },
      messages: [{ role: "user", content: `${buildFamilyWriterPrompt(input)}\n\n## 中心事实（title 与 story 必须围绕它）\n${input.centralFact}` }],
    }),
  });
  if (res.status === 402) { console.error("DeepSeek 402 insufficient balance — stopping."); process.exit(2); }
  if (!res.ok) throw new Error(`http_${res.status}`);
  const payload = await res.json();
  const block = payload.content?.find((b) => b.type === "tool_use" && b.name === FAMILY_WRITER_TOOL_NAME);
  if (!block) throw new Error("no_tool_use");
  return block.input;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const { rows: events } = await client.query(
  `select e.id, e.title, e.story, e.occurred_at, e.source_ids
   from life_events e join content_quality_reviews r on r.target_kind='life_event' and r.target_id=e.id
   where r.decision='approved' order by e.occurred_at`);
// --only re-runs a single event without re-spending calls on the others.
const targets = onlyId ? events.filter((event) => event.id === onlyId) : events;
if (onlyId && targets.length === 0) { console.error(`--only=${onlyId} matched no published event.`); process.exit(1); }
console.log(`Focusing ${targets.length} published life event(s)${onlyId ? ` (--only)` : ""}.\n`);

const results = [];
let calls = 0;
for (const event of targets) {
  const { rows: sources } = await client.query(
    `select id, text, captured_at from raw_sources where id = any($1::text[]) and deleted_at is null order by captured_at`,
    [event.source_ids]);
  const candidates = sources.map((row) => ({ id: row.id, text: row.text ?? "" }));

  // The central fact is chosen from the EVIDENCE, preferring a statement that records a new
  // ability. Taking it from the previous story's opening line just inherits whatever that story was
  // mis-centred on — which is how a memory about learning to crawl ended up titled after the fact
  // that nobody filmed it.
  const centralFact = selectCentralFact(candidates.map((candidate) => ({ statement: candidate.text.replace(/\s+/g, " ").trim(), evidenceRefs: [] })))?.statement
    ?? event.story.split(/[。！？]/)[0] ?? event.title;

  const judged = await judgeSupport(centralFact, candidates);
  calls += 1;
  const decisions = (judged.decisions ?? [])
    .filter((d) => Number.isInteger(d.index) && d.index >= 0 && d.index < candidates.length)
    .map((d) => ({ sourceId: candidates[d.index].id, keep: Boolean(d.supports), reason: String(d.reason ?? "").slice(0, 60) }));
  const { kept, resolved } = reconcileSupport(candidates.map((c) => c.id), decisions);

  let decision = meetsMinimumSupport(kept) ? "approved" : "needs_human_review";
  let rewritten = null;
  const writerIssues = [];
  if (decision === "approved") {
    const keptTexts = candidates.filter((c) => kept.includes(c.id));
    const input = {
      occurredAt: event.occurred_at.toISOString().slice(0, 10), centralFact,
      coreFacts: keptTexts.map((c) => ({ statement: c.text.replace(/\s+/g, " ").trim().slice(0, 60), assertionKind: "raw_fact", kind: evidenceKindOf(c.text) })),
      quotableLines: keptTexts.map((c) => ({ text: c.text.replace(/\s+/g, " ").trim(), speakerRole: "家人" })),
      mediaCount: 0,
    };
    for (let attempt = 0; attempt < 3 && !rewritten; attempt += 1) {
      let output;
      try { output = await writeStory(input); calls += 1; } catch (error) { writerIssues.push(`call_failed:${error.message}`); continue; }
      if (output.insufficient) { writerIssues.push("model_declared_insufficient"); break; }
      const validation = validateFamilyWriterOutput({
        title: output.title ?? "", story: output.story ?? "", quotableLines: input.quotableLines,
        evidenceTexts: keptTexts.map((c) => c.text),
        hasHypotheticalEvidence: keptTexts.some((c) => evidenceKindOf(c.text) === "hypothetical"),
      });
      if (validation.ok) rewritten = output; else writerIssues.push(...validation.issues);
    }
    if (!rewritten) { decision = "needs_human_review"; writerIssues.push("writer_rejected"); }
  }

  const textById = new Map(candidates.map((c) => [c.id, c.text]));
  results.push({
    id: event.id, occurredAt: event.occurred_at.toISOString().slice(0, 10), previousTitle: event.title,
    centralFact, centralFactRestated: judged.centralFactRestated,
    before: candidates.length, after: kept.length, decision, writerIssues,
    newTitle: rewritten?.title, newStory: rewritten?.story,
    audit: resolved.map((d) => ({ keep: d.keep, reason: d.reason, text: (textById.get(d.sourceId) ?? "").replace(/\s+/g, " ").slice(0, 70) })),
  });

  console.log(`── ${event.occurred_at.toISOString().slice(0, 10)} ${event.title}`);
  console.log(`   central fact: ${centralFact.slice(0, 60)}`);
  for (const d of resolved) console.log(`   ${d.keep ? "KEEP" : "DROP"}  ${(textById.get(d.sourceId) ?? "").replace(/\s+/g, " ").slice(0, 46).padEnd(48)} ${d.reason}`);
  console.log(`   -> ${candidates.length} to ${kept.length} sources, ${decision}${rewritten ? `, new title: ${rewritten.title}` : ""}\n`);

  if (!dryRun && decision === "approved" && rewritten) {
    await client.query(`update life_events set source_ids=$2::jsonb, title=$3, story=$4, organizer_version=$5 where id=$1`,
      [event.id, JSON.stringify(kept), rewritten.title, rewritten.story, `deepseek-${FAMILY_WRITER_PROMPT_VERSION}`]);
  }
  if (!dryRun) {
    const fingerprint = createHash("sha256").update(`life_event:${event.id}:central-fact-v1:${QUALITY_REVIEW_POLICY_VERSION}:${decision}`).digest("hex");
    await client.query(
      `update content_quality_reviews set decision=$2, reason_codes=(reason_codes::jsonb || $3::jsonb), review_fingerprint=$4, reviewed_at=now()
       where target_kind='life_event' and target_id=$1`,
      [event.id, decision, JSON.stringify(["central_fact_support_filter"]), fingerprint]);
  }
}

await client.end();

const summary = {
  events: results.length, calls,
  stillApproved: results.filter((r) => r.decision === "approved").length,
  needsHuman: results.filter((r) => r.decision === "needs_human_review").length,
  sourcesBefore: results.reduce((n, r) => n + r.before, 0),
  sourcesAfter: results.filter((r) => r.decision === "approved").reduce((n, r) => n + r.after, 0),
  dryRun,
};
console.log("=== SUMMARY ==="); console.log(JSON.stringify(summary, null, 2));
await writeFile(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");
console.log(`\nDetailed report written to: ${outPath}`);
