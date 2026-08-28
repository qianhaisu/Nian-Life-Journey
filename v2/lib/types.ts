export type Visibility = "private" | "family" | "public";
export type MediaType = "photo" | "video";
export type EventType = "moment" | "outing" | "routine" | "milestone" | "chapter";
export type GrowthKind = "height" | "weight" | "language" | "motor" | "social" | "interest" | "sleep" | "food" | "personality";
export type CareKind = "health_observation" | "sleep_note" | "feeding_guidance" | "reminder" | "medical_visit";
export type CareStatus = "观察中" | "长期关注" | "习惯建立" | "护理中" | "已稳定" | "历史" | "待关注" | "记录中";
export type SourceType = "family_photo" | "family_video" | "daycare_photo" | "daycare_note" | "wechat" | "parent_note" | "medical_document" | "checkup_document" | "growth_measurement" | "other_document";
export type ContentType = "daily" | "daycare" | "travel" | "milestone" | "growth" | "language" | "motor" | "interest" | "food" | "sleep" | "health" | "family" | "funny_moment";
export type ContributorRole = "father" | "mother" | "teacher" | "grandfather" | "grandmother" | "hospital" | "system_import";
export type RawSourceStatus = "inbox" | "reviewed" | "attached" | "ignored";
export type MemoryWeight = "trace" | "memory" | "highlight" | "chapter";
export type TimelineScope = "family" | "daycare" | "outing" | "growth";
export type CandidateMemoryStatus = "suggested" | "deferred" | "split" | "converted";

export interface Profile { id: string; displayName: string; birthDate: string; timezone: string; bio: string; visibility: Visibility; }
export interface Contributor { id: string; profileId: string; role: ContributorRole; displayName: string; }
export interface Media { id: string; profileId: string; lifeEventId?: string; rawSourceId?: string; type: MediaType; src: string; alt: string; takenAt: string; visibility: Visibility; width: number; height: number; durationSeconds?: number; posterSrc?: string; }
export interface RawSource { id: string; profileId: string; sourceType: SourceType; contentTypes: ContentType[]; contributorId: string; capturedAt: string; importedAt: string; text?: string; mediaIds: string[]; sourceLabel: string; visibility: Visibility; status: RawSourceStatus; relatedLifeEventId?: string; extractedMedicalFacts?: { hospital?: string; examinationType?: string; recordedAt?: string; facts: string[] }; }
export interface LifeEvent { id: string; profileId: string; title?: string; story?: string; storySections?: string[]; occurredAt: string; locationLabel?: string; people: string[]; tags: string[]; contentTypes: ContentType[]; mediaIds: string[]; sourceIds: string[]; growthRecordIds: string[]; careRecordIds: string[]; eventType: EventType; memoryWeight: MemoryWeight; scopes: TimelineScope[]; heroMediaId?: string; visibility: Visibility; keptInYearbook: boolean; }
export interface GrowthRecord { id: string; profileId: string; lifeEventId?: string; kind: GrowthKind; observedAt: string; value?: number; unit?: string; note: string; source: string; visibility: Visibility; }
export interface CareRecord { id: string; profileId: string; careEpisodeId?: string; lifeEventId?: string; kind: CareKind; observedAt: string; status: CareStatus; title: string; note: string; history?: string; nextStep?: string; source: string; sourceIds?: string[]; visibility: Visibility; }
export interface CareEpisode { id: string; profileId: string; title: string; startedAt: string; endedAt?: string; recordIds: string[]; sourceIds: string[]; status: "open" | "resolved"; visibility: "private"; }
export interface MonthlySnapshot { id: string; profileId: string; month: string; summary: string; highlights: string[]; visibility: Visibility; }
export interface DailyTrace { id: string; profileId: string; occurredAt: string; entries: string[]; sourceIds: string[]; scopes: TimelineScope[]; visibility: Visibility; }
export interface CandidateMemory { id: string; profileId: string; occurredAt: string; contextLabel: string; title: string; description: string; sourceIds: string[]; suggestedContentTypes: ContentType[]; suggestedTags: string[]; growthInsight?: string; storyDraft?: string; status: CandidateMemoryStatus; visibility: Visibility; }
export interface MonthArchive { id: string; profileId: string; month: string; label: string; coverMediaId: string; summary: string; highlights: string[]; momentCount: number; photoCount: number; videoCount: number; visibility: Visibility; }
export interface YearArchive { id: string; profileId: string; year: string; title: string; intro: string; monthIds: string[]; visibility: Visibility; }
export interface CurrentPortrait { label: string; summary: string; recordId?: string; private?: boolean; }
export interface SleepPhase { id: string; label: string; startedAt: string; note: string; current?: boolean; }
