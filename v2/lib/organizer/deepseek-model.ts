// 2026-09-23: Switched from DeepSeek to 智谱 GLM. See lib/organizer/glm-model.ts for the active config.
//
// Old (2026-09-14 – 2026-09-23): NIANLIFE_DEEPSEEK_MODEL = "deepseek-flash"
//   API: https://api.deepseek.com/anthropic (Anthropic-compatible endpoint)
//   Key: DEEPSEEK_API_KEY
//
// New (2026-09-23+): glm-5.3-flash via 智谱 OpenAI-compatible endpoint
//   See NIANLIFE_GLM_MODEL in glm-model.ts
//
// This file is kept for reference and for callers that haven't migrated yet.
// resolveDeepSeekModel now accepts both "deepseek-flash" (legacy) and the active GLM model.
import { NIANLIFE_GLM_MODEL } from "./glm-model";
// export const NIANLIFE_DEEPSEEK_MODEL = "deepseek-flash"; // old DeepSeek model, kept for reference
export const NIANLIFE_DEEPSEEK_MODEL = NIANLIFE_GLM_MODEL; // re-exported active model

export class DeepSeekModelError extends Error {
  constructor(readonly code: "MODEL_NOT_ALLOWED" | "PROVIDER_MODEL_MISMATCH", message: string) { super(`${code}: ${message}`); this.name = "DeepSeekModelError"; }
}

/** Resolves the model for a DeepSeek call from `env[variable]` (default AI_MODEL). */
const ALLOWED_MODELS = new Set([NIANLIFE_DEEPSEEK_MODEL, "deepseek-flash"]);

export function resolveDeepSeekModel(env: Record<string, string | undefined>, variable = "AI_MODEL"): string {
  const configured = env[variable]?.trim();
  if (!configured) return NIANLIFE_DEEPSEEK_MODEL;
  if (!ALLOWED_MODELS.has(configured)) {
    throw new DeepSeekModelError("MODEL_NOT_ALLOWED", `${variable}="${configured}" is not an allowed model. Allowed: ${[...ALLOWED_MODELS].join(", ")}; no call was made.`);
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
