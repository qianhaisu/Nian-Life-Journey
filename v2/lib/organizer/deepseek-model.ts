// The one DeepSeek model Nianlife calls (Teddy, 2026-09-14: "all DeepSeek calls use V4.1 Flash").
//
// The API id is `deepseek-flash`. Verified, not guessed: GET https://api.deepseek.com/models on this
// account lists exactly `deepseek-flash` and `deepseek-v4-pro`, and a minimal synthetic request on both
// the OpenAI-compatible and Anthropic-compatible surfaces returned `model: "deepseek-flash"`
// (NianlifeOps timeline-2026-09-13-overnight/data/DEEPSEEK-models-2026-09-14T03-14-17.json).
//
// No fallback in either direction: an unset variable means this model; a variable naming any other
// model is a configuration error that stops the call before anything is sent. A response that says
// it came from a different model is refused too, so a provider-side substitution cannot pass silently.
export const NIANLIFE_DEEPSEEK_MODEL = "deepseek-flash";

export class DeepSeekModelError extends Error {
  constructor(readonly code: "MODEL_NOT_ALLOWED" | "PROVIDER_MODEL_MISMATCH", message: string) { super(`${code}: ${message}`); this.name = "DeepSeekModelError"; }
}

/** Resolves the model for a DeepSeek call from `env[variable]` (default AI_MODEL). */
export function resolveDeepSeekModel(env: Record<string, string | undefined>, variable = "AI_MODEL"): string {
  const configured = env[variable]?.trim();
  if (!configured) return NIANLIFE_DEEPSEEK_MODEL;
  if (configured !== NIANLIFE_DEEPSEEK_MODEL) {
    throw new DeepSeekModelError("MODEL_NOT_ALLOWED", `${variable}="${configured}" is not the Nianlife DeepSeek model "${NIANLIFE_DEEPSEEK_MODEL}". Unset it or set it to ${NIANLIFE_DEEPSEEK_MODEL}; no call was made.`);
  }
  return configured;
}

/** Checks the model a response reports. Returns it (or null when the provider sent none). */
export function assertProviderModel(requested: string, payload: { model?: unknown } | null | undefined): string | null {
  const returned = typeof payload?.model === "string" ? payload.model : null;
  if (returned !== null && returned !== requested) {
    throw new DeepSeekModelError("PROVIDER_MODEL_MISMATCH", `requested ${requested} but the provider answered as ${returned}`);
  }
  return returned;
}
