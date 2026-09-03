// Deterministic image-to-text binding (§6.3 / §7.3). Confidence < 0.75 must never support a
// coreFact — enforced downstream in the Validator, not here.
import type { EvidenceItem, MediaBinding } from "./types";
import { bindingBasisFor, tierForRule } from "./media-tier";

const INDICATOR_WORDS = /这|这个|看|他|她|它/;

export const BINDING_THRESHOLD = 0.75;

/**
 * Single construction point, so a binding can never exist without its tier and basis. The tier is
 * derived from the rule (media-tier.ts) rather than passed in, which is what makes "silently
 * upgrade a tier" impossible here: changing a tier means changing the rule table, in one place,
 * under test.
 */
function bind(mediaId: string, boundItemId: string | undefined, confidence: number, rule: string): MediaBinding {
  return { mediaId, boundItemId, confidence, rule, tier: tierForRule(rule), basis: bindingBasisFor({ rule, boundItemId }) };
}

export function bindMedia(items: EvidenceItem[]): MediaBinding[] {
  const bindings: MediaBinding[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    for (const ref of item.mediaRefs) {
      if (item.text.trim()) { bindings.push(bind(ref.mediaId, item.itemId, 1, "same_message_mixed")); continue; }
      const nextSameSender = items.slice(index + 1).find((candidate) => candidate.senderDigest === item.senderDigest && candidate.text.trim());
      if (nextSameSender && Date.parse(nextSameSender.sentAt) - Date.parse(item.sentAt) <= 90_000) { bindings.push(bind(ref.mediaId, nextSameSender.itemId, 0.85, "same_sender_after_90s")); continue; }
      const prevSameSender = [...items.slice(0, index)].reverse().find((candidate) => candidate.senderDigest === item.senderDigest && candidate.text.trim());
      if (prevSameSender && Date.parse(item.sentAt) - Date.parse(prevSameSender.sentAt) <= 60_000) { bindings.push(bind(ref.mediaId, prevSameSender.itemId, 0.75, "same_sender_before_60s")); continue; }
      const nearby = items.find((candidate) => candidate !== item && candidate.text.trim() && INDICATOR_WORDS.test(candidate.text) && Math.abs(Date.parse(candidate.sentAt) - Date.parse(item.sentAt)) <= 120_000);
      if (nearby) { bindings.push(bind(ref.mediaId, nearby.itemId, 0.55, "cross_sender_indicator_120s")); continue; }
      bindings.push(bind(ref.mediaId, undefined, 0, "unbound"));
    }
  }
  return bindings;
}
