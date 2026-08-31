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
  process.stdout.write("Usage: npm run wechat:import -- --source-root <directory> [--profile-id <id>] [--contributor-id <id>] [--task-id <id>] [--max-messages <1..100>] [--max-media <1..20>] [--retry-failed] [--canary]\n       npm run wechat:import -- --source-root <directory> --capacity-audit [--max-messages <1..100>] [--max-media <1..20>]\n");
  process.exit(0);
}

try {
  const sourceRoot = option("--source-root");
  if (!sourceRoot) throw new Error("WECHAT_SOURCE_ROOT_REQUIRED");
  const canary = hasFlag("--canary");
  const capacityAudit = hasFlag("--capacity-audit");
  if (canary && capacityAudit) throw new Error("WECHAT_MODE_CONFLICT");
  const maxMessages = canary ? 100 : positiveLimit(option("--max-messages"), "max_messages", 100) ?? 100;
  const maxMedia = canary ? 20 : positiveLimit(option("--max-media"), "max_media", 20) ?? 20;
  if (capacityAudit) {
    const { auditWechatCapacity } = await import("../lib/ingest/wechat-snapshot.ts");
    const audit = await auditWechatCapacity(sourceRoot, { maxMessages, maxMedia });
    process.stdout.write(`${JSON.stringify(redactedCapacityAudit(audit))}\n`);
  } else {
    const { runWechatImportWorker } = await import("../lib/ingest/wechat-worker.ts");
    const report = await runWechatImportWorker({
      sourceRoot,
      profileId: option("--profile-id") || "profile-zhangnian",
      contributorId: option("--contributor-id") || "contributor-system",
      taskId: option("--task-id"),
      maxMessages,
      maxMedia,
      retryFailed: hasFlag("--retry-failed"),
    });
    process.stdout.write(`${JSON.stringify(redactedReport(report, canary ? "canary" : "import"))}\n`);
    if (report.status === "failed" || report.status === "rejected") process.exitCode = 1;
    if (report.status === "busy") process.exitCode = 2;
  }
} catch (error) {
  const errorCode = safeErrorCode(error);
  if (hasFlag("--capacity-audit")) process.stdout.write(`${JSON.stringify({ mode: "capacity-audit", ...rejectedReport(errorCode) })}\n`);
  else process.stdout.write(`${JSON.stringify(redactedReport(rejectedReport(errorCode), hasFlag("--canary") ? "canary" : "import"))}\n`);
  process.exitCode = 1;
}
