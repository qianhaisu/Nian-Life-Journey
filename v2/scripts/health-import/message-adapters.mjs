// Incremental WeChat export -> ledger `source` entities. Reuses the HEALTH-01 exporter parsing and identity rules
// (scripts/health-audit/wechat-export-dedupe.mjs) instead of a second parser.
//
// BOUNDARY: this path stores raw messages as SOURCES only. It does not create observations, episodes or any health
// event. A health fact enters the ledger only through an accepted-fact file (lib/health/adapters.ts) that points at
// these sources. A source is evidence that a message exists, not a claim that anything health-related happened.
//
// Failure policy (never a silent empty import): non-empty input that yields no message, a missing conversation
// identity, or a message without time/speaker throws MessageInputError listing line numbers only (never message text).
import { createHash } from "node:crypto";
import { messageIdentity, parseMarkdownExport, unescapeMarkdown } from "../health-audit/wechat-export-dedupe.mjs";

export class MessageInputError extends Error {
  constructor(code, details = {}) { super(`${code}${Object.keys(details).length ? ` ${JSON.stringify(details)}` : ""}`); this.code = code; this.details = details; }
}

const sha = (s) => createHash("sha256").update(String(s ?? "")).digest("hex");
const ATTACHMENT = /^\[(视频|图片|语音|动画表情|表情|文件|位置|音乐|链接|卡片)\]/;
const pad = (n) => String(n).padStart(2, "0");
/** epoch seconds/ms or a date string -> "YYYY-MM-DD HH:MM:SS" Shanghai wall clock, matching the r4 fact files. */
export function toShanghaiWallClock(v) {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(v.trim())) return v.trim().replace("T", " ").padEnd(19, ":00").slice(0, 19);
  const n = typeof v === "number" ? v : /^\d+$/.test(String(v ?? "")) ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const d = new Date((n > 1e12 ? n : n * 1000) + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** Header block of a WeFlow Markdown export: `- 会话ID: \`x\``, `- 消息数量: N`. */
export function parseMarkdownHeader(text) {
  const head = String(text ?? "").split(/\r?\n/, 40).join("\n");
  const id = /^- 会话ID:\s*`([^`]+)`/m.exec(head)?.[1] ?? null;
  const declared = /^- 消息数量:\s*(\d+)/m.exec(head)?.[1];
  return { sessionId: id ? unescapeMarkdown(id) : null, declaredCount: declared ? Number(declared) : null };
}

function build(messages, conversation, batchId, warnings) {
  const items = [];
  const bad = [];
  for (const m of messages) {
    const time = toShanghaiWallClock(m.createTime);
    const speaker = String(m.senderDisplayName ?? m.senderUsername ?? "").trim();
    if (!time) { bad.push({ line: m.sourceLine ?? null, why: "time_missing_or_unparseable" }); continue; }
    if (!speaker) { bad.push({ line: m.sourceLine ?? null, why: "speaker_missing" }); continue; }
    const text = String(m.content ?? "");
    const content = { layer: "wechat", conversation, recordedAt: time, speaker, text, sha256: sha(text), hasAttachmentPlaceholder: ATTACHMENT.test(text) };
    const ident = messageIdentity({ platformMessageId: m.platformMessageId, localId: m.localId, createTime: time }, conversation);
    if (ident) items.push({ kind: "source", id: `wechat:${conversation}::${ident.id}`, identity: "strong", content });
    else items.push({ kind: "source", identity: "weak", content });
  }
  if (bad.length) throw new MessageInputError("messages_rejected", { count: bad.length, first: bad.slice(0, 20) });
  return { batch: { batchId, items }, warnings, messages: items.length };
}

/** WeFlow Markdown slice. No message ids => weak identities (aligned to strong ones by conversation+time+speaker+text, never merged by guess). */
export function adaptMessagesMarkdown(text, { conversation, batchId }) {
  const raw = String(text ?? "");
  if (!raw.trim()) throw new MessageInputError("empty_input");
  const head = parseMarkdownHeader(raw);
  const conv = conversation ?? head.sessionId;
  if (!conv) throw new MessageInputError("conversation_identity_missing", { hint: "pass --conversation or provide the export header" });
  const messages = parseMarkdownExport(raw);
  if (!messages.length) throw new MessageInputError("unsupported_or_unparseable_markdown", { bytes: raw.length });
  const warnings = [];
  if (head.declaredCount !== null && head.declaredCount !== messages.length) warnings.push({ code: "declared_count_differs", declared: head.declaredCount, parsed: messages.length });
  return build(messages, conv, batchId, warnings);
}

/** WeFlow JSON export: `{session:{wxid}, messages:[{platformMessageId, localId, createTime, senderUsername, senderDisplayName, content}]}` or a bare array. */
export function adaptMessagesJson(text, { conversation, batchId }) {
  const raw = String(text ?? "");
  if (!raw.trim()) throw new MessageInputError("empty_input");
  let doc;
  try { doc = JSON.parse(raw); } catch { throw new MessageInputError("invalid_json"); }
  const list = Array.isArray(doc) ? doc : Array.isArray(doc?.messages) ? doc.messages : null;
  if (!list) throw new MessageInputError("unsupported_json_shape", { keys: doc && typeof doc === "object" ? Object.keys(doc).slice(0, 10) : [] });
  const conv = conversation ?? doc?.session?.wxid ?? null;
  if (!conv) throw new MessageInputError("conversation_identity_missing", { hint: "pass --conversation or provide session.wxid" });
  if (!list.length) throw new MessageInputError("no_messages");
  return build(list.map((m, i) => ({ ...m, sourceLine: i + 1 })), conv, batchId, []);
}
