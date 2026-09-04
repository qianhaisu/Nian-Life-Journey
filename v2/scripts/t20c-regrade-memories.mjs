#!/usr/bin/env node
// T20-C + T19, 2026-09-04 (Cowork, 原则五): every T7-written life_event was forced to
// memoryWeight="trace" regardless of content, so "小年年升入大班了" and "老师提醒尿不湿不多了" render
// identically. This re-grades the already-published T7 events (organizer_version =
// 'organizer-v2-t7-subject-gate') into three tiers, using only the title+story already written
// (no new facts, no re-reading raw chat):
//
//   high   -> memoryWeight "memory" (a real chapter: 1-4 per month, a genuine change/milestone)
//   medium -> memoryWeight "trace" (an ordinary day worth keeping, current default, unchanged)
//   low    -> UNPUBLISHED (content_quality_reviews decision -> "store_only": the row, its
//             sourceIds and its evidence stay intact, it just stops rendering as a titled memory)
//
// "low" also covers T19's finding: the subject is an adult's logistics/errand/administration with
// the child only mentioned in passing, not something he did or that happened to him.
//
//   node --import tsx scripts/t20c-regrade-memories.mjs --month=2026-08 [--commit]
//
// Batches ~12 events per DeepSeek call (cheap classification, not the full evidence pipeline).
// Idempotent: re-running always recomputes from current title/story and overwrites memoryWeight /
// review decision — safe to re-run after fixing a prompt or adding a month.
import path from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const hasFlag = (name) => args.includes(`--${name}`);
const MONTH = argOf("month", null);
const COMMIT = hasFlag("commit");
const BATCH_SIZE = 12;
const T7_ORGANIZER_VERSION = "organizer-v2-t7-subject-gate";
const PROMPT_VERSION = "t20-c-regrade-v1";
const PROFILE_ID = "profile-zhangnian";

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const apiKey = process.env.DEEPSEEK_API_KEY;
const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
const model = process.env.AI_MODEL || "deepseek-v4-pro";
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
if (!apiKey) { console.error("Need DEEPSEEK_API_KEY."); process.exit(1); }

const { persistQualityReview } = await import("../lib/db/repository.ts");

const pool = new pg.Pool({ connectionString: dbUrl });

const TOOL_NAME = "grade_memories";
const TOOL_SCHEMA = {
  type: "object",
  properties: {
    grades: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "the 1-based index of this memory in the given list" },
          subjectIsChild: { type: "boolean", description: "true only if the memory is about something the child did, felt, or that happened to him — not an adult's errand/logistics/administration that merely mentions him" },
          tier: { type: "string", enum: ["high", "medium", "low"], description: "high = a real change/milestone/first-time worth a chapter; medium = an ordinary day worth keeping as-is; low = thin, routine, or an adult's logistics — should not be a titled memory. If subjectIsChild is false, tier must be low." },
        },
        required: ["index", "subjectIsChild", "tier"],
      },
    },
  },
  required: ["grades"],
};

const SYSTEM_PROMPT = `你是一份家庭档案的编辑，负责给已经写好的记忆定级，不改写任何文字。

对每一条记忆判断两件事：
1. subjectIsChild：这条记忆讲的是不是张年自己做了什么、他身上发生了什么、他的感受或变化。
   如果讲的是大人的安排、接送、采购、通知、行政沟通（张年只是被提到一句，不是主角），subjectIsChild = false。
2. tier（三选一）：
   - high：真正的变化或第一次——新技能、新习惯、重要里程碑、明显的成长节点。一个月最多 1-4 条应该是 high。
   - medium：普通的一天，记录了张年做的具体事情或说的具体话，值得留着，但不是里程碑。
   - low：内容单薄、重复、或者根本不是张年的事（这时 subjectIsChild 必须是 false）。

标准要严格：大多数普通日子应该是 medium，high 是少数，low 是主语跑偏或内容太单薄的那些。`;

async function callGrader(batch) {
  const material = batch.map((e, i) => `${i + 1}. 【${e.day}】${e.title}\n${e.story}`).join("\n\n");
  const body = JSON.stringify({
    model, max_tokens: 2000, temperature: 0, thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: "给这一批记忆定级", input_schema: TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: `给下面这批记忆定级：\n\n${material}` }],
  });
  const res = await fetch(`${baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`grader http ${res.status}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!tool) throw new Error("grader returned no tool_use");
  return tool.input.grades;
}

async function main() {
  const monthClause = MONTH ? `and occurred_at >= $2::date and occurred_at < ($2::date + interval '1 month')` : "";
  const params = MONTH ? [T7_ORGANIZER_VERSION, `${MONTH}-01`] : [T7_ORGANIZER_VERSION];
  const events = await pool.query(
    `select le.id, le.title, le.story, to_char(le.occurred_at, 'YYYY-MM-DD') as day, le.memory_weight,
            cqr.id as review_id, cqr.decision
     from life_events le
     left join content_quality_reviews cqr on cqr.target_kind = 'life_event' and cqr.target_id = le.id and cqr.prompt_version = 'family-writer-v2-calibrated-r2.1'
     where le.organizer_version = $1 ${monthClause}
     order by le.occurred_at, le.id`,
    params,
  );
  console.log(`${events.rows.length} T7-written event(s)${MONTH ? ` for ${MONTH}` : ""}.`);

  const results = [];
  for (let i = 0; i < events.rows.length; i += BATCH_SIZE) {
    const batch = events.rows.slice(i, i + BATCH_SIZE);
    const grades = await callGrader(batch);
    for (const grade of grades) {
      const event = batch[grade.index - 1];
      if (!event) { console.log(`  WARNING: grader returned index ${grade.index} out of range for this batch`); continue; }
      const tier = grade.subjectIsChild ? grade.tier : "low";
      results.push({ event, tier });
      console.log(`  ${event.day} [${tier}]${grade.subjectIsChild ? "" : " (not-about-child)"} ${event.title}`);
    }
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const r of results) counts[r.tier] += 1;
  console.log(`\n=== SUMMARY ===`);
  console.log(JSON.stringify({ total: results.length, ...counts, commit: COMMIT }, null, 2));

  if (!COMMIT) { console.log("Dry run — nothing written. Pass --commit to persist."); return; }

  let updated = 0;
  for (const { event, tier } of results) {
    const newWeight = tier === "high" ? "memory" : "trace"; // low events get memoryWeight left alone; they're unpublished instead.
    if (tier !== "low" && event.memory_weight !== newWeight) {
      await pool.query(`update life_events set memory_weight = $1 where id = $2`, [newWeight, event.id]);
      updated += 1;
    }
    if (tier === "low") {
      if (event.review_id) {
        await pool.query(`update content_quality_reviews set decision = 'store_only', reason_codes = reason_codes || '["t20-c-regrade-low-tier"]'::jsonb where id = $1`, [event.review_id]);
      } else {
        await persistQualityReview({
          id: `quality-review-${randomUUID()}`, profileId: PROFILE_ID, targetKind: "life_event", targetId: event.id,
          decision: "store_only", reasonCodes: ["t20-c-regrade-low-tier"], provider: "deepseek", model,
          promptVersion: PROMPT_VERSION, policyVersion: "t20-c-v1", reviewFingerprint: `${event.id}:${PROMPT_VERSION}`, reviewedAt: new Date().toISOString(),
        });
      }
      updated += 1;
    }
  }
  console.log(`Updated ${updated} row(s).`);
}

try {
  await main();
} finally {
  await pool.end();
}
