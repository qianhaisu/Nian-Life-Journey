// Shared T20-C grading logic (P1-3, 2026-09-05).
//
// Extracted from t20c-regrade-memories.mjs so organizer-month-write.mjs can run the same grading
// in-process right after writing events, instead of requiring a separate post-write step.
// Three-tier classification — high/medium/low — of already-written life_events:
//
//   high   -> memoryWeight "memory" (milestone/chapter)
//   medium -> memoryWeight "trace" (ordinary day — no change)
//   low    -> content_quality_reviews decision "store_only" (not about the child, or too thin)
//
// Both callers (organizer-month-write.mjs and t20c-regrade-memories.mjs) import gradeMonthEvents.
// The standalone t20c-regrade-memories.mjs is kept for manual re-runs (e.g. after prompt changes),
// but it no longer needs to be run as a required follow-up step after the writer.
import { randomUUID } from "node:crypto";
import pg from "pg";

export const T7_ORGANIZER_VERSION = "organizer-v2-t7-subject-gate";
export const GRADE_PROMPT_VERSION = "t20-c-regrade-v1";
export const GRADE_POLICY_VERSION = "t20-c-v1";
const BATCH_SIZE = 12;
const PROFILE_ID = "profile-zhangnian";

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

export async function callGrader(batch, { apiKey, baseUrl, model }) {
  const material = batch.map((e, i) => `${i + 1}. 【${e.day}】${e.title}\n${e.story}`).join("\n\n");
  const body = JSON.stringify({
    model, max_tokens: 2000, temperature: 0, thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    tools: [{ name: TOOL_NAME, description: "给这一批记忆定级", input_schema: TOOL_SCHEMA }],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: `给下面这批记忆定级：\n\n${material}` }],
  });
  const res = await fetch(`${baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body });
  if (!res.ok) throw new Error(`grader http ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  const tool = payload.content?.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!tool) throw new Error("grader returned no tool_use");
  return tool.input.grades;
}

/**
 * Grade all T7-written life_events for a month and apply the grading decisions.
 *
 * @param {string} month - YYYY-MM format
 * @param {{ dbUrl: string, apiKey: string, baseUrl: string, model: string, persistQualityReview: Function, commit: boolean }} opts
 * @returns {{ high: number, medium: number, low: number, total: number, updated: number }}
 */
export async function gradeMonthEvents(month, { dbUrl, apiKey, baseUrl, model, persistQualityReview, commit }) {
  const pool = new pg.Pool({ connectionString: dbUrl });
  try {
    const { rows: events } = await pool.query(
      `select le.id, le.title, le.story, to_char(le.occurred_at, 'YYYY-MM-DD') as day, le.memory_weight,
              cqr.id as review_id, cqr.decision
       from life_events le
       left join content_quality_reviews cqr
         on cqr.target_kind = 'life_event' and cqr.target_id = le.id
         and cqr.prompt_version = 'family-writer-v2-calibrated-r2.1'
       where le.profile_id = $1 and le.organizer_version = $2
         and le.occurred_at >= $3::date and le.occurred_at < ($3::date + interval '1 month')
       order by le.occurred_at, le.id`,
      [PROFILE_ID, T7_ORGANIZER_VERSION, `${month}-01`],
    );

    if (events.length === 0) return { high: 0, medium: 0, low: 0, total: 0, updated: 0 };
    console.log(`T20-C: grading ${events.length} event(s) for ${month}…`);

    const grades = [];
    for (let i = 0; i < events.length; i += BATCH_SIZE) {
      const batch = events.slice(i, i + BATCH_SIZE);
      const batchGrades = await callGrader(batch, { apiKey, baseUrl, model });
      for (const grade of batchGrades) {
        const event = batch[grade.index - 1];
        if (!event) { console.warn(`  WARNING: grader returned index ${grade.index} out of range`); continue; }
        const tier = grade.subjectIsChild ? grade.tier : "low";
        grades.push({ event, tier });
        console.log(`  ${event.day} [${tier}]${grade.subjectIsChild ? "" : " (not-about-child)"} ${event.title}`);
      }
    }

    const counts = { high: 0, medium: 0, low: 0 };
    for (const { tier } of grades) counts[tier] += 1;

    if (!commit) {
      console.log(`T20-C dry run: ${JSON.stringify({ total: grades.length, ...counts })}`);
      return { ...counts, total: grades.length, updated: 0 };
    }

    let updated = 0;
    for (const { event, tier } of grades) {
      const newWeight = tier === "high" ? "memory" : "trace";
      if (tier !== "low" && event.memory_weight !== newWeight) {
        await pool.query(`update life_events set memory_weight = $1 where id = $2`, [newWeight, event.id]);
        updated += 1;
      }
      if (tier === "low") {
        if (event.review_id) {
          await pool.query(
            `update content_quality_reviews set decision = 'store_only', reason_codes = reason_codes || '["t20-c-regrade-low-tier"]'::jsonb where id = $1`,
            [event.review_id],
          );
        } else {
          await persistQualityReview({
            id: `quality-review-${randomUUID()}`, profileId: PROFILE_ID, targetKind: "life_event", targetId: event.id,
            decision: "store_only", reasonCodes: ["t20-c-regrade-low-tier"], provider: "deepseek", model,
            promptVersion: GRADE_PROMPT_VERSION, policyVersion: GRADE_POLICY_VERSION,
            reviewFingerprint: `${event.id}:${GRADE_PROMPT_VERSION}`, reviewedAt: new Date().toISOString(),
          });
        }
        updated += 1;
      }
    }

    console.log(`T20-C: ${JSON.stringify({ total: grades.length, ...counts, updated })}`);
    return { ...counts, total: grades.length, updated };
  } finally {
    await pool.end();
  }
}
