// Health module access. There is NO health-specific account, password or session: the health page, its API, hospital originals and
// the entry endpoints are reachable like the rest of the site (Teddy decided this on 2026-09-21: 「病历数据允许公开访问」).
// "妈妈 / 爸爸" is only the ENTRY PERSON a writer picks (sent as the X-Health-Entry-By header): it is recorded as declared, it is not a
// verified identity and must never be presented as one. What stays: writes must come from this site's own pages (same-origin check),
// input validation, corrections history, duplicate-submit protection and the ledger's write lock.
import type { HealthRecordConfig, HealthWho } from "./config";

export const ENTRY_BY_HEADER = "x-health-entry-by";

/** The declared entry person of a write request, or null when the header is missing/invalid. Not an authenticated identity. */
export function entryBy(req: Request): HealthWho | null {
  const v = req.headers.get(ENTRY_BY_HEADER);
  return v === "mom" || v === "dad" ? v : null;
}

/** Writes must come from this site's own pages: the Origin header has to match the request host (or an allow-listed origin). */
export function sameOrigin(cfg: HealthRecordConfig, req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  if (cfg.allowedOrigins.includes(origin)) return true;
  let host: string;
  try { host = new URL(origin).host; } catch { return false; }
  const want = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return host === want;
}
