// Scheduled editorial work uses the already configured GLM provider, without a CLI or agent session.
import fs from "node:fs";
import { NIANLIFE_GLM_BASE_URL, resolveGlmModel, assertGlmProviderModel } from "../../lib/organizer/glm-model.ts";

export function editorModelEnv(env = process.env) {
  const result = { ...env };
  const file = new URL("../../.env.local", import.meta.url);
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && result[match[1]] === undefined) result[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return result;
}

export async function callTextModel(prompt, { env = editorModelEnv(), request = fetch } = {}) {
  try {
    if (env.AI_PROVIDER?.toLowerCase() !== "zhipu" || !env.ZHIPU_API_KEY) return { ok: false, error: "缺 AI_PROVIDER=zhipu / ZHIPU_API_KEY" };
    const model = resolveGlmModel(env);
    const base = (env.ZHIPU_BASE_URL ?? NIANLIFE_GLM_BASE_URL).replace(/\/$/, "");
    const response = await request(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${env.ZHIPU_API_KEY}` },
      body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(180_000),
    });
    // Do not echo provider bodies: they may contain source text or credentials.
    if (!response.ok) return { ok: false, error: `编辑模型 HTTP ${response.status}` };
    const body = await response.json();
    assertGlmProviderModel(model, body);
    const choice = body.choices?.[0];
    if (choice?.finish_reason !== "stop") return { ok: false, error: "编辑模型回答未完整结束" };
    const reply = String(choice?.message?.content ?? "").trim();
    if (!reply) return { ok: false, error: "编辑模型没有返回正文" };
    return { ok: true, reply, model, inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
  } catch {
    return { ok: false, error: "编辑模型调用失败；未写入或发布内容" };
  }
}
