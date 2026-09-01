import type {
  ChatImportTaskAcknowledgeInput,
  ChatImportTaskClaimInput,
  ChatImportTaskCompletionInput,
  ChatImportTaskCreateInput,
  ChatImportTaskFailureInput,
  ChatImportTaskLeaseInput,
  ChatImportTaskListFilter,
  ChatImportTaskWarningsInput,
} from "./repository-interface";
import type { ChatImportCheckpoint, ChatImportStage, ChatImportTask, ChatImportTaskStatus, ChatImportWarning } from "@/lib/types";
import { newId } from "./repository-interface";

export const DEFAULT_CHAT_IMPORT_STAGE: ChatImportStage = "snapshot_validation";
export const DEFAULT_CHAT_IMPORT_LEASE_MS = 5 * 60 * 1000;
export const DEFAULT_CHAT_IMPORT_MAX_ATTEMPTS = 3;

const stageOrder: ChatImportStage[] = ["snapshot_validation", "bundle_parse", "raw_source_persist", "media_validate", "media_upload", "media_link", "finalize"];
const terminalStatuses = new Set<ChatImportTaskStatus>(["completed", "completed_with_warnings", "failed", "cancelled"]);

export class ChatImportStateError extends Error {
  readonly code: string;

  constructor(code: string, message = code) {
    super(message);
    this.name = "ChatImportStateError";
    this.code = code;
  }
}

function nowValue(now?: string) {
  const value = now ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(value))) throw new ChatImportStateError("INVALID_TIMESTAMP");
  return value;
}

function requireOwner(owner: string) {
  if (!owner || /[\u0000-\u001f\u007f]/.test(owner) || owner.length > 128) throw new ChatImportStateError("INVALID_LEASE_OWNER");
  return owner;
}

export function normalizeWarningCounts(warnings: ChatImportWarning[] | undefined) {
  const counts = new Map<string, number>();
  for (const warning of warnings ?? []) {
    if (!warning || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(warning.code) || !Number.isInteger(warning.count) || warning.count < 0) throw new ChatImportStateError("INVALID_WARNING");
    counts.set(warning.code, (counts.get(warning.code) ?? 0) + warning.count);
  }
  return [...counts.entries()].filter(([, count]) => count > 0).sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count }));
}

export function warningTotal(warnings: ChatImportWarning[]) {
  return warnings.reduce((total, warning) => total + warning.count, 0);
}

export function validateSafeErrorCode(code: string) {
  if (!/^[A-Z][A-Z0-9_:-]{0,63}$/.test(code)) throw new ChatImportStateError("INVALID_SAFE_ERROR_CODE");
}

function findTask(tasks: ChatImportTask[], taskId: string) {
  return tasks.find((task) => task.id === taskId);
}

function assertLease(task: ChatImportTask, leaseOwner: string, now: string) {
  requireOwner(leaseOwner);
  if (task.status !== "running" || task.leaseOwner !== leaseOwner) throw new ChatImportStateError("LEASE_NOT_OWNED");
  if (!task.leaseExpiresAt || Date.parse(task.leaseExpiresAt) <= Date.parse(now)) throw new ChatImportStateError("LEASE_EXPIRED");
}

function assertCheckpointProgress(previous: ChatImportCheckpoint | undefined, next: ChatImportCheckpoint) {
  if (!next.snapshotDigest || /[\u0000\r\n]/.test(next.snapshotDigest) || next.snapshotDigest.length > 128) throw new ChatImportStateError("INVALID_CHECKPOINT");
  if (!Number.isInteger(next.documentOrdinal) || next.documentOrdinal < 0 || !Number.isInteger(next.messageOrdinal) || next.messageOrdinal < 0) throw new ChatImportStateError("INVALID_CHECKPOINT");
  if (next.mediaDigest !== undefined && (!next.mediaDigest || /[\u0000\r\n]/.test(next.mediaDigest) || next.mediaDigest.length > 128)) throw new ChatImportStateError("INVALID_CHECKPOINT");
  if (!previous) return;
  if (previous.snapshotDigest !== next.snapshotDigest) throw new ChatImportStateError("CHECKPOINT_SNAPSHOT_MISMATCH");
  if (next.documentOrdinal < previous.documentOrdinal || (next.documentOrdinal === previous.documentOrdinal && next.messageOrdinal < previous.messageOrdinal)) throw new ChatImportStateError("CHECKPOINT_NOT_MONOTONIC");
  if (next.documentOrdinal === previous.documentOrdinal && next.messageOrdinal === previous.messageOrdinal && previous.mediaDigest && next.mediaDigest && previous.mediaDigest !== next.mediaDigest) throw new ChatImportStateError("CHECKPOINT_MEDIA_MISMATCH");
}

function setStage(task: ChatImportTask, stage: ChatImportStage) {
  if (stageOrder.indexOf(stage) < stageOrder.indexOf(task.currentStage)) throw new ChatImportStateError("STAGE_NOT_MONOTONIC");
  task.currentStage = stage;
  task.phase = stage;
}

export function createChatImportTask(tasks: ChatImportTask[], input: ChatImportTaskCreateInput) {
  const existing = tasks.find((task) => task.importBatchId === input.importBatchId);
  if (existing) return existing;
  if (!input.profileId || !input.importBatchId || /[\u0000\r\n]/.test(input.importBatchId)) throw new ChatImportStateError("INVALID_TASK_IDENTITY");
  const now = nowValue(input.now);
  const maxAttempts = input.maxAttempts ?? DEFAULT_CHAT_IMPORT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) throw new ChatImportStateError("INVALID_MAX_ATTEMPTS");
  const currentStage = input.currentStage ?? DEFAULT_CHAT_IMPORT_STAGE;
  const task: ChatImportTask = { id: input.id ?? newId("chat-import-task"), profileId: input.profileId, importBatchId: input.importBatchId, status: "pending", phase: currentStage, currentStage, processedMessages: 0, createdMessages: 0, reusedMessages: 0, warnings: 0, warningCounts: [], attempt: 0, maxAttempts, createdAt: now, updatedAt: now };
  tasks.push(task);
  return task;
}

export function listChatImportTasks(tasks: ChatImportTask[], filter: ChatImportTaskListFilter = {}) {
  const statuses = filter.status === undefined ? undefined : new Set(Array.isArray(filter.status) ? filter.status : [filter.status]);
  return tasks.filter((task) => (!filter.profileId || task.profileId === filter.profileId) && (!statuses || statuses.has(task.status))).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function claimChatImportTask(tasks: ChatImportTask[], input: ChatImportTaskClaimInput) {
  const owner = requireOwner(input.leaseOwner);
  const now = nowValue(input.now);
  const leaseMs = input.leaseMs ?? DEFAULT_CHAT_IMPORT_LEASE_MS;
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60 * 1000) throw new ChatImportStateError("INVALID_LEASE");
  const candidates = (input.taskId ? tasks.filter((task) => task.id === input.taskId) : tasks).filter((task) => task.status === "pending" || task.status === "retry_pending" || (task.status === "running" && Boolean(task.leaseExpiresAt) && Date.parse(task.leaseExpiresAt!) <= Date.parse(now))).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const task = candidates[0];
  if (!task) return null;
  if (task.attempt >= task.maxAttempts) {
    task.status = "failed";
    task.safeErrorCode = "MAX_ATTEMPTS_EXCEEDED";
    task.leaseOwner = undefined;
    task.leaseExpiresAt = undefined;
    task.completedAt = now;
    task.updatedAt = now;
    return null;
  }
  task.status = "running";
  task.leaseOwner = owner;
  task.leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
  task.attempt += 1;
  task.startedAt ??= now;
  task.updatedAt = now;
  return task;
}

export function heartbeatChatImportTask(tasks: ChatImportTask[], input: ChatImportTaskLeaseInput) {
  const task = findTask(tasks, input.taskId);
  if (!task) return null;
  const now = nowValue(input.now);
  assertLease(task, input.leaseOwner, now);
  const leaseMs = input.leaseMs ?? DEFAULT_CHAT_IMPORT_LEASE_MS;
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 24 * 60 * 60 * 1000) throw new ChatImportStateError("INVALID_LEASE");
  task.leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
  task.updatedAt = now;
  return task;
}

export function saveChatImportCheckpoint(tasks: ChatImportTask[], input: { taskId: string; leaseOwner: string; checkpoint: ChatImportCheckpoint; processedMessages?: number; createdMessages?: number; reusedMessages?: number; warnings?: number; warningCounts?: ChatImportWarning[]; currentStage?: ChatImportStage; now?: string }) {
  const task = findTask(tasks, input.taskId);
  if (!task) return null;
  const now = nowValue(input.now);
  assertLease(task, input.leaseOwner, now);
  assertCheckpointProgress(task.checkpoint, input.checkpoint);
  for (const value of [input.processedMessages, input.createdMessages, input.reusedMessages, input.warnings]) if (value !== undefined && (!Number.isInteger(value) || value < 0)) throw new ChatImportStateError("INVALID_PROGRESS");
  if (input.processedMessages !== undefined && input.processedMessages < task.processedMessages) throw new ChatImportStateError("PROGRESS_NOT_MONOTONIC");
  if (input.createdMessages !== undefined && input.createdMessages < task.createdMessages) throw new ChatImportStateError("PROGRESS_NOT_MONOTONIC");
  if (input.reusedMessages !== undefined && input.reusedMessages < task.reusedMessages) throw new ChatImportStateError("PROGRESS_NOT_MONOTONIC");
  if (input.warnings !== undefined && input.warnings < task.warnings) throw new ChatImportStateError("PROGRESS_NOT_MONOTONIC");
  if (input.warningCounts) {
    const nextWarnings = normalizeWarningCounts(input.warningCounts);
    if (warningTotal(nextWarnings) < task.warnings) throw new ChatImportStateError("PROGRESS_NOT_MONOTONIC");
    task.warningCounts = nextWarnings;
    task.warnings = warningTotal(nextWarnings);
  }
  if (input.currentStage) setStage(task, input.currentStage);
  task.checkpoint = { ...input.checkpoint };
  if (input.processedMessages !== undefined) task.processedMessages = input.processedMessages;
  if (input.createdMessages !== undefined) task.createdMessages = input.createdMessages;
  if (input.reusedMessages !== undefined) task.reusedMessages = input.reusedMessages;
  if (input.warnings !== undefined) task.warnings = input.warnings;
  task.updatedAt = now;
  return task;
}

export function requestChatImportCancel(tasks: ChatImportTask[], taskId: string, nowInput?: string) {
  const task = findTask(tasks, taskId);
  if (!task) return null;
  if (terminalStatuses.has(task.status)) return task;
  const now = nowValue(nowInput);
  task.cancelRequestedAt ??= now;
  task.updatedAt = now;
  return task;
}

export function acknowledgeChatImportCancel(tasks: ChatImportTask[], input: ChatImportTaskAcknowledgeInput) {
  const task = findTask(tasks, input.taskId);
  if (!task) return null;
  if (terminalStatuses.has(task.status)) return task;
  if (!task.cancelRequestedAt) throw new ChatImportStateError("CANCEL_NOT_REQUESTED");
  if (task.status === "running") {
    const now = nowValue(input.now);
    if (!input.leaseOwner) throw new ChatImportStateError("LEASE_NOT_OWNED");
    assertLease(task, input.leaseOwner, now);
    task.completedAt = now;
    task.updatedAt = now;
  } else {
    const now = nowValue(input.now);
    task.completedAt = now;
    task.updatedAt = now;
  }
  task.status = "cancelled";
  task.leaseOwner = undefined;
  task.leaseExpiresAt = undefined;
  return task;
}

export function failChatImportTask(tasks: ChatImportTask[], input: ChatImportTaskFailureInput) {
  const task = findTask(tasks, input.taskId);
  if (!task) return null;
  const now = nowValue(input.now);
  assertLease(task, input.leaseOwner, now);
  validateSafeErrorCode(input.safeErrorCode);
  task.status = "failed";
  task.safeErrorCode = input.safeErrorCode;
  task.leaseOwner = undefined;
  task.leaseExpiresAt = undefined;
  task.completedAt = now;
  task.updatedAt = now;
  return task;
}

export function retryChatImportTask(tasks: ChatImportTask[], taskId: string, nowInput?: string) {
  const task = findTask(tasks, taskId);
  if (!task) return null;
  if (task.status !== "failed" && task.status !== "cancelled") throw new ChatImportStateError("INVALID_RETRY_TRANSITION");
  // A cancelled task was deliberately paused, not failed — resuming it must not consume the
  // failure-retry budget (maxAttempts), and any stale cancelRequestedAt from the prior run must be
  // cleared so the resumed worker's first heartbeat doesn't immediately cancel itself again.
  if (task.status === "failed" && task.attempt >= task.maxAttempts) throw new ChatImportStateError("MAX_ATTEMPTS_EXCEEDED");
  const now = nowValue(nowInput);
  task.status = "retry_pending";
  task.completedAt = undefined;
  task.leaseOwner = undefined;
  task.leaseExpiresAt = undefined;
  task.cancelRequestedAt = undefined;
  task.updatedAt = now;
  return task;
}

function complete(tasks: ChatImportTask[], input: ChatImportTaskCompletionInput, status: "completed" | "completed_with_warnings", warningCounts?: ChatImportWarning[]) {
  const task = findTask(tasks, input.taskId);
  if (!task) return null;
  const now = nowValue(input.now);
  assertLease(task, input.leaseOwner, now);
  if (task.cancelRequestedAt) throw new ChatImportStateError("CANCEL_REQUESTED");
  if (warningCounts) {
    task.warningCounts = normalizeWarningCounts(warningCounts);
    task.warnings = warningTotal(task.warningCounts);
  }
  task.status = status;
  task.leaseOwner = undefined;
  task.leaseExpiresAt = undefined;
  task.completedAt = now;
  task.updatedAt = now;
  return task;
}

export function completeChatImportTask(tasks: ChatImportTask[], input: ChatImportTaskCompletionInput) {
  return complete(tasks, input, "completed");
}

export function completeChatImportWithWarnings(tasks: ChatImportTask[], input: ChatImportTaskWarningsInput) {
  const warnings = normalizeWarningCounts(input.warningCounts);
  if (!warnings.length) throw new ChatImportStateError("WARNINGS_REQUIRED");
  return complete(tasks, input, "completed_with_warnings", warnings);
}
