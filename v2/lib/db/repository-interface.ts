import { createHash, randomUUID } from "node:crypto";
import type { QualityReview } from "@/lib/organizer/quality-review";
import type { StoryNeighbours } from "@/lib/story-neighbours";
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
  // The quality ledger. Persisted since the DeepSeek quality gate shipped, but it used to be
  // readable only through the PostgreSQL backend's own private helper — so the JSON backend had
  // nowhere to put a review and the Organizer had to reach past the repository to write one.
  qualityReviews: QualityReview[];
  // T20-B, 2026-09-04: every month with published memories may carry its own written review
  // ("这个月的张年") — the table has always been per-(profile, month) (schema.ts's byProfileMonth
  // unique index), but the store used to surface only the single newest one. A month page needs
  // its OWN month's snapshot, not whichever is most recent archive-wide.
  monthlySnapshots: MonthlySnapshot[];
};

/**
 * Everything `composeFamilyArchive()` reads, and nothing else. The family render path's own read.
 *
 * WHY IT EXISTS, measured on ECS against the live RDS on 2026-09-13 (perf/21, perf/23):
 * `loadFamilyArchive()` used to be `getStore()` + `getAllEvents()` + `getAllEventIdentities()`,
 * which ships 72.6 MB to render pages that read a fraction of it. Server-side execution for the
 * whole set is 34 ms — **no query is slow**; the cost is 1.8 s of pure transfer, and it is paid on
 * every cold render and every ISR revalidation.
 *
 * Three quarters of those bytes are columns nobody on the path reads: `media_locations` is consulted
 * ONLY through `selectLocation()` (provider/variant/status, keyed by asset), `media_assets` ONLY for
 * `mediaType`/`mimeType`, and `raw_sources` ONLY for `mediaPrivilegeOf()` — which looks at sources
 * that back a media row — plus one `max(capturedAt)` for the activity clock. The same three tables
 * were also being read twice over (`life_events` three times, `content_quality_reviews` twice).
 *
 * THE ROWS HERE ARE PARTIAL, and that is the hazard to keep in mind: `store.mediaAssets`,
 * `store.mediaLocations` and `store.rawSources` carry only the columns named above. Reading any
 * other field off them gets `undefined` silently, exactly as with `getStore()`'s existing 10-column
 * `rawSources` read. Anything needing the full rows must call `getStore()` — which is unchanged.
 */
export type FamilyArchiveInput = {
  /** Partial by design — see above. */
  store: Store;
  /** The publishable set, newest first: identical to what getAllEvents() returns. */
  events: LifeEvent[];
  /** Every life_event's id/title/story/occurredAt, any decision — as getAllEventIdentities(). */
  eventIdentities: Array<Pick<LifeEvent, "id" | "title" | "story" | "occurredAt">>;
  /** max(captured_at) over this profile's live raw_sources, because `store.rawSources` no longer
   *  holds every row and the archive clock must not quietly move backwards. */
  latestSourceCapturedAt: string | null;
};

export type EventDetail = {
  event: LifeEvent;
  media: Media[];
  sources: RawSource[];
  contributors: Contributor[];
  growth: GrowthRecord[];
  care: CareRecord[];
  // Phase 3A (2026-09-08, docs/migration-C-readiness.md §2.1): app/events/[id]/page.tsx used to
  // call getStore() just to filter its whole-archive links/mediaAssets/mediaLocations down to this
  // one event's own rows. These three are scoped by the query itself — links by this event's id,
  // mediaAssets/mediaLocations by the mediaAssetId set the `media` array above already carries.
  links: SourceMemoryLink[];
  mediaAssets: MediaAsset[];
  mediaLocations: MediaLocation[];
  // Basis C confirmations for THIS event only (lib/media/story-binding.ts). Derived from the review
  // rows this read already loads for the publication gate, so it adds no query.
  photoConfirmations: ReadonlySet<string>;
  // The story before this one and the story after it, in lived order (lib/story-neighbours.ts).
  // Computed here rather than on the page because the publication gate needs the review rows, and
  // this read already has them — asking again would repeat a whole-table query on a render path
  // (the 2026-09-06 egress incident is the reason that matters). The extra cost is ONE query on
  // life_events alone, selecting six small columns plus one jsonb field extracted to text, for one
  // profile: no story text, no joins, no other table. Both ends are optional and simply absent at
  // the first and last story.
  neighbours: StoryNeighbours;
  // Same narrowing as MonthArchiveInput.birthDay below: the page only ever reads the birth date to
  // compute an age, never the rest of the profile row.
  birthDay?: string;
};

// Just enough of the Store to build ONE month's chapter (lib/memory-chapters.ts buildChapters +
// lib/media/deliverability.ts deliverableMediaIds + lib/family-archive.ts mediaPrivilegeOf), scoped
// by date at the query itself rather than filtered in JS after getStore() pulled every month. See
// Repository.getMonthArchive.
export type MonthArchiveInput = {
  birthDay?: string;
  events: LifeEvent[];
  dailyTraces: DailyTrace[];
  media: Media[];
  mediaAssets: MediaAsset[];
  mediaLocations: MediaLocation[];
  rawSources: Pick<RawSource, "id" | "sourceType" | "sourceLabel">[];
  // Basis C confirmations for this month's events (lib/media/story-binding.ts). assembleMonthArchive
  // already reads the review table for the publication gate; this is the same rows, read once.
  photoConfirmations: ReadonlySet<string>;
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

// Everything the Evidence Builder needs for ONE Organizer job, read by source id. The V2 pipeline
// needs a RawSource's `metadata` (per-message sender digest and document locator) plus the media
// rows, assets and locations behind its `mediaIds` — none of which getOrganizerStore's whole-profile
// projection carries, and all of which getStore() only supplies by loading every table. Keyed by
// the job's own ids so the read stays proportional to the work.
export type OrganizerWindowInput = {
  /** The sources' own profile, when the backend holds a row for it. Only the birth date is read
   *  (a story may say how old he was); a missing row means the age is simply not stated. */
  profile: Profile | null;
  sources: RawSource[];
  media: Media[];
  mediaAssets: MediaAsset[];
  mediaLocations: MediaLocation[];
};

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
  /** The family render path's own read. See FamilyArchiveInput — its rows are partial. */
  getFamilyArchiveInput(): Promise<FamilyArchiveInput>;
  // A Store scoped to one profile and only the fields the Organizer actually reads (rawSources,
  // media, mediaAssets, contributors, events — everything else comes back empty). getStore()'s
  // unfiltered select() across all 18 tables takes ~10 minutes at real WeChat-import data volume
  // (thousands of raw_sources with large jsonb columns); this is ~80s for the same profile because
  // it selects only the needed columns and filters by profile_id. Never a substitute for getStore()
  // in code paths that need the full domain (Quark ingestion, capture, the web app) — only for a
  // batch Organizer pass over many source-id groups in one run.
  getOrganizerStore(profileId: string): Promise<Store>;
  // A-6/B-17 trace tier's ONLY need from the whole-profile Organizer view: every life_event's id,
  // title, story and occurredAt, regardless of publication decision (so a store_only row marked
  // trace_eligible is still matchable). 2026-09-06: a page render path was calling
  // getOrganizerStore() for exactly this, which also pulls raw_sources (including its `text`
  // column — the single largest table) for nothing this call ever reads; that traced back to a
  // spike in Neon's outbound data transfer. This query touches only life_events, filtered by
  // profile_id, with no other table joined.
  getAllEventIdentities(profileId: string): Promise<Array<Pick<LifeEvent, "id" | "title" | "story" | "occurredAt">>>;
  /** Evidence-window input for one job's sources. See OrganizerWindowInput. */
  getOrganizerWindowInput(sourceIds: string[]): Promise<OrganizerWindowInput>;
  getEventDetail(id: string): Promise<EventDetail | null>;
  // month is "YYYY-MM". Scoped by occurredAt/takenAt at the query itself — see getOrganizerStore's
  // doc comment for why getStore() cannot serve this: the archive-expander action needs one month
  // out of the whole profile's history on every click, not the whole history filtered client-side.
  getMonthArchive(month: string): Promise<MonthArchiveInput>;
  // Every "YYYY-MM" a month page could exist for — same existence rule as buildChapters
  // (lib/memory-chapters.ts): a life_event, a daily_trace, or a photographed media item landing in
  // that month. Used only by generateStaticParams (build-time, not a request path) so [year] and
  // [year]/[month] can be prebuilt and actually served from the CDN instead of rendering on every
  // hit; a month missing from this list still works, it just falls back to on-demand ISR.
  listArchiveMonths(): Promise<string[]>;
  appendUpload(input: UploadPersistInput): Promise<RawSource>;
  persistUpload(input: UploadPersistInput): Promise<UploadPersistResult>;
  findMediaAssetByChecksum(checksum: string): Promise<MediaAsset | null>;
  // /api/media/[id]'s only read: one media row, its asset, and that asset's locations — never
  // getStore()'s whole-archive projection. See lib/db/media.ts's locationForMedia for the
  // equivalent in-memory-Store shape this narrows down to.
  getMediaForDelivery(id: string): Promise<{ media: Media; asset: MediaAsset | null; locations: MediaLocation[] } | null>;
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
  // Identity is `organizationFingerprint` and nothing else. A calendar day is a presentation
  // grouping key (see buildChapters in lib/memory-chapters.ts, which folds every trace on a day
  // into one TraceDay), never an artifact identity: two organizers looking at different evidence
  // on the same day produce two artifacts, each with its own provenance and review lifecycle.
  // A trace with no fingerprint has no identity to dedup on and always becomes a new row.
  persistDailyTrace(trace: DailyTrace): Promise<DailyTrace>;
  persistCareEpisode(episode: CareEpisode): Promise<CareEpisode>;
  // Quality ledger writes go through the repository like every other artifact write — the V2
  // adapter must never need a raw SQL statement of its own to record why a Memory is unpublished.
  //
  // Identity is the table's own unique key `(targetKind, targetId, promptVersion)`, the semantics
  // the RC-12 canary proved: a repeat is a NO-OP that returns the row already there, so a retry
  // after a partial failure repairs the batch instead of duplicating the ledger or overwriting a
  // decision someone has since revisited. A new decision on the same artifact is a new
  // promptVersion, never a silent overwrite of the old one.
  persistQualityReview(review: QualityReview): Promise<QualityReview>;
  findQualityReview(targetKind: QualityReview["targetKind"], targetId: string, promptVersion: string): Promise<QualityReview | null>;
  // T20-B: upserts on the table's real unique key (profileId, month).
  persistMonthlySnapshot(snapshot: MonthlySnapshot): Promise<MonthlySnapshot>;
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
