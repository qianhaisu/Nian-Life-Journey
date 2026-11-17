// Optional mobile webhook notifier (Bark / WeCom / ServerChan / generic webhook).
// Reads C:/Users/teddy/NianlifeOps/ops-daily/weekend.env if present.
// When no channel is configured, returns { sent: false, status: "webhook_not_configured" } honestly.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_WEEKEND_ENV_PATH = path.join(os.homedir(), "NianlifeOps", "ops-daily", "weekend.env");

export function parseWeekendEnvFile(envPath = DEFAULT_WEEKEND_ENV_PATH) {
  const out = {};
  if (!envPath || !fs.existsSync(envPath)) return out;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

export function resolveWebhookConfig({ envPath = DEFAULT_WEEKEND_ENV_PATH, env = process.env } = {}) {
  const fileEnv = parseWeekendEnvFile(envPath);
  const merged = { ...fileEnv, ...env };

  const barkUrl = (merged.WEEKEND_BARK_URL ?? "").trim();
  const wecomUrl = (merged.WEEKEND_WECOM_WEBHOOK_URL ?? "").trim();
  const serverChanUrl = (merged.WEEKEND_SERVERCHAN_URL ?? "").trim();
  const serverChanKey = (merged.WEEKEND_SERVERCHAN_SENDKEY ?? "").trim();
  const genericUrl = (merged.WEEKEND_WEBHOOK_URL ?? "").trim();

  if (barkUrl) return { configured: true, channel: "bark", target: barkUrl };
  if (wecomUrl) return { configured: true, channel: "wecom", target: wecomUrl };
  if (serverChanUrl) return { configured: true, channel: "serverchan", target: serverChanUrl };
  if (serverChanKey) {
    return { configured: true, channel: "serverchan", target: `https://sctapi.ftqq.com/${serverChanKey}.send` };
  }
  if (genericUrl) return { configured: true, channel: "webhook", target: genericUrl };
  return { configured: false, channel: null, target: null };
}

export async function sendWeekendWebhook(
  { title, message, level = "info", weekId = null, event = "notice" },
  { envPath = DEFAULT_WEEKEND_ENV_PATH, env = process.env, fetchImpl = fetch } = {},
) {
  const at = new Date().toISOString();
  const cfg = resolveWebhookConfig({ envPath, env });
  if (!cfg.configured) {
    return {
      sent: false,
      status: "webhook_not_configured",
      channel: null,
      title,
      message,
      weekId,
      event,
      at,
    };
  }

  let url = cfg.target;
  let init;

  if (cfg.channel === "bark") {
    const cleanBase = url.replace(/\/+$/, "");
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ title, body: message, group: "NianlifeWeekend" }),
      signal: AbortSignal.timeout(10_000),
    };
    url = `${cleanBase}/`;
    // Support full Bark URL with `/<key>` or `/push`; if base has key without `/push`, POSTing JSON to `/push` or `/<key>/<title>/<body>`:
    if (!/\/push$/i.test(cleanBase)) {
      url = `${cleanBase}/${encodeURIComponent(title)}/${encodeURIComponent(message)}`;
      init = { method: "GET", signal: AbortSignal.timeout(10_000) };
    }
  } else if (cfg.channel === "wecom") {
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        msgtype: "markdown",
        markdown: { content: `**${title}**\n${message}` },
      }),
      signal: AbortSignal.timeout(10_000),
    };
  } else if (cfg.channel === "serverchan") {
    const form = new URLSearchParams({ title, desp: message });
    init = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      body: form.toString(),
      signal: AbortSignal.timeout(10_000),
    };
  } else {
    init = {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ title, message, level, weekId, event, at }),
      signal: AbortSignal.timeout(10_000),
    };
  }

  try {
    const res = await fetchImpl(url, init);
    return {
      sent: res.ok,
      status: res.ok ? "sent" : `http_${res.status}`,
      channel: cfg.channel,
      httpStatus: res.status,
      title,
      weekId,
      event,
      at,
    };
  } catch (err) {
    return {
      sent: false,
      status: "send_error",
      channel: cfg.channel,
      error: err instanceof Error ? err.message : String(err),
      title,
      weekId,
      event,
      at,
    };
  }
}
