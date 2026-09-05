import { createHash } from "node:crypto";
import { relative, resolve, sep } from "node:path";
import { canonicalMessageId, type ChatMessage, type ChatMessageType, type MediaAvailability } from "./chat-import-bundle";

export interface ParsedMarkdown { document: string; conversationId: string; conversationName: string; messages: ChatMessage[]; warnings: string[]; }
const header = /^## (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (.+)$/;
export function id(value: string) { return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 24); }
export function safeTarget(root: string, document: string, target: string) {
  if (!target || /^(?:[A-Za-z]:[\\/]|\\\\|[a-z][a-z0-9+.-]*:)/i.test(target)) return undefined;
  const base = resolve(root, document, ".."); const path = resolve(base, target); const prefix = base.endsWith(sep) ? base : `${base}${sep}`;
  return path === base || path.startsWith(prefix) ? relative(root, path).replaceAll("\\", "/") : undefined;
}
// The header block between the title and "---" holds both the stable session identity (\u4F1A\u8BDDID,
// \u4F1A\u8BDD\u7C7B\u578B) and two fields that change on every re-export of the same conversation (\u6D88\u606F\u6570\u91CF,
// \u5BFC\u51FA\u65F6\u95F4). Hashing the whole block used to mean every re-export invalidated every message's
// canonicalMessageId for that conversation (see docs/STATUS.md 2026-09-04 "\u6839\u56E0"). Keyed on \u4F1A\u8BDDID
// instead \u2014 namespaced like the WeFlow JSON parser's conversationId so the two can never collide \u2014
// re-exporting the same conversation now yields the same conversationId every time.
function headerField(headerLines: string[], label: string): string {
  for (const line of headerLines) {
    const match = line.match(new RegExp(`^-\\s*${label}[:\uFF1A]\\s*` + "`?([^`]*?)`?\\s*$"));
    if (match) return match[1].trim();
  }
  return "";
}

export function parseWechatMarkdown(input: { root: string; document: string; text: string; media: Map<string, { checksum?: string; availability: MediaAvailability; mimeType?: string; fileSize?: number; width?: number; height?: number }> }): ParsedMarkdown {
  const lines = input.text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const title = lines[0]?.match(/^# (.+)$/)?.[1]; if (!title) return { document: input.document, conversationId: "", conversationName: "", messages: [], warnings: ["auxiliary_markdown"] };
  const boundary = lines.indexOf("---"); if (boundary < 0) return { document: input.document, conversationId: id(title), conversationName: title, messages: [], warnings: ["missing_separator"] };
  const headerLines = lines.slice(1, boundary);
  const sessionId = headerField(headerLines, "\u4F1A\u8BDDID");
  const sessionType = headerField(headerLines, "\u4F1A\u8BDD\u7C7B\u578B");
  const conversationId = `conversation:${id(sessionId ? `markdown\n${sessionId}\n${title}\n${sessionType}` : title + "\n" + headerLines.join("\n"))}`; const messages: ChatMessage[] = [];
  let current: { sentAt: string; sender: string; body: string[]; ordinal: number } | undefined; let ordinal = 0;
  const flush = () => { if (!current) return; const body = current.body.join("\n"); const refs = [...body.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m, i) => { const rawTarget = m[1].trim(); const path = safeTarget(input.root, input.document, rawTarget); const relativePath = path ?? `unresolved-${id(rawTarget)}`; const meta = path ? input.media.get(path) : undefined; return { id: `media-ref:${id(relativePath)}:${i}`, relativePath, checksum: meta?.checksum, availability: meta?.availability ?? (path ? "missing" : "invalid" as const), mimeType: meta?.mimeType, fileSize: meta?.fileSize, width: meta?.width, height: meta?.height }; }); const type: ChatMessageType = refs.length ? (body.replace(/!\[[^\]]*\]\(([^)]+)\)/g, "").trim() ? "mixed" : "image") : "text"; const base = { conversationId, senderId: `sender:${id(current.sender)}`, direction: "unknown" as const, sentAt: current.sentAt, messageType: type, text: body, mediaRefs: refs, sourceLocator: { document: input.document, recordOrdinal: current.ordinal } }; messages.push({ ...base, messageId: canonicalMessageId(base, 0) }); };
  for (const line of lines.slice(boundary + 1)) { const match = line.replaceAll("\\-", "-").match(header); if (match) { flush(); ordinal += 1; current = { sentAt: `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00`, sender: match[7], body: [], ordinal }; } else if (current) current.body.push(line); }
  flush(); const counts = new Map<string, number>(); for (const message of messages) { const n = counts.get(message.messageId) ?? 0; counts.set(message.messageId, n + 1); if (n) message.messageId = canonicalMessageId(message, n); message.occurrenceRank = n; }
  return { document: input.document, conversationId, conversationName: "conversation_1", messages, warnings: [] };
}
