import { FAMILY_REGISTRY } from "@/lib/organizer/family-registry";
import { resolveSpeaker } from "@/lib/organizer/identity";
import type { RawSource } from "@/lib/types";

// What 「当时留下的资料」 calls the person behind each message.
//
// The month content file carries a `speakerBySourceId` table written when the month was edited. Some
// of those tables predate people being registered: 2025-12's names 雪姨 「发言人E」 on every message
// she sent (Teddy's screenshot, 2026-09-23 — five times each on 12/04, 12/08, 12/11). The table is a
// snapshot; the registry (lib/organizer/family-registry.ts) is where identity is actually decided. So
// the registry is asked first, on every render, and the snapshot only fills in for someone the
// registry genuinely cannot name.
//
// When the registry cannot name the sender (no digest on the row, or a person nobody has registered),
// the snapshot's label stands as written — typically a stable 「发言人X」 placeholder.

export function registryLabelFor(source: Pick<RawSource, "senderDigest" | "metadata" | "sourceLabel">): string | undefined {
  const digest = source.senderDigest ?? (typeof source.metadata?.senderDigest === "string" ? source.metadata.senderDigest : undefined);
  if (!digest) return undefined;
  // Some registry entries are only valid inside the conversation they were confirmed in, and the
  // conversation is the source label (the same key scripts/editor/identity-rules.mjs passes).
  return resolveSpeaker(digest, FAMILY_REGISTRY, { conversationId: source.sourceLabel }).narrativeLabel ?? undefined;
}

export function resolveDaySpeakers(
  sources: readonly Pick<RawSource, "id" | "senderDigest" | "metadata" | "sourceLabel">[],
  snapshot: Record<string, string> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const source of sources) {
    const label = registryLabelFor(source) ?? snapshot?.[source.id];
    if (label) out[source.id] = label;
  }
  return out;
}
