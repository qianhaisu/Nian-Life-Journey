// HEALTH-03 configuration. Everything is explicit: no configured root, no secret or no parent credentials = the feature is OFF.
// It never falls back to an existing ledger, a business database or a public repository directory.
import path from "node:path";
import { isInside, repoRootOf, resolveThroughLinks } from "./paths";

export type HealthWho = "mom" | "dad";
export const WHO_LABEL: Record<HealthWho, string> = { mom: "妈妈", dad: "爸爸" };

export interface HealthRecordConfig {
  repo: string; // real path of the repository; nothing under it may ever be written
  root: string; // private data root: <root>/ledger, <root>/originals, <root>/thumbs
  secret: string; // signs session cookies
  passwords: Record<HealthWho, string>;
  secure: boolean; // cookie Secure flag (production)
  allowedOrigins: string[]; // extra exact origins accepted for writes (same-origin is always accepted)
  sessionMaxAgeSec: number;
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
  const secret = env.HEALTH_RECORD_SESSION_SECRET ?? "";
  if (secret.length < 32) return { ok: false, reason: "HEALTH_RECORD_SESSION_SECRET must be at least 32 characters" };
  const mom = env.HEALTH_RECORD_MOM_PASSWORD ?? "";
  const dad = env.HEALTH_RECORD_DAD_PASSWORD ?? "";
  if (mom.length < 8 || dad.length < 8) return { ok: false, reason: "HEALTH_RECORD_MOM_PASSWORD and HEALTH_RECORD_DAD_PASSWORD must each be at least 8 characters" };
  if (mom === dad) return { ok: false, reason: "the two parent credentials must differ" };
  const allowedOrigins = (env.HEALTH_RECORD_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const secure = env.HEALTH_RECORD_COOKIE_SECURE ? env.HEALTH_RECORD_COOKIE_SECURE === "1" : env.NODE_ENV === "production";
  return { ok: true, config: { repo, root: real, secret, passwords: { mom, dad }, secure, allowedOrigins, sessionMaxAgeSec: 8 * 3600 } };
}
