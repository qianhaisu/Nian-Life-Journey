import type { ContentType, LifeEvent, MemoryWeight, OrganizerAction, OrganizerGrowthSignal, OrganizerRun, RawSource } from "@/lib/types";

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
};
