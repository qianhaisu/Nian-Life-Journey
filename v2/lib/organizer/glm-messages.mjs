// messagesFetch：给按 DeepSeek Anthropic 兼容端点写的脚本用的替身（2026-09-23 切到智谱 glm-5.3-flash）。
//
// 用法：把 `fetch(`${base}/v1/messages`, init)` 换成 `messagesFetch(`${base}/v1/messages`, init, env)`。
// AI_PROVIDER=zhipu 时，同一个请求改发到智谱 OpenAI 兼容端点，返回值再转回 Anthropic 形状
// （content 里的 text / tool_use 块、stop_reason、usage.input_tokens/output_tokens），脚本的解析一行不用改。
// 其他 provider 原样走 fetch。请求里的 model 原样发出：由调用方从 AI_MODEL 解析，响应不是这个模型时
// 调用方自己的 assertProviderModel 照样拦下。纯 JS，不需要 tsx。
export const GLM_MODEL = "glm-5.3-flash";
export const GLM_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

export const isZhipu = (env = process.env) => (env.AI_PROVIDER ?? "").toLowerCase() === "zhipu";

/** 当前配置下可用的模型凭据：zhipu 看 ZHIPU_API_KEY，否则看 DEEPSEEK_API_KEY。 */
export const modelKey = (env = process.env) => (isZhipu(env) ? env.ZHIPU_API_KEY : env.DEEPSEEK_API_KEY);

function toOpenAiContent(content) {
  if (typeof content === "string" || !Array.isArray(content)) return content;
  return content.map((b) => (b.type === "image" && b.source?.data
    ? { type: "image_url", image_url: { url: `data:${b.source.media_type ?? "image/jpeg"};base64,${b.source.data}` } }
    : b.type === "text" ? { type: "text", text: b.text ?? "" } : b));
}

export async function messagesFetch(url, init = {}, env = process.env) {
  if (!isZhipu(env)) return fetch(url, init);
  const key = env.ZHIPU_API_KEY;
  if (!key) throw new Error("AI_PROVIDER=zhipu but ZHIPU_API_KEY is missing");
  const req = JSON.parse(String(init.body ?? "{}"));
  const system = Array.isArray(req.system) ? req.system.map((b) => b.text ?? "").join("\n") : req.system;
  const body = {
    model: req.model,
    // glm-5.3-flash 是推理模型：reasoning token 计入 max_tokens，上限不够时正文是空串。
    max_tokens: Math.max(req.max_tokens ?? 0, 8000),
    messages: [
      ...(system ? [{ role: "system", content: system }] : []),
      ...(req.messages ?? []).map((m) => ({ role: m.role, content: toOpenAiContent(m.content) })),
    ],
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.tools?.length) body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));
  if (req.tool_choice?.type === "tool" && req.tool_choice.name) body.tool_choice = { type: "function", function: { name: req.tool_choice.name } };
  const res = await fetch(`${(env.ZHIPU_BASE_URL ?? GLM_BASE_URL).replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: init.signal,
  });
  const text = await res.text();
  if (!res.ok) return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
  const data = JSON.parse(text);
  const choice = data.choices?.[0];
  const content = [];
  if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
  for (const call of choice?.message?.tool_calls ?? []) {
    let input = null;
    try { input = JSON.parse(call.function?.arguments ?? ""); } catch { input = null; }
    content.push({ type: "tool_use", name: call.function?.name, input });
  }
  const shaped = {
    model: data.model,
    content,
    stop_reason: choice?.finish_reason === "length" ? "max_tokens" : choice?.message?.tool_calls?.length ? "tool_use" : "end_turn",
    usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
  };
  return new Response(JSON.stringify(shaped), { status: 200, headers: { "content-type": "application/json" } });
}
