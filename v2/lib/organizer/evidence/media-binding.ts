// Deterministic image-to-text binding (§6.3 / §7.3). Confidence < 0.75 must never support a
// coreFact — enforced downstream in the Validator, not here.
import type { EvidenceItem, MediaBinding } from "./types";

const INDICATOR_WORDS = /这|这个|看|他|她|它/;

export const BINDING_THRESHOLD = 0.75;

export function bindMedia(items: EvidenceItem[]): MediaBinding[] {
  const bindings: MediaBinding[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    for (const ref of item.mediaRefs) {
      if (item.text.trim()) { bindings.push({ mediaId: ref.mediaId, boundItemId: item.itemId, confidence: 1, rule: "same_message_mixed" }); continue; }
      const nextSameSender = items.slice(index + 1).find((candidate) => candidate.senderDigest === item.senderDigest && candidate.text.trim());
      if (nextSameSender && Date.parse(nextSameSender.sentAt) - Date.parse(item.sentAt) <= 90_000) { bindings.push({ mediaId: ref.mediaId, boundItemId: nextSameSender.itemId, confidence: 0.85, rule: "same_sender_after_90s" }); continue; }
      const prevSameSender = [...items.slice(0, index)].reverse().find((candidate) => candidate.senderDigest === item.senderDigest && candidate.text.trim());
      if (prevSameSender && Date.parse(item.sentAt) - Date.parse(prevSameSender.sentAt) <= 60_000) { bindings.push({ mediaId: ref.mediaId, boundItemId: prevSameSender.itemId, confidence: 0.75, rule: "same_sender_before_60s" }); continue; }
      const nearby = items.find((candidate) => candidate !== item && candidate.text.trim() && INDICATOR_WORDS.test(candidate.text) && Math.abs(Date.parse(candidate.sentAt) - Date.parse(item.sentAt)) <= 120_000);
      if (nearby) { bindings.push({ mediaId: ref.mediaId, boundItemId: nearby.itemId, confidence: 0.55, rule: "cross_sender_indicator_120s" }); continue; }
      bindings.push({ mediaId: ref.mediaId, boundItemId: undefined, confidence: 0, rule: "unbound" });
    }
  }
  return bindings;
}
