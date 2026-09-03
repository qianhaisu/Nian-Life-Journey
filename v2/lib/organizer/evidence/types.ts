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
  mediaRefs: Array<{ mediaId: string; assetSha256?: string; hasHotDerivative: boolean }>;
  locator: { document: string; recordOrdinal: number };
  spans: Array<{ id: string; start: number; end: number }>;
  tier: EvidenceTier;
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
