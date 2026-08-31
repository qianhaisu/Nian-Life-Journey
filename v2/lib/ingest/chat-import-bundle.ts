import { createHash } from "node:crypto";

export const CHAT_IMPORT_SCHEMA_VERSION = "chat-import-bundle/v1" as const;
export type MediaAvailability = "present" | "missing" | "needs_review" | "invalid";
export type ChatMessageType = "text" | "image" | "mixed";
export interface ChatMediaRef { id: string; relativePath: string; checksum?: string; availability: MediaAvailability; }
export interface ChatMessage { messageId: string; conversationId: string; senderId: string; direction: "unknown"; sentAt: string; messageType: ChatMessageType; text: string; mediaRefs: ChatMediaRef[]; sourceLocator: { document: string; recordOrdinal: number }; occurrenceRank?: number; }
export interface ChatConversation { id: string; name: string; participantIds: string[]; }
export interface ChatImportBundle { schemaVersion: typeof CHAT_IMPORT_SCHEMA_VERSION; parserVersion: string; sourceProvider: "wechat-official-markdown"; sourceTimezone: "Asia/Shanghai"; exportSnapshot: { rootFingerprint: string; capturedAt: string; fileCount: number }; conversations: ChatConversation[]; participants: Array<{ id: string; displayName: string }>; messages: ChatMessage[]; mediaRefs: ChatMediaRef[]; warnings: Array<{ code: string; count: number }>; }

export function canonicalMessageId(input: Omit<ChatMessage, "messageId">, occurrenceRank: number): string {
  const canonical = JSON.stringify({ v: 1, conversation: input.conversationId, sender: input.senderId, sentAt: input.sentAt, type: input.messageType, text: input.text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), attachments: input.mediaRefs.map((m) => ({ path: m.relativePath, checksum: m.checksum ?? null })).sort((a, b) => a.path.localeCompare(b.path)), occurrenceRank });
  return `canonical:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

export function validateChatImportBundle(bundle: ChatImportBundle): void {
  if (bundle.schemaVersion !== CHAT_IMPORT_SCHEMA_VERSION) throw new Error("invalid chat bundle schemaVersion");
  if (bundle.sourceProvider !== "wechat-official-markdown" || bundle.sourceTimezone !== "Asia/Shanghai") throw new Error("invalid chat bundle source contract");
  const ids = new Set<string>();
  for (const message of bundle.messages) {
    if (ids.has(message.messageId)) throw new Error("duplicate chat message identity");
    ids.add(message.messageId);
    if (message.direction !== "unknown" || !message.sourceLocator.document) throw new Error("invalid chat message provenance");
    for (const ref of message.mediaRefs) if (/^(?:[A-Za-z]:[\\/]|\\\\|[a-z][a-z0-9+.-]*:)/i.test(ref.relativePath) || ref.relativePath.split(/[\\/]+/).includes("..")) throw new Error("unsafe media reference");
  }
}
