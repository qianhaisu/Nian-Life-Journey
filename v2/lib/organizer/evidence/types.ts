// Evidence-pipeline types (§6/§7/§9 of the Organizer V2 task). Independent of the legacy
// lib/organizer/types.ts (OrganizerContext/OrganizerDecision, still used by the V1/rule path) so
// this module can land without touching files another session may be editing concurrently.
import type { ContentType, RawSource } from "@/lib/types";
import type { MediaBindingTier } from "./media-tier";

export type EvidenceTier = "authoritative_document" | "user_direct_input" | "firsthand_observation" | "reported_speech" | "media_metadata" | "ai_visual_description" | "ai_inference";

export type EvidenceItem = {
  itemId: string;
  sourceId: string;
  sentAt: string;
  senderRole: string;
  senderDigest: string;
  text: string;
  contentTypes: ContentType[];
  mediaRefs: MediaRef[];
  locator: { document: string; recordOrdinal: number };
  spans: Array<{ id: string; start: number; end: number }>;
  tier: EvidenceTier;
};

/**
 * What the Organizer knows about one piece of media attached to a message.
 *
 * `hasHotDerivative` used to be a plain boolean hardcoded to `false` at the only construction site,
 * so the pipeline could not distinguish "no renderable copy" from "nobody looked". Those must not
 * collapse: the first is a fact the Writer has to respect, the second is a caller that did not
 * supply a media index, and silently reporting the second as the first is a fail-OPEN in the
 * direction of "media is unavailable" — which sounds safe but is how you lose real photos.
 *
 * So availability is three-state, and `provider`/`mediaType` are present because a Quark photo and
 * a WeChat photo are different evidence and the Organizer could not previously tell them apart.
 * Everything except `mediaId` is optional, because a caller with no media index knows only the id.
 */
export type MediaRef = {
  mediaId: string;
  mediaAssetId?: string;
  provider?: string;
  mediaType?: "photo" | "video" | "document";
  mimeType?: string;
  /** The asset's own SHA-256 — the permanent identity, never a provider reference. */
  assetSha256?: string;
  /** When the media itself was taken/sent, distinct from the message's sentAt. */
  takenAt?: string;
  /** Whether a renderable derivative exists. `unknown` means no media index was supplied. */
  derivative: "available" | "unavailable" | "unknown";
  /** Whether the original bytes are known to be retrievable. */
  original: "available" | "unavailable" | "unknown";
};

export type MediaBinding = {
  mediaId: string;
  boundItemId?: string;
  confidence: number;
  rule: string;
  /**
   * Named tier derived from `rule` (media-tier.ts). Carried alongside `confidence`, not instead of
   * it: the number answers "how sure", the tier answers "may the Writer say this picture shows
   * this moment" — and only `confirmed` ever licenses that.
   */
  tier: MediaBindingTier;
  /** Why this tier, in words, for the audit trail and review UI. Never parsed. */
  basis: string;
};

export type TraceRef = { id: string; occurredAt: string };
export type EventRef = { id: string; occurredAt: string; title?: string; contentTypes: ContentType[] };

export type EvidenceWindow = {
  windowId: string;
  conversationId: string;
  profileId: string;
  activityDate: string;
  timeRange: { from: string; to: string };
  items: EvidenceItem[];
  mediaBindings: MediaBinding[];
  neighbors: { before: EvidenceItem[]; after: EvidenceItem[] };
  priorContext: { dailyTraces: TraceRef[]; lifeEvents: EventRef[] };
  stats: { messageCount: number; imageCount: number; senderCount: number; droppedCount: number };
};

export type SubjectProfile = { primaryName: string; aliases: string[] };

export type WindowSource = Pick<RawSource, "id" | "profileId" | "sourceType" | "contentTypes" | "contributorId" | "capturedAt" | "text" | "mediaIds" | "visibility" | "metadata"> & { sourceLabel?: string; contributorRole?: string };
