// Deterministic image-to-text binding (§6.3 / §7.3). Confidence < 0.75 must never support a
// coreFact — enforced downstream in the Validator, not here.
import type { EvidenceItem, MediaBinding } from "./types";
import { isEmptyMessage } from "../subject-gate";
import { bindingBasisFor, tierForRule } from "./media-tier";

const INDICATOR_WORDS = /这|这个|看|他|她|它/;

export const BINDING_THRESHOLD = 0.75;

/**
 * A WeChat photo does not arrive attached to a sentence. It arrives as its own message whose entire
 * body is the exporter's placeholder — `[media]` for an image, a markdown link to the extracted file
 * for a video. Measured on the 2025-07/08 windows the Organizer actually ran: 265 of 299
 * media-bearing messages had the body `[media]`, and the remaining 34 were video links.
 *
 * This mattered because the first rule below asked only whether the message had ANY text. A
 * placeholder is text by that test, so every WeChat photo bound to itself at `confirmed` — the tier
 * that licenses "this picture shows this moment" — pointing at a message with nothing said in it,
 * and the two adjacency rules underneath it never ran once on real WeChat data. The photograph and
 * the sentence about it were never on the same binding; the read layer's Basis A test then correctly
 * refused a hero whose bound message was a placeholder, so the story went to the page text-only.
 *
 * `isEmptyMessage` is the archive's existing placeholder recogniser (subject-gate.ts) and is reused
 * rather than duplicated. It does not match a video's `[视频文件](media/videos/….mp4)` because the
 * gate must keep judging that message on its own terms, so the markdown-link shape is added here,
 * inside the binding module, where "does this message say something" is the only question asked.
 */
const MEDIA_FILE_LINK = /^\[[^\]]*\]\(\s*media\/[^)]*\)$/;

function carriesWords(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || isEmptyMessage(trimmed)) return false;
  return !MEDIA_FILE_LINK.test(trimmed);
}

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
      if (carriesWords(item.text)) { bindings.push(bind(ref.mediaId, item.itemId, 1, "same_message_mixed")); continue; }
      // Each adjacency rule needs a message that actually SAYS something: binding one placeholder to
      // the next placeholder in a burst of photos would be a binding to nothing, and the time bound
      // alone is only what makes a candidate — the rule name and `basis` are what make it explicable.
      const nextSameSender = items.slice(index + 1).find((candidate) => candidate.senderDigest === item.senderDigest && carriesWords(candidate.text));
      if (nextSameSender && Date.parse(nextSameSender.sentAt) - Date.parse(item.sentAt) <= 90_000) { bindings.push(bind(ref.mediaId, nextSameSender.itemId, 0.85, "same_sender_after_90s")); continue; }
      const prevSameSender = [...items.slice(0, index)].reverse().find((candidate) => candidate.senderDigest === item.senderDigest && carriesWords(candidate.text));
      if (prevSameSender && Date.parse(item.sentAt) - Date.parse(prevSameSender.sentAt) <= 60_000) { bindings.push(bind(ref.mediaId, prevSameSender.itemId, 0.75, "same_sender_before_60s")); continue; }
      const nearby = items.find((candidate) => candidate !== item && carriesWords(candidate.text) && INDICATOR_WORDS.test(candidate.text) && Math.abs(Date.parse(candidate.sentAt) - Date.parse(item.sentAt)) <= 120_000);
      if (nearby) { bindings.push(bind(ref.mediaId, nearby.itemId, 0.55, "cross_sender_indicator_120s")); continue; }
      bindings.push(bind(ref.mediaId, undefined, 0, "unbound"));
    }
  }
  return bindings;
}
