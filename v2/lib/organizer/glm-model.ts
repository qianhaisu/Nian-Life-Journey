// GLM (智谱 AI) model config and OpenAI-compatible transport helpers (Teddy, 2026-09-23).
//
// glm-5.3-flash 是推理模型：先输出 reasoning_content（reasoning token），再输出 content（正文）。
// max_tokens 必须足够大（建议 8000+），否则推理 token 耗尽后正文是空字符串。
// 验证（2026-09-23）：64×64 合成橙色块发给 vision 端点，回答 "Orange"；工具调用正常。
export const NIANLIFE_GLM_MODEL = "glm-5.3-flash";
export const NIANLIFE_GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

export class GlmModelError extends Error {
  constructor(readonly code: "MODEL_NOT_ALLOWED" | "PROVIDER_MODEL_MISMATCH", message: string) {
    super(`${code}: ${message}`);
    this.name = "GlmModelError";
  }
}

/** Resolves the GLM model from env (default AI_MODEL). Returns NIANLIFE_GLM_MODEL if unset. */
export function resolveGlmModel(env: Record<string, string | undefined>, variable = "AI_MODEL"): string {
  const configured = env[variable]?.trim();
  if (!configured) return NIANLIFE_GLM_MODEL;
  if (configured !== NIANLIFE_GLM_MODEL) {
    throw new GlmModelError("MODEL_NOT_ALLOWED", `${variable}="${configured}" is not the Nianlife GLM model "${NIANLIFE_GLM_MODEL}". Unset it or set it to ${NIANLIFE_GLM_MODEL}; no call was made.`);
  }
  return configured;
}

/** Check the model a GLM response reports. Throws on mismatch. */
export function assertGlmProviderModel(requested: string, body: { model?: unknown } | null | undefined): void {
  const returned = typeof body?.model === "string" ? body.model : null;
  if (returned !== null && returned !== requested) {
    throw new GlmModelError("PROVIDER_MODEL_MISMATCH", `requested ${requested} but GLM answered as ${returned}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Transport helpers: call GLM's OpenAI-compatible chat/completions endpoint
// ──────────────────────────────────────────────────────────────────────────────

export type GlmTool = { name: string; description: string; input_schema: object };
export type GlmImagePart = { type: "image_url"; image_url: { url: string } };
export type GlmTextPart = { type: "text"; text: string };

/** Encode a buffer as an OpenAI-format image_url content part. */
export function glmImagePart(buf: Buffer, mimeType: string): GlmImagePart {
  return { type: "image_url", image_url: { url: `data:${mimeType};base64,${buf.toString("base64")}` } };
}

export type GlmWithToolsOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  /** String content OR array of text/image_url parts. */
  userContent: string | Array<GlmTextPart | GlmImagePart | Record<string, unknown>>;
  tools: GlmTool[];
  toolName: string;
  maxTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type GlmWithToolsResult = {
  toolInput: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number; total_tokens?: number } | undefined;
  /** Raw model field from the response, for assertion. */
  responseModel: string | undefined;
};

/**
 * Call GLM with forced tool use (OpenAI function calling format).
 *
 * Anthropic → OpenAI translation:
 *   tools[].input_schema → tools[].function.parameters
 *   tool_choice {type:"tool",name} → {type:"function",function:{name}}
 *   system string → messages[0] with role:"system"
 *   response content[{type:"tool_use",input}] → choices[0].message.tool_calls[0].function.arguments
 *   usage {input_tokens,output_tokens} → {prompt_tokens,completion_tokens}
 */
export async function callGlmWithTools(opts: GlmWithToolsOptions): Promise<GlmWithToolsResult> {
  const tools = opts.tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: opts.maxTokens,
    temperature: 0,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userContent },
    ],
    tools,
    tool_choice: { type: "function", function: { name: opts.toolName } },
  });

  const response = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${opts.apiKey}` },
    body,
    signal: opts.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`GLM HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json() as {
    model?: string;
    choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };

  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall?.function?.arguments) throw new Error("GLM returned no tool_calls in response");
  if (toolCall.function.name !== opts.toolName) throw new Error(`GLM returned tool ${toolCall.function.name}, expected ${opts.toolName}`);

  let toolInput: Record<string, unknown>;
  try { toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>; }
  catch { throw new Error("GLM tool arguments are not valid JSON"); }

  const usage = data.usage ? {
    input_tokens: data.usage.prompt_tokens ?? 0,
    output_tokens: data.usage.completion_tokens ?? 0,
    total_tokens: data.usage.total_tokens,
  } : undefined;

  return { toolInput, usage, responseModel: typeof data.model === "string" ? data.model : undefined };
}

/**
 * Modify a GLM (OpenAI-format) request body to append a second-look hint to the user message.
 * Parallel of deepseek-editor.ts withSecondLook but for OpenAI message format.
 */
export function withSecondLookGlm(requestBody: string, hint: string): string {
  const body = JSON.parse(requestBody) as { messages: Array<{ role: string; content: unknown }> };
  const userMsg = body.messages.find((m) => m.role === "user");
  if (userMsg) {
    const existing = typeof userMsg.content === "string" ? userMsg.content : JSON.stringify(userMsg.content);
    userMsg.content = `${existing}\n\n${hint}`;
  }
  return JSON.stringify(body);
}
