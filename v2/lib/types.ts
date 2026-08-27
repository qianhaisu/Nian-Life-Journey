export type Visibility = "private" | "family" | "public";
export type MediaType = "photo" | "video";
export type EventType = "moment" | "outing" | "routine" | "milestone";
export type GrowthKind = "height" | "weight" | "language" | "motor" | "social" | "sleep";
export type CareKind = "health_observation" | "sleep_note" | "feeding_guidance" | "reminder";

export interface Profile { id: string; displayName: string; birthDate: string; timezone: string; bio: string; visibility: Visibility; }
export interface Media { id: string; profileId: string; lifeEventId?: string; type: MediaType; src: string; alt: string; takenAt: string; visibility: Visibility; width: number; height: number; }
export interface LifeEvent { id: string; profileId: string; title: string; story: string; occurredAt: string; locationLabel?: string; people: string[]; tags: string[]; mediaIds: string[]; growthRecordIds: string[]; careRecordIds: string[]; eventType: EventType; visibility: Visibility; }
export interface GrowthRecord { id: string; profileId: string; lifeEventId?: string; kind: GrowthKind; observedAt: string; value?: number; unit?: string; note: string; source: string; visibility: Visibility; }
export interface CareRecord { id: string; profileId: string; lifeEventId?: string; kind: CareKind; observedAt: string; status: string; note: string; source: string; visibility: Visibility; }
export interface MonthlySnapshot { id: string; profileId: string; month: string; summary: string; highlights: string[]; visibility: Visibility; }
