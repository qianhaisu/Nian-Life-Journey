// HEALTH-03 configuration. Everything is explicit: no configured root = the feature is OFF (there are no health credentials any more).
// It never falls back to an existing ledger, a business database or a public repository directory.
import path from "node:path";
import { isInside, repoRootOf, resolveThroughLinks } from "./paths";

export type HealthWho = "mom" | "dad";
export const WHO_LABEL: Record<HealthWho, string> = { mom: "妈妈", dad: "爸爸" };

export interface HealthRecordConfig {
  repo: string; // real path of the repository; nothing under it may ever be written
  root: string; // private data root: <root>/ledger, <root>/originals, <root>/thumbs
  allowedOrigins: string[]; // extra exact origins accepted for writes (same-origin is always accepted)
}

export type ConfigResult = { ok: true; config: HealthRecordConfig } | { ok: false; reason: string };

/** Config problems are reported by name only; values (credentials, paths) are never echoed. */
export function loadHealthRecordConfig(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): ConfigResult {
  const root = env.HEALTH_RECORD_ROOT?.trim();
  if (!root) return { ok: false, reason: "HEALTH_RECORD_ROOT is not set" };
  if (!path.isAbsolute(root)) return { ok: false, reason: "HEALTH_RECORD_ROOT must be an absolute path" };
  let repo: string, real: string;
  try { repo = repoRootOf(cwd); real = resolveThroughLinks(root); } catch { return { ok: false, reason: "HEALTH_RECORD_ROOT could not be resolved" }; }
  if (isInside(real, repo)) return { ok: false, reason: "HEALTH_RECORD_ROOT resolves inside the repository (after following links); it must be outside" };
  const allowedOrigins = (env.HEALTH_RECORD_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return { ok: true, config: { repo, root: real, allowedOrigins } };
}
