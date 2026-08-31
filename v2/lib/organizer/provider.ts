import type { ContentType, OrganizerAction, OrganizerGrowthSignal } from "@/lib/types";
import { ORGANIZER_DECISION_SCHEMA, validateOrganizerDecision } from "./schema";
import { buildOrganizerPrompt, ORGANIZER_PROMPT_VERSION, ORGANIZER_SYSTEM_PROMPT } from "./prompts/v1";
import { toGeminiResponseSchema } from "./gemini-schema";
import { ORGANIZER_DECISION_SCHEMA_V2, validateOrganizerDecisionV2 } from "./schema-v2";
import { buildOrganizerPromptV2, ORGANIZER_PROMPT_VERSION_V2, ORGANIZER_SYSTEM_PROMPT_V2 } from "./prompts/v2";
import type { AIProvider, AIProviderResponse, OrganizerContext, OrganizerDecision } from "./types";

export class AIProviderError extends Error {
  readonly decision?: unknown;

  constructor(message: string, decision?: unknown) {
    super(message);
    this.name = "AIProviderError";
    this.decision = decision;
  }
}

function apiBase(env: NodeJS.ProcessEnv) {
  return (env.AI_API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

function responseText(value: unknown) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.filter((part): part is { type?: string; text?: string } => typeof part === "object" && part !== null).map((part) => part.type === "text" ? part.text ?? "" : "").join("");
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai-compatible";
  readonly promptVersion = ORGANIZER_PROMPT_VERSION;
  readonly model: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (!env.AI_API_KEY) throw new AIProviderError("AI provider is not configured: AI_API_KEY is missing");
    if (!env.AI_MODEL) throw new AIProviderError("AI provider is not configured: AI_MODEL is missing");
    this.env = env;
    this.model = env.AI_MODEL;
  }

  async organize(context: OrganizerContext): Promise<AIProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number.parseInt(this.env.AI_TIMEOUT_MS ?? "30000", 10) || 30000));
    const userContent: Array<Record<string, unknown>> = [{ type: "text", text: buildOrganizerPrompt(context) }];
    for (const input of context.mediaInputs) userContent.push({ type: "image_url", image_url: { url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString("base64")}`, detail: "low" } });
    try {
      const response = await fetch(`${apiBase(this.env)}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.env.AI_API_KEY}` }, body: JSON.stringify({ model: this.model, temperature: 0, messages: [{ role: "system", content: ORGANIZER_SYSTEM_PROMPT }, { role: "user", content: userContent }], response_format: { type: "json_schema", json_schema: { name: "organizer_decision", strict: true, schema: ORGANIZER_DECISION_SCHEMA } } }), signal: controller.signal });
      if (!response.ok) throw new AIProviderError(`AI provider request failed with status ${response.status}`);
      const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } };
      const content = responseText(body.choices?.[0]?.message?.content);
      if (!content) throw new AIProviderError("AI provider returned empty structured output");
      let decision: unknown;
      try { decision = JSON.parse(content) as unknown; } catch { throw new AIProviderError("AI provider returned invalid JSON"); }
      return { decision, usage: body.usage ? { input: body.usage.prompt_tokens, output: body.usage.completion_tokens, total: body.usage.total_tokens } : undefined };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new AIProviderError("AI provider request timed out");
      throw new AIProviderError("AI provider is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }
}

const GEMINI_ORGANIZER_RESPONSE_SCHEMA_V1 = toGeminiResponseSchema(ORGANIZER_DECISION_SCHEMA);
const GEMINI_ORGANIZER_RESPONSE_SCHEMA_V2 = toGeminiResponseSchema(ORGANIZER_DECISION_SCHEMA_V2);
const GEMINI_TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_RETRIES = 2;
const GEMINI_RETRY_BASE_DELAY_MS = 250;

type GeminiPart = { text?: string; inlineData?: { mimeType: string; data: string } };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
};

function geminiText(parts: GeminiPart[] | undefined) {
  return (parts ?? []).map((part) => part.text ?? "").join("");
}

export class GeminiAIProvider implements AIProvider {
  readonly name = "gemini";
  readonly model: string;
  readonly promptVersion: typeof ORGANIZER_PROMPT_VERSION | typeof ORGANIZER_PROMPT_VERSION_V2;
  private readonly apiKey: string;
  private readonly env: NodeJS.ProcessEnv;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (!env.GEMINI_API_KEY) throw new AIProviderError("AI provider is not configured: GEMINI_API_KEY is missing");
    if (!env.AI_MODEL) throw new AIProviderError("AI provider is not configured: AI_MODEL is missing");
    // Matches the AI_ORGANIZER_PROMPT_VERSION default documented in .env.example: v2 is the
    // supported contract (action-field matrix + validateOrganizerDecisionV2). Falling back to v1
    // here would silently reintroduce the schema/policy mismatches v2 was built to fix.
    const promptVersion = (env.AI_ORGANIZER_PROMPT_VERSION ?? "v2").toLowerCase();
    if (promptVersion !== ORGANIZER_PROMPT_VERSION && promptVersion !== ORGANIZER_PROMPT_VERSION_V2) throw new AIProviderError(`Unsupported organizer prompt version: ${promptVersion}`);
    this.env = env;
    this.model = env.AI_MODEL;
    this.apiKey = env.GEMINI_API_KEY;
    this.promptVersion = promptVersion;
  }

  async organize(context: OrganizerContext): Promise<AIProviderResponse> {
    const mediaInputs = context.mediaInputs.toSorted((a, b) => {
      const priority = { thumbnail: 0, web: 1, poster: 2 } as const;
      return priority[a.variant] - priority[b.variant];
    }).slice(0, 6);
    const promptContext = mediaInputs.length === context.mediaInputs.length ? context : { ...context, mediaInputs, representativeMediaCount: mediaInputs.length };
    const prompt = this.promptVersion === ORGANIZER_PROMPT_VERSION_V2 ? buildOrganizerPromptV2(promptContext) : buildOrganizerPrompt(promptContext);
    const systemPrompt = this.promptVersion === ORGANIZER_PROMPT_VERSION_V2 ? ORGANIZER_SYSTEM_PROMPT_V2 : ORGANIZER_SYSTEM_PROMPT;
    const responseSchema = this.promptVersion === ORGANIZER_PROMPT_VERSION_V2 ? GEMINI_ORGANIZER_RESPONSE_SCHEMA_V2 : GEMINI_ORGANIZER_RESPONSE_SCHEMA_V1;
    const parts: GeminiPart[] = [{ text: prompt }];
    for (const input of mediaInputs) parts.push({ inlineData: { mimeType: input.mimeType, data: Buffer.from(input.bytes).toString("base64") } });
    try {
      const request = JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema },
      });
      let response: Response | undefined;
      for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
        const attemptController = new AbortController();
        const attemptTimeout = setTimeout(() => attemptController.abort(), Math.max(1000, Number.parseInt(this.env.AI_TIMEOUT_MS ?? "30000", 10) || 30000));
        try {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey }, body: request, signal: attemptController.signal });
        } finally {
          clearTimeout(attemptTimeout);
        }
        if (response.ok) break;
        if (!GEMINI_TRANSIENT_STATUSES.has(response.status) || attempt === GEMINI_MAX_RETRIES) throw new AIProviderError(`AI provider request failed with status ${response.status}`);
        await new Promise((resolve) => setTimeout(resolve, GEMINI_RETRY_BASE_DELAY_MS * 2 ** attempt));
      }
      if (!response) throw new AIProviderError("AI provider returned no response");
      const body = await response.json() as GeminiResponse;
      if (body.promptFeedback?.blockReason) throw new AIProviderError(`AI provider blocked the request: ${body.promptFeedback.blockReason}`);
      const candidate = body.candidates?.[0];
      if (candidate?.finishReason && !["STOP", "MAX_TOKENS"].includes(candidate.finishReason)) throw new AIProviderError(`AI provider returned finishReason ${candidate.finishReason}`);
      const content = geminiText(candidate?.content?.parts);
      if (!content) throw new AIProviderError("AI provider returned empty structured output");
      let parsed: unknown;
      try { parsed = JSON.parse(content) as unknown; } catch { throw new AIProviderError("AI provider returned invalid JSON"); }
      let decision: unknown = parsed;
      if (this.promptVersion === ORGANIZER_PROMPT_VERSION_V2) {
        try {
          decision = validateOrganizerDecisionV2(parsed, context);
        } catch (error) {
          throw new AIProviderError(error instanceof Error ? error.message : "Invalid organizer decision", parsed);
        }
      }
      const usage = body.usageMetadata ? { input: body.usageMetadata.promptTokenCount, output: body.usageMetadata.candidatesTokenCount, total: body.usageMetadata.totalTokenCount } : undefined;
      return { decision, usage };
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new AIProviderError("AI provider request timed out");
      throw new AIProviderError(`AI provider is unavailable${error instanceof Error && error.message ? `: ${error.message}` : ""}`);
    }
  }
}

export class MockAIProvider implements AIProvider {
  readonly name = "mock";
  readonly model = "synthetic-v1";
  readonly promptVersion = ORGANIZER_PROMPT_VERSION;
  private readonly responder?: (context: OrganizerContext) => unknown;

  constructor(responder?: (context: OrganizerContext) => unknown) {
    this.responder = responder;
  }

  async organize(context: OrganizerContext): Promise<AIProviderResponse> {
    return { decision: this.responder ? this.responder(context) : defaultMockDecision(context) };
  }
}

const signalEvidence: Record<OrganizerGrowthSignal, RegExp> = { language: /说|词|语言|表达|车车|language/i, motor: /跑|走|踢|爬|跳|追|球|motor/i, social: /一起|其他孩子|同伴|老师|主动|social/i, interest: /喜欢|专注|感兴趣|interest/i };

function sourceText(context: OrganizerContext) {
  return context.sourceSummaries.map((source) => source.text?.trim()).filter(Boolean).join("\n");
}

function contentTypesFor(context: OrganizerContext): ContentType[] {
  return [...new Set(context.sourceSummaries.flatMap((source) => source.contentTypes))];
}

function defaultMockDecision(context: OrganizerContext): OrganizerDecision {
  const sources = context.sourceSummaries;
  const text = sourceText(context);
  const types = contentTypesFor(context);
  const date = sources[0]?.capturedAt.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  const medical = types.includes("health") || sources.some((source) => source.sourceType === "medical_document" || source.sourceType === "checkup_document");
  if (medical) return { action: "care_episode", sourceIds: sources.map((source) => source.id), occurredAt: date, contentTypes: ["health"], memoryWeight: "trace", confidence: 0.99, reason: "Health sources are organized as facts only." };
  // A same-date/content-type overlap alone does not justify attaching to an existing memory: the
  // target must be unique (not one of several plausible matches) and there must be text or media
  // evidence linking this batch to it — matching the store_only gate below.
  const existingMatches = context.existingMemories.filter((memory) => memory.contentTypes.some((type) => types.includes(type)));
  const existing = existingMatches.length === 1 ? existingMatches[0] : undefined;
  const video = sources.some((source) => source.sourceType === "family_video");
  const hasEvidence = Boolean(text) || context.representativeMediaCount > 0;
  if (existing && video && hasEvidence) return { action: "attach_existing", sourceIds: sources.map((source) => source.id), existingLifeEventId: existing.id, occurredAt: date, contentTypes: types, memoryWeight: "memory", confidence: 0.91, reason: "Related video belongs to the nearby existing memory." };
  if (!text && context.representativeMediaCount === 0) return { action: "store_only", sourceIds: sources.map((source) => source.id), occurredAt: date, contentTypes: types, memoryWeight: "trace", confidence: 0.35, reason: "No text or safe derivative input supports a stronger archive claim." };
  const milestone = /第一次|首次|开始|学会|主动|生日|旅行|milestone|first\s*time/i.test(text);
  if (milestone) {
    const possibleSignals: OrganizerGrowthSignal[] = ["language", "motor", "social", "interest"];
    const signals = possibleSignals.filter((signal) => signalEvidence[signal].test(text));
    return { action: "create_memory", sourceIds: sources.map((source) => source.id), occurredAt: date, contentTypes: types, memoryWeight: types.includes("travel") ? "chapter" : "highlight", title: text.slice(0, 60), shortStory: text.slice(0, 420), growthSignals: signals, confidence: 0.9, reason: "The source text contains a concrete change or event signal." };
  }
  if (sources.some((source) => source.sourceType === "daycare_note" || source.sourceType === "daycare_photo")) return { action: "daily_trace", sourceIds: sources.map((source) => source.id), occurredAt: date, contentTypes: types, memoryWeight: "trace", confidence: 0.74, reason: "The daycare material describes an ordinary day and is better kept as a trace." };
  if (text && sources.length <= 2) return { action: "create_memory", sourceIds: sources.map((source) => source.id), occurredAt: date, contentTypes: types, memoryWeight: "memory", title: text.slice(0, 60), shortStory: text.slice(0, 420), confidence: 0.8, reason: "A short source note is useful as a lightweight memory." };
  return { action: "daily_trace", sourceIds: sources.map((source) => source.id), occurredAt: date, contentTypes: types, memoryWeight: "trace", confidence: 0.74, reason: "The batch describes an ordinary day and is better kept as a trace." };
}

export function createConfiguredAIProvider(env: NodeJS.ProcessEnv = process.env) {
  const provider = (env.AI_PROVIDER ?? "openai").toLowerCase();
  if (provider === "gemini") return new GeminiAIProvider(env);
  if (provider !== "openai" && provider !== "openai-compatible") throw new AIProviderError(`Unsupported AI provider: ${provider}`);
  return new OpenAICompatibleProvider(env);
}

export { ORGANIZER_PROMPT_VERSION, ORGANIZER_SYSTEM_PROMPT, validateOrganizerDecision };
