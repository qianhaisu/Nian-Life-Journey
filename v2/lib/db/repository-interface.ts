import { createHash, randomUUID } from "node:crypto";
import type { CareEpisode, CareRecord, ChatImportCheckpoint, ChatImportStage, ChatImportTask, ChatImportTaskStatus, ChatImportWarning, ConnectorState, Contributor, DailyTrace, GrowthRecord, LifeEvent, Media, MediaAsset, MediaLocation, MonthlyFocusGoal, MonthlySnapshot, OrganizerJob, OrganizerRun, Profile, RawSource, SourceMemoryLink } from "@/lib/types";

// The full in-memory snapshot both repository implementations produce from getStore(). Every
// field here is a real, currently-persisted entity (a field of the JSON Store) — not every type
// declared in lib/types.ts has one (CandidateMemory, MonthArchive, YearArchive, SleepPhase and
// CurrentPortrait are not part of Store; nothing persists them today).
export type Store = {
  profile: Profile;
  contributors: Contributor[];
  media: Media[];
  mediaAssets: MediaAsset[];
  mediaLocations: MediaLocation[];
  connectorStates: ConnectorState[];
  rawSources: RawSource[];
  events: LifeEvent[];
  dailyTraces: DailyTrace[];
  growthRecords: GrowthRecord[];
  careRecords: CareRecord[];
  careEpisodes: CareEpisode[];
  monthlyFocusGoals: MonthlyFocusGoal[];
  organizerRuns: OrganizerRun[];
  organizerJobs: OrganizerJob[];
  chatImportTasks: ChatImportTask[];
  links: SourceMemoryLink[];
  monthlySnapshot: MonthlySnapshot;
};

export type EventDetail = {
  event: LifeEvent;
  media: Media[];
  sources: RawSource[];
  contributors: Contributor[];
  growth: GrowthRecord[];
  care: CareRecord[];
};

// The domain contract pages, Server Actions, Route Handlers, and the Organizer depend on — never
// on PostgreSQL or the JSON file directly. Both json-repository.ts and postgres-repository.ts
// implement this exactly; repository.ts picks one at module load based on REPOSITORY_BACKEND.
export type ChatImportTaskCreateInput = {
  id?: string;
  profileId: string;
  importBatchId: string;
  currentStage?: ChatImportStage;
  maxAttempts?: number;
  now?: string;
};
export type ChatImportTaskListFilter = { profileId?: string; status?: ChatImportTaskStatus | ChatImportTaskStatus[] };
export type ChatImportTaskClaimInput = { taskId?: string; leaseOwner: string; leaseMs?: number; now?: string };
export type ChatImportTaskLeaseInput = { taskId: string; leaseOwner: string; leaseMs?: number; now?: string };
export type ChatImportTaskAcknowledgeInput = { taskId: string; leaseOwner?: string; now?: string };
export type ChatImportCheckpointInput = { taskId: string; leaseOwner: string; checkpoint: ChatImportCheckpoint; processedMessages?: number; createdMessages?: number; reusedMessages?: number; warnings?: number; warningCounts?: ChatImportWarning[]; currentStage?: ChatImportStage; now?: string };
export type ChatImportTaskFailureInput = { taskId: string; leaseOwner: string; safeErrorCode: string; now?: string };
export type ChatImportTaskCompletionInput = { taskId: string; leaseOwner: string; now?: string };
export type ChatImportTaskWarningsInput = ChatImportTaskCompletionInput & { warningCounts: ChatImportWarning[] };

export type UploadPersistInput = { source: RawSource; media: Media[]; assets?: MediaAsset[]; locations?: MediaLocation[] };
export type UploadPersistResult = { source: RawSource; sourceCreated: boolean; createdAssetIds: string[]; reusedAssetIds: string[]; createdLocationIds: string[]; reusedLocationIds: string[]; mediaIds: string[] };

// A batch persist processes N UploadPersistInput items in one call. Every implementation
// (PostgreSQL, JSON, in-memory, async) must return per-item results in the SAME order as the
// input array, and must resolve a canonical identity that repeats within the batch itself (two
// items with the same providerExternalId, checksum, or providerRef) exactly the same way a
// second persistChatImportMessage call would: the second occurrence is "reused", never a
// duplicate row and never an error. The PostgreSQL implementation is the one where this method
// actually changes the number of round trips (bulk multi-row INSERT ... ON CONFLICT ... RETURNING
// instead of one transaction per item); JSON/in-memory/async only need to preserve behavior.
export type ChatImportBatchResult = { items: UploadPersistResult[] };

export interface ChatImportRepository {
  createChatImportTask(input: ChatImportTaskCreateInput): Promise<ChatImportTask>;
  getChatImportTask(id: string): Promise<ChatImportTask | null>;
  listChatImportTasks(filter?: ChatImportTaskListFilter): Promise<ChatImportTask[]>;
  claimChatImportTask(input: ChatImportTaskClaimInput): Promise<ChatImportTask | null>;
  heartbeatChatImportTask(input: ChatImportTaskLeaseInput): Promise<ChatImportTask | null>;
  saveChatImportCheckpoint(input: ChatImportCheckpointInput): Promise<ChatImportTask | null>;
  requestChatImportCancel(taskId: string, now?: string): Promise<ChatImportTask | null>;
  acknowledgeChatImportCancel(input: ChatImportTaskAcknowledgeInput): Promise<ChatImportTask | null>;
  failChatImportTask(input: ChatImportTaskFailureInput): Promise<ChatImportTask | null>;
  retryChatImportTask(taskId: string, now?: string): Promise<ChatImportTask | null>;
  completeChatImportTask(input: ChatImportTaskCompletionInput): Promise<ChatImportTask | null>;
  completeChatImportWithWarnings(input: ChatImportTaskWarningsInput): Promise<ChatImportTask | null>;
  persistChatImportMessage(input: UploadPersistInput): Promise<UploadPersistResult>;
  persistChatImportBatch(inputs: UploadPersistInput[]): Promise<ChatImportBatchResult>;
}

export interface Repository extends ChatImportRepository {
  getHomeEvents(): Promise<LifeEvent[]>;
  getAllEvents(): Promise<LifeEvent[]>;
  // `profile` is always the canonical one (lib/db/config.ts), never "whichever row comes first";
  // the collections are the whole backend view — pages narrow them with lib/db/profile-scope.ts.
  getStore(): Promise<Store>;
  // A Store scoped to one profile and only the fields the Organizer actually reads (rawSources,
  // media, mediaAssets, contributors, events — everything else comes back empty). getStore()'s
  // unfiltered select() across all 18 tables takes ~10 minutes at real WeChat-import data volume
  // (thousands of raw_sources with large jsonb columns); this is ~80s for the same profile because
  // it selects only the needed columns and filters by profile_id. Never a substitute for getStore()
  // in code paths that need the full domain (Quark ingestion, capture, the web app) — only for a
  // batch Organizer pass over many source-id groups in one run.
  getOrganizerStore(profileId: string): Promise<Store>;
  getEventDetail(id: string): Promise<EventDetail | null>;
  appendUpload(input: UploadPersistInput): Promise<RawSource>;
  persistUpload(input: UploadPersistInput): Promise<UploadPersistResult>;
  findMediaAssetByChecksum(checksum: string): Promise<MediaAsset | null>;
  updateMediaAsset(id: string, patch: Partial<MediaAsset>): Promise<MediaAsset | null>;
  updateMediaLocation(id: string, patch: Partial<MediaLocation>): Promise<MediaLocation | null>;
  removeMediaLocation(id: string): Promise<void>;
  findMediaLocationByProviderRef(provider: MediaLocation["provider"], providerRef: string): Promise<{ location: MediaLocation; asset: MediaAsset | null } | null>;
  appendMediaAssetWithLocation(asset: MediaAsset, location: MediaLocation): Promise<{ asset: MediaAsset; location: MediaLocation }>;
  updateMediaAssetWithLocation(assetId: string, locationId: string, assetPatch: Partial<MediaAsset>, locationPatch: Partial<MediaLocation>): Promise<{ asset: MediaAsset; location: MediaLocation } | null>;
  getConnectorState(provider: "quark", profileId: string): Promise<ConnectorState | null>;
  upsertConnectorState(input: ConnectorState): Promise<ConnectorState>;
  markArchiveStatus(assetId: string, status: NonNullable<MediaAsset["archiveStatus"]>, error?: string): Promise<MediaAsset | null>;
  recordArchivedOriginal(input: { assetId: string; providerRef: string; path?: string; fileSize?: number; checksumVerified?: boolean }): Promise<MediaLocation | null>;
  persistOrganization(sourceIds: string[], eventInput: LifeEvent, links: SourceMemoryLink[]): Promise<LifeEvent>;
  persistDailyTrace(trace: DailyTrace): Promise<DailyTrace>;
  persistCareEpisode(episode: CareEpisode): Promise<CareEpisode>;
  markSourcesOrganized(sourceIds: string[]): Promise<void>;
  markSourcesProcessing(sourceIds: string[]): Promise<void>;
  findOrganizerRun(organizationFingerprint: string): Promise<OrganizerRun | null>;
  persistOrganizerRun(run: OrganizerRun): Promise<OrganizerRun>;
  undoOrganization(sourceIds: string[], eventId: string): Promise<void>;
  enqueueOrganizerJob(input: { sourceIds: string[]; profileId: string; force?: boolean }): Promise<OrganizerJob>;
  claimNextOrganizerJob(now?: Date): Promise<OrganizerJob | null>;
  completeOrganizerJob(id: string, patch: { resultAction?: string; resultTargetId?: string }): Promise<void>;
  failOrganizerJob(id: string, error: string, nextAvailableAt: string | null): Promise<void>;
  getOrganizerJob(id: string): Promise<OrganizerJob | null>;
  recoverStuckOrganizerJobs(olderThanMs: number, now?: Date): Promise<number>;
}

export function organizerJobKey(sourceIds: string[]) {
  return createHash("sha256").update(sourceIds.toSorted().join(",")).digest("hex");
}

export const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
