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

import { messagesFetch, modelKey } from "../lib/organizer/glm-messages.mjs";
import path from "node:path";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
  unlinkSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { config as loadDotenv } from "dotenv";
import pg from "pg";

// Load env before any module that reads it at import time.
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

const { loadWechatBundle } = await import("../lib/ingest/wechat-snapshot.ts");
const { runWechatImportWorker } = await import("../lib/ingest/wechat-worker.ts");
const { buildArchiveIndex, classifyDocumentMessages, commitReservation, releaseReservation, shanghaiDateDaysAgo } = await import("../lib/ingest/wechat-content-dedupe.ts");

// ── Constants ─────────────────────────────────────────────────────────────────

const BIRTH_DAY = "2025-01-03";
const SOURCE_ROOT = "E:\\WechatHis";
const PROFILE_ID = "profile-zhangnian";
const CONTRIBUTOR_ID = "contributor-system";
const CONVERSATION_LIMIT = 64;

let WORKER_STATE_PATH = path.resolve(process.cwd(), ".data/worker-state.json");
const IMPORT_STATE_PATH = path.resolve(process.cwd(), ".data/wechat-import-all-state.json");
const SITE_URL = "https://nianlife.cn";

// ── Env validation ────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!dbUrl) {
  process.stderr.write("[worker] DATABASE_URL is missing — check .env.local\n");
  process.exit(1);
}
if (!modelKey()) {
  process.stderr.write("[worker] model key (ZHIPU_API_KEY) is missing — check .env.local\n");
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

// ── Run ledger (2026-09-13) ───────────────────────────────────────────────────
//
// Appended one line at a time (never buffered) so a killed process still leaves every completed
// step on disk — that is what makes a resume verifiable rather than assumed.
let LEDGER_PATH = null;
function ledger(entry) {
  if (!LEDGER_PATH) return;
  try {
    mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    appendFileSync(LEDGER_PATH, JSON.stringify({ runId: RUN_ID, at: new Date().toISOString(), ...entry }) + "\n", "utf8");
  } catch (error) {
    log("[ledger] write failed: " + safeErrorInfo(error).message);
  }
}

// Failure classification. Not a prettier log line: a resumable pipeline has to know which failures
// mean "try again later" and which mean "stop, a human has to look" — retrying the second kind is
// the空转 this run is explicitly forbidden to do.
function classifyFailure({ error, report }) {
  const raw = report?.safeErrorCode ?? (error && (error.code || (error instanceof Error ? error.message : null))) ?? "UNKNOWN";
  const text = String(raw);
  if (report && (report.status === "rejected" || report.status === "busy")) return { class: "TASK_LEASE_BUSY", code: text, retryable: true };
  if (text === "WECHAT_NO_VALID_SESSION") return { class: "SOURCE_END_OF_LIST", code: text, retryable: false };
  if (["ENOENT", "EPERM", "EBUSY", "EACCES"].includes(text)) return { class: "SOURCE_UNAVAILABLE", code: text, retryable: true };
  if (text.startsWith("WECHAT_SNAPSHOT")) return { class: "SOURCE_CHANGED_MIDRUN", code: text, retryable: true };
  if (text.startsWith("WECHAT_MEDIA_HASH_CHANGED")) return { class: "SOURCE_MEDIA_CONFLICT", code: text, retryable: false };
  if (text.includes("UPLOAD") || text.includes("STORAGE") || text.includes("NoSuchBucket")) return { class: "STORAGE_ERROR", code: text, retryable: true };
  if (text === "PROGRESS_NOT_MONOTONIC") return { class: "TASK_STATE_CONFLICT", code: text, retryable: false };
  if (text === "MAX_ATTEMPTS_EXCEEDED") return { class: "TASK_EXHAUSTED", code: text, retryable: false };
  if (["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "57P01", "53300", "08006", "08003"].includes(text)) return { class: "DB_UNAVAILABLE", code: text, retryable: true };
  return { class: "UNKNOWN", code: text.slice(0, 120), retryable: true };
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

// The ledger records which chat a decision was about without writing the chat's own id into a file:
// the id is the group's real WeChat identifier, and this file is read by other sessions.
const digestOf = (value) => createHash("sha256").update(String(value), "utf8").digest("hex").slice(0, 16);

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

// Added 2026-09-13 (通宵持续更新链路). Each flag below opts OUT of a side effect this run would
// otherwise have, or points the cursor/record somewhere else — no new default behaviour.
//
//   --state=<abs path>   use this cursor file instead of .data/worker-state.json
//   --ledger=<abs path>  append a machine-readable JSONL record here: one line per conversation
//                          and one per run, so a later run (or another session) can answer "what
//                          did the last run do, and where did it stop" without parsing prose.
//   --no-review          skip Phase 4 (month-review --commit). Phase 4 rewrites a month's
//                          monthly_snapshot, which is live reading material — a publication-shaped
//                          side effect an unattended run is not authorised to take.
//   --no-revalidate      skip Phase 5 (ISR poke).
//   --no-organizer       skip Phase 3 (import-only run).
//   --max-organizer-months=N  process at most N affected months in Phase 3/4.
//   --organizer-args=a,b forwarded verbatim to organizer-month-write.mjs (e.g.
//                          --organizer-args=--max-calls=40,--concurrency=6). --self-approve and
//                          --grade are refused here on purpose: an unattended run does not make a
//                          publication decision.
const CLI_STATE_PATH = argValue("state");
const CLI_LEDGER_PATH = argValue("ledger");
const CLI_NO_REVIEW = process.argv.includes("--no-review");
const CLI_NO_REVALIDATE = process.argv.includes("--no-revalidate");
const CLI_NO_ORGANIZER = process.argv.includes("--no-organizer");
const CLI_FORCE = process.argv.includes("--force-all");
// --exclude=<digest,...>  skip these conversation digests for this run, on top of the persistent
// excluded list in .data/wechat-import-all-state.json. Why a flag and not an edit to that file:
// the exclusions this needs are a property of the CURRENT export layout (one chat exported as both
// .md and .json is two "conversations" to this importer, and importing both stores the same
// messages twice under two document identities, which canonicalMessageId cannot dedupe because the
// document path is part of it). That layout can change with the next export, so the choice belongs
// to the run that can see it, written into the ledger, not baked into shared state.
const CLI_EXCLUDE = (argValue("exclude") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
// Added 2026-09-15 (每日增量入口).
//   --since-days=N     rolling window: import since the Shanghai calendar day N days ago. What a
//                        scheduled run uses instead of --since, so a missed day (the machine asleep, the
//                        exporter skipped) is still inside the next run's window.
//   --content-dedupe   import only messages whose (instant, normalized text) is not already in the
//                        archive under ANY wechat label — see lib/ingest/wechat-content-dedupe.ts for
//                        why canonical ids cannot catch the .md/.json overlap WeFlow's daily export creates.
//                        Each conversation is then imported through an exact ordinal allowlist, and a
//                        run that does not account for every selected message counts as failed.
const CLI_SINCE_DAYS = argValue("since-days") !== null ? Number(argValue("since-days")) : null;
const CLI_CONTENT_DEDUPE = process.argv.includes("--content-dedupe");
const CLI_MAX_ORG_MONTHS = argValue("max-organizer-months") ? Number(argValue("max-organizer-months")) : null;
const CLI_ORGANIZER_ARGS = (argValue("organizer-args") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
for (const forbidden of ["--self-approve", "--grade"]) {
  if (CLI_ORGANIZER_ARGS.includes(forbidden)) {
    process.stderr.write("[worker] refusing --organizer-args=" + forbidden + ": an unattended run does not make publication decisions\n");
    process.exit(2);
  }
}
const RUN_ID = "run-" + runTimestamp;
if (CLI_STATE_PATH) WORKER_STATE_PATH = path.resolve(CLI_STATE_PATH);
if (CLI_LEDGER_PATH) LEDGER_PATH = path.resolve(CLI_LEDGER_PATH);

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
    (CLI_SINCE_DAYS !== null ? shanghaiDateDaysAgo(CLI_SINCE_DAYS) : null) ??
    (workerState.lastRunAt
      ? new Date(workerState.lastRunAt).toISOString().slice(0, 10)
      : BIRTH_DAY);
  log(`import since: ${importSince}${workerState.lastRunAt ? " (last successful run)" : " (first run — full import)"}`);

  const excluded = readImportExcluded();
  for (const digest of CLI_EXCLUDE) excluded.add(digest);
  log(`excluded conversation digests: ${excluded.size}` + (CLI_EXCLUDE.length ? ` (${CLI_EXCLUDE.length} from --exclude)` : ""));

  // ── Phase 1: Incremental WeChat import ────────────────────────────────────

  log("=== Phase 1: WeChat import ===");
  const totals = {
    conversations: 0,
    created: 0,
    reused: 0,
    mediaCreated: 0,
    mediaReused: 0,
    failed: 0,
    skipped: 0,
    failureClasses: {},
  };
  // Carried into worker-state.json at the end of the run: one entry per conversation, keyed by
  // conversation digest, holding the resume key that made this run's work a no-op or not.
  const conversationState = { ...(workerState.conversations ?? {}) };

  // ── Content dedupe: the archive as it stands, scoped by real chat ─────────────
  //
  // A message is only ever compared with rows of the SAME chat (lib/ingest/wechat-content-dedupe.ts
  // says why that scope, the sender and the attachments are all required). The archive stores a
  // document-derived `source_label`, not the chat's own id, so the mapping label → sessionKey is
  // built here, from the exports actually on disk: each document states its own chat id, and both of
  // a chat's exports state the same one. Labels no document on disk explains stay UNMAPPED — their
  // rows can only ever make a message ambiguous, never make it look archived.
  let archiveIndex = null;
  const sessionByIndex = new Map();
  const ambiguousTotal = [];
  if (CLI_CONTENT_DEDUPE) {
    const labelToSession = new Map();
    for (let index = 0; index < CONVERSATION_LIMIT; index += 1) {
      let probe;
      try {
        probe = await loadWechatBundle(SOURCE_ROOT, { maxMessages: 1, maxMedia: 1, conversationIndex: index, since: importSince });
      } catch (error) {
        if (error instanceof Error && error.message === "WECHAT_NO_VALID_SESSION") break;
        throw error;
      }
      const label = probe.bundle.conversations[0]?.id;
      if (label && probe.sessionKey) { labelToSession.set(label, probe.sessionKey); sessionByIndex.set(index, probe.sessionKey); }
      else if (label) sessionByIndex.set(index, "");
    }
    const keyPool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, max: 1 });
    let rows;
    try {
      // One day of slack below the window: reading a day more costs nothing, and a row just outside
      // the window that is really the same message would otherwise read as missing.
      ({ rows } = await keyPool.query(
        `SELECT r.id, r.source_label, r.captured_at, r.text,
                r.metadata->>'senderDigest' AS sender_digest,
                r.metadata->'mediaEvidence' AS media_evidence,
                COALESCE(array_agg(a.checksum) FILTER (WHERE a.checksum IS NOT NULL), '{}') AS checksums
           FROM raw_sources r
           LEFT JOIN media m ON m.raw_source_id = r.id
           LEFT JOIN media_assets a ON a.id = m.media_asset_id
          WHERE r.profile_id = $1 AND r.source_type = 'wechat' AND r.deleted_at IS NULL
            AND r.captured_at >= ($2::date - interval '1 day') AT TIME ZONE 'Asia/Shanghai'
          GROUP BY r.id`,
        [PROFILE_ID, importSince.slice(0, 10)],
      ));
    } finally {
      await keyPool.end();
    }
    archiveIndex = buildArchiveIndex(rows.map((row) => ({
      sessionKey: labelToSession.get(row.source_label),
      sentAt: row.captured_at,
      senderDigest: row.sender_digest,
      text: row.text,
      mediaEvidence: row.media_evidence,
      checksums: row.checksums,
      rowId: row.id,
    })));
    log(`content dedupe: ${archiveIndex.rowCount} archived row(s) in window · ${labelToSession.size} chat(s) mapped · ${archiveIndex.unmappedRowCount} row(s) under unmapped chats`);
    ledger({ phase: "import", event: "archive_index_built", rows: archiveIndex.rowCount, mappedChats: labelToSession.size, unmappedRows: archiveIndex.unmappedRowCount, since: importSince });
  }
  ledger({ phase: "run", event: "started", since: importSince, stateFile: WORKER_STATE_PATH, flags: {
    organizer: !CLI_NO_ORGANIZER, review: !CLI_NO_REVIEW, revalidate: !CLI_NO_REVALIDATE,
    maxOrganizerMonths: CLI_MAX_ORG_MONTHS, organizerArgs: CLI_ORGANIZER_ARGS, force: CLI_FORCE,
    noStateUpdate: CLI_NO_STATE_UPDATE, limit: CLI_LIMIT, maxMessages: CLI_MAX_MESSAGES } });

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
        ledger({ phase: "import", event: "end_of_list", conversationIndex: index, scanned: index });
        break;
      }
      throw error;
    }

    totals.conversations += 1;
    const digest = probe.bundle.exportSnapshot.conversationDigest;
    // The resume key: THIS conversation's own transcript content, this conversation, this window.
    //
    // It deliberately does not use rootFingerprint. That hash covers every file under the export
    // root — path, size, mtime and content of all of them — so one chat receiving one new message
    // (or the exporter touching any file at all) changes it for every conversation at once, and a
    // rerun re-walks all thirteen instead of the one that actually moved. Observed on 2026-09-13:
    // the fingerprint changed between two runs ten minutes apart and every cursor entry went stale.
    //
    // contentDigest is the sha256 of this transcript file itself, so the key changes when and only
    // when this conversation's own source changed. The DB's import_batch_id still keys on
    // rootFingerprint (task identity is not this run's to redefine) — that is a coarser key, and
    // being coarser it can only create an extra task row, never skip work that still needs doing.
    const selectedEntry = probe.snapshot.files.find((f) => f.relativePath === probe.selectedDocument);
    const documentDigest = selectedEntry?.contentDigest ?? probe.bundle.exportSnapshot.rootFingerprint;
    const resumeKey = `${documentDigest}|${digest}|${importSince}`;
    const priorOk = (workerState.conversations ?? {})[digest];

    if (excluded.has(digest)) {
      log(`conversation ${index}: excluded — skipped`);
      ledger({ phase: "import", event: "excluded", conversationIndex: index, digest });
      continue;
    }

    if (!CLI_FORCE && priorOk && priorOk.resumeKey === resumeKey && priorOk.status === "ok") {
      log(`conversation ${index}: unchanged since ${priorOk.at} (same export fingerprint + since) — skipped`);
      totals.skipped += 1;
      ledger({ phase: "import", event: "skipped_unchanged", conversationIndex: index, digest, resumeKey, priorAt: priorOk.at });
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
      conversationState[digest] = { resumeKey, status: "ok", at: new Date().toISOString(), created: 0, reused: 0, note: "no messages in window" };
      ledger({ phase: "import", event: "empty_window", conversationIndex: index, digest, resumeKey });
      continue;
    }

    let recordOrdinals;
    let batchKey;
    let reservation;
    if (archiveIndex) {
      const sessionKey = sessionByIndex.get(index);
      if (!sessionKey) {
        // The export does not state which chat it is. Comparing it against anything would be a
        // guess, and importing it blind would duplicate whatever is already there.
        log(`conversation ${index}: export states no chat id — skipped by --content-dedupe, needs a look`);
        ledger({ phase: "import", event: "no_session_key", conversationIndex: index, digest });
        totals.failed += 1;
        totals.failureClasses.NO_SESSION_KEY = (totals.failureClasses.NO_SESSION_KEY ?? 0) + 1;
        continue;
      }
      // Media refs are hashed here (maxMedia = the window's real count) so an attachment can be
      // compared by content, not only by the path it happens to have in this export.
      const full = await loadWechatBundle(SOURCE_ROOT, { maxMessages: Math.max(probe.availableMessageCount, 1), maxMedia: Math.max(probe.availableMediaRefCount, 1), conversationIndex: index, since: importSince });
      const selection = classifyDocumentMessages(full.bundle.messages, archiveIndex, sessionKey);
      if (selection.ambiguous.length > 0) {
        ambiguousTotal.push(...selection.ambiguous.map((item) => ({ conversationIndex: index, digest, ...item })));
        log(`conversation ${index}: ${selection.ambiguous.length} message(s) could not be decided — listed, not imported`);
        ledger({ phase: "import", event: "content_ambiguous", conversationIndex: index, digest, ambiguous: selection.ambiguous });
      }
      if (selection.ordinals.size === 0) {
        log(`conversation ${index}: all ${full.bundle.messages.length} message(s) in window already archived (${selection.alreadyArchived} matched, ${selection.ambiguous.length} undecided) — nothing to import`);
        conversationState[digest] = { resumeKey, status: "ok", at: new Date().toISOString(), created: 0, reused: 0, note: "content already archived" };
        ledger({ phase: "import", event: "content_already_archived", conversationIndex: index, digest, resumeKey, inWindow: full.bundle.messages.length, ambiguous: selection.ambiguous.length });
        continue;
      }
      recordOrdinals = selection.ordinals;
      reservation = selection.reservation;
      batchKey = `content:${[...selection.ordinals].sort((a, b) => a - b).join(",")}`;
      log(`conversation ${index}: content dedupe selected ${selection.ordinals.size} of ${full.bundle.messages.length} (${selection.alreadyArchived} already archived, ${selection.ambiguous.length} undecided)`);
      ledger({ phase: "import", event: "content_selected", conversationIndex: index, digest, sessionKeyDigest: digestOf(sessionKey), selected: selection.ordinals.size, alreadyArchived: selection.alreadyArchived, ambiguous: selection.ambiguous.length });
    }

    log(`conversation ${index}: ${recordOrdinals ? recordOrdinals.size : messages} message(s), ${mediaRefs} media ref(s)`);

    let report;
    try {
      report = await runWechatImportWorker({
        sourceRoot: SOURCE_ROOT,
        profileId: PROFILE_ID,
        contributorId: CONTRIBUTOR_ID,
        maxMessages: Math.max(recordOrdinals ? recordOrdinals.size : messages, 1),
        maxMedia: Math.max(mediaRefs, 1),
        conversationIndex: index,
        since: importSince,
        recordOrdinals,
        batchKey,
        retryFailed: true,
      });
      // An allowlisted import that does not account for every selected message is a silent partial
      // import, the one outcome wechat-import-all.mjs also refuses to call success.
      if (recordOrdinals && (report.status === "completed" || report.status === "completed_with_warnings") && report.createdMessages + report.reusedMessages !== recordOrdinals.size) {
        report = { ...report, status: "failed", safeErrorCode: `CONTENT_BATCH_SHORTFALL_${report.createdMessages + report.reusedMessages}_OF_${recordOrdinals.size}` };
      }
    } catch (error) {
      // Nothing was written, so the reservation must go back: this message may still arrive through
      // a retry or through the other export of the same chat.
      if (reservation) releaseReservation(reservation);
      const info = safeErrorInfo(error);
      const failure = classifyFailure({ error });
      totals.failed += 1;
      totals.failureClasses[failure.class] = (totals.failureClasses[failure.class] ?? 0) + 1;
      log(`conversation ${index}: threw ${info.code} (${info.message}) — class ${failure.class}, ${failure.retryable ? "retryable" : "NOT retryable, needs a look"}`);
      conversationState[digest] = { resumeKey, status: "failed", at: new Date().toISOString(), failure };
      ledger({ phase: "import", event: "failed", conversationIndex: index, digest, resumeKey, failure, message: info.message.slice(0, 200) });
      continue;
    }

    const ok =
      report.status === "completed" || report.status === "completed_with_warnings";
    // Archived means written. Only a successful import turns this document's reservations into
    // occurrences the next document of the same chat is allowed to match against.
    if (reservation && archiveIndex) {
      if (ok) commitReservation(archiveIndex, reservation);
      else releaseReservation(reservation);
    }
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
    if (ok) {
      conversationState[digest] = { resumeKey, status: "ok", at: new Date().toISOString(), created: report.createdMessages, reused: report.reusedMessages, taskId: report.taskId };
    } else {
      const failure = classifyFailure({ report });
      totals.failed += 1;
      totals.failureClasses[failure.class] = (totals.failureClasses[failure.class] ?? 0) + 1;
      log(`conversation ${index}: not fully completed (${failure.class}) — ${failure.retryable ? "will retry next run" : "NOT retryable, needs a look"}`);
      conversationState[digest] = { resumeKey, status: "failed", at: new Date().toISOString(), failure };
    }
    ledger({
      phase: "import", event: ok ? "imported" : "incomplete", conversationIndex: index, digest, resumeKey,
      taskId: report.taskId, status: report.status, safeErrorCode: report.safeErrorCode ?? null,
      createdMessages: report.createdMessages, reusedMessages: report.reusedMessages,
      createdMediaAssets: report.createdMediaAssets, reusedMediaAssets: report.reusedMediaAssets,
      warningCounts: report.warningCounts ?? [],
    });

    if (CLI_LIMIT && totals.created + totals.reused >= CLI_LIMIT) {
      log(`[bounded test run] reached --limit=${CLI_LIMIT} (created+reused) — stopping import phase early`);
      break;
    }
  }

  ledger({ phase: "import", event: "phase_done", conversations: totals.conversations, created: totals.created,
    reused: totals.reused, mediaCreated: totals.mediaCreated, mediaReused: totals.mediaReused,
    skipped: totals.skipped, failed: totals.failed, failureClasses: totals.failureClasses,
    ambiguous: ambiguousTotal.length });
  if (ambiguousTotal.length > 0) {
    log(`content dedupe: ${ambiguousTotal.length} message(s) left undecided — neither imported nor treated as archived; see the ledger`);
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

  if (CLI_NO_ORGANIZER && affectedMonths.length > 0) {
    log("=== Phase 3: skipped (--no-organizer) ===");
    ledger({ phase: "organizer", event: "skipped_by_flag", months: affectedMonths });
  } else if (affectedMonths.length > 0) {
    log("=== Phase 3: Organizer ===");
    const organizerMonths = CLI_MAX_ORG_MONTHS ? affectedMonths.slice(0, CLI_MAX_ORG_MONTHS) : affectedMonths;
    if (organizerMonths.length < affectedMonths.length) {
      log(`[bounded] --max-organizer-months=${CLI_MAX_ORG_MONTHS} — ${affectedMonths.length - organizerMonths.length} month(s) left for the next run`);
      ledger({ phase: "organizer", event: "bounded", processing: organizerMonths, deferred: affectedMonths.slice(organizerMonths.length) });
    }
    for (const month of organizerMonths) {
      // organizer-month-write.mjs refuses to write --out inside the repo. Use OS temp dir.
      const outPath = path.join(tmpdir(), `nianlife-organizer-${month}-${Date.now()}.json`);
      const startedAt = Date.now();
      const okOrganizer = await spawnChild(`organizer:${month}`, [
        "scripts/organizer-month-write.mjs",
        `--month=${month}`,
        "--commit",
        `--out=${outPath}`,
        ...CLI_ORGANIZER_ARGS,
      ]);
      ledger({ phase: "organizer", event: okOrganizer ? "month_done" : "month_failed", month, durationMs: Date.now() - startedAt });
      // The out file contains private chat content — delete it immediately.
      try {
        unlinkSync(outPath);
      } catch {
        // Already deleted or never written (dry run / early exit). Either way fine.
      }
    }
  }

  // ── Phase 4: Month review ─────────────────────────────────────────────────

  if (CLI_NO_REVIEW && affectedMonths.length > 0) {
    log("=== Phase 4: skipped (--no-review) — monthly_snapshot is live reading material, not this run's call ===");
    ledger({ phase: "review", event: "skipped_by_flag", months: affectedMonths });
  } else if (affectedMonths.length > 0) {
    log("=== Phase 4: Month review ===");
    const reviewMonths = CLI_MAX_ORG_MONTHS ? affectedMonths.slice(0, CLI_MAX_ORG_MONTHS) : affectedMonths;
    for (const month of reviewMonths) {
      const startedAt = Date.now();
      const okReview = await spawnChild(`review:${month}`, [
        "scripts/month-review.mjs",
        `--month=${month}`,
        "--commit",
      ]);
      ledger({ phase: "review", event: okReview ? "month_done" : "month_failed", month, durationMs: Date.now() - startedAt });
    }
  }

  // ── Phase 5: Revalidate ───────────────────────────────────────────────────
  //
  // Public pages are ISR (revalidate=300s). Without an explicit poke, a family member
  // could wait up to 5 minutes after this run to see new content. Best-effort: a failure
  // here must never fail the run — the import/organizer/review work already landed in the DB.

  if (CLI_NO_REVALIDATE && affectedMonths.length > 0) {
    log("=== Phase 5: skipped (--no-revalidate) ===");
  } else if (affectedMonths.length > 0) {
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
    writeWorkerState({ version: 2, lastRunAt: runStartedAt.toISOString(), lastRunId: RUN_ID, conversations: conversationState });
    log(`${path.basename(WORKER_STATE_PATH)} → lastRunAt: ${runStartedAt.toISOString()}, ${Object.keys(conversationState).length} conversation cursor(s)`);
  }
  log(`log file: ${logPath}`);
  ledger({ phase: "run", event: "completed", durationSec, created: totals.created, mediaCreated: totals.mediaCreated,
    skipped: totals.skipped, failed: totals.failed, failureClasses: totals.failureClasses,
    affectedMonths, stateAdvanced: !CLI_NO_STATE_UPDATE });
}

main().catch((error) => {
  const info = safeErrorInfo(error);
  const failure = classifyFailure({ error });
  try { ledger({ phase: "run", event: "fatal", failure, message: info.message.slice(0, 200) }); } catch {}
  const msg = `[FATAL] ${info.code}: ${info.message} — class ${failure.class}`;
  process.stderr.write(msg + "\n");
  try {
    appendFileSync(logPath, msg + "\n", "utf8");
  } catch {
    // If we can't write the log, at least stderr made it out.
  }
  process.exit(1);
});
