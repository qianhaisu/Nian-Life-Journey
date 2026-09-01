import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function positiveLimit(value, name, maximum) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`${name.toUpperCase()}_INVALID`);
  return parsed;
}

function safeErrorCode(error) {
  const value = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_:-]{0,63}$/.test(value) ? value : "WECHAT_WORKER_FAILED";
}

function redactedReport(report, mode) {
  return {
    mode,
    status: report.status,
    safeErrorCode: report.safeErrorCode,
    createdMessages: report.createdMessages,
    reusedMessages: report.reusedMessages,
    createdMediaAssets: report.createdMediaAssets,
    reusedMediaAssets: report.reusedMediaAssets,
    createdMediaLocations: report.createdMediaLocations,
    reusedMediaLocations: report.reusedMediaLocations,
    uploadedObjects: report.uploadedObjects,
    reusedObjects: report.reusedObjects,
    uploadedBytes: report.uploadedBytes,
    warningCounts: report.warningCounts,
  };
}

function redactedCapacityAudit(audit) {
  return { mode: "capacity-audit", status: "ok", ...audit };
}

function rejectedReport(safeErrorCode) {
  return { status: "rejected", safeErrorCode, createdMessages: 0, reusedMessages: 0, createdMediaAssets: 0, reusedMediaAssets: 0, createdMediaLocations: 0, reusedMediaLocations: 0, uploadedObjects: 0, reusedObjects: 0, uploadedBytes: 0, warningCounts: [] };
}

if (hasFlag("--help")) {
  process.stdout.write("Usage: npm run wechat:import -- --source-root <directory> [--profile-id <id>] [--contributor-id <id>] [--task-id <id>] [--conversation-index <n>] [--max-messages <1..200000>] [--max-media <1..200000>] [--full-conversation] [--retry-failed] [--canary]\n       npm run wechat:import -- --source-root <directory> --capacity-audit [--conversation-index <n>] [--max-messages <1..200000>] [--max-media <1..200000>]\nReal imports (not --capacity-audit) require REPOSITORY_BACKEND=postgres to be set explicitly; there is no silent default.\n--conversation-index selects among the deterministically ordered candidate conversations (0-indexed); omit it to keep the existing default (index 0).\n--retry-failed also resumes a task that was gracefully cancelled (pass the same --task-id); already-completed messages and media are never re-created or re-uploaded.\n");
  process.exit(0);
}

// Real writes must never land in the local JSON store by accident: the app-wide default backend
// is "json" (see lib/db/config.ts), which is correct for local web-app dev but wrong for a real
// WeChat import. Capacity-audit never persists anything, so it's exempt from this check.
function assertPostgresBackendForRealImport() {
  const raw = (process.env.REPOSITORY_BACKEND ?? "").trim().toLowerCase();
  if (raw !== "postgres") throw new Error("WECHAT_BACKEND_NOT_SPECIFIED");
  if (!process.env.DATABASE_URL) throw new Error("WECHAT_DATABASE_URL_MISSING");
  process.stdout.write("backend=postgres\n");
}

try {
  const sourceRoot = option("--source-root");
  if (!sourceRoot) throw new Error("WECHAT_SOURCE_ROOT_REQUIRED");
  const canary = hasFlag("--canary");
  const capacityAudit = hasFlag("--capacity-audit");
  const fullConversation = hasFlag("--full-conversation");
  if (canary && capacityAudit) throw new Error("WECHAT_MODE_CONFLICT");
  if (fullConversation && (canary || capacityAudit)) throw new Error("WECHAT_MODE_CONFLICT");
  const conversationIndexValue = option("--conversation-index") !== undefined ? Number(option("--conversation-index")) : undefined;
  if (conversationIndexValue !== undefined && (!Number.isInteger(conversationIndexValue) || conversationIndexValue < 0)) throw new Error("CONVERSATION_INDEX_INVALID");
  if (capacityAudit) {
    const maxMessages = positiveLimit(option("--max-messages"), "max_messages", 200_000) ?? 100;
    const maxMedia = positiveLimit(option("--max-media"), "max_media", 200_000) ?? 20;
    const { auditWechatCapacity } = await import("../lib/ingest/wechat-snapshot.ts");
    const audit = await auditWechatCapacity(sourceRoot, { maxMessages, maxMedia, conversationIndex: conversationIndexValue });
    process.stdout.write(`${JSON.stringify(redactedCapacityAudit(audit))}\n`);
  } else {
    assertPostgresBackendForRealImport();
    const { loadWechatBundle } = await import("../lib/ingest/wechat-snapshot.ts");
    const { runWechatImportWorker } = await import("../lib/ingest/wechat-worker.ts");
    let maxMessages, maxMedia;
    if (canary) { maxMessages = 100; maxMedia = 20; }
    else if (fullConversation) {
      // Discover the selected conversation's true size with a cheap pass (no media hashing beyond
      // the floor caps), then re-request exactly that many messages/media refs so nothing is
      // truncated — no arbitrary "big enough" sentinel that could still clip an even larger export.
      const probe = await loadWechatBundle(sourceRoot, { maxMessages: 1, maxMedia: 1, conversationIndex: conversationIndexValue });
      maxMessages = Math.max(probe.availableMessageCount, 1);
      maxMedia = Math.max(probe.availableMediaRefCount, 1);
    } else {
      maxMessages = positiveLimit(option("--max-messages"), "max_messages", 200_000) ?? 100;
      maxMedia = positiveLimit(option("--max-media"), "max_media", 200_000) ?? 20;
    }
    const messageBatchSize = option("--message-batch-size") !== undefined ? Number(option("--message-batch-size")) : undefined;
    const mediaConcurrency = option("--media-concurrency") !== undefined ? Number(option("--media-concurrency")) : undefined;
    const report = await runWechatImportWorker({
      sourceRoot,
      profileId: option("--profile-id") || "profile-zhangnian",
      contributorId: option("--contributor-id") || "contributor-system",
      taskId: option("--task-id"),
      maxMessages,
      maxMedia,
      conversationIndex: conversationIndexValue,
      retryFailed: hasFlag("--retry-failed"),
      messageBatchSize,
      mediaConcurrency,
    });
    process.stdout.write(`${JSON.stringify(redactedReport(report, canary ? "canary" : fullConversation ? "full-conversation" : "import"))}\n`);
    if (report.status === "failed" || report.status === "rejected") process.exitCode = 1;
    if (report.status === "busy") process.exitCode = 2;
  }
} catch (error) {
  const errorCode = safeErrorCode(error);
  if (hasFlag("--capacity-audit")) process.stdout.write(`${JSON.stringify({ mode: "capacity-audit", ...rejectedReport(errorCode) })}\n`);
  else process.stdout.write(`${JSON.stringify(redactedReport(rejectedReport(errorCode), hasFlag("--canary") ? "canary" : "import"))}\n`);
  process.exitCode = 1;
}
