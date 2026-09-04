// Imports every conversation in a WeChat export root, in one long-running pass.
//
//   npm run wechat:import-all -- --source-root "E:\WechatHis"
//   npm run wechat:import-all -- --source-root "E:\WechatHis" --dry-run
//
// Why this exists as a driver rather than a loop of `wechat:import` calls: a full import is
// measured in hours (media hashing plus R2 uploads), which no interactive or serverless caller can
// hold open. This runs to completion in one process on the machine that holds the export, and is
// safe to kill and re-run — every message carries a content-derived identity, so a repeat is
// counted as `reused` rather than inserted twice.
//
// Boundaries it keeps:
//   - REPOSITORY_BACKEND=postgres is required, exactly as the single-conversation worker requires it.
//   - --since defaults to 张年's birth day: the private conversations run back to 2019, and years
//     that predate the child are not this archive's material.
//   - It enqueues no Organizer work. Import is not organization; what is worth keeping is decided
//     later, by the Organizer and a human review, over material that is already in the archive.
//   - It prints counts, statuses and error codes only — never a message, a name or a file path
//     from the family's conversations.
import path from "node:path";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });

const option = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const hasFlag = (name) => process.argv.includes(name);

const BIRTH_DAY = "2025-01-03";
const STATE_PATH = path.resolve(process.cwd(), ".data/wechat-import-all-state.json");
const CONVERSATION_LIMIT = 64;

function readState() {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf8")); } catch { return { completed: [], startedAt: new Date().toISOString() }; }
}
function writeState(state) {
  mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const log = (message) => process.stdout.write(`[${stamp()}] ${message}\n`);

const sourceRoot = option("--source-root");
if (!sourceRoot) { process.stderr.write("--source-root is required\n"); process.exit(1); }
const since = option("--since") ?? BIRTH_DAY;
const dryRun = hasFlag("--dry-run");
const resetState = hasFlag("--reset-state");
// --only 0,4,5,6 imports just those conversation indices. The rest of the run is untouched, so a
// long import can be taken a conversation at a time when the caller cannot stay open for hours.
const only = option("--only") ? new Set(option("--only").split(",").map((value) => Number(value.trim()))) : undefined;
if (only && [...only].some((value) => !Number.isInteger(value) || value < 0)) { process.stderr.write("--only takes comma-separated non-negative integers\n"); process.exit(1); }

if (!dryRun) {
  if ((process.env.REPOSITORY_BACKEND ?? "").trim().toLowerCase() !== "postgres") { process.stderr.write("REPOSITORY_BACKEND=postgres is required for a real import\n"); process.exit(1); }
  if (!process.env.DATABASE_URL) { process.stderr.write("DATABASE_URL is missing\n"); process.exit(1); }
}

const { loadWechatBundle } = await import("../lib/ingest/wechat-snapshot.ts");
const { runWechatImportWorker } = await import("../lib/ingest/wechat-worker.ts");

const state = resetState ? { completed: [], startedAt: new Date().toISOString() } : readState();
const completed = new Set(state.completed ?? []);
log(`source-root scan starting · since=${since}${dryRun ? " · DRY RUN (nothing is written)" : ""}`);

const totals = { conversations: 0, created: 0, reused: 0, mediaCreated: 0, mediaReused: 0, uploaded: 0, failed: 0 };

for (let index = 0; index < CONVERSATION_LIMIT; index += 1) {
  if (only && !only.has(index)) continue;
  if (completed.has(index)) { log(`conversation ${index}: already completed in an earlier run — skipped`); continue; }
  let probe;
  try {
    probe = await loadWechatBundle(sourceRoot, { maxMessages: 1, maxMedia: 1, conversationIndex: index, since });
  } catch (error) {
    if (error instanceof Error && error.message === "WECHAT_NO_VALID_SESSION") { log(`no conversation at index ${index} — ${index} conversation(s) seen, done scanning`); break; }
    throw error;
  }
  totals.conversations += 1;
  const messages = probe.availableMessageCount;
  const mediaRefs = probe.availableMediaRefCount;
  if (messages === 0) { log(`conversation ${index}: 0 messages at or after ${since} — nothing to import`); completed.add(index); writeState({ ...state, completed: [...completed] }); continue; }

  if (dryRun) {
    log(`conversation ${index}: would import ${messages} message(s), ${mediaRefs} media ref(s)`);
    continue;
  }

  log(`conversation ${index}: importing ${messages} message(s), ${mediaRefs} media ref(s) — this is the slow part`);
  const report = await runWechatImportWorker({
    sourceRoot,
    profileId: option("--profile-id") || "profile-zhangnian",
    contributorId: option("--contributor-id") || "contributor-system",
    maxMessages: Math.max(messages, 1),
    maxMedia: Math.max(mediaRefs, 1),
    conversationIndex: index,
    since,
  });
  const ok = report.status === "completed" || report.status === "completed_with_warnings";
  log(`conversation ${index}: ${report.status}${report.safeErrorCode ? ` (${report.safeErrorCode})` : ""} · messages +${report.createdMessages} / reused ${report.reusedMessages} · media assets +${report.createdMediaAssets} / reused ${report.reusedMediaAssets} · objects uploaded ${report.uploadedObjects}${report.warningCounts?.length ? ` · warnings ${JSON.stringify(report.warningCounts)}` : ""}`);
  totals.created += report.createdMessages; totals.reused += report.reusedMessages;
  totals.mediaCreated += report.createdMediaAssets; totals.mediaReused += report.reusedMediaAssets;
  totals.uploaded += report.uploadedObjects;
  if (ok) { completed.add(index); writeState({ ...state, completed: [...completed], updatedAt: new Date().toISOString() }); }
  else { totals.failed += 1; log(`conversation ${index}: not marked complete — re-run this script to retry it`); }
}

log(`done · conversations seen ${totals.conversations} · messages +${totals.created} (reused ${totals.reused}) · media assets +${totals.mediaCreated} (reused ${totals.mediaReused}) · objects uploaded ${totals.uploaded} · conversations still failing ${totals.failed}`);
if (!dryRun) log(`state file: ${STATE_PATH} (delete it or pass --reset-state to start over)`);
