import type { ContentType, LifeEvent, MemoryWeight, OrganizerAction, OrganizerGrowthSignal, OrganizerRun, RawSource } from "@/lib/types";
import type { Store } from "@/lib/db/repository-interface";

export type OrganizerSourceSummary = {
  id: string;
  sourceType: RawSource["sourceType"];
  contentTypes: ContentType[];
  contributorId: string;
  contributorName?: string;
  capturedAt: string;
  sourceLabel: string;
  text?: string;
  mediaCount: number;
  media: Array<{ id: string; mediaType: "photo" | "video" | "document"; mimeType: string; takenAt?: string; durationSeconds?: number; filename?: string; width?: number; height?: number; hasPoster: boolean }>;
  metadata?: Record<string, unknown>;
};

export type OrganizerMemorySummary = {
  id: string;
  occurredAt: string;
  title?: string;
  story?: string;
  contentTypes: ContentType[];
  memoryWeight: MemoryWeight;
  sourceCount: number;
  visibility: LifeEvent["visibility"];
};

export type OrganizerMediaInput = {
  sourceId: string;
  mediaId: string;
  variant: "thumbnail" | "web" | "poster";
  mimeType: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
};

export type OrganizerContext = {
  profileId: string;
  sourceSummaries: OrganizerSourceSummary[];
  existingMemories: OrganizerMemorySummary[];
  mediaInputs: OrganizerMediaInput[];
  inputSourceCount: number;
  representativeMediaCount: number;
  generatedAt: string;
  organizationFingerprint: string;
};

export type OrganizerDecision = {
  action: OrganizerAction;
  sourceIds: string[];
  existingLifeEventId?: string;
  occurredAt: string;
  contentTypes: ContentType[];
  memoryWeight: MemoryWeight;
  title?: string;
  shortStory?: string;
  growthSignals?: OrganizerGrowthSignal[];
  careSignals?: string[];
  confidence: number;
  reason: string;
};

export type ProviderUsage = { input?: number; output?: number; total?: number };

export type AIProviderResponse = {
  decision: unknown;
  usage?: ProviderUsage;
};

export interface AIProvider {
  readonly name: string;
  readonly model?: string;
  readonly promptVersion?: string;
  organize(context: OrganizerContext): Promise<AIProviderResponse>;
}

export type OrganizerDebug = {
  sourceIds: string[];
  action: OrganizerAction;
  confidence: number;
  latencyMs: number;
  inputSourceCount: number;
  representativeMediaCount: number;
  provider: string;
  model?: string;
  promptVersion: string;
  tokenUsage?: ProviderUsage;
  fallbackReason?: string;
};

export type OrganizerResult = {
  action: OrganizerAction;
  confidence: number;
  eventId?: string;
  traceId?: string;
  careEpisodeId?: string;
  sourceIds: string[];
  reason: string;
  organizationFingerprint: string;
  fallbackReason?: string;
  debug?: OrganizerDebug;
  run: OrganizerRun;
};

export type OrganizerOptions = {
  force?: boolean;
  provider?: AIProvider;
  now?: Date;
  // Compute and return the decision the organizer WOULD make, without calling any persist
  // function (no DailyTrace/LifeEvent/CareEpisode/OrganizerRun is written). Only RuleBasedMemoryOrganizer
  // honors this today.
  dryRun?: boolean;
  // Reuse an already-fetched Store instead of calling getStore() again. getStore() does an
  // unfiltered select() across every table — at real WeChat data volume (thousands of rows) that
  // single call can take minutes, so a caller processing many source-id batches in one run (e.g. a
  // day-by-day Evidence Window pass) MUST fetch once and pass the same store to every organize()
  // call, or the run becomes O(batches × minutes) instead of O(minutes). Only RuleBasedMemoryOrganizer
  // honors this today; findOrganizerRun (idempotency check) still hits the database directly since
  // organizer_runs isn't part of the passed-in store shape callers typically have on hand.
  store?: Store;
};
