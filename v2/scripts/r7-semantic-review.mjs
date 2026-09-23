/**
 * R7 Semantic Review Service
 *
 * Reviews life_events from the evidence pack using DeepSeek-flash.
 * For each event not yet semantically reviewed:
 *   - Fetches CURRENT story/people from DB (not evidence pack text)
 *   - Calls DeepSeek-flash with current content + evidence pack source messages
 *   - Writes review via recordClaudeStoryDecision or applyClaudeStoryCorrection
 *
 * Resumable: caches ONLY successful verdicts tied to the reviewed content hash.
 * --dry-run: runs the model but does NOT write to DB.
 * Usage:
 *   node --import tsx scripts/r7-semantic-review.mjs \
 *     --pack=<path>/R7-CODEX-EVIDENCE-PACK.json \
 *     --out=<path>/R7-SEMANTIC-REVIEW-RESULTS.jsonl \
 *     [--dry-run] [--max-calls=100] [--concurrency=3]
 */
import { GLM_MODEL, isZhipu, messagesFetch, modelKey } from "../lib/organizer/glm-messages.mjs";
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const hasFlag = (name) => args.includes(`--${name}`);

const PACK_PATH = argOf("pack", null);
const OUT_PATH = argOf("out", null);
const DRY_RUN = hasFlag("dry-run");
const MAX_CALLS = Number(argOf("max-calls", "100"));
const CONCURRENCY = Math.max(1, Math.min(8, Number(argOf("concurrency", "3"))));

if (!PACK_PATH || !OUT_PATH) {
  console.error("--pack=<path> and --out=<path> are required");
  process.exit(1);
}

// ── load evidence pack ─────────────────────────────────────────────────────
const pack = JSON.parse(readFileSync(PACK_PATH, "utf8"));
const events = pack.events;
console.log(`Loaded ${events.length} events from evidence pack`);

// ── resume: load already-successfully-reviewed IDs (tied to content hash) ──
// Only cache events where semantic review actually ran; skip dry_run/error/skipped.
const processedIdHashes = new Map(); // id → contentSha256 at review time
if (existsSync(OUT_PATH)) {
  const lines = readFileSync(OUT_PATH, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const rec = JSON.parse(line);
      if (rec.id && rec.contentSha256 && rec.status && !["error", "dry_run_skipped", "has_human_decision", "not_found"].includes(rec.status)) {
        processedIdHashes.set(rec.id, rec.contentSha256);
      }
    } catch {}
  }
  console.log(`Resuming: ${processedIdHashes.size} successfully reviewed`);
}

// ── DB + repo setup ──────────────────────────────────────────────────────
const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
process.env.DATABASE_URL = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;

const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
const { getPool } = await import("../lib/db/client.ts");
const repo = createPostgresRepository();
const pool = getPool();

// ── DeepSeek config ──────────────────────────────────────────────────────
const DEEPSEEK_API_KEY = modelKey();
const DEEPSEEK_BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
const DEEPSEEK_MODEL = isZhipu() ? GLM_MODEL : "deepseek-flash"; // 2026-09-23：zhipu → glm-5.3-flash
if (!DEEPSEEK_API_KEY) { console.error("ZHIPU_API_KEY (AI_PROVIDER=zhipu) is required"); process.exit(1); }

const CLAUDE_AUTHORIZATION_REASON = "authorized-by:teddy-2026-09-16";
const PROMPT_VERSION = "r7-semantic-review-v1";
const POLICY_VERSION = "r7-semantic-review-policy-v1";

// ── DeepSeek tool schema ─────────────────────────────────────────────────
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
        description: "People with actual evidence in the source messages (speaker or described as present/participant). Subset of current people field.",
      },
      corrections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["presence_assertion", "semantic_error", "people_inflation"] },
            original_text: { type: "string", description: "Exact substring of the current story to replace or remove" },
            corrected_text: { type: "string", description: "Replacement text, or empty string to remove the original_text" },
          },
          required: ["type", "original_text", "corrected_text"],
        },
      },
      source_ids_checked: {
        type: "array",
        items: { type: "string" },
        description: "Source IDs used as evidence in this verdict",
      },
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

// ── call DeepSeek with current DB content + evidence pack sources ─────────
async function callDeepSeek(currentTitle, currentStory, currentPeople, packSources) {
  const sourceBlock = packSources.map((s, i) => {
    const speaker = s.speaker?.narrativeLabel ?? s.speaker?.displayName ?? "（未知）";
    const time = s.captured_at ? s.captured_at.slice(0, 16) : "";
    return `[来源${i + 1} id=${s.id?.slice(-12) ?? "?"} ${time} ${speaker}]: ${s.text?.trim() ?? "（媒体消息）"}`;
  }).join("\n");

  const userPrompt = `原始消息：
${sourceBlock || "（无关联原始消息）"}

当前故事：
标题：${currentTitle ?? "（无）"}
正文：${currentStory ?? "（无）"}
人物：${JSON.stringify(currentPeople ?? [])}

请审核上述故事是否准确。如需修正，提供精确的original_text（必须是正文中存在的子串）和corrected_text。返回verdict、approved_people、corrections、source_ids_checked、reasoning。`;

  const body = JSON.stringify({
    model: DEEPSEEK_MODEL,
    max_tokens: 600,
    temperature: 0,
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    tools: [REVIEW_TOOL_SCHEMA],
    tool_choice: { type: "tool", name: "review_verdict" },
    messages: [{ role: "user", content: userPrompt }],
  });

  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt - 1]));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await messagesFetch(`${DEEPSEEK_BASE_URL}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": DEEPSEEK_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (TRANSIENT_STATUSES.has(res.status)) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      if (!res.ok) { const t = await res.text(); throw new Error(`HTTP ${res.status}: ${t.slice(0, 200)}`); }
      const data = await res.json();
      if (data.model && data.model !== DEEPSEEK_MODEL) throw new Error(`Model mismatch: got ${data.model}`);
      const toolBlock = data.content?.find((b) => b.type === "tool_use" && b.name === "review_verdict");
      if (!toolBlock?.input) throw new Error("No tool_use block in response");
      const v = toolBlock.input;
      // Validate required fields
      if (!["approve", "correct_needed", "flag"].includes(v.verdict)) throw new Error(`Invalid verdict: ${v.verdict}`);
      if (!Array.isArray(v.approved_people)) v.approved_people = [];
      if (!Array.isArray(v.corrections)) v.corrections = [];
      if (!Array.isArray(v.source_ids_checked)) v.source_ids_checked = [];
      return v;
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === "AbortError") { lastErr = new Error("Request timed out"); continue; }
      if (attempt >= RETRY_DELAYS.length) throw e;
      lastErr = e;
    }
  }
  throw lastErr;
}

// ── get current event state from DB ──────────────────────────────────────
async function getCurrentEventState(eventId) {
  // Get current content sha256 + story fields
  const version = await repo.getStoryContentVersion(eventId);
  if (!version) return null;

  // Get current people (not in content hash)
  const evRows = await pool.query("SELECT people FROM life_events WHERE id=$1", [eventId]);
  const currentPeople = evRows.rows[0]?.people ?? [];

  // Get review state
  const reviewRows = await pool.query(
    `SELECT decision, provider, prompt_version FROM content_quality_reviews
     WHERE target_kind='life_event' AND target_id=$1
     ORDER BY reviewed_at DESC, id DESC LIMIT 20`,
    [eventId]
  );
  // Human blocker: non-automatic provider with an actionable decision
  const hasHumanDecision = reviewRows.rows.some((r) =>
    r.provider !== "claude-review" && r.provider !== "deepseek" && r.provider !== "agent"
    && r.decision !== "needs_human_review" && r.decision !== "needs_review"
  );
  // This specific semantic review already ran for this content hash
  const thisReviewDone = processedIdHashes.get(eventId) === version.contentSha256;

  return {
    version,
    currentPeople,
    hasHumanDecision,
    thisReviewDone,
  };
}

// ── apply corrections from review verdict ─────────────────────────────────
async function applyCorrections(eventId, currentSha256, currentStory, currentPeople, corrections, approvedPeople) {
  let newStory = currentStory ?? "";
  const appliedTypes = [];
  let anyMismatch = false;

  for (const c of corrections) {
    if (!c.original_text) continue;
    if (newStory.includes(c.original_text)) {
      newStory = newStory.replace(c.original_text, c.corrected_text ?? "");
      appliedTypes.push(`correction:${c.type}`);
    } else {
      anyMismatch = true;
    }
  }

  // If any correction couldn't be applied, stay pending
  if (anyMismatch) return { applied: false, reason: "correction_text_not_found" };

  const storyChanged = newStory !== (currentStory ?? "");
  const cp = currentPeople ?? [];
  const ap = approvedPeople ?? cp;
  const peopleChanged = JSON.stringify([...ap].sort()) !== JSON.stringify([...cp].sort());

  if (!storyChanged && !peopleChanged) return { applied: false, reason: "no_actual_change" };

  const result = await repo.applyClaudeStoryCorrection({
    eventId,
    currentContentSha256: currentSha256,
    ...(storyChanged ? { newStory } : {}),
    ...(peopleChanged ? { newPeople: ap } : {}),
    promptVersion: PROMPT_VERSION,
    policyVersion: POLICY_VERSION,
    reasonCodes: [
      CLAUDE_AUTHORIZATION_REASON,
      appliedTypes[0] ?? "correction:semantic-review",
      ...appliedTypes.slice(1),
    ],
  });
  return { applied: true, result, newHash: result.newContentSha256 };
}

// ── main review loop ───────────────────────────────────────────────────────
let callsUsed = 0;
let approved = 0, corrected = 0, flagged = 0, skipped = 0, failed = 0;

// Build lookup: eventId → sources from evidence pack
const packEventSources = new Map(events.map((e) => [e.id, e.sources ?? []]));

const toProcess = events.filter((e) => {
  const cached = processedIdHashes.get(e.id);
  return !cached; // process if not yet cached with a matching sha256
});
console.log(`${toProcess.length} events to process (${events.length - toProcess.length} already reviewed)`);
console.log(DRY_RUN ? "[DRY RUN — runs model but no DB writes]" : "[LIVE]", `max-calls=${MAX_CALLS} concurrency=${CONCURRENCY}`);

const queue = [...toProcess];

function writeRecord(rec) {
  appendFileSync(OUT_PATH, JSON.stringify(rec) + "\n");
}

const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (queue.length > 0 && callsUsed < MAX_CALLS) {
    const event = queue.shift();
    if (!event) break;

    const record = { id: event.id, title: event.title?.slice(0, 40), timestamp: new Date().toISOString() };

    try {
      const state = await getCurrentEventState(event.id);
      if (!state) { record.status = "not_found"; skipped++; writeRecord(record); continue; }
      if (state.thisReviewDone) { record.status = "already_reviewed"; skipped++; writeRecord(record); continue; }
      if (state.hasHumanDecision) { record.status = "has_human_decision"; skipped++; writeRecord(record); continue; }

      callsUsed++;
      const packSources = packEventSources.get(event.id) ?? [];
      const verdict = await callDeepSeek(
        state.version.content.title,
        state.version.content.story,
        state.currentPeople,
        packSources,
      );
      record.verdict = verdict.verdict;
      record.contentSha256 = state.version.contentSha256;
      record.approvedPeople = verdict.approved_people;
      record.sourcesChecked = verdict.source_ids_checked?.length ?? 0;
      record.reasoning = verdict.reasoning?.slice(0, 200);

      if (DRY_RUN) {
        record.status = "dry_run_reviewed";
        record.corrections = verdict.corrections;
        approved += verdict.verdict === "approve" ? 1 : 0;
        flagged += verdict.verdict === "flag" ? 1 : 0;
        corrected += verdict.verdict === "correct_needed" ? 1 : 0;
        // Cache the dry-run result so it can be applied on a live re-run
        processedIdHashes.set(event.id, state.version.contentSha256);
        writeRecord(record);
        continue;
      }

      if (verdict.verdict === "approve") {
        await repo.recordClaudeStoryDecision({
          eventId: event.id,
          decision: "approved",
          reviewedContentSha256: state.version.contentSha256,
          promptVersion: PROMPT_VERSION,
          policyVersion: POLICY_VERSION,
          reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:approved"],
        });
        record.status = "approved";
        approved++;
        processedIdHashes.set(event.id, state.version.contentSha256);
      } else if (verdict.verdict === "correct_needed") {
        const correction = await applyCorrections(
          event.id,
          state.version.contentSha256,
          state.version.content.story,
          state.currentPeople,
          verdict.corrections ?? [],
          verdict.approved_people,
        );
        record.correction = { applied: correction.applied, reason: correction.reason };
        if (correction.applied) {
          record.status = "corrected_and_approved";
          record.newHash = correction.newHash;
          corrected++;
          processedIdHashes.set(event.id, state.version.contentSha256);
        } else {
          // Unapplied correction: stay agent-pending
          await repo.recordClaudeStoryDecision({
            eventId: event.id,
            decision: "needs_human_review",
            reviewedContentSha256: state.version.contentSha256,
            promptVersion: PROMPT_VERSION,
            policyVersion: POLICY_VERSION,
            reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:correction-unapplied", `reason:${correction.reason}`],
          });
          record.status = "pending_correction_unapplied";
          flagged++;
          processedIdHashes.set(event.id, state.version.contentSha256);
        }
      } else {
        // "flag"
        await repo.recordClaudeStoryDecision({
          eventId: event.id,
          decision: "needs_human_review",
          reviewedContentSha256: state.version.contentSha256,
          promptVersion: PROMPT_VERSION,
          policyVersion: POLICY_VERSION,
          reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:flagged"],
        });
        record.status = "flagged";
        flagged++;
        processedIdHashes.set(event.id, state.version.contentSha256);
      }
    } catch (e) {
      record.status = "error";
      record.error = e.message?.slice(0, 200);
      failed++;
      console.error(`  ERROR ${event.id}: ${e.message?.slice(0, 100)}`);
    }

    writeRecord(record);
    const done = approved + corrected + flagged + failed;
    if (done % 20 === 0 && done > 0) {
      console.log(`  Progress: approved=${approved} corrected=${corrected} flagged=${flagged} failed=${failed} skipped=${skipped} calls=${callsUsed}`);
    }
  }
});

await Promise.all(workers);
await pool.end();
tunnel.close();

console.log(`\nDone.`);
console.log(`  approved=${approved} corrected=${corrected} flagged=${flagged} failed=${failed} skipped=${skipped} calls=${callsUsed}`);
if (callsUsed >= MAX_CALLS && queue.length > 0) {
  console.log(`  MAX_CALLS reached with ${queue.length} events remaining. Re-run to continue.`);
}
