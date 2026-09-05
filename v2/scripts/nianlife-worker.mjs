#!/usr/bin/env node
// Nianlife daily worker — incremental WeChat import + Organizer + month review.
//
// WINDOWS TASK SCHEDULER SETUP (run from an Administrator command prompt):
//
//   schtasks /create ^
//     /tn "Nianlife Daily Worker" ^
//     /tr "\"C:\Program Files\nodejs\node.exe\" --import tsx scripts\nianlife-worker.mjs" ^
//     /sc DAILY /st 03:00 /f ^
//     /sd 2026-09-06
//   (No /ru needed — runs as the current user. Adjust /st for desired run time.)
//
// Or via Task Scheduler GUI:
//   Create Basic Task > Triggers: Daily 03:00
//   Action: Start a program
//     Program/script: C:\Program Files\nodejs\node.exe
//     Arguments:      --import tsx scripts\nianlife-worker.mjs
//     Start in:       C:\Users\teddy\Documents\Nianlife\v2
//
// What this does per run:
//   1. Incremental WeChat import from E:\WechatHis (since last successful run)
//   2. Organizer: for months with new raw_sources, run organizer-month-write --commit
//   3. Month review: for affected months, run month-review --commit
//   4. Log written to v2/.data/worker-runs/<timestamp>.log
//
// State: v2/.data/worker-state.json — updated only after a successful run.
// Excluded conversations: read from v2/.data/wechat-import-all-state.json (the .excluded array).
//
// Idempotent: re-running never duplicates data. Already-imported messages are counted as
// "reused". Already-organized windows are skipped (organizer fingerprint check). Repeating
// month-review overwrites the existing snapshot (persistMonthlySnapshot is an upsert).
//
// Source root is E:\WechatHis (not E:\WechatHis\texts — see STATE.md §3 for why).

import path from "node:path";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

// Load env before any module that reads it at import time.
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

const { loadWechatBundle } = await import("../lib/ingest/wechat-snapshot.ts");
const { runWechatImportWorker } = await import("../lib/ingest/wechat-worker.ts");

// ── Constants ─────────────────────────────────────────────────────────────────

const BIRTH_DAY = "2025-01-03";
const SOURCE_ROOT = "E:\\WechatHis";
const PROFILE_ID = "profile-zhangnian";
const CONTRIBUTOR_ID = "contributor-system";
const CONVERSATION_LIMIT = 64;

const WORKER_STATE_PATH = path.resolve(process.cwd(), ".data/worker-state.json");
const IMPORT_STATE_PATH = path.resolve(process.cwd(), ".data/wechat-import-all-state.json");
const SITE_URL = "https://nianlife.cn";

// ── Env validation ────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!dbUrl) {
  process.stderr.write("[worker] DATABASE_URL is missing — check .env.local\n");
  process.exit(1);
}
if (!process.env.DEEPSEEK_API_KEY) {
  process.stderr.write("[worker] DEEPSEEK_API_KEY is missing — check .env.local\n");
  process.exit(1);
}

// ── Logging ───────────────────────────────────────────────────────────────────

const runTimestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logDir = path.resolve(process.cwd(), ".data/worker-runs");
mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, `${runTimestamp}.log`);

const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function log(msg) {
  const line = `[${stamp()}] ${msg}`;
  process.stdout.write(line + "\n");
  appendFileSync(logPath, line + "\n", "utf8");
}

// ── State ─────────────────────────────────────────────────────────────────────

function readWorkerState() {
  try {
    return JSON.parse(readFileSync(WORKER_STATE_PATH, "utf8"));
  } catch {
    return { lastRunAt: null };
  }
}

function writeWorkerState(state) {
  mkdirSync(path.dirname(WORKER_STATE_PATH), { recursive: true });
  writeFileSync(WORKER_STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function readImportExcluded() {
  try {
    const s = JSON.parse(readFileSync(IMPORT_STATE_PATH, "utf8"));
    return new Set(s.excluded ?? []);
  } catch {
    return new Set();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeErrorInfo(error) {
  const code = (error && (error.code || error.name)) || "UNKNOWN_ERROR";
  let message = error instanceof Error ? error.message : String(error);
  // Never log a connection string or credentials.
  message = message.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+@[^\s]+/gi, "[redacted]");
  return { code, message };
}

function spawnChild(label, scriptArgs) {
  return new Promise((resolve) => {
    const nodeArgs = ["--import", "tsx", ...scriptArgs];
    log(`[${label}] ▶ node ${nodeArgs.join(" ")}`);
    const child = spawn(process.execPath, nodeArgs, {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Line-buffered relay: keep partial last line until the next chunk or close.
    let partial = "";
    function relay(chunk, isFinal = false) {
      partial += chunk.toString();
      const lines = partial.split("\n");
      partial = isFinal ? "" : (lines.pop() ?? "");
      for (const line of lines) {
        if (line.trim()) log(`  [${label}] ${line}`);
      }
    }
    child.stdout.on("data", (d) => relay(d));
    child.stderr.on("data", (d) => relay(d));
    child.on("close", (code) => {
      relay("", true);
      if (code !== 0) {
        log(`[${label}] ✗ exited ${code}`);
        resolve(false);
      } else {
        log(`[${label}] ✓ ok`);
        resolve(true);
      }
    });
    child.on("error", (e) => {
      log(`[${label}] spawn error: ${e.message}`);
      resolve(false);
    });
  });
}

async function revalidateAffectedMonths(months) {
  const token = process.env.INGESTION_TOKEN;
  if (!token) {
    log("[revalidate] INGESTION_TOKEN not set — skipping (pages will still update within 300s ISR)");
    return;
  }

  const paths = new Set(["/", "/memory"]);
  for (const month of months) {
    const [year] = month.split("-");
    paths.add(`/memory/${year}`);
    paths.add(`/memory/${month.replace("-", "/")}`);
  }
  const pathList = [...paths].slice(0, 50);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(`${SITE_URL}/api/internal/revalidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paths: pathList }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      log(`[revalidate] request failed: ${response.status} ${text.slice(0, 200)}`);
      return;
    }
    log(`[revalidate] ok — revalidated ${pathList.length} path(s): ${pathList.join(", ")}`);
  } catch (error) {
    const info = safeErrorInfo(error);
    log(`[revalidate] threw ${info.code}: ${info.message} — pages still fall back to 300s ISR`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

// ── CLI overrides (for bounded manual test runs — never used by the scheduled task) ────
//
//   --since=YYYY-MM-DD    override the computed "import since" lower bound
//   --max-messages=N      cap messages/media processed per conversation
//   --limit=N             stop the conversation loop once total created+reused messages reach N
//   --no-state-update     don't advance worker-state.json's lastRunAt (keeps the real
//                          incremental cursor intact so a bounded test run never causes
//                          the next scheduled full run to skip a backlog)
function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}
const CLI_SINCE = argValue("since");
const CLI_MAX_MESSAGES = argValue("max-messages") ? Number(argValue("max-messages")) : null;
const CLI_LIMIT = argValue("limit") ? Number(argValue("limit")) : null;
const CLI_NO_STATE_UPDATE = process.argv.includes("--no-state-update");

async function main() {
  const runStartedAt = new Date();
  log(`nianlife-worker v1 starting · log: ${logPath}`);
  if (CLI_SINCE || CLI_MAX_MESSAGES || CLI_LIMIT || CLI_NO_STATE_UPDATE) {
    log(
      `[bounded test run] since=${CLI_SINCE ?? "(default)"} max-messages=${CLI_MAX_MESSAGES ?? "(none)"}` +
        ` limit=${CLI_LIMIT ?? "(none)"} no-state-update=${CLI_NO_STATE_UPDATE}`,
    );
  }

  const workerState = readWorkerState();
  // On the first run, import everything since birth day. On subsequent runs, use the
  // last successful run's timestamp as the lower bound (messages before it are already
  // in the DB and will be counted as "reused", which is fine — the import is idempotent).
  const importSince =
    CLI_SINCE ??
    (workerState.lastRunAt
      ? new Date(workerState.lastRunAt).toISOString().slice(0, 10)
      : BIRTH_DAY);
  log(`import since: ${importSince}${workerState.lastRunAt ? " (last successful run)" : " (first run — full import)"}`);

  const excluded = readImportExcluded();
  log(`excluded conversation digests: ${excluded.size}`);

  // ── Phase 1: Incremental WeChat import ────────────────────────────────────

  log("=== Phase 1: WeChat import ===");
  const totals = {
    conversations: 0,
    created: 0,
    reused: 0,
    mediaCreated: 0,
    mediaReused: 0,
    failed: 0,
  };

  for (let index = 0; index < CONVERSATION_LIMIT; index += 1) {
    let probe;
    try {
      probe = await loadWechatBundle(SOURCE_ROOT, {
        maxMessages: 1,
        maxMedia: 1,
        conversationIndex: index,
        since: importSince,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "WECHAT_NO_VALID_SESSION") {
        log(`conversation ${index}: no more sessions — ${index} conversation(s) scanned`);
        break;
      }
      throw error;
    }

    totals.conversations += 1;
    const digest = probe.bundle.exportSnapshot.conversationDigest;

    if (excluded.has(digest)) {
      log(`conversation ${index}: excluded — skipped`);
      continue;
    }

    const messages = CLI_MAX_MESSAGES
      ? Math.min(probe.availableMessageCount, CLI_MAX_MESSAGES)
      : probe.availableMessageCount;
    const mediaRefs = CLI_MAX_MESSAGES
      ? Math.min(probe.availableMediaRefCount, CLI_MAX_MESSAGES)
      : probe.availableMediaRefCount;

    if (messages === 0) {
      log(`conversation ${index}: 0 messages since ${importSince} — nothing to import`);
      continue;
    }

    log(`conversation ${index}: ${messages} message(s), ${mediaRefs} media ref(s)`);

    let report;
    try {
      report = await runWechatImportWorker({
        sourceRoot: SOURCE_ROOT,
        profileId: PROFILE_ID,
        contributorId: CONTRIBUTOR_ID,
        maxMessages: Math.max(messages, 1),
        maxMedia: Math.max(mediaRefs, 1),
        conversationIndex: index,
        since: importSince,
        retryFailed: true,
      });
    } catch (error) {
      const info = safeErrorInfo(error);
      totals.failed += 1;
      log(`conversation ${index}: threw ${info.code} (${info.message}) — will retry next run`);
      continue;
    }

    const ok =
      report.status === "completed" || report.status === "completed_with_warnings";
    log(
      `conversation ${index}: ${report.status}` +
        ` · msgs +${report.createdMessages} / reused ${report.reusedMessages}` +
        ` · media +${report.createdMediaAssets} / reused ${report.reusedMediaAssets}` +
        (report.safeErrorCode ? ` (${report.safeErrorCode})` : ""),
    );

    totals.created += report.createdMessages;
    totals.reused += report.reusedMessages;
    totals.mediaCreated += report.createdMediaAssets;
    totals.mediaReused += report.reusedMediaAssets;
    if (!ok) {
      totals.failed += 1;
      log(`conversation ${index}: not fully completed — will retry next run`);
    }

    if (CLI_LIMIT && totals.created + totals.reused >= CLI_LIMIT) {
      log(`[bounded test run] reached --limit=${CLI_LIMIT} (created+reused) — stopping import phase early`);
      break;
    }
  }

  log(
    `import phase done` +
      ` · msgs +${totals.created} / reused ${totals.reused}` +
      ` · media +${totals.mediaCreated} / reused ${totals.mediaReused}` +
      ` · failed conversations: ${totals.failed}`,
  );

  // ── Phase 2: Find affected months ─────────────────────────────────────────

  let affectedMonths = [];

  if (totals.created === 0 && totals.mediaCreated === 0) {
    log("=== Phase 2-4: no new rows created — skipping organizer and review ===");
  } else {
    log("=== Phase 2: querying affected months ===");
    const pool = new pg.Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
    try {
      const result = await pool.query(
        `SELECT DISTINCT
           to_char(date_trunc('month', captured_at AT TIME ZONE 'Asia/Shanghai'), 'YYYY-MM') AS month
         FROM raw_sources
         WHERE profile_id = $1
           AND source_type = 'wechat'
           AND deleted_at IS NULL
           AND created_at >= $2::timestamptz
         ORDER BY month`,
        [PROFILE_ID, runStartedAt.toISOString()],
      );
      affectedMonths = result.rows.map((r) => r.month);
    } finally {
      await pool.end();
    }
    log(`affected months (${affectedMonths.length}): ${affectedMonths.join(", ") || "none"}`);
  }

  // ── Phase 3: Organizer ────────────────────────────────────────────────────

  if (affectedMonths.length > 0) {
    log("=== Phase 3: Organizer ===");
    for (const month of affectedMonths) {
      // organizer-month-write.mjs refuses to write --out inside the repo. Use OS temp dir.
      const outPath = path.join(tmpdir(), `nianlife-organizer-${month}-${Date.now()}.json`);
      await spawnChild(`organizer:${month}`, [
        "scripts/organizer-month-write.mjs",
        `--month=${month}`,
        "--commit",
        `--out=${outPath}`,
      ]);
      // The out file contains private chat content — delete it immediately.
      try {
        unlinkSync(outPath);
      } catch {
        // Already deleted or never written (dry run / early exit). Either way fine.
      }
    }
  }

  // ── Phase 4: Month review ─────────────────────────────────────────────────

  if (affectedMonths.length > 0) {
    log("=== Phase 4: Month review ===");
    for (const month of affectedMonths) {
      await spawnChild(`review:${month}`, [
        "scripts/month-review.mjs",
        `--month=${month}`,
        "--commit",
      ]);
    }
  }

  // ── Phase 5: Revalidate ───────────────────────────────────────────────────
  //
  // Public pages are ISR (revalidate=300s). Without an explicit poke, a family member
  // could wait up to 5 minutes after this run to see new content. Best-effort: a failure
  // here must never fail the run — the import/organizer/review work already landed in the DB.

  if (affectedMonths.length > 0) {
    log("=== Phase 5: Revalidate ===");
    await revalidateAffectedMonths(affectedMonths);
  }

  // ── Done ──────────────────────────────────────────────────────────────────

  const durationSec = Math.round((Date.now() - runStartedAt.getTime()) / 1000);
  log("=== Worker complete ===");
  log(`duration: ${durationSec}s`);
  log(`new messages: +${totals.created} · new media: +${totals.mediaCreated}`);
  log(`organizer+review months: ${affectedMonths.length}`);
  if (totals.failed > 0) {
    log(`WARN: ${totals.failed} conversation(s) failed — will retry on next run`);
  }

  // Advance lastRunAt so the next run starts from here. We still update even if some
  // conversations failed — those will retry from this point, and messages already imported
  // will come back as "reused" (idempotent).
  if (CLI_NO_STATE_UPDATE) {
    log("[bounded test run] --no-state-update set — worker-state.json left untouched");
  } else {
    writeWorkerState({ lastRunAt: runStartedAt.toISOString() });
    log(`worker-state.json → lastRunAt: ${runStartedAt.toISOString()}`);
  }
  log(`log file: ${logPath}`);
}

main().catch((error) => {
  const info = safeErrorInfo(error);
  const msg = `[FATAL] ${info.code}: ${info.message}`;
  process.stderr.write(msg + "\n");
  try {
    appendFileSync(logPath, msg + "\n", "utf8");
  } catch {
    // If we can't write the log, at least stderr made it out.
  }
  process.exit(1);
});
