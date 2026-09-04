#!/usr/bin/env node
// T20-B, 2026-09-04 (Cowork, 原则七): a month's own written review — "这个月的张年" — 3-5 sentences,
// answering "what changed", built ONLY from that month's already-published life_events (no new
// facts, no re-reading raw chat). Persisted to `monthly_snapshot` (the table already existed and
// already rendered on both the home page and the month page — it just never had a writer).
//
//   node --import tsx scripts/month-review.mjs --month=2026-08 [--commit]
//
// Months with fewer than 5 published life_events are skipped (T20-B's own rule: not enough
// material to write a real review, and a thin one would read as invented). --commit persists;
// without it, the draft prints and nothing is written — same dry-run/commit split as T7's writer.
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });

const { persistMonthlySnapshot, persistQualityReview } = await import("../lib/db/repository.ts");

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const hasFlag = (name) => args.includes(`--${name}`);
const MONTH = argOf("month", null);
const COMMIT = hasFlag("commit");
const MIN_EVENTS = 5;
const PROMPT_VERSION = "month-review-v1";
const PROFILE_ID = "profile-zhangnian";

if (!MONTH || !/^\d{4}-\d{2}$/.test(MONTH)) { console.error("--month=YYYY-MM is required"); process.exit(1); }

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
const model = process.env.AI_MODEL || "deepseek-v4-pro";
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (!apiKey) { console.error("Need DEEPSEEK_API_KEY."); process.exit(1); }

const pool = new pg.Pool({ connectionString: dbUrl });

const TOOL_NAME = "month_review";
const TOOL_SCHEMA = {
  type: "object",
  properties: {
    insufficient: { type: "boolean", description: "true if the month's events genuinely do not support a 3-5 sentence review without inventing anything" },
    summary: { type: "string", description: "3-5 Chinese sentences, <=200 characters total, no numbers/counts, quotes use 「」" },
  },
  required: ["insufficient"],
};

const SYSTEM_PROMPT = `你是一份家庭档案的编辑。你的任务是把一个月已发布的记忆（life_event 的标题和正文）综合成一段简短的月度回顾——「这个月的张年」。

硬性规则：
- 只能使用给定的记忆里已经写出的事实，不能引入任何新事实，不能推测、不能想象
- 3-5 句话，全文不超过 200 字，用中文衬线排版的散文，不分点、不加标题
- 优先写"变化"：这个月开始会什么、比之前多了什么、一个新习惯；其次是反复出现的事；最后才是单次事件
- 可以引用 1-2 句原话，用「」标出，原话必须逐字来自给定的记忆
- 称谓只能用：妈妈、爸爸、奶奶、雪姨、老师——绝不能写"家人"这个词
- 绝对不能出现任何数字（几张照片、几条记忆、几天、年龄）
- 如果这些记忆内容太单薄、太重复、或者写不出真正的变化而不编造，把 insufficient 设为 true，summary 留空`;

async function callReviewer(events, month) {
  const material = events.map((e) => `【${e.day}】${e.title}\n${e.story}`).join("\n\n");
  const body = JSON.stringify({
    model, max_tokens: 800, temperature: 0.2, thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: "输出这个月的回顾", input_schema: TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: `${month} 这个月已发布的记忆：\n\n${material}` }],
  });
  const res = await fetch(`${baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`reviewer http ${res.status}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!tool) throw new Error("reviewer returned no tool_use");
  return tool.input;
}

// Early exits use `process.exitCode` + `return`, never `process.exit()` — the latter skips this
// script's own `finally` (below), which is what closes the pg Pool gracefully; an abrupt
// process.exit() while the pool holds an open handle crashed the process on Windows/Node 24 with
// a libuv assertion (harmless — happened after all real work was done — but noisy and could
// confuse automated exit-code checks).
async function main() {
  const events = await pool.query(
    `select id, title, story, to_char(occurred_at, 'YYYY-MM-DD') as day from life_events
     where profile_id = $1 and occurred_at >= $2::date and occurred_at < ($2::date + interval '1 month')
     order by occurred_at`,
    [PROFILE_ID, `${MONTH}-01`],
  );
  console.log(`${MONTH}: ${events.rows.length} published life_event(s).`);
  if (events.rows.length < MIN_EVENTS) {
    console.log(`Fewer than ${MIN_EVENTS} events — skipping, month stays a quiet index (T20-B's own rule).`);
    return;
  }

  const output = await callReviewer(events.rows, MONTH);
  if (output.insufficient || !output.summary?.trim()) {
    console.log("Model declared the material insufficient for a real review. Not writing anything.");
    return;
  }
  const summary = output.summary.trim();
  console.log(`\nDraft (${summary.length} chars):\n${summary}\n`);

  if (/家人/.test(summary)) { console.error("REFUSED: contains 家人"); process.exitCode = 1; return; }
  if (/\d/.test(summary.replace(/[年月日]/g, ""))) console.log("WARNING: contains a digit outside a bare date reference — review before committing.");

  if (!COMMIT) { console.log("Dry run — nothing written. Pass --commit to persist."); return; }

  const snapshot = { id: `monthly-snapshot-${MONTH}`, profileId: PROFILE_ID, month: MONTH, summary, highlights: [], visibility: "family" };
  const saved = await persistMonthlySnapshot(snapshot);
  await persistQualityReview({
    id: `quality-review-${randomUUID()}`, profileId: PROFILE_ID, targetKind: "monthly_snapshot", targetId: saved.id,
    decision: "approved", reasonCodes: ["t20-b-month-review", "cowork-reviewed"], provider: "deepseek", model,
    promptVersion: PROMPT_VERSION, policyVersion: "t20-b-v1", reviewFingerprint: `${MONTH}:${PROMPT_VERSION}`, reviewedAt: new Date().toISOString(),
  });
  console.log(`WRITTEN monthly_snapshot for ${MONTH}.`);
}

try {
  await main();
} finally {
  await pool.end();
}
