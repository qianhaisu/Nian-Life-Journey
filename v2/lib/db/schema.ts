// PostgreSQL/Drizzle source of truth for the production repository.
// The JSON repository is a credential-free local development adapter.
// Every table here mirrors a field of Store (v2/lib/db/json-repository.ts) and, through it, a type
// in v2/lib/types.ts. Array-of-id and embedded-metadata fields (mediaIds, organizerRun, ...) are kept
// as jsonb rather than normalized: the app only ever reads/writes them as a whole object today, and
// mirroring the JSON shape exactly is what makes the JSON/Postgres repository contract tests meaningful.
import { pgTable, text, timestamp, integer, boolean, real, jsonb, primaryKey, unique, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { OrganizerRunMetadata } from "@/lib/types";

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  birthDate: text("birth_date").notNull(),
  timezone: text("timezone").notNull(),
  bio: text("bio"),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

// Matches Contributor exactly (id, profileId, role, displayName). The former relationship/type
// columns did not correspond to any field on the Contributor type and nothing ever read or wrote
// them — dropped as part of closing the schema/type drift this slice exists to fix.
export const contributors = pgTable("contributors", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  role: text("role").notNull(),
  displayName: text("display_name").notNull(),
}, (table) => ({ byProfile: index("contributors_profile_idx").on(table.profileId) }));

export const rawSources = pgTable("raw_sources", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  contributorId: text("contributor_id").notNull(),
  sourceType: text("source_type").notNull(),
  contentTypes: jsonb("content_types").$type<string[]>().notNull(),
  capturedAt: timestamp("captured_at", { mode: "string" }).notNull(),
  importedAt: timestamp("imported_at", { mode: "string" }).defaultNow().notNull(),
  text: text("text"),
  provider: text("provider"),
  providerExternalId: text("provider_external_id"),
  mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
  sourceLabel: text("source_label").notNull(),
  status: text("status").notNull(),
  visibility: text("visibility").notNull(),
  originalFilename: text("original_filename"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  deletedAt: timestamp("deleted_at", { mode: "string" }),
  relatedLifeEventId: text("related_life_event_id"),
  extractedMedicalFacts: jsonb("extracted_medical_facts").$type<{ hospital?: string; examinationType?: string; recordedAt?: string; facts: string[] }>(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byProfile: index("raw_sources_profile_idx").on(table.profileId), byStatus: index("raw_sources_status_idx").on(table.status), byCapturedAt: index("raw_sources_captured_at_idx").on(table.capturedAt), canonicalIdentity: uniqueIndex("raw_sources_provider_external_id_unique").on(table.provider, table.providerExternalId) }));

export const mediaAssets = pgTable("media_assets", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  rawSourceId: text("raw_source_id"),
  mediaType: text("media_type").notNull(),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationSeconds: integer("duration_seconds"),
  takenAt: timestamp("taken_at", { mode: "string" }),
  checksum: text("checksum"),
  originalFilename: text("original_filename"),
  archiveStatus: text("archive_status").notNull().default("awaiting_archive"),
  archiveVerifiedAt: timestamp("archive_verified_at", { mode: "string" }),
  archiveLastError: text("archive_last_error"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byRawSource: index("media_assets_raw_source_idx").on(table.rawSourceId), checksum: uniqueIndex("media_assets_checksum_unique").on(table.checksum) }));

// providerRef is the stable location identity. A checksum can have several WeChat source
// references, so a location is not unique by (asset, provider, variant).
export const mediaLocations = pgTable("media_locations", {
  id: text("id").primaryKey(),
  mediaAssetId: text("media_asset_id").notNull().references(() => mediaAssets.id),
  provider: text("provider").notNull(),
  variant: text("variant").notNull(),
  providerRef: text("provider_ref").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  width: integer("width"),
  height: integer("height"),
  status: text("status").notNull(),
  quarkPathSnapshot: text("quark_path_snapshot"),
  sourceParentRef: text("source_parent_ref"),
  sourceCreatedAt: timestamp("source_created_at", { mode: "string" }),
  sourceUpdatedAt: timestamp("source_updated_at", { mode: "string" }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ providerRef: unique().on(table.provider, table.providerRef) }));

// Display-layer records (src/thumbnailSrc/alt/...), distinct from MediaAsset/MediaLocation's
// storage-provenance layer. Never had a table before this slice.
export const media = pgTable("media", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  lifeEventId: text("life_event_id"),
  rawSourceId: text("raw_source_id"),
  mediaAssetId: text("media_asset_id").references(() => mediaAssets.id),
  type: text("type").notNull(),
  src: text("src").notNull(),
  thumbnailSrc: text("thumbnail_src"),
  objectKey: text("object_key"),
  thumbnailObjectKey: text("thumbnail_object_key"),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  alt: text("alt").notNull(),
  takenAt: timestamp("taken_at", { mode: "string" }).notNull(),
  visibility: text("visibility").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  durationSeconds: integer("duration_seconds"),
  posterSrc: text("poster_src"),
}, (table) => ({
  byLifeEvent: index("media_life_event_idx").on(table.lifeEventId),
  byRawSource: index("media_raw_source_idx").on(table.rawSourceId),
  byAsset: index("media_asset_idx").on(table.mediaAssetId),
  // P1-5: getMonthArchive filters this column by month range on every archive-expander click.
  byTakenAt: index("media_taken_at_idx").on(table.takenAt),
}));

// Rebuilt field-for-field against LifeEvent. `featured`/`yearbook_selected` from the old table
// matched no field on LifeEvent (the type's field is `keptInYearbook`) and nothing read or wrote
// them — dropped rather than carried forward as unexplained columns.
export const lifeEvents = pgTable("life_events", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  title: text("title"),
  story: text("story"),
  storySections: jsonb("story_sections").$type<string[]>(),
  occurredAt: timestamp("occurred_at", { mode: "string" }).notNull(),
  locationLabel: text("location_label"),
  people: jsonb("people").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  contentTypes: jsonb("content_types").$type<string[]>().notNull(),
  mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  growthRecordIds: jsonb("growth_record_ids").$type<string[]>().notNull().default([]),
  careRecordIds: jsonb("care_record_ids").$type<string[]>().notNull().default([]),
  eventType: text("event_type").notNull(),
  memoryWeight: text("memory_weight").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  heroMediaId: text("hero_media_id"),
  visibility: text("visibility").notNull(),
  keptInYearbook: boolean("kept_in_yearbook").notNull().default(false),
  createdBy: text("created_by"),
  organizerVersion: text("organizer_version"),
  organizerRun: jsonb("organizer_run").$type<OrganizerRunMetadata>(),
  organizationFingerprint: text("organization_fingerprint"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({
  byProfile: index("life_events_profile_idx").on(table.profileId),
  byOccurredAt: index("life_events_occurred_idx").on(table.occurredAt),
  byFingerprint: uniqueIndex("life_events_fingerprint_unique_idx").on(table.organizationFingerprint),
}));

export const sourceMemoryLinks = pgTable("source_memory_links", {
  rawSourceId: text("raw_source_id").notNull().references(() => rawSources.id),
  lifeEventId: text("life_event_id").notNull().references(() => lifeEvents.id),
  role: text("role").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ pk: primaryKey({ columns: [table.rawSourceId, table.lifeEventId] }) }));

// Untouched — Quark connector boundary, not part of this slice's scope.
export const connectorStates = pgTable("connector_states", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  profileId: text("profile_id").notNull(),
  cursor: text("cursor"),
  lastSuccessfulSync: timestamp("last_successful_sync", { mode: "string" }),
  lastError: text("last_error"),
  pendingArchiveCount: integer("pending_archive_count").notNull().default(0),
  scope: jsonb("scope"),
  connectorVersion: text("connector_version").notNull(),
  status: text("status").notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  lastKeyword: text("last_keyword"),
  lastAttemptAt: timestamp("last_attempt_at", { mode: "string" }),
  lastSuccessfulAt: timestamp("last_successful_at", { mode: "string" }),
  artifactItemCount: integer("artifact_item_count"),
  importedCount: integer("imported_count"),
  failedCount: integer("failed_count"),
  lastErrorCode: text("last_error_code"),
});

export const organizerRuns = pgTable("organizer_runs", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  organizationFingerprint: text("organization_fingerprint").notNull().unique(),
  organizerType: text("organizer_type").notNull(),
  organizerVersion: text("organizer_version").notNull(),
  provider: text("provider").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version"),
  action: text("action").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull(),
  targetId: text("target_id"),
  sourceCount: integer("source_count").notNull(),
  mediaInputCount: integer("media_input_count").notNull(),
  processedAt: timestamp("processed_at", { mode: "string" }).notNull(),
  fallbackReason: text("fallback_reason"),
  latencyMs: integer("latency_ms"),
  tokenUsage: jsonb("token_usage").$type<{ input?: number; output?: number; total?: number }>(),
});

// New. persistDailyTrace() dedups by organizationFingerprint alone: that is the artifact identity.
// A calendar day is only a presentation grouping key — buildChapters() folds every trace on a day
// into one TraceDay — so several rows per (profileId, day) are a normal, supported state and 17
// such days already exist in production.
//
// `organization_fingerprint` is now UNIQUE, matching lifeEvents and organizerRuns. It was only an
// ordinary index until 2026-09-03, and the gap was real: persistDailyTrace() does
// SELECT-then-INSERT under READ COMMITTED, so two workers organizing the same evidence both miss
// and both insert. Production had acquired 17 collision pairs that way — same fingerprint, same
// day, seconds apart, all rule-derived and all unpublished. Ten were byte-identical; in the other
// seven the pair had since diverged because the (now removed) same-day merge appended later batches
// to whichever row it found first.
//
// The pairs were consolidated before the constraint went on, using persistDailyTrace's OWN merge —
// union of entries, union of sourceIds — which is exactly the state a non-racing run would have
// produced. The read path already concatenated every trace on a day (memory-chapters.ts), so the
// consolidated row shows the family what the pair already showed them, minus the duplicated lines.
// See docs/organizer-dailytrace-uniqueness-2026-09-03.md.
export const dailyTraces = pgTable("daily_traces", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  occurredAt: timestamp("occurred_at", { mode: "string" }).notNull(),
  entries: jsonb("entries").$type<string[]>().notNull().default([]),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  visibility: text("visibility").notNull(),
  organizerRun: jsonb("organizer_run").$type<OrganizerRunMetadata>(),
  organizationFingerprint: text("organization_fingerprint"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({
  byProfile: index("daily_traces_profile_idx").on(table.profileId),
  byFingerprint: uniqueIndex("daily_traces_fingerprint_unique_idx").on(table.organizationFingerprint),
}));

// New. Read-only today: no repository function creates or updates a GrowthRecord — it only ever
// arrives via the initial seed. Modeled fully so getStore() stays complete; not implying a write
// path that doesn't exist yet.
export const growthRecords = pgTable("growth_records", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  lifeEventId: text("life_event_id"),
  kind: text("kind").notNull(),
  observedAt: timestamp("observed_at", { mode: "string" }).notNull(),
  value: real("value"),
  unit: text("unit"),
  note: text("note").notNull(),
  source: text("source").notNull(),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byProfile: index("growth_records_profile_idx").on(table.profileId) }));

// New. Same seed-only status as growthRecords today — see note above.
export const careRecords = pgTable("care_records", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  careEpisodeId: text("care_episode_id"),
  lifeEventId: text("life_event_id"),
  kind: text("kind").notNull(),
  observedAt: timestamp("observed_at", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  note: text("note").notNull(),
  history: text("history"),
  nextStep: text("next_step"),
  source: text("source").notNull(),
  sourceIds: jsonb("source_ids").$type<string[]>(),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byProfile: index("care_records_profile_idx").on(table.profileId), byEpisode: index("care_records_episode_idx").on(table.careEpisodeId) }));

// New. persistCareEpisode() dedups by (profileId, day, status="open") at the app layer — same
// reasoning as dailyTraces: indexed, not a DB-level unique constraint.
export const careEpisodes = pgTable("care_episodes", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  title: text("title").notNull(),
  startedAt: timestamp("started_at", { mode: "string" }).notNull(),
  endedAt: timestamp("ended_at", { mode: "string" }),
  recordIds: jsonb("record_ids").$type<string[]>().notNull().default([]),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  status: text("status").notNull(),
  visibility: text("visibility").notNull().default("private"),
  organizerRun: jsonb("organizer_run").$type<OrganizerRunMetadata>(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byProfile: index("care_episodes_profile_idx").on(table.profileId), byStatus: index("care_episodes_status_idx").on(table.status) }));

// New. Seed-only today, same as growthRecords/careRecords.
export const monthlySnapshot = pgTable("monthly_snapshot", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  month: text("month").notNull(),
  summary: text("summary").notNull(),
  highlights: jsonb("highlights").$type<string[]>().notNull().default([]),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byProfileMonth: unique().on(table.profileId, table.month) }));

// New. Seed-only today, same as growthRecords/careRecords/monthlySnapshot.
export const monthlyFocusGoals = pgTable("monthly_focus_goals", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  snapshotMonth: text("snapshot_month").notNull(),
  targetMonth: text("target_month").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull(),
  linkedEntryIds: jsonb("linked_entry_ids").$type<string[]>(),
  completedAt: timestamp("completed_at", { mode: "string" }),
  visibility: text("visibility").notNull(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byProfile: index("monthly_focus_goals_profile_idx").on(table.profileId) }));

// New. The async Organizer queue: one row per organize(sourceIds) call, claimed by
// lib/organizer/worker.ts with `SELECT ... FOR UPDATE SKIP LOCKED`. jobKey (sha256 of sorted
// sourceIds) is unique only while a job is pending/processing — a partial index, not a table-wide
// unique constraint — so a finished job's sourceIds can legitimately be enqueued again later
// (e.g. an explicit reorganize) without colliding with its own history.
export const organizerJobs = pgTable("organizer_jobs", {
  id: text("id").primaryKey(),
  jobKey: text("job_key").notNull(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull(),
  force: boolean("force").notNull().default(false),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { mode: "string" }).defaultNow().notNull(),
  lockedAt: timestamp("locked_at", { mode: "string" }),
  lastError: text("last_error"),
  resultAction: text("result_action"),
  resultTargetId: text("result_target_id"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { mode: "string" }),
}, (table) => ({
  byProfile: index("organizer_jobs_profile_idx").on(table.profileId),
  claimable: index("organizer_jobs_claimable_idx").on(table.status, table.availableAt),
  activeJobKey: uniqueIndex("organizer_jobs_active_job_key_idx").on(table.jobKey).where(sql`${table.status} in ('pending', 'processing')`),
}));

export const chatImportTasks = pgTable("chat_import_tasks", {
  id: text("id").primaryKey(), profileId: text("profile_id").notNull().references(() => profiles.id), importBatchId: text("import_batch_id").notNull().unique(),
  status: text("status").notNull(), phase: text("phase").notNull(), currentStage: text("current_stage").notNull().default("snapshot_validation"), processedMessages: integer("processed_messages").notNull().default(0), createdMessages: integer("created_messages").notNull().default(0), reusedMessages: integer("reused_messages").notNull().default(0), warnings: integer("warnings").notNull().default(0), warningCounts: jsonb("warning_counts").$type<{ code: string; count: number }[]>().notNull().default([]), checkpoint: text("checkpoint"), leaseOwner: text("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { mode: "string" }), attempt: integer("attempt").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(3), cancelRequestedAt: timestamp("cancel_requested_at", { mode: "string" }), startedAt: timestamp("started_at", { mode: "string" }), completedAt: timestamp("completed_at", { mode: "string" }), safeErrorCode: text("safe_error_code"), createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(), updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({ byProfile: index("chat_import_tasks_profile_idx").on(table.profileId), byStatus: index("chat_import_tasks_status_idx").on(table.status) }));

// Quality review ledger (additive, auditable, reversible). Records a per-artifact verdict from the
// DeepSeek quality gate. Nothing is ever hard-deleted and `visibility` is left alone: publication is
// decided by joining this ledger, so a review can be revisited or rolled back without touching the
// artifact. Rule-derived artifacts are fail-closed — no approved row here means not published.
export const contentQualityReviews = pgTable("content_quality_reviews", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => profiles.id),
  targetKind: text("target_kind").notNull(),
  targetId: text("target_id").notNull(),
  decision: text("decision").notNull(),
  gateA: text("gate_a"),
  subjectRelevance: text("subject_relevance"),
  worthinessScore: integer("worthiness_score"),
  reasonCodes: jsonb("reason_codes").$type<string[]>().notNull().default([]),
  provider: text("provider").notNull(),
  model: text("model"),
  promptVersion: text("prompt_version").notNull(),
  policyVersion: text("policy_version").notNull(),
  reviewFingerprint: text("review_fingerprint").notNull(),
  reviewedAt: timestamp("reviewed_at", { mode: "string" }).defaultNow().notNull(),
}, (table) => ({
  byTarget: uniqueIndex("content_quality_reviews_target_idx").on(table.targetKind, table.targetId, table.promptVersion),
  byProfile: index("content_quality_reviews_profile_idx").on(table.profileId),
}));
