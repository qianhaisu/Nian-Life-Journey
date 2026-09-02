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
import { buildMemoryEditorPromptV2, MEMORY_EDITOR_V2_PROMPT_VERSION, MEMORY_EDITOR_V2_SYSTEM_PROMPT, MEMORY_EDITOR_V2_TOOL_NAME, MEMORY_EDITOR_V2_TOOL_SCHEMA, type PriorObservation } from "./prompts/memory-editor-v2";
import { toV1WorthinessDimensions, type EvidenceAxis, type WorthinessAxis } from "./worthiness-v2";
import { buildMemoryEditorPromptV3, MEMORY_EDITOR_V3_PROMPT_VERSION, MEMORY_EDITOR_V3_SYSTEM_PROMPT, MEMORY_EDITOR_V3_TOOL_NAME, MEMORY_EDITOR_V3_TOOL_SCHEMA } from "./prompts/memory-editor-v3";
import { toV1WorthinessDimensionsV3, type WorthinessAxisV3 } from "./worthiness-v3";
import type { SelectedPriorObservation } from "./prior-observations";
import { buildMemoryEditorPromptV4, MEMORY_EDITOR_V4_PROMPT_VERSION, MEMORY_EDITOR_V4_SYSTEM_PROMPT, MEMORY_EDITOR_V4_TOOL_NAME, MEMORY_EDITOR_V4_TOOL_SCHEMA } from "./prompts/memory-editor-v4";
import { toV1WorthinessDimensionsV4, type WorthinessAxisV4 } from "./worthiness-v4";
import { resolveSubjectBounded, type SubjectResolution as BoundedSubjectResolution } from "./subject-resolver";
import type { IdentityRegistry } from "./identity";

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

export function coerceSubjectRelevance(raw: Record<string, unknown>, window: EvidenceWindow, subject: { primaryName: string; aliases: string[] }, bounded?: BoundedSubjectResolution): { subjectRelevance: string; gateAReason?: string } {
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
  // v4 supplies a bounded resolution computed deterministically before this point; it supersedes the
  // older in-window-name test, which refused every pronoun-only window however well anchored.
  if (bounded) {
    if (bounded.level === "unresolved") return { subjectRelevance: "ambiguous", gateAReason: `gate_a_${bounded.blockers[0] ?? "unresolved"}` };
    return { subjectRelevance: "primary" };
  }
  const resolution = resolveSubject(window, subject);
  if (resolution === "none") return { subjectRelevance: "ambiguous", gateAReason: "gate_a_no_name_in_window" };
  if (resolution === "contested") return { subjectRelevance: "ambiguous", gateAReason: "gate_a_competing_person" };
  return { subjectRelevance: "primary" };
}

export type MemoryEditorVariant = "v1" | "v2" | "v3" | "v4";

export type DeepSeekEditorOptions = {
  /** v1 is the production publication-ledger contract. v2 splits provenance from worthiness. */
  variant?: MemoryEditorVariant;
  /** v2+: bounded, topic-linked baseline used to justify a developmental-transition claim. */
  priorObservationsFor?: (window: EvidenceWindow) => PriorObservation[] | SelectedPriorObservation[];
  /** v4: verified identities, used by the Subject Resolver to count caregiver continuity. */
  registry?: IdentityRegistry;
  /** v4: raises the resolver's prior only. Never sufficient to resolve a pronoun by itself. */
  singleChildHousehold?: boolean;
};

export class DeepSeekMemoryEditor implements MemoryEditorProvider {
  readonly name = "deepseek";
  readonly model: string;
  readonly promptVersion: string;
  readonly variant: MemoryEditorVariant;
  readonly stats: DeepSeekCallStats[] = [];
  /**
   * v2 emits two axes that the v1 contract does not carry, and validateMemoryEditorVerdict returns
   * a rebuilt object, so they would otherwise be dropped before anything could score them. Keeping
   * them here (keyed by windowId) preserves them for scoring and observability without widening the
   * contract.
   */
  readonly axesByWindowId = new Map<string, { evidenceAxis: EvidenceAxis; worthinessAxis: WorthinessAxis | WorthinessAxisV3 | WorthinessAxisV4 }>();
  /** v4: the deterministic subject resolution behind each window, for auditing. */
  readonly subjectResolutionByWindowId = new Map<string, BoundedSubjectResolution>();
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly subject: { primaryName: string; aliases: string[] };
  private readonly priorObservationsFor?: (window: EvidenceWindow) => PriorObservation[] | SelectedPriorObservation[];
  private readonly registry?: IdentityRegistry;
  private readonly singleChildHousehold: boolean;

  constructor(env: NodeJS.ProcessEnv, subject: { primaryName: string; aliases: string[] }, options: DeepSeekEditorOptions = {}) {
    this.variant = options.variant ?? "v1";
    this.promptVersion = this.variant === "v4" ? MEMORY_EDITOR_V4_PROMPT_VERSION : this.variant === "v3" ? MEMORY_EDITOR_V3_PROMPT_VERSION : this.variant === "v2" ? MEMORY_EDITOR_V2_PROMPT_VERSION : MEMORY_EDITOR_PROMPT_VERSION;
    this.registry = options.registry;
    this.singleChildHousehold = options.singleChildHousehold ?? false;
    this.priorObservationsFor = options.priorObservationsFor;
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
    const isV2 = this.variant === "v2";
    const isV3 = this.variant === "v3";
    const isV4 = this.variant === "v4";
    // Deterministic, bounded and auditable — computed before the model is asked anything, so Gate A
    // never rests on the model's own claim about who "他" is.
    const boundedResolution = isV4
      ? resolveSubjectBounded(window, this.subject, { registry: this.registry, singleChildHousehold: this.singleChildHousehold })
      : undefined;
    if (boundedResolution) this.subjectResolutionByWindowId.set(window.windowId, boundedResolution);
    const priors = this.priorObservationsFor?.(window) ?? [];
    const toolName = isV4 ? MEMORY_EDITOR_V4_TOOL_NAME : isV3 ? MEMORY_EDITOR_V3_TOOL_NAME : isV2 ? MEMORY_EDITOR_V2_TOOL_NAME : MEMORY_EDITOR_TOOL_NAME;
    const systemPrompt = isV4 ? MEMORY_EDITOR_V4_SYSTEM_PROMPT : isV3 ? MEMORY_EDITOR_V3_SYSTEM_PROMPT : isV2 ? MEMORY_EDITOR_V2_SYSTEM_PROMPT : MEMORY_EDITOR_SYSTEM_PROMPT;
    const schema = isV4 ? MEMORY_EDITOR_V4_TOOL_SCHEMA : isV3 ? MEMORY_EDITOR_V3_TOOL_SCHEMA : isV2 ? MEMORY_EDITOR_V2_TOOL_SCHEMA : MEMORY_EDITOR_TOOL_SCHEMA;
    const userPrompt = isV4
      ? buildMemoryEditorPromptV4(window, this.subject, priors as SelectedPriorObservation[])
      : isV3
      ? buildMemoryEditorPromptV3(window, this.subject, priors as SelectedPriorObservation[])
      : isV2 ? buildMemoryEditorPromptV2(window, this.subject, priors as PriorObservation[]) : buildMemoryEditorPrompt(window, this.subject);
    const body = JSON.stringify({
      model: this.model,
      max_tokens: 4000,
      temperature: 0,
      thinking: { type: "disabled" },
      system: systemPrompt,
      tools: [{ name: toolName, description: "输出记忆编辑的结构化判断", input_schema: schema }],
      tool_choice: { type: "tool", name: toolName },
      messages: [{ role: "user", content: userPrompt }],
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
        const toolUse = payload.content?.find((block) => block.type === "tool_use" && block.name === toolName);
        if (!toolUse || typeof toolUse.input !== "object" || toolUse.input === null) throw new DeepSeekEditorError("DeepSeek returned no tool_use block", "no_tool_use");

        const raw = { ...(toolUse.input as Record<string, unknown>) };
        if (isV3 || isV4) {
          const worthinessAxis = raw.worthinessAxis as (WorthinessAxisV3 & WorthinessAxisV4) | undefined;
          const evidenceAxis = raw.evidenceAxis as EvidenceAxis | undefined;
          if (!worthinessAxis || !evidenceAxis) throw new DeepSeekEditorError("DeepSeek v3 verdict is missing an axis", "missing_axis");
          // v3 splits the transition's score (on the worthiness axis) from its justification (in
          // transitionSupport). Rejoin them so the contract and H8 see one coherent claim.
          const support = raw.transitionSupport as { basis?: string } | undefined;
          const transition = worthinessAxis.developmentalTransition as unknown as { score: number; evidenceRefs: string[] };
          worthinessAxis.developmentalTransition = { score: transition.score as 0 | 1 | 2 | 3, basis: (support?.basis as "explicit_in_window" | "supported_by_prior_context" | "unknown") ?? "unknown", evidenceRefs: transition.evidenceRefs ?? [] };
          this.axesByWindowId.set(window.windowId, { evidenceAxis, worthinessAxis });
          raw.worthinessDimensions = isV4 ? toV1WorthinessDimensionsV4(worthinessAxis) : toV1WorthinessDimensionsV3(worthinessAxis);
        } else if (isV2) {
          const worthinessAxis = raw.worthinessAxis as WorthinessAxis | undefined;
          const evidenceAxis = raw.evidenceAxis as EvidenceAxis | undefined;
          if (!worthinessAxis || !evidenceAxis) throw new DeepSeekEditorError("DeepSeek v2 verdict is missing an axis", "missing_axis");
          this.axesByWindowId.set(window.windowId, { evidenceAxis, worthinessAxis });
          // The H1–H9 validator speaks v1 dimension names and remains the safety authority, so the
          // worthiness axis is projected onto them. H8 then re-checks the transition claim against
          // the text independently of the model's own `basis`.
          raw.worthinessDimensions = toV1WorthinessDimensions(worthinessAxis);
        }
        const temporal = coerceTemporalStatus(raw.temporalStatus);
        raw.temporalStatus = temporal.temporalStatus;
        const { subjectRelevance, gateAReason } = coerceSubjectRelevance(raw, window, this.subject, boundedResolution);
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
export function createDeepSeekMemoryEditor(env: NodeJS.ProcessEnv, subject: { primaryName: string; aliases: string[] }, options: DeepSeekEditorOptions = {}) {
  const provider = (env.AI_PROVIDER ?? "").toLowerCase();
  if (provider !== "deepseek") throw new DeepSeekEditorError(`AI_PROVIDER is "${provider || "unset"}", expected "deepseek"`, "wrong_provider", true);
  return new DeepSeekMemoryEditor(env, subject, options);
}
