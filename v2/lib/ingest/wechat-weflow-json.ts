import { canonicalMessageId, type ChatMediaRef, type ChatMessage, type ChatMessageType, type MediaAvailability } from "./chat-import-bundle";
import { id, safeTarget, type ParsedMarkdown } from "./wechat-markdown";

// WeFlow writes each conversation twice: a Markdown transcript and a JSON one. They are NOT the
// same export. The Markdown for 乳儿班张小年家庭群 holds 70 messages and its own header says so;
// the JSON beside it holds 7,244. Four of the family's groups — the nursery class group, 亲爱的
//爸爸妈妈, 张小年小群, 小雪微信群 — exist almost entirely in the JSON, so an importer that reads
// only Markdown had imported 90 of their ~16,000 messages. This parser reads the JSON, and returns
// exactly the shape parseWechatMarkdown returns so that everything downstream — canonical message
// identity, media resolution, the checkpointing worker — is unchanged.
//
// One conversation's two files are two different documents with two different orderings, so a
// message present in both gets two different canonical ids. Importing the JSON therefore does not
// supersede an already-imported Markdown row; the overlap has to be reconciled deliberately, by
// (sentAt, sender, text), and never by assuming the ids will collide.

type WeflowSession = { wxid?: unknown; nickname?: unknown; remark?: unknown; displayName?: unknown; type?: unknown; messageCount?: unknown };
type WeflowMessage = { createTime?: unknown; formattedTime?: unknown; type?: unknown; localType?: unknown; content?: unknown; senderDisplayName?: unknown; senderUsername?: unknown };

// Message kinds whose `content` is a path to a file on disk rather than something anyone wrote.
// Everything else is text, including the system notices and the sticker placeholder — they are
// filtered later, by the subject gate, which is where "is this about the child" is decided.
const MEDIA_KINDS = new Set(["图片消息", "视频消息", "语音消息", "文件消息"]);

const asString = (value: unknown) => (typeof value === "string" ? value : "");

/** WeFlow stamps seconds since the epoch. Values are read as Shanghai wall-clock, as the rest of this importer is. */
function sentAtOf(createTime: unknown): string | undefined {
  const raw = typeof createTime === "number" ? createTime : Number(createTime);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const ms = raw > 1e12 ? raw : raw * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

export function isWeflowJson(text: string): boolean {
  const head = text.slice(0, 4096);
  return head.includes('"weflow"') && head.includes('"messages"');
}

export function parseWeflowJson(input: {
  root: string;
  document: string;
  text: string;
  media: Map<string, { checksum?: string; availability: MediaAvailability; mimeType?: string; fileSize?: number; width?: number; height?: number }>;
}): ParsedMarkdown {
  let parsed: { session?: WeflowSession; messages?: unknown };
  try {
    parsed = JSON.parse(input.text.replace(/^﻿/, "")) as { session?: WeflowSession; messages?: unknown };
  } catch {
    return { document: input.document, conversationId: "", conversationName: "", messages: [], warnings: ["weflow_json_unparseable"] };
  }
  const session = parsed.session ?? {};
  const rawMessages = Array.isArray(parsed.messages) ? (parsed.messages as WeflowMessage[]) : undefined;
  if (!rawMessages) return { document: input.document, conversationId: "", conversationName: "", messages: [], warnings: ["weflow_json_no_messages"] };

  const conversationName = asString(session.displayName) || asString(session.nickname) || asString(session.remark);
  // Namespaced so a JSON conversation id can never collide with the Markdown id for the same
  // conversation. They are deliberately different identities: two exports, two documents.
  const conversationId = `conversation:${id(`weflow-json\n${asString(session.wxid)}\n${conversationName}\n${asString(session.type)}`)}`;

  const messages: ChatMessage[] = [];
  const warnings: string[] = [];
  let ordinal = 0;
  let undated = 0;

  for (const message of rawMessages) {
    ordinal += 1;
    const sentAt = sentAtOf(message.createTime);
    // A message with no usable timestamp cannot be filed under a day, and a guessed day would be a
    // claim about when something happened. It is counted and dropped, never placed.
    if (!sentAt) { undated += 1; continue; }
    const kind = asString(message.type);
    const content = asString(message.content);
    const sender = asString(message.senderDisplayName) || asString(message.senderUsername);
    if (!sender) { warnings.push("weflow_json_message_without_sender"); continue; }

    const mediaRefs: ChatMediaRef[] = [];
    let text = content;
    if (MEDIA_KINDS.has(kind) && content) {
      const resolved = safeTarget(input.root, input.document, content.replaceAll("\\", "/"));
      const relativePath = resolved ?? `unresolved-${id(content)}`;
      const meta = resolved ? input.media.get(resolved) : undefined;
      mediaRefs.push({
        id: `media-ref:${id(relativePath)}:0`,
        relativePath,
        checksum: meta?.checksum,
        availability: meta?.availability ?? (resolved ? "missing" : "invalid"),
        mimeType: meta?.mimeType,
        fileSize: meta?.fileSize,
        width: meta?.width,
        height: meta?.height,
      });
      // The path is provenance, not something a family member said. Keeping it as text would put a
      // file path on a month page.
      text = "";
    }

    const messageType: ChatMessageType = mediaRefs.length ? (text.trim() ? "mixed" : "image") : "text";
    const base = {
      conversationId,
      senderId: `sender:${id(sender)}`,
      direction: "unknown" as const,
      sentAt,
      messageType,
      text,
      mediaRefs,
      sourceLocator: { document: input.document, recordOrdinal: ordinal },
    };
    messages.push({ ...base, messageId: canonicalMessageId(base, 0) });
  }

  if (undated) warnings.push("weflow_json_message_without_time");

  // Identical to the Markdown parser: two messages that are the same in every canonical input are
  // distinguished by occurrence rank rather than being collapsed into one.
  const counts = new Map<string, number>();
  for (const message of messages) {
    const seen = counts.get(message.messageId) ?? 0;
    counts.set(message.messageId, seen + 1);
    if (seen) message.messageId = canonicalMessageId(message, seen);
    message.occurrenceRank = seen;
  }

  return { document: input.document, conversationId, conversationName: conversationName || "conversation_1", messages, warnings };
}
