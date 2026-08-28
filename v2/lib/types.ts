export type Visibility = "private" | "family" | "public";
export type MediaType = "photo" | "video";
export type EventType = "moment" | "outing" | "routine" | "milestone";
export type GrowthKind = "height" | "weight" | "language" | "motor" | "social" | "sleep";
export type CareKind = "health_observation" | "sleep_note" | "feeding_guidance" | "reminder";
export type SourceType = "family_photo" | "family_video" | "daycare_photo" | "daycare_note" | "wechat" | "parent_note" | "medical_document" | "growth_measurement";
export type RawSourceStatus = "inbox" | "reviewed" | "attached" | "ignored";
export type MemoryWeight = "feature" | "memory" | "daily_trace";
export type TimelineScope = "family" | "daycare" | "outing" | "growth";
export type CandidateMemoryStatus = "suggested" | "dismissed" | "converted";

export interface Profile { id: string; displayName: string; birthDate: string; timezone: string; bio: string; visibility: Visibility; }
export interface Media { id: string; profileId: string; lifeEventId?: string; rawSourceId?: string; type: MediaType; src: string; alt: string; takenAt: string; visibility: Visibility; width: number; height: number; durationSeconds?: number; }
export interface RawSource { id: string; profileId: string; sourceType: SourceType; capturedAt: string; importedAt: string; text?: string; mediaIds: string[]; sourceLabel: string; authorLabel: string; visibility: Visibility; status: RawSourceStatus; relatedLifeEventId?: string; }
export interface LifeEvent { id: string; profileId: string; title: string; story: string; storySections?: string[]; occurredAt: string; locationLabel?: string; people: string[]; tags: string[]; mediaIds: string[]; sourceIds: string[]; growthRecordIds: string[]; careRecordIds: string[]; eventType: EventType; memoryWeight: MemoryWeight; scopes: TimelineScope[]; heroMediaId?: string; visibility: Visibility; }
export interface GrowthRecord { id: string; profileId: string; lifeEventId?: string; kind: GrowthKind; observedAt: string; value?: number; unit?: string; note: string; source: string; visibility: Visibility; }
export interface CareRecord { id: string; profileId: string; lifeEventId?: string; kind: CareKind; observedAt: string; status: string; note: string; source: string; visibility: Visibility; }
export interface MonthlySnapshot { id: string; profileId: string; month: string; summary: string; highlights: string[]; visibility: Visibility; }
export interface DailyTrace { id: string; profileId: string; occurredAt: string; entries: string[]; sourceIds: string[]; scopes: TimelineScope[]; visibility: Visibility; }
export interface CandidateMemory { id: string; profileId: string; occurredAt: string; title: string; description: string; sourceIds: string[]; status: CandidateMemoryStatus; visibility: Visibility; }
export interface MonthArchive { id: string; profileId: string; month: string; label: string; coverMediaId: string; summary: string; highlights: string[]; momentCount: number; photoCount: number; videoCount: number; visibility: Visibility; }
export interface YearArchive { id: string; profileId: string; year: string; title: string; intro: string; monthIds: string[]; visibility: Visibility; }
