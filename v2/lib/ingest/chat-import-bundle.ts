import { createHash } from "node:crypto";

export const CHAT_IMPORT_SCHEMA_VERSION = "chat-import-bundle/v1" as const;
export type MediaAvailability = "present" | "missing" | "needs_review" | "invalid" | "hash_changed" | "deferred_by_limit";
export type ChatMessageType = "text" | "image" | "mixed";
export interface ChatMediaRef { id: string; relativePath: string; checksum?: string; availability: MediaAvailability; mimeType?: string; fileSize?: number; width?: number; height?: number; }
export interface ChatMessage { messageId: string; conversationId: string; senderId: string; direction: "unknown"; sentAt: string; messageType: ChatMessageType; text: string; mediaRefs: ChatMediaRef[]; sourceLocator: { document: string; recordOrdinal: number }; occurrenceRank?: number; }
export interface ChatConversation { id: string; name: string; participantIds: string[]; }
export interface ChatImportBundle { schemaVersion: typeof CHAT_IMPORT_SCHEMA_VERSION; parserVersion: string; sourceProvider: "wechat-official-markdown"; sourceTimezone: "Asia/Shanghai"; exportSnapshot: { rootFingerprint: string; conversationDigest: string; capturedAt: string; fileCount: number }; conversations: ChatConversation[]; participants: Array<{ id: string; displayName: string }>; messages: ChatMessage[]; mediaRefs: ChatMediaRef[]; warnings: Array<{ code: string; count: number }>; }

// A batch id must be unique per (export snapshot, selected conversation) pair — two different
// conversations from the same source-root snapshot are two different imports, not the same one,
// and must not collide on (and short-circuit against) the same ChatImportTask row.
// A task is identified by the snapshot, the conversation, and — when the caller scopes the import
// to a date range — that range. Without `since` in the key, one conversation under one export
// snapshot has exactly one task forever, so a narrower re-import inherits the wider run's monotonic
// counters (processedMessages/warnings) and dies on PROGRESS_NOT_MONOTONIC: a partial-range import
// is simply not representable. Scoping the key gives a re-scoped run its own task with its own
// counters and attempt budget. This does NOT touch canonicalMessageId — message identity is
// unchanged, so a re-scoped run still reuses rows it already imported rather than duplicating them.
// Omitting `since` keeps the original, unscoped id, so callers that import whole conversations
// (wechat-import.ts) keep matching the tasks they already created.
export function chatImportBatchId(exportSnapshot: { rootFingerprint: string; conversationDigest: string }, since?: string): string {
  const base = `wechat-import:${exportSnapshot.rootFingerprint}:${exportSnapshot.conversationDigest}`;
  if (since === undefined) return base;
  const parsed = Date.parse(since);
  return `${base}:since=${Number.isNaN(parsed) ? since : new Date(parsed).toISOString()}`;
}

export function canonicalMessageId(input: Omit<ChatMessage, "messageId">, occurrenceRank: number): string {
  const documentDigest = createHash("sha256").update(input.sourceLocator.document.replaceAll("\\", "/"), "utf8").digest("hex");
  const canonical = JSON.stringify({ v: 2, conversation: input.conversationId, sender: input.senderId, sentAt: input.sentAt, type: input.messageType, text: input.text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), attachments: input.mediaRefs.map((m) => ({ pathDigest: createHash("sha256").update(m.relativePath.replaceAll("\\", "/"), "utf8").digest("hex"), checksum: m.checksum ?? null })).sort((a, b) => a.pathDigest.localeCompare(b.pathDigest)), documentDigest, recordOrdinal: input.sourceLocator.recordOrdinal });
  return `canonical:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function validateChatImportBundle(bundle: ChatImportBundle): void {
  if (bundle.schemaVersion !== CHAT_IMPORT_SCHEMA_VERSION) throw new Error("invalid chat bundle schemaVersion");
  if (bundle.sourceProvider !== "wechat-official-markdown" || bundle.sourceTimezone !== "Asia/Shanghai") throw new Error("invalid chat bundle source contract");
  const ids = new Set<string>();
  for (const message of bundle.messages) {
    if (ids.has(message.messageId)) throw new Error("duplicate chat message identity");
    ids.add(message.messageId);
    if (message.direction !== "unknown" || !message.sourceLocator.document || /^(?:[A-Za-z]:[\\/]|\\\\|[a-z][a-z0-9+.-]*:)/i.test(message.sourceLocator.document) || message.sourceLocator.document.split(/[\\/]+/).includes("..") || !Number.isInteger(message.sourceLocator.recordOrdinal) || message.sourceLocator.recordOrdinal < 0) throw new Error("invalid chat message provenance");
    for (const ref of message.mediaRefs) {
      if (!ref.id || /[\u0000\r\n]/.test(ref.relativePath) || /^(?:[A-Za-z]:[\\/]|\\\\|[a-z][a-z0-9+.-]*:)/i.test(ref.relativePath) || ref.relativePath.split(/[\\/]+/).includes("..")) throw new Error("unsafe media reference");
      if (ref.checksum !== undefined && !/^(?:sha256:)?[a-f0-9]{64}$/i.test(ref.checksum)) throw new Error("invalid media checksum");
      if (ref.availability === "present" && !ref.checksum) throw new Error("present media requires checksum");
    }
  }
}
