// Named binding tiers for media evidence.
//
// `bindMedia` has always produced a numeric confidence plus a rule name, and the Validator compares
// that number against BINDING_THRESHOLD. A number is the wrong vocabulary for the decision that
// actually matters downstream, which is not "how confident" but "may the Writer say this picture
// shows this moment". Those are different questions: 0.75 and 0.85 are both "strong contextual", and
// no amount of arithmetic turns either into "this photo was attached to this sentence".
//
// So the tier is named, derived from the RULE rather than from the number, and carried alongside the
// confidence rather than replacing it. Nothing here changes a routing decision; it gives the
// downstream contract a word for what the binding rule already proved.
//
//   confirmed          the media and the text are the same WeChat message, or an explicit bundle
//                      record ties them. The only tier that licenses "this photo shows X".
//   strong_contextual  same speaker, same conversational beat, deterministic time bound. Good enough
//                      to place a picture near a story; NOT enough to assert it depicts the claim.
//   day_level          related only by falling on the same lifeDate.
//   month_level        related only by falling in the same month.
//   unbound            no reliable narrative relationship at all.
//
// day_level and month_level are DECLARED but never produced by `bindMedia`, and that is deliberate:
// the only cross-source relationship in the archive today is Quark photo <-> WeChat story, and the
// Evidence Builder does not construct it (windows are built per conversation, and Quark photos are
// `family_photo` sources in their own conversation). The words exist so that when cross-source
// binding is built it cannot quietly borrow `strong_contextual`. A same-day Quark photo is
// day_level, and day_level may never be narrated as depicting a Memory.
import type { MediaBinding } from "./types";

export type MediaBindingTier = "confirmed" | "strong_contextual" | "day_level" | "month_level" | "unbound";

/** Tiers that may be narrated as depicting a specific Memory. Nothing else may be. */
const NARRATABLE: ReadonlySet<MediaBindingTier> = new Set<MediaBindingTier>(["confirmed"]);

/**
 * Tiers that may be ATTACHED to a Memory at all. `strong_contextual` is attachable but not
 * narratable: the Writer may show it, and may not say it depicts the claim.
 */
const ATTACHABLE: ReadonlySet<MediaBindingTier> = new Set<MediaBindingTier>(["confirmed", "strong_contextual"]);

// Rule -> tier. Exhaustive over the rules bindMedia emits; an unrecognised rule is `unbound`,
// because a binding nobody has classified must never default into a tier that licenses narration.
const TIER_BY_RULE: Readonly<Record<string, MediaBindingTier>> = Object.freeze({
  same_message_mixed: "confirmed",
  same_sender_after_90s: "strong_contextual",
  same_sender_before_60s: "strong_contextual",
  // 0.55 — below BINDING_THRESHOLD, and a cross-sender guess besides. Deliberately not attachable.
  cross_sender_indicator_120s: "unbound",
  unbound: "unbound",
});

export function tierForRule(rule: string): MediaBindingTier {
  return TIER_BY_RULE[rule] ?? "unbound";
}

export function tierForBinding(binding: Pick<MediaBinding, "rule">): MediaBindingTier {
  return tierForRule(binding.rule);
}

/** May the Writer state that this media depicts the claim? Only a confirmed binding may. */
export function mayNarrateAsDepicting(tier: MediaBindingTier): boolean {
  return NARRATABLE.has(tier);
}

/** May this media be attached to the Memory at all (shown, without a depiction claim)? */
export function mayAttachToMemory(tier: MediaBindingTier): boolean {
  return ATTACHABLE.has(tier);
}

/**
 * Human-readable basis, recorded on the descriptor so a stored result explains itself without
 * re-deriving the rule. Never parsed — it is for the audit trail and for review UI.
 */
export function bindingBasisFor(binding: Pick<MediaBinding, "rule" | "boundItemId">): string {
  switch (binding.rule) {
    case "same_message_mixed": return `media and text are the same message (${binding.boundItemId ?? "?"})`;
    case "same_sender_after_90s": return `same speaker wrote ${binding.boundItemId ?? "?"} within 90s after the media`;
    case "same_sender_before_60s": return `same speaker wrote ${binding.boundItemId ?? "?"} within 60s before the media`;
    case "cross_sender_indicator_120s": return `a different speaker used a deictic word near the media — too weak to bind`;
    default: return "no reliable relationship to any message in the window";
  }
}
