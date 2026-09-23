// Cross-export dedupe for WeChat imports — "is this message already in the archive?".
//
// WHY IT EXISTS. canonicalMessageId includes the document path, so one chat exported as both .md and
// .json yields two ids for every message and id-based dedupe never fires across them (2026-09-13:
// 1,118 duplicate rows, 2.2% of the archive). WeFlow's daily automation writes a fresh .md slice
// every day beside a static .json, which is exactly the layout that keeps producing that overlap.
//
// WHAT AN ANSWER MUST BE MADE OF. A first version keyed on (second, normalized text truncated to
// 200 chars) across the WHOLE archive. That is not an identity: two different chats can hold the
// same words in the same second, two people can, two long messages can share a prefix, and two
// media-only messages are both "". Any of those would have been read as "already archived" and the
// real message would have been silently dropped — the one failure mode this module must not have.
// So a match now requires ALL of:
//   1. the same real chat — `sessionKey`, the chat's own id as the exporter wrote it (Markdown 会话ID,
//      JSON session.wxid), NOT the document-derived conversationId which differs per export;
//   2. the same sending second;
//   3. the same sender — compared through the stored digest, trying every spelling of the display
//      name, because Markdown escapes it ("hxx\.") and JSON does not;
//   4. the same text in full, never truncated, after removing Markdown escaping, inline image
//      references, links into the export's media folder, and the stored "[media]" placeholder;
//   5. the same attachments — by content SHA-256 when both sides have it, otherwise by the path
//      digests the importer stores in metadata.mediaEvidence.
//
// WHAT HAPPENS WHEN THAT CANNOT BE DECIDED. Nothing is skipped and nothing is guessed: the message
// is returned as `ambiguous`, with a reason, for a human to look at. That covers an archived row
// whose chat is not mapped to a sessionKey, and a row whose attachment evidence is missing on one
// side. A duplicate row costs one row; a dropped message costs the record of a day.
//
// MULTIPLICITY. Occurrences are counted, not collapsed: two identical messages sent in the same
// second are two messages, and an archive holding one of them still needs the second.
//
// RESERVATIONS. A match is consumed only when a write actually succeeded. Selecting a message
// reserves its slot for that document; `commitReservation` turns the reservation into an archived
// occurrence (so the same message in another export of the same chat is not imported twice in one
// run), and `releaseReservation` puts it back when the import failed, so a retry — or the same
// message in a different file — can still bring it in.

import { createHash } from "node:crypto";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

const IMAGE_REFERENCE = /!\[[^\]]*\]\([^)]*\)/g;
// A video written as `[视频文件](media/videos/….mp4)` in one export was stored as "[media]" from
// another; any Markdown link into the export's media folder is an attachment, not words.
const MEDIA_LINK = /\[[^\]]*\]\((?:[^)]*\/)?media\/[^)]*\)/g;
// What lib/ingest/wechat-import.ts's sanitizeText writes into raw_sources.text for an image.
const STORED_MEDIA_PLACEHOLDER = /\[media\]/g;
const MARKDOWN_PUNCTUATION = /([.\-_*[\]()#+!~`>])/g;

/** Full text, comparable across the two exports. Never truncated — a prefix is not an identity. */
export function normalizeWechatText(text: string | null | undefined): string {
  return String(text ?? "")
    .replace(IMAGE_REFERENCE, "").replace(MEDIA_LINK, "")
    .split("\\").join("")
    .replace(IMAGE_REFERENCE, "").replace(MEDIA_LINK, "").replace(STORED_MEDIA_PLACEHOLDER, "")
    .replace(/\s+/g, "");
}

export function secondOf(sentAt: string | Date): number {
  const ms = sentAt instanceof Date ? sentAt.getTime() : Date.parse(sentAt);
  if (!Number.isFinite(ms)) throw new Error("WECHAT_CONTENT_KEY_INVALID_TIME");
  return Math.floor(ms / 1000);
}

/** Reproduces the importer's chain: senderDigest = sha256("sender:" + sha256(displayName)[0..24]). */
export function senderDigestForDisplayName(displayName: string): string {
  return sha256(`sender:${sha256(displayName).slice(0, 24)}`);
}

/** Every spelling of one display name the two exporters can produce, hashed the importer's way. */
export function senderDigestsFor(message: { senderId?: string; senderName?: string }): Set<string> {
  const digests = new Set<string>();
  if (message.senderId) digests.add(sha256(message.senderId));
  const name = message.senderName?.trim();
  if (name) {
    const plain = name.split("\\").join("");
    for (const variant of new Set([name, plain, plain.replace(MARKDOWN_PUNCTUATION, "\\$1")])) {
      if (variant) digests.add(senderDigestForDisplayName(variant));
    }
  }
  return digests;
}

export type AttachmentEvidence = { pathDigests: string[]; checksums: string[] };

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

/** A transcript message's attachments, in the shape the importer records them. */
// A media link the parser does not turn into a mediaRef — `[视频文件](media/videos/x.mp4)`, which
// only the image syntax `![](…)` becomes an attachment — still identifies this message. Dropping it
// from the text (normalizeWechatText must, because the other export stores it as "[media]") without
// putting it back here left such a message as "empty text, no attachments", indistinguishable from
// any other media message in the same second. Measured 2026-09-16: a 09-13 video message matched a
// photo message one second apart, and was reported as an already-archived duplicate when the archive
// held neither its bytes nor any other row referencing that file.
const MEDIA_LINK_TARGET = /\[[^\]]*\]\(((?:[^)]*\/)?media\/[^)]*)\)/g;

export function mediaLinkTargets(text: string | null | undefined): string[] {
  return [...String(text ?? "").split("\\").join("").matchAll(MEDIA_LINK_TARGET)].map((match) => match[1].replaceAll("\\", "/"));
}

export function attachmentEvidenceOfRefs(
  refs: ReadonlyArray<{ relativePath: string; checksum?: string }>,
  text?: string | null,
): AttachmentEvidence {
  return {
    pathDigests: sorted([...refs.map((ref) => ref.relativePath.replaceAll("\\", "/")), ...mediaLinkTargets(text)].map(sha256)),
    checksums: sorted(refs.map((ref) => (ref.checksum ?? "").replace(/^sha256:/i, "").toLowerCase()).filter(Boolean)),
  };
}

/** An archived row's attachments: metadata.mediaEvidence digests plus its assets' checksums. */
export function attachmentEvidenceOfRow(row: { mediaEvidence?: ReadonlyArray<{ digest?: string }> | null; checksums?: ReadonlyArray<string | null> | null; text?: string | null }): AttachmentEvidence {
  return {
    // The stored row's own text carries the same unparsed media links (sanitizeText only rewrites
    // image syntax), so both sides of a comparison are built the same way.
    pathDigests: sorted([...(row.mediaEvidence ?? []).map((item) => String(item?.digest ?? "")).filter(Boolean), ...mediaLinkTargets(row.text).map(sha256)]),
    checksums: sorted((row.checksums ?? []).map((value) => String(value ?? "").replace(/^sha256:/i, "").toLowerCase()).filter(Boolean)),
  };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

type AttachmentVerdict = "match" | "differ" | "unknown";

function compareAttachments(message: AttachmentEvidence, archived: AttachmentEvidence): AttachmentVerdict {
  if (message.pathDigests.length === 0 && archived.pathDigests.length === 0) return "match";
  // Content identity first, when both sides carry it for every attachment.
  if (message.checksums.length > 0 && message.checksums.length === message.pathDigests.length
    && archived.checksums.length > 0 && archived.checksums.length === archived.pathDigests.length) {
    return sameList(message.checksums, archived.checksums) ? "match" : "differ";
  }
  if (message.pathDigests.length > 0 && archived.pathDigests.length > 0) {
    if (sameList(message.pathDigests, archived.pathDigests)) {
      // Same file paths. If both sides also have checksums, they must agree; a path can be rewritten.
      if (message.checksums.length > 0 && archived.checksums.length > 0) {
        return sameList(message.checksums, archived.checksums) ? "match" : "differ";
      }
      return "match";
    }
    // Different paths can still be the same content (two exports, two folders).
    if (message.checksums.length > 0 && archived.checksums.length > 0) {
      return sameList(message.checksums, archived.checksums) ? "match" : "differ";
    }
    return "unknown";
  }
  // One side says "this message has attachments" and the other has no evidence at all.
  return "unknown";
}

export type ArchivedMessage = {
  /** Resolved real chat. `undefined` when the row's conversation label could not be mapped. */
  sessionKey?: string;
  sentAt: string | Date;
  senderDigest?: string | null;
  text: string | null | undefined;
  mediaEvidence?: ReadonlyArray<{ digest?: string }> | null;
  checksums?: ReadonlyArray<string | null> | null;
  /** For reporting only — never used to decide a match. */
  rowId?: string;
};

type IndexedRow = { senderDigest: string; normalizedText: string; attachments: AttachmentEvidence; rowId?: string; available: number };

export type ArchiveIndex = {
  bySession: Map<string, Map<number, IndexedRow[]>>;
  unmappedBySecond: Map<number, IndexedRow[]>;
  rowCount: number;
  unmappedRowCount: number;
};

export function buildArchiveIndex(rows: Iterable<ArchivedMessage>): ArchiveIndex {
  const index: ArchiveIndex = { bySession: new Map(), unmappedBySecond: new Map(), rowCount: 0, unmappedRowCount: 0 };
  for (const row of rows) {
    const entry: IndexedRow = {
      senderDigest: String(row.senderDigest ?? ""),
      normalizedText: normalizeWechatText(row.text),
      attachments: attachmentEvidenceOfRow({ ...row, text: row.text }),
      rowId: row.rowId,
      available: 1,
    };
    const second = secondOf(row.sentAt);
    index.rowCount += 1;
    if (!row.sessionKey) {
      index.unmappedRowCount += 1;
      const bucket = index.unmappedBySecond.get(second);
      if (bucket) bucket.push(entry); else index.unmappedBySecond.set(second, [entry]);
      continue;
    }
    let sessionBuckets = index.bySession.get(row.sessionKey);
    if (!sessionBuckets) { sessionBuckets = new Map(); index.bySession.set(row.sessionKey, sessionBuckets); }
    const bucket = sessionBuckets.get(second);
    if (bucket) bucket.push(entry); else sessionBuckets.set(second, [entry]);
  }
  return index;
}

export type TranscriptMessage = {
  sentAt: string;
  text: string;
  senderId?: string;
  senderName?: string;
  mediaRefs: ReadonlyArray<{ relativePath: string; checksum?: string }>;
  sourceLocator: { recordOrdinal: number };
};

export type AmbiguousMessage = { recordOrdinal: number; sentAt: string; reason: "attachment_evidence_unknown" | "unmapped_conversation"; archivedRowIds: string[] };

export type Classification = {
  ordinals: Set<number>;
  alreadyArchived: number;
  ambiguous: AmbiguousMessage[];
  /** Pass to commitReservation/releaseReservation once the import for this document has finished. */
  reservation: Reservation;
};

export type Reservation = { sessionKey: string; entries: Array<{ second: number; row: IndexedRow }>; pending: Array<{ second: number; row: IndexedRow }> };

/**
 * Which of one document's messages are not yet in the archive.
 *
 * `sessionKey` is the real chat this document is an export of. A message is only ever compared with
 * rows of that same chat; rows whose chat could not be mapped can make a message ambiguous, never
 * archived.
 */
export function classifyDocumentMessages(
  messages: ReadonlyArray<TranscriptMessage>,
  index: ArchiveIndex,
  sessionKey: string,
): Classification {
  if (!sessionKey) throw new Error("WECHAT_DEDUPE_SESSION_KEY_REQUIRED");
  const buckets = index.bySession.get(sessionKey);
  const ordinals = new Set<number>();
  const ambiguous: AmbiguousMessage[] = [];
  const reservation: Reservation = { sessionKey, entries: [], pending: [] };
  let alreadyArchived = 0;
  // Consumption is per document, not global. Two exports of one chat are two statements of the same
  // history, not two claims on the same rows: when the archive already holds a message twice (the
  // pre-existing .md/.json duplication), letting the first document consume the second's copy left
  // the second document short and made real, already-archived messages look missing — measured
  // 2026-09-16: 8 messages of 张小年小群 on 09-10. Double-importing a genuinely NEW message within
  // one run is prevented by the reservation below, not by this counter.
  const remaining = new Map<IndexedRow, number>();
  const take = (row: IndexedRow) => {
    const left = remaining.get(row) ?? row.available;
    if (left <= 0) return false;
    remaining.set(row, left - 1);
    return true;
  };
  const left = (row: IndexedRow) => (remaining.get(row) ?? row.available) > 0;

  for (const message of messages) {
    const second = secondOf(message.sentAt);
    const normalizedText = normalizeWechatText(message.text);
    const attachments = attachmentEvidenceOfRefs(message.mediaRefs ?? [], message.text);
    const senderDigests = senderDigestsFor(message);
    const candidates = (buckets?.get(second) ?? []).filter((row) => left(row)
      && row.normalizedText === normalizedText
      && (row.senderDigest === "" || senderDigests.size === 0 || senderDigests.has(row.senderDigest)));

    let matched = false;
    const undecided: IndexedRow[] = [];
    for (const row of candidates) {
      const verdict = compareAttachments(attachments, row.attachments);
      if (verdict === "match" && take(row)) { alreadyArchived += 1; matched = true; break; }
      if (verdict === "unknown") undecided.push(row);
    }
    if (matched) continue;
    if (undecided.length > 0) {
      ambiguous.push({ recordOrdinal: message.sourceLocator.recordOrdinal, sentAt: message.sentAt, reason: "attachment_evidence_unknown", archivedRowIds: undecided.map((row) => row.rowId ?? "").filter(Boolean) });
      continue;
    }
    // No row of this chat matches. Before importing, check the rows whose chat is unknown: one of
    // them may be this very message, filed under a conversation label nothing has mapped yet.
    const unmapped = (index.unmappedBySecond.get(second) ?? []).filter((row) => left(row)
      && row.normalizedText === normalizedText
      && (row.senderDigest === "" || senderDigests.size === 0 || senderDigests.has(row.senderDigest)));
    if (unmapped.length > 0) {
      ambiguous.push({ recordOrdinal: message.sourceLocator.recordOrdinal, sentAt: message.sentAt, reason: "unmapped_conversation", archivedRowIds: unmapped.map((row) => row.rowId ?? "").filter(Boolean) });
      continue;
    }
    ordinals.add(message.sourceLocator.recordOrdinal);
    // Reserved, not archived: it becomes an archived occurrence only if the import succeeds.
    const row: IndexedRow = { senderDigest: [...senderDigests][0] ?? "", normalizedText, attachments, available: 0 };
    reservation.pending.push({ second, row });
  }
  return { ordinals, alreadyArchived, ambiguous, reservation };
}

/** The import for this document succeeded: its selected messages are now in the archive. */
export function commitReservation(index: ArchiveIndex, reservation: Reservation): void {
  let buckets = index.bySession.get(reservation.sessionKey);
  if (!buckets) { buckets = new Map(); index.bySession.set(reservation.sessionKey, buckets); }
  for (const { second, row } of reservation.pending) {
    row.available = 1;
    const bucket = buckets.get(second);
    if (bucket) bucket.push(row); else buckets.set(second, [row]);
    index.rowCount += 1;
    reservation.entries.push({ second, row });
  }
  reservation.pending = [];
}

/** The import failed: nothing was written, so the same message may still be imported elsewhere. */
export function releaseReservation(reservation: Reservation): void {
  reservation.pending = [];
}

/** Start of the Shanghai calendar day `days` days before `now`, as YYYY-MM-DD. */
export function shanghaiDateDaysAgo(days: number, now: Date = new Date()): string {
  if (!Number.isInteger(days) || days < 0 || days > 400) throw new Error("WECHAT_SINCE_DAYS_INVALID");
  return new Date(now.getTime() + 8 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10);
}

// ── 跨导出去重（2026-09-23 第四轮，私聊_阿静三份导入）───────────────────────────────────────────
//
// 同一条消息，WeFlow 的 JSON 与 Markdown 两种导出写法不同：
//   引用回复  JSON「可以先看个几百的？[引用 苏静：你觉得要看这个医生吗]」
//            MD  「> 苏静: 你觉得要看这个医生吗\n\n可以先看个几百的？」
//   链接      MD 在标题前加「\[链接\]」；小程序 JSON 写标题、MD 只写「\[小程序\]美团」
//   纯媒体    JSON 正文为空，MD 写「\[视频\]」「\[图片\]」
// normalizeWechatText 只去掉空白与转义，这些都对不上（第四轮查到约 1,120 条）。下面的规范化把这些
// 「写法」剥掉，只留说出来的那句话；比对键仍是 发送秒 + 发送人 + 规范化文本，三者都要相同。

const QUOTE_SUFFIX = /\[引用 [^：:\]]{1,40}[：:][\s\S]*\]\s*$/;
const QUOTE_PREFIX = /^\s*>\s*[^:：\n]{1,40}[:：][^\n]*\n+/;
const BRACKET_TAG = /^\s*\[(链接|小程序|文件|视频号|名片|位置)\]/;
const MEDIA_ONLY = /^\s*\[(视频|图片|表情|动画表情|语音|media)\]\s*$/;

/** 跨导出比对用的正文：去掉引用、链接/小程序标签、纯媒体占位与转义，保留说出来的话。 */
export function normalizeAcrossExports(text: string | null | undefined): string {
  let s = String(text ?? "").split("\\").join("");
  s = s.replace(QUOTE_PREFIX, "").replace(QUOTE_SUFFIX, "");
  const tag = s.match(BRACKET_TAG);
  // 小程序：两种导出写的标题不同（课程名 vs「美团」），标签本身才是共同的部分。
  if (tag?.[1] === "小程序") return "[小程序]";
  if (tag) s = s.replace(BRACKET_TAG, "");
  if (MEDIA_ONLY.test(s)) return "";
  return normalizeWechatText(s);
}

/**
 * 被引用、所以不能软删的重复行，在 metadata.duplicateOf 里指向保留的那一条。
 * 这样的行仍然存在（「读原记录」的链接照常打开），但 Organizer 与编辑读材料时跳过它，
 * 不会把同一句话当两条证据读两遍。
 */
export function isDuplicateMarked(metadata: Record<string, unknown> | null | undefined): boolean {
  const value = metadata?.duplicateOf;
  return typeof value === "string" && value.trim().length > 0;
}

/** SQL 条件：只读没有 duplicateOf 标记的行。与 isDuplicateMarked 同义，给直接写 SQL 的读取方用。 */
export const NOT_DUPLICATE_MARKED_SQL = "coalesce(metadata->>'duplicateOf', '') = ''";
