export type Visibility = "private" | "family" | "public";
export type MediaType = "photo" | "video" | "document";
export type MediaProvider = "quark" | "hot";
export type MediaVariant = "original" | "thumbnail" | "web" | "poster" | "preview" | "document_preview";
export type ArchiveStatus = "awaiting_archive" | "archiving" | "archived" | "archive_failed" | "paused_auth_required";
export type MediaLocationStatus = "pending" | "ready" | "awaiting_archive" | "archiving" | "archived" | "archive_failed" | "paused_auth_required";
export type ConnectorSyncStatus = "connected" | "auth_required" | "syncing" | "idle" | "failed";
export type EventType = "moment" | "outing" | "routine" | "milestone" | "chapter";
export type GrowthKind = "height" | "weight" | "language" | "motor" | "social" | "interest" | "sleep" | "food" | "personality";
export type CareKind = "health_observation" | "sleep_note" | "feeding_guidance" | "reminder" | "medical_visit";
export type CareStatus = "观察中" | "长期关注" | "习惯建立" | "护理中" | "已稳定" | "历史" | "待关注" | "记录中";
export type SourceType = "family_photo" | "family_video" | "daycare_photo" | "daycare_note" | "wechat" | "parent_note" | "chat_screenshot" | "medical_document" | "checkup_document" | "growth_measurement" | "other_document";
export type ContentType = "daily" | "daycare" | "travel" | "milestone" | "growth" | "language" | "motor" | "interest" | "food" | "sleep" | "health" | "family" | "funny_moment";
export type ContributorRole = "father" | "mother" | "teacher" | "grandfather" | "grandmother" | "hospital" | "system_import";
export type RawSourceStatus = "uploaded" | "processing" | "organized" | "failed" | "inbox" | "reviewed" | "attached" | "ignored";
export type MemoryWeight = "trace" | "memory" | "highlight" | "chapter";
export type TimelineScope = "family" | "daycare" | "outing" | "growth";
export type CandidateMemoryStatus = "suggested" | "deferred" | "split" | "converted";

export type OrganizerType = "rule" | "ai";
export type OrganizerAction = "create_memory" | "merge_existing" | "attach_existing" | "daily_trace" | "care_episode" | "store_only";
export type OrganizerGrowthSignal = "language" | "motor" | "social" | "interest";

export interface OrganizerRunMetadata {
  organizerType: OrganizerType;
  organizerVersion: string;
  provider: string;
  model?: string;
  promptVersion?: string;
  processedAt: string;
  organizationFingerprint: string;
  sourceCount: number;
  mediaInputCount: number;
  fallbackReason?: string;
  latencyMs?: number;
  tokenUsage?: { input?: number; output?: number; total?: number };
}
export interface OrganizerRun extends OrganizerRunMetadata {
  id: string;
  profileId: string;
  action: OrganizerAction;
  sourceIds: string[];
  targetId?: string;
}

export interface Profile { id: string; displayName: string; birthDate: string; timezone: string; bio: string; visibility: Visibility; }
export interface Contributor { id: string; profileId: string; role: ContributorRole; displayName: string; }
export interface MediaAsset { id: string; profileId: string; rawSourceId?: string; mediaType: MediaType; mimeType: string; width?: number; height?: number; durationSeconds?: number; takenAt?: string | null; checksum?: string | null; originalFilename?: string; archiveStatus?: ArchiveStatus; archiveVerifiedAt?: string; archiveLastError?: string; createdAt: string; }
export interface MediaLocation { id: string; mediaAssetId: string; provider: MediaProvider; variant: MediaVariant; providerRef: string; mimeType?: string; fileSize?: number; width?: number; height?: number; status: MediaLocationStatus; quarkPathSnapshot?: string; sourceParentRef?: string; sourceCreatedAt?: string; sourceUpdatedAt?: string; createdAt: string; updatedAt: string; }
export interface Media { id: string; profileId: string; lifeEventId?: string; rawSourceId?: string; mediaAssetId?: string; type: MediaType; src: string; thumbnailSrc?: string; objectKey?: string; thumbnailObjectKey?: string; originalFilename?: string; mimeType?: string; fileSize?: number; alt: string; takenAt: string; visibility: Visibility; width: number; height: number; durationSeconds?: number; posterSrc?: string; locations?: MediaLocation[]; }
export interface RawSource { id: string; profileId: string; sourceType: SourceType; contentTypes: ContentType[]; contributorId: string; capturedAt: string; importedAt: string; text?: string; mediaIds: string[]; sourceLabel: string; visibility: Visibility; status: RawSourceStatus; originalFilename?: string; metadata?: Record<string, unknown>; deletedAt?: string; relatedLifeEventId?: string; extractedMedicalFacts?: { hospital?: string; examinationType?: string; recordedAt?: string; facts: string[] }; }
export interface LifeEvent { id: string; profileId: string; title?: string; story?: string; storySections?: string[]; occurredAt: string; locationLabel?: string; people: string[]; tags: string[]; contentTypes: ContentType[]; mediaIds: string[]; sourceIds: string[]; growthRecordIds: string[]; careRecordIds: string[]; eventType: EventType; memoryWeight: MemoryWeight; scopes: TimelineScope[]; heroMediaId?: string; visibility: Visibility; keptInYearbook: boolean; createdBy?: "user" | "rule" | "ai"; organizerVersion?: string; organizerRun?: OrganizerRunMetadata; organizationFingerprint?: string; }
export interface SourceMemoryLink { rawSourceId: string; lifeEventId: string; role: "primary" | "supporting" | "context"; createdAt: string; }
export interface GrowthRecord { id: string; profileId: string; lifeEventId?: string; kind: GrowthKind; observedAt: string; value?: number; unit?: string; note: string; source: string; visibility: Visibility; }
export interface CareRecord { id: string; profileId: string; careEpisodeId?: string; lifeEventId?: string; kind: CareKind; observedAt: string; status: CareStatus; title: string; note: string; history?: string; nextStep?: string; source: string; sourceIds?: string[]; visibility: Visibility; }
export interface CareEpisode { id: string; profileId: string; title: string; startedAt: string; endedAt?: string; recordIds: string[]; sourceIds: string[]; status: "open" | "resolved"; visibility: "private"; organizerRun?: OrganizerRunMetadata; }
export interface MonthlySnapshot { id: string; profileId: string; month: string; summary: string; highlights: string[]; visibility: Visibility; }
export interface DailyTrace { id: string; profileId: string; occurredAt: string; entries: string[]; sourceIds: string[]; scopes: TimelineScope[]; visibility: Visibility; organizerRun?: OrganizerRunMetadata; organizationFingerprint?: string; }
export interface CandidateMemory { id: string; profileId: string; occurredAt: string; contextLabel: string; title: string; description: string; sourceIds: string[]; suggestedContentTypes: ContentType[]; suggestedTags: string[]; suggestedMemoryWeight?: MemoryWeight; growthInsight?: string; storyDraft?: string; confidence?: number; reason?: string; status: CandidateMemoryStatus; visibility: Visibility; }
export interface MonthArchive { id: string; profileId: string; month: string; label: string; coverMediaId: string; summary: string; highlights: string[]; momentCount: number; photoCount: number; videoCount: number; visibility: Visibility; }
export interface YearArchive { id: string; profileId: string; year: string; title: string; intro: string; monthIds: string[]; visibility: Visibility; }
export interface CurrentPortrait { label: string; summary: string; recordId?: string; private?: boolean; }
export interface SleepPhase { id: string; label: string; startedAt: string; note: string; current?: boolean; }
export interface ConnectorState { id: string; provider: "quark"; profileId: string; cursor?: string; lastSuccessfulSync?: string; lastError?: string; pendingArchiveCount: number; scope?: { folder?: string; from?: string; to?: string; query?: string }; connectorVersion: string; status: ConnectorSyncStatus; updatedAt: string; lastKeyword?: string; lastAttemptAt?: string; lastSuccessfulAt?: string; artifactItemCount?: number; importedCount?: number; failedCount?: number; lastErrorCode?: string; }
