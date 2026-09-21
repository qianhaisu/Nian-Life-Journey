// Independent health session (NOT a site-wide login project): mom / dad each have a server-configured credential.
// A verified login issues a short-lived HttpOnly, SameSite=Strict cookie (Secure in production). The author of every
// write comes from this session, never from the request body.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { WHO_LABEL, type HealthRecordConfig, type HealthWho } from "./config";

export const COOKIE = "hr_session";
const digest = (s: string) => createHash("sha256").update(s).digest();
const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export interface Session { who: HealthWho; label: string; exp: number }

const sign = (cfg: HealthRecordConfig, body: string) => createHmac("sha256", cfg.secret).update(body).digest("base64url");

export function issueSession(cfg: HealthRecordConfig, who: HealthWho, nowMs = Date.now()): { token: string; setCookie: string } {
  const exp = Math.floor(nowMs / 1000) + cfg.sessionMaxAgeSec;
  const body = b64(JSON.stringify({ w: who, exp }));
  const token = `${body}.${sign(cfg, body)}`;
  return { token, setCookie: `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${cfg.sessionMaxAgeSec}${cfg.secure ? "; Secure" : ""}` };
}
export const clearCookie = (cfg: HealthRecordConfig) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cfg.secure ? "; Secure" : ""}`;

export function readSession(cfg: HealthRecordConfig, cookieHeader: string | null | undefined, nowMs = Date.now()): Session | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [body, mac] = raw.split(".");
  if (!body || !mac) return null;
  const want = Buffer.from(sign(cfg, body)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { w?: string; exp?: number };
    if ((p.w !== "mom" && p.w !== "dad") || typeof p.exp !== "number" || p.exp * 1000 < nowMs) return null;
    return { who: p.w, label: WHO_LABEL[p.w], exp: p.exp };
  } catch { return null; }
}

export function passwordMatches(cfg: HealthRecordConfig, who: HealthWho, given: string): boolean {
  return timingSafeEqual(digest(cfg.passwords[who]), digest(given));
}

/** Crude in-memory brake on password guessing (single-process service): 5 failures per parent -> 5 minutes. */
export class LoginBrake {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(private max = 5, private lockMs = 5 * 60_000) {}
  blocked(who: string, now = Date.now()) { const f = this.fails.get(who); return !!f && f.until > now; }
  fail(who: string, now = Date.now()) { const f = this.fails.get(who) ?? { n: 0, until: 0 }; f.n += 1; if (f.n >= this.max) { f.until = now + this.lockMs; f.n = 0; } this.fails.set(who, f); }
  ok(who: string) { this.fails.delete(who); }
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
