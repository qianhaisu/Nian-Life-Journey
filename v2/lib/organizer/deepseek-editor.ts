// DeepSeek Memory Editor — the production decision maker for the evidence pipeline.
//
// It implements the existing MemoryEditorProvider interface (pipeline.ts), so the surrounding
// Recall → Editor → Validator(H1–H9) → MemoryCandidate flow is unchanged. There is deliberately no
// second "scratch organizer": if this provider fails, pipeline.ts degrades THIS window to a safe
// outcome. It never falls back to RuleBased (that fallback is what put adult-shift-swap messages
// on the child's homepage).
//
// Transport note: DEEPSEEK_BASE_URL points at DeepSeek's Anthropic-compatible endpoint. The
// reasoning model rejects a forced tool_choice while thinking is on, so we disable thinking and
// force the tool call — that is the only mode that guarantees schema-shaped output. Plain-text JSON
// modes were measured to be slower (reasoning tokens) and carry no schema guarantee.
import type { EvidenceWindow } from "./evidence/types";
import type { MemoryEditorProvider } from "./pipeline";
import { buildMemoryEditorPrompt, MEMORY_EDITOR_PROMPT_VERSION, MEMORY_EDITOR_SYSTEM_PROMPT, MEMORY_EDITOR_TOOL_NAME, MEMORY_EDITOR_TOOL_SCHEMA } from "./prompts/memory-editor-v1";

export class DeepSeekEditorError extends Error {
  constructor(message: string, readonly code: string, readonly fatal = false) {
    super(message);
    this.name = "DeepSeekEditorError";
  }
}

export type DeepSeekCallStats = { windowId: string; latencyMs: number; inputTokens: number; outputTokens: number; retries: number; ok: boolean; errorCode?: string };

const RETRY_DELAYS_MS = [2000, 10000, 30000];
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type AnthropicContentBlock = { type: string; name?: string; input?: unknown };
type AnthropicResponse = { content?: AnthropicContentBlock[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string; type?: string } };

// Gate A is enforced here, not left to the prompt: the fine-grained relevance label deterministically
// decides the canonical subjectRelevance the validator sees. A model that labels a window
// family_context_only can never also mark it "primary" and slip past H9.
//
// The second half is the part a prompt cannot guarantee. "primary" additionally requires that some
// span IN THIS WINDOW literally names the child. A window whose only reference is a bare pronoun
// cannot be promoted on the model's say-so — that is the exact rule ("只有他/她而没有可解析前文
// 不能证明相关") that the benchmark caught the prompt alone failing to hold.
// Another child in the conversation makes a bare pronoun unresolvable, whatever the neighbours say.
const COMPETING_PERSON = /其他小朋友|别的孩子|别的小朋友|另一个孩子|同学|哥哥|姐姐|弟弟|妹妹|双胞胎|同伴|小伙伴/;

function namesSubject(text: string, names: string[]) {
  return names.some((name) => text.includes(name));
}

// Resolution scope, deliberately narrow:
//   in_window   — a span in this window names the child. Strongest, always allowed.
//   in_neighbor — no span names the child, but one of the ±5 adjacent messages does, so the
//                 pronoun has a real antecedent. Neighbours are used for RESOLUTION ONLY. They can
//                 never be cited, linked or displayed: the contract validates every evidenceRef
//                 against window.items alone, so a neighbour span has no addressable ref at all.
//   contested   — a competing person is in play, so "他" cannot be pinned to one child.
//   none        — nothing names the child anywhere nearby.
export type SubjectResolution = "in_window" | "in_neighbor" | "contested" | "none";

export function resolveSubject(window: EvidenceWindow, subject: { primaryName: string; aliases: string[] }): SubjectResolution {
  const names = [subject.primaryName, ...subject.aliases].filter(Boolean);
  if (window.items.some((item) => namesSubject(item.text, names))) return "in_window";
  const neighbors = [...window.neighbors.before, ...window.neighbors.after];
  if (!neighbors.some((item) => namesSubject(item.text, names))) return "none";
  const nearbyText = [...window.items, ...neighbors].map((item) => item.text).join(String.fromCharCode(10));
  if (COMPETING_PERSON.test(nearbyText)) return "contested";
  return "in_neighbor";
}

const TEMPORAL_STATUSES = new Set(["past", "present", "planned", "uncertain"]);

// The tool schema declares the enum, but the model occasionally returns a value outside it, and the
// contract rightly rejects the whole verdict when it does. Normalising to "uncertain" at the
// provider boundary keeps the contract strict while making the failure safe rather than total:
// "uncertain" raises the uncertainty penalty and can never promote a window on its own.
export function coerceTemporalStatus(raw: unknown): { temporalStatus: string; coerced: boolean } {
  if (typeof raw === "string" && TEMPORAL_STATUSES.has(raw)) return { temporalStatus: raw, coerced: false };
  return { temporalStatus: "uncertain", coerced: true };
}

export function coerceSubjectRelevance(raw: Record<string, unknown>, window: EvidenceWindow, subject: { primaryName: string; aliases: string[] }): { subjectRelevance: string; gateAReason?: string } {
  const detail = raw.subjectRelevanceDetail;
  if (detail === "family_context_only" || detail === "unrelated") return { subjectRelevance: "unrelated", gateAReason: `gate_a_${detail}` };
  if (detail === "insufficient_evidence") return { subjectRelevance: "ambiguous", gateAReason: "gate_a_insufficient_evidence" };
  if (detail !== "resolved_child" && detail !== "explicit_child") {
    // Unknown/absent detail: fail closed rather than trusting the coarse field.
    return { subjectRelevance: "ambiguous", gateAReason: "gate_a_missing_detail" };
  }
  if (detail === "resolved_child") {
    const ref = raw.subjectResolutionRef;
    if (typeof ref !== "string" || !ref.includes("#")) return { subjectRelevance: "ambiguous", gateAReason: "gate_a_unresolved_pronoun" };
  }
  const resolution = resolveSubject(window, subject);
  if (resolution === "none") return { subjectRelevance: "ambiguous", gateAReason: "gate_a_no_name_in_window" };
  if (resolution === "contested") return { subjectRelevance: "ambiguous", gateAReason: "gate_a_competing_person" };
  return { subjectRelevance: "primary" };
}

export class DeepSeekMemoryEditor implements MemoryEditorProvider {
  readonly name = "deepseek";
  readonly model: string;
  readonly promptVersion = MEMORY_EDITOR_PROMPT_VERSION;
  readonly stats: DeepSeekCallStats[] = [];
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly subject: { primaryName: string; aliases: string[] };

  constructor(env: NodeJS.ProcessEnv, subject: { primaryName: string; aliases: string[] }) {
    if (!env.DEEPSEEK_API_KEY) throw new DeepSeekEditorError("DeepSeek is not configured: DEEPSEEK_API_KEY is missing", "missing_api_key", true);
    if (!env.AI_MODEL) throw new DeepSeekEditorError("DeepSeek is not configured: AI_MODEL is missing", "missing_model", true);
    this.apiKey = env.DEEPSEEK_API_KEY;
    this.model = env.AI_MODEL;
    this.baseUrl = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");
    this.timeoutMs = Math.max(1000, Number.parseInt(env.AI_TIMEOUT_MS ?? "60000", 10) || 60000);
    this.subject = subject;
  }

  // Never logs prompt or response bodies: they contain private family chat text.
  describe() { return { provider: this.name, model: this.model, promptVersion: this.promptVersion }; }

  async organize(window: EvidenceWindow): Promise<{ verdict: unknown }> {
    const body = JSON.stringify({
      model: this.model,
      max_tokens: 4000,
      temperature: 0,
      thinking: { type: "disabled" },
      system: MEMORY_EDITOR_SYSTEM_PROMPT,
      tools: [{ name: MEMORY_EDITOR_TOOL_NAME, description: "输出记忆编辑的结构化判断", input_schema: MEMORY_EDITOR_TOOL_SCHEMA }],
      tool_choice: { type: "tool", name: MEMORY_EDITOR_TOOL_NAME },
      messages: [{ role: "user", content: buildMemoryEditorPrompt(window, this.subject) }],
    });

    const startedAt = Date.now();
    let retries = 0;
    let lastError: DeepSeekEditorError | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      if (attempt > 0) { retries = attempt; await sleep(RETRY_DELAYS_MS[attempt - 1]); }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/v1/messages`, { method: "POST", headers: { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body, signal: controller.signal });
        // Insufficient balance: stop the whole run, never keep burning retries.
        if (response.status === 402) throw new DeepSeekEditorError("DeepSeek returned 402 insufficient balance", "insufficient_balance", true);
        if (!response.ok) {
          if (TRANSIENT_STATUSES.has(response.status) && attempt < RETRY_DELAYS_MS.length) { lastError = new DeepSeekEditorError(`DeepSeek returned status ${response.status}`, `http_${response.status}`); continue; }
          throw new DeepSeekEditorError(`DeepSeek returned status ${response.status}`, `http_${response.status}`);
        }
        const payload = await response.json() as AnthropicResponse;
        if (payload.error) throw new DeepSeekEditorError(`DeepSeek error: ${payload.error.type ?? "unknown"}`, "api_error");
        const toolUse = payload.content?.find((block) => block.type === "tool_use" && block.name === MEMORY_EDITOR_TOOL_NAME);
        if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) throw new DeepSeekEditorError("DeepSeek returned no tool_use block", "no_tool_use");

        const raw = { ...(toolUse.input as Record<string, unknown>) };
        const temporal = coerceTemporalStatus(raw.temporalStatus);
        raw.temporalStatus = temporal.temporalStatus;
        const { subjectRelevance, gateAReason } = coerceSubjectRelevance(raw, window, this.subject);
        raw.subjectRelevance = subjectRelevance;
        // H9 alignment: an unrelated/ambiguous subject may not carry subjectIds, and the contract
        // rejects subjectIds on "ambiguous" outright.
        if (subjectRelevance !== "primary") raw.subjectIds = [];
        if (gateAReason) raw.selectionReason = `${gateAReason}: ${String(raw.selectionReason ?? "").slice(0, 100)}`.slice(0, 120);
        raw.windowId = window.windowId;

        this.stats.push({ windowId: window.windowId, latencyMs: Date.now() - startedAt, inputTokens: payload.usage?.input_tokens ?? 0, outputTokens: payload.usage?.output_tokens ?? 0, retries, ok: true });
        return { verdict: raw };
      } catch (error) {
        if (error instanceof DeepSeekEditorError) {
          if (error.fatal) { this.stats.push({ windowId: window.windowId, latencyMs: Date.now() - startedAt, inputTokens: 0, outputTokens: 0, retries, ok: false, errorCode: error.code }); throw error; }
          lastError = error;
          if (attempt >= RETRY_DELAYS_MS.length) break;
          continue;
        }
        const code = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
        lastError = new DeepSeekEditorError(`DeepSeek call failed (${code})`, code);
        if (attempt >= RETRY_DELAYS_MS.length) break;
      } finally {
        clearTimeout(timer);
      }
    }

    const failure = lastError ?? new DeepSeekEditorError("DeepSeek call failed", "unknown");
    this.stats.push({ windowId: window.windowId, latencyMs: Date.now() - startedAt, inputTokens: 0, outputTokens: 0, retries, ok: false, errorCode: failure.code });
    throw failure;
  }
}

// Fail closed: an unconfigured or unsupported DeepSeek setup must stop AI writes, never silently
// hand the work to the rule-based organizer.
export function createDeepSeekMemoryEditor(env: NodeJS.ProcessEnv, subject: { primaryName: string; aliases: string[] }) {
  const provider = (env.AI_PROVIDER ?? "").toLowerCase();
  if (provider !== "deepseek") throw new DeepSeekEditorError(`AI_PROVIDER is "${provider || "unset"}", expected "deepseek"`, "wrong_provider", true);
  return new DeepSeekMemoryEditor(env, subject);
}
