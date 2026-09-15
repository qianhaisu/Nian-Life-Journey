// Content-level dedupe for WeChat imports across export formats.
//
// canonicalMessageId includes the document path, so one chat exported as both .md and .json yields
// two ids for every message and id-based dedupe never fires across them (2026-09-13: 1,118 duplicate
// rows, 2.2% of the archive). WeFlow's daily automation writes a fresh .md slice every day next to a
// static .json, which is exactly the layout that keeps producing that duplication.
//
// The key is what two serializations of the same message still share: the sending instant, to the
// second, and the text with Markdown escaping, inline image references and whitespace removed. A
// media-only message is "" in both parsers (the JSON parser drops the file path from text; the
// Markdown one leaves only an image reference, stripped here), so it still matches on the instant.
//
// Counted as a multiset, not a set: two identical stickers sent in the same second are two messages,
// and a file holding both must import the second one when the archive only has the first.
//
// Known limit, accepted: two genuinely different messages with the same second and the same text in
// two different chats collapse to one key. The alternative — trusting canonical ids — duplicates
// every message of every re-exported chat.

const IMAGE_REFERENCE = /!\[[^\]]*\]\([^)]*\)/g;
// What lib/ingest/wechat-import.ts's sanitizeText stores in raw_sources.text in place of an image
// reference. Archived rows carry this; freshly parsed transcripts carry the reference itself.
const STORED_MEDIA_PLACEHOLDER = /\[media\]/g;

export function normalizeWechatText(text: string | null | undefined): string {
  return String(text ?? "").replace(IMAGE_REFERENCE, "").split("\\").join("").replace(IMAGE_REFERENCE, "").replace(STORED_MEDIA_PLACEHOLDER, "").replace(/\s+/g, "").slice(0, 200);
}

export function wechatContentKey(sentAt: string | Date, text: string | null | undefined): string {
  const ms = sentAt instanceof Date ? sentAt.getTime() : Date.parse(sentAt);
  if (!Number.isFinite(ms)) throw new Error("WECHAT_CONTENT_KEY_INVALID_TIME");
  return `${Math.floor(ms / 1000)}|${normalizeWechatText(text)}`;
}

export type ContentKeyCounts = Map<string, number>;

export function countContentKeys(rows: Iterable<{ sentAt: string | Date; text: string | null | undefined }>): ContentKeyCounts {
  const counts: ContentKeyCounts = new Map();
  for (const row of rows) {
    const key = wechatContentKey(row.sentAt, row.text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Which of a document's messages are not yet in the archive, by content key.
 *
 * `archived` is consumed: every message this call selects is added to it, and every message it
 * matches uses up one archived occurrence. Passing the same map through every document of one run is
 * what stops a message present in both the .md and the .json from being selected twice.
 */
export function selectUnarchivedOrdinals(
  messages: ReadonlyArray<{ sentAt: string; text: string; sourceLocator: { recordOrdinal: number } }>,
  archived: ContentKeyCounts,
): { ordinals: Set<number>; alreadyArchived: number } {
  const remaining = new Map(archived);
  const ordinals = new Set<number>();
  let alreadyArchived = 0;
  for (const message of messages) {
    const key = wechatContentKey(message.sentAt, message.text);
    const left = remaining.get(key) ?? 0;
    if (left > 0) { remaining.set(key, left - 1); alreadyArchived += 1; continue; }
    ordinals.add(message.sourceLocator.recordOrdinal);
    archived.set(key, (archived.get(key) ?? 0) + 1);
  }
  return { ordinals, alreadyArchived };
}

/** Start of the Shanghai calendar day `days` days before `now`, as YYYY-MM-DD. */
export function shanghaiDateDaysAgo(days: number, now: Date = new Date()): string {
  if (!Number.isInteger(days) || days < 0 || days > 400) throw new Error("WECHAT_SINCE_DAYS_INVALID");
  return new Date(now.getTime() + 8 * 3600_000 - days * 86_400_000).toISOString().slice(0, 10);
}
