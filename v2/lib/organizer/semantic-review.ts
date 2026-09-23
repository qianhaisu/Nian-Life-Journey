/**
 * Semantic review of life_event stories using DeepSeek-flash.
 *
 * Factored from r7-semantic-review.mjs for reuse in the production Organizer
 * and organizer-month-write.mjs. Core entry point: reviewEventStory().
 *
 * Design:
 * - Reads CURRENT DB content (not pack text) as model input.
 * - Writes through repo.recordClaudeStoryDecision / applyClaudeStoryCorrection with
 *   reviewer = DEEPSEEK_SEMANTIC_REVIEW_PROVIDER, so the ledger says what actually judged the story
 *   (provider deepseek-semantic-review, model deepseek-flash). Until 2026-09-23 it omitted the reviewer
 *   and 218 DeepSeek verdicts were recorded as Claude approvals; Teddy chose "record truthfully,
 *   DeepSeek may still approve".
 * - correct_needed + unapplied correction → needs_human_review (never auto-approve).
 * - Returns a ReviewOutcome describing what happened; never throws on non-transient failures.
 */
import { createHash } from "node:crypto";

export const SEMANTIC_REVIEW_PROMPT_VERSION = "r7-semantic-review-v1";
export const SEMANTIC_REVIEW_POLICY_VERSION = "r7-semantic-review-policy-v1";
const CLAUDE_AUTHORIZATION_REASON = "authorized-by:teddy-2026-09-16";
// = story-write-guard.ts DEEPSEEK_SEMANTIC_REVIEW_PROVIDER (not imported: this module stays dependency-free).
const DEEPSEEK_SEMANTIC_REVIEW_PROVIDER = "deepseek-semantic-review" as const;
const DEEPSEEK_MODEL = "deepseek-flash";
// 2026-09-23 起默认走智谱 glm-5.3-flash（OpenAI 兼容端点），账上 reviewer 写 glm-semantic-review。
const GLM_SEMANTIC_REVIEW_PROVIDER = "glm-semantic-review" as const;
const GLM_MODEL = "glm-5.3-flash";
const GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

export type SemanticReviewVerdict = "approve" | "correct_needed" | "flag";

export type SemanticReviewSource = {
  id: string;
  text?: string;
  captured_at?: string;
  speaker?: { narrativeLabel?: string; displayName?: string };
};

export type ReviewOutcome =
  | { kind: "approved"; contentSha256: string }
  | { kind: "corrected"; contentSha256: string; newSha256: string }
  | { kind: "needs_human_review"; contentSha256: string; reason: string }
  | { kind: "skipped"; reason: string }
  | { kind: "error"; error: string };

const REVIEW_TOOL_SCHEMA = {
  name: "review_verdict",
  description: "Return the semantic review verdict for this story",
  input_schema: {
    type: "object",
    properties: {
      verdict: { type: "string", enum: ["approve", "correct_needed", "flag"] },
      approved_people: {
        type: "array",
        items: { type: "string" },
        description: "People with actual evidence in the source messages. Subset of current people.",
      },
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["presence_assertion", "semantic_error", "people_inflation"] },
            original_text: { type: "string" },
            corrected_text: { type: "string" },
          },
          required: ["type", "original_text", "corrected_text"],
        },
      },
      source_ids_checked: { type: "array", items: { type: "string" } },
      reasoning: { type: "string", maxLength: 300 },
    },
    required: ["verdict", "approved_people", "corrections", "source_ids_checked", "reasoning"],
  },
};

const SYSTEM_PROMPT = `你是一个准确性审核员，负责核实关于孩子张年的生活记录。

核实规则：
1. 在场断言：「也在」「一起」「陪着」等需要原始消息直接说明此人在场。发言本身≠在场证据（除非消息明确描述了陪伴/在场场景）。
2. 人物字段：只保留在原始消息中有实际证据的人（发言者，或被明确描述为在场/参与的人）。@某人 ≠ 某人在场。
3. 语义准确：正文不能把将来/计划的事写成已发生；不能把发言者的建议/问句写成已确认事实；不能误读喂养对象。

不需要修正：
- 「某某说……」形式，有发言者证据
- 明确描述了陪伴场景的转述
- 故事时态和意义与原始消息吻合`;

const RETRY_DELAYS = [2000, 8000, 20000];
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

async function callDeepSeek(
  title: string | null | undefined,
  story: string | null | undefined,
  people: string[],
  sources: SemanticReviewSource[],
  deepseekApiKey: string,
  deepseekBaseUrl: string,
  glm = false,
): Promise<{ verdict: SemanticReviewVerdict; approved_people: string[]; corrections: Array<{ type: string; original_text: string; corrected_text: string }>; source_ids_checked: string[]; reasoning: string }> {
  const sourceBlock = sources.map((s, i) => {
    const speaker = s.speaker?.narrativeLabel ?? s.speaker?.displayName ?? "（未知）";
    const time = s.captured_at ? s.captured_at.slice(0, 16) : "";
    return `[来源${i + 1} id=${s.id.slice(-12)} ${time} ${speaker}]: ${s.text?.trim() ?? "（媒体消息）"}`;
  }).join("\n");

  const userPrompt = `原始消息：
${sourceBlock || "（无关联原始消息）"}

当前故事：
标题：${title ?? "（无）"}
正文：${story ?? "（无）"}
人物：${JSON.stringify(people)}

请审核上述故事是否准确。如需修正，提供精确的original_text（必须是正文中存在的子串）和corrected_text。`;

  const body = glm ? JSON.stringify({
    model: GLM_MODEL,
    max_tokens: 12000,
    temperature: 0,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userPrompt }],
    tools: [{ type: "function", function: { name: REVIEW_TOOL_SCHEMA.name, description: REVIEW_TOOL_SCHEMA.description, parameters: REVIEW_TOOL_SCHEMA.input_schema } }],
    tool_choice: { type: "function", function: { name: "review_verdict" } },
  }) : JSON.stringify({
    model: DEEPSEEK_MODEL,
    max_tokens: 600,
    temperature: 0,
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    tools: [REVIEW_TOOL_SCHEMA],
    tool_choice: { type: "tool", name: "review_verdict" },
    messages: [{ role: "user", content: userPrompt }],
  });

  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), glm ? 120_000 : 30_000);
    try {
      const res = await fetch(glm ? `${deepseekBaseUrl}/chat/completions` : `${deepseekBaseUrl}/v1/messages`, {
        method: "POST",
        headers: glm ? { Authorization: `Bearer ${deepseekApiKey}`, "content-type": "application/json" } : { "x-api-key": deepseekApiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (TRANSIENT_STATUSES.has(res.status)) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`); }
      const data = await res.json() as { model?: string; content?: Array<{ type: string; name?: string; input?: unknown }>; choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }> };
      const expectedModel = glm ? GLM_MODEL : DEEPSEEK_MODEL;
      if (data.model && data.model !== expectedModel) throw new Error(`Model mismatch: got ${data.model}`);
      let toolInput: unknown;
      if (glm) {
        const args = data.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === "review_verdict")?.function?.arguments;
        toolInput = args ? JSON.parse(args) : undefined;
      } else {
        toolInput = data.content?.find((b) => b.type === "tool_use" && b.name === "review_verdict")?.input;
      }
      if (!toolInput) throw new Error("No tool_use block in response");
      const v = toolInput as { verdict?: string; approved_people?: unknown[]; corrections?: unknown[]; source_ids_checked?: unknown[]; reasoning?: string };
      if (!["approve", "correct_needed", "flag"].includes(v.verdict ?? "")) throw new Error(`Invalid verdict: ${v.verdict}`);
      return {
        verdict: v.verdict as SemanticReviewVerdict,
        approved_people: Array.isArray(v.approved_people) ? v.approved_people.filter((x): x is string => typeof x === "string") : [],
        corrections: Array.isArray(v.corrections) ? v.corrections as Array<{ type: string; original_text: string; corrected_text: string }> : [],
        source_ids_checked: Array.isArray(v.source_ids_checked) ? v.source_ids_checked.filter((x): x is string => typeof x === "string") : [],
        reasoning: typeof v.reasoning === "string" ? v.reasoning : "",
      };
    } catch (e) {
      clearTimeout(timeout);
      if ((e as Error).name === "AbortError") { lastErr = new Error("Request timed out"); continue; }
      if (attempt >= RETRY_DELAYS.length) throw e;
      lastErr = e as Error;
    }
  }
  throw lastErr;
}

/**
 * Review one life_event story and persist the decision.
 *
 * @param eventId — life_events.id
 * @param sources — source messages for context (from evidence pack or DB query)
 * @param repo    — PostgresRepository instance
 * @param pool    — pg.Pool for direct event queries
 * @param options — DeepSeek credentials + dry-run flag
 */
export async function reviewEventStory(
  eventId: string,
  sources: SemanticReviewSource[],
  repo: {
    getStoryContentVersion(eventId: string): Promise<{ eventId: string; contentSha256: string; content: { title?: string | null; story?: string | null } } | null>;
    recordClaudeStoryDecision(args: { reviewer?: "deepseek-semantic-review" | "glm-semantic-review"; eventId: string; decision: "approved" | "needs_human_review"; reviewedContentSha256: string; promptVersion: string; policyVersion: string; reasonCodes: string[] }): Promise<unknown>;
    applyClaudeStoryCorrection(args: { reviewer?: "deepseek-semantic-review" | "glm-semantic-review"; eventId: string; currentContentSha256: string; newStory?: string; newPeople?: string[]; promptVersion: string; policyVersion: string; reasonCodes: string[] }): Promise<{ newContentSha256: string }>;
  },
  pool: { query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }> },
  options: {
    /** 智谱 key。给了就走 GLM（默认路径），没给才用下面的 DeepSeek 旧配置。 */
    zhipuApiKey?: string;
    zhipuBaseUrl?: string;
    deepseekApiKey?: string;
    deepseekBaseUrl?: string;
    dryRun?: boolean;
  },
): Promise<ReviewOutcome> {
  const glm = Boolean(options.zhipuApiKey);
  const baseUrl = (glm ? (options.zhipuBaseUrl ?? GLM_BASE_URL) : (options.deepseekBaseUrl ?? "https://api.deepseek.com/anthropic")).replace(/\/$/, "");
  const apiKey = glm ? options.zhipuApiKey! : options.deepseekApiKey;
  if (!apiKey) return { kind: "error", error: "no model credential (zhipuApiKey / deepseekApiKey)" };
  const reviewer = glm ? GLM_SEMANTIC_REVIEW_PROVIDER : DEEPSEEK_SEMANTIC_REVIEW_PROVIDER;

  try {
    const version = await repo.getStoryContentVersion(eventId);
    if (!version) return { kind: "skipped", reason: "not_found" };

    const evRows = await pool.query("SELECT people FROM life_events WHERE id=$1", [eventId]);
    const currentPeople: string[] = (evRows.rows[0]?.people as string[] | undefined) ?? [];

    const verdict = await callDeepSeek(
      version.content.title,
      version.content.story,
      currentPeople,
      sources,
      apiKey,
      baseUrl,
      glm,
    );

    if (options.dryRun) {
      return { kind: verdict.verdict === "approve" ? "approved" : verdict.verdict === "flag" ? "needs_human_review" : "needs_human_review", contentSha256: version.contentSha256, reason: `dry-run:${verdict.verdict}` } as ReviewOutcome;
    }

    if (verdict.verdict === "approve") {
      await repo.recordClaudeStoryDecision({
        eventId,
        decision: "approved",
        reviewedContentSha256: version.contentSha256,
        promptVersion: SEMANTIC_REVIEW_PROMPT_VERSION,
        policyVersion: SEMANTIC_REVIEW_POLICY_VERSION,
        reviewer, reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:approved"],
      });
      return { kind: "approved", contentSha256: version.contentSha256 };

    } else if (verdict.verdict === "correct_needed") {
      // Try to apply corrections
      let newStory = version.content.story ?? "";
      let anyMismatch = false;
      for (const c of verdict.corrections) {
        if (!c.original_text) continue;
        if (newStory.includes(c.original_text)) {
          newStory = newStory.replace(c.original_text, c.corrected_text ?? "");
        } else {
          anyMismatch = true;
        }
      }
      const storyChanged = newStory !== (version.content.story ?? "");
      const peopleChanged = JSON.stringify([...verdict.approved_people].sort()) !== JSON.stringify([...currentPeople].sort());

      if (!anyMismatch && (storyChanged || peopleChanged)) {
        const result = await repo.applyClaudeStoryCorrection({
          eventId,
          currentContentSha256: version.contentSha256,
          ...(storyChanged ? { newStory } : {}),
          ...(peopleChanged ? { newPeople: verdict.approved_people } : {}),
          promptVersion: SEMANTIC_REVIEW_PROMPT_VERSION,
          policyVersion: SEMANTIC_REVIEW_POLICY_VERSION,
          reviewer, reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:correction-applied"],
        });
        return { kind: "corrected", contentSha256: version.contentSha256, newSha256: result.newContentSha256 };
      }
      // Unapplied correction: stay pending
      await repo.recordClaudeStoryDecision({
        eventId,
        decision: "needs_human_review",
        reviewedContentSha256: version.contentSha256,
        promptVersion: SEMANTIC_REVIEW_PROMPT_VERSION,
        policyVersion: SEMANTIC_REVIEW_POLICY_VERSION,
        reviewer, reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:correction-unapplied", anyMismatch ? "reason:correction_text_not_found" : "reason:no_actual_change"],
      });
      return { kind: "needs_human_review", contentSha256: version.contentSha256, reason: anyMismatch ? "correction_text_not_found" : "no_actual_change" };

    } else {
      // "flag"
      await repo.recordClaudeStoryDecision({
        eventId,
        decision: "needs_human_review",
        reviewedContentSha256: version.contentSha256,
        promptVersion: SEMANTIC_REVIEW_PROMPT_VERSION,
        policyVersion: SEMANTIC_REVIEW_POLICY_VERSION,
        reviewer, reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:flagged", verdict.reasoning?.slice(0, 80) ?? ""],
      });
      return { kind: "needs_human_review", contentSha256: version.contentSha256, reason: "flagged:" + (verdict.reasoning?.slice(0, 60) ?? "") };
    }
  } catch (e) {
    return { kind: "error", error: (e as Error).message ?? String(e) };
  }
}
