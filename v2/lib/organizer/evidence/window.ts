// Deterministic Evidence Builder (§6.2 of the Organizer V2 task): groups a conversation's sources
// into EvidenceWindow batches using gap/count/duration rules only — no model call, no value
// judgement. Same input + same policy version must always produce the same windows and fingerprint.
import { createHash } from "node:crypto";
import type { EvidenceItem, EvidenceWindow, WindowSource } from "./types";
import { bindMedia } from "./media-binding";
import { classifyTier } from "./tier";

export const WINDOW_POLICY_VERSION = "evidence-window-v1";

const MAX_GAP_MS = 45 * 60 * 1000;
const MAX_SPAN_MS = 3 * 60 * 60 * 1000;
const MAX_ITEMS = 40;
const NEIGHBOR_COUNT = 5;

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

// Splits text into sentence-ish spans so a coreFact's evidenceRef can point at a specific claim
// inside a message rather than the whole message. Deterministic, punctuation/newline based.
export function spans(text: string): EvidenceItem["spans"] {
  const parts = text.split(/(?<=[。！？!?\n])/u);
  const result: EvidenceItem["spans"] = [];
  let cursor = 0;
  let index = 0;
  for (const part of parts) {
    const start = cursor;
    const end = cursor + part.length;
    if (part.trim()) result.push({ id: `span-${index}`, start, end });
    cursor = end;
    index += 1;
  }
  if (!result.length) result.push({ id: "span-0", start: 0, end: text.length });
  return result;
}

// Activity day: a configurable local-day boundary (default 04:00) in the profile/session timezone,
// not the server's UTC day — a 23:40–00:30 exchange must land on one activity day (§7.3/§6.2).
export function activityDateOf(iso: string, timezone: string, dayBoundaryHour = 4): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const local = new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") === 24 ? 0 : get("hour")));
  if (local.getUTCHours() < dayBoundaryHour) local.setUTCDate(local.getUTCDate() - 1);
  return local.toISOString().slice(0, 10);
}

function toEvidenceItem(source: WindowSource, index: number): EvidenceItem {
  const mediaRefs = source.mediaIds.map((mediaId) => ({ mediaId, hasHotDerivative: false }));
  return {
    itemId: `item:${digest(`${source.id}:${index}`).slice(0, 24)}`,
    sourceId: source.id,
    sentAt: source.capturedAt,
    senderRole: source.contributorRole ?? "unknown",
    senderDigest: digest(source.contributorId),
    text: source.text ?? "",
    contentTypes: source.contentTypes,
    mediaRefs,
    locator: { document: String(source.metadata?.documentDigest ?? source.sourceLabel ?? source.id), recordOrdinal: Number(source.metadata?.recordOrdinal ?? index) },
    spans: spans(source.text ?? ""),
    tier: classifyTier(source),
  };
}

export function windowFingerprint(window: Pick<EvidenceWindow, "items" | "mediaBindings">, versions: { policyVersion: string; promptVersion: string; modelVersion: string }, assetChecksums: Map<string, string | undefined>) {
  const material = window.items.toSorted((a, b) => a.itemId.localeCompare(b.itemId)).map((item) => [item.itemId, item.sentAt, ...item.mediaRefs.toSorted((a, b) => a.mediaId.localeCompare(b.mediaId)).map((ref) => `${ref.mediaId}:${assetChecksums.get(ref.mediaId) ?? "unavailable"}`)].join("|")).join("\n");
  return createHash("sha256").update(`${versions.policyVersion}\n${versions.promptVersion}\n${versions.modelVersion}\n${material}`).digest("hex");
}

export type BuildWindowsOptions = { timezone?: string; dayBoundaryHour?: number; maxGapMs?: number; maxSpanMs?: number; maxItems?: number };

// Groups a single conversation's already-sorted-by-time sources into windows. Splits at the
// largest gap when the count/duration caps would otherwise be exceeded, per §7.3.
export function buildEvidenceWindows(conversationId: string, profileId: string, sources: WindowSource[], priorContext: EvidenceWindow["priorContext"], options: BuildWindowsOptions = {}): EvidenceWindow[] {
  const timezone = options.timezone ?? "Asia/Shanghai";
  const dayBoundaryHour = options.dayBoundaryHour ?? 4;
  const maxGapMs = options.maxGapMs ?? MAX_GAP_MS;
  const maxSpanMs = options.maxSpanMs ?? MAX_SPAN_MS;
  const maxItems = options.maxItems ?? MAX_ITEMS;
  const sorted = [...sources].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
  const items = sorted.map((source, index) => toEvidenceItem(source, index));

  const groups: EvidenceItem[][] = [];
  for (const item of items) {
    const group = groups.at(-1);
    const previous = group?.at(-1);
    if (group && previous) {
      const gap = Date.parse(item.sentAt) - Date.parse(previous.sentAt);
      const span = Date.parse(item.sentAt) - Date.parse(group[0].sentAt);
      if (gap <= maxGapMs && span <= maxSpanMs && group.length < maxItems) { group.push(item); continue; }
    }
    groups.push([item]);
  }

  return groups.map((groupItems, groupIndex) => {
    const before = items.filter((item) => Date.parse(item.sentAt) < Date.parse(groupItems[0].sentAt)).slice(-NEIGHBOR_COUNT);
    const afterStart = items.filter((item) => Date.parse(item.sentAt) > Date.parse(groupItems.at(-1)!.sentAt)).slice(0, NEIGHBOR_COUNT);
    const mediaBindings = bindMedia(groupItems);
    const senderCount = new Set(groupItems.map((item) => item.senderDigest)).size;
    const imageCount = groupItems.reduce((sum, item) => sum + item.mediaRefs.length, 0);
    const activityDate = activityDateOf(groupItems[0].sentAt, timezone, dayBoundaryHour);
    const windowId = `window:${digest(`${conversationId}:${activityDate}:${groupIndex}:${groupItems.map((item) => item.itemId).join(",")}`).slice(0, 24)}`;
    const window: EvidenceWindow = {
      windowId,
      conversationId,
      profileId,
      activityDate,
      timeRange: { from: groupItems[0].sentAt, to: groupItems.at(-1)!.sentAt },
      items: groupItems,
      mediaBindings,
      neighbors: { before, after: afterStart },
      priorContext,
      stats: { messageCount: groupItems.length, imageCount, senderCount, droppedCount: 0 },
    };
    return window;
  });
}
