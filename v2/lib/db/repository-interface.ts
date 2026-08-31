import { createHash, randomUUID } from "node:crypto";
import type { CareEpisode, CareRecord, ConnectorState, Contributor, DailyTrace, GrowthRecord, LifeEvent, Media, MediaAsset, MediaLocation, MonthlyFocusGoal, MonthlySnapshot, OrganizerJob, OrganizerRun, Profile, RawSource, SourceMemoryLink } from "@/lib/types";

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
export interface Repository {
  getHomeEvents(): Promise<LifeEvent[]>;
  getAllEvents(): Promise<LifeEvent[]>;
  getStore(): Promise<Store>;
  getEventDetail(id: string): Promise<EventDetail | null>;
  appendUpload(input: { source: RawSource; media: Media[]; assets?: MediaAsset[]; locations?: MediaLocation[] }): Promise<RawSource>;
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
