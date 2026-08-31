CREATE TABLE "care_episodes" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"started_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"organizer_run" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "care_records" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"care_episode_id" text,
	"life_event_id" text,
	"kind" text NOT NULL,
	"observed_at" timestamp NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"note" text NOT NULL,
	"history" text,
	"next_step" text,
	"source" text NOT NULL,
	"source_ids" jsonb,
	"visibility" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text NOT NULL,
	"organizer_run" jsonb,
	"organization_fingerprint" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "growth_records" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"life_event_id" text,
	"kind" text NOT NULL,
	"observed_at" timestamp NOT NULL,
	"value" real,
	"unit" text,
	"note" text NOT NULL,
	"source" text NOT NULL,
	"visibility" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"life_event_id" text,
	"raw_source_id" text,
	"media_asset_id" text,
	"type" text NOT NULL,
	"src" text NOT NULL,
	"thumbnail_src" text,
	"object_key" text,
	"thumbnail_object_key" text,
	"original_filename" text,
	"mime_type" text,
	"file_size" integer,
	"alt" text NOT NULL,
	"taken_at" timestamp NOT NULL,
	"visibility" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"duration_seconds" integer,
	"poster_src" text
);
--> statement-breakpoint
CREATE TABLE "monthly_focus_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"snapshot_month" text NOT NULL,
	"target_month" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text NOT NULL,
	"linked_entry_ids" jsonb,
	"completed_at" timestamp,
	"visibility" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_snapshot" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"month" text NOT NULL,
	"summary" text NOT NULL,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_snapshot_profile_id_month_unique" UNIQUE("profile_id","month")
);
--> statement-breakpoint
ALTER TABLE "contributors" DROP COLUMN "relationship";
--> statement-breakpoint
ALTER TABLE "contributors" DROP COLUMN "type";
--> statement-breakpoint
ALTER TABLE "contributors" DROP COLUMN "created_at";
--> statement-breakpoint
ALTER TABLE "contributors" ADD COLUMN "role" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_sources" ADD COLUMN "media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_sources" ADD COLUMN "source_label" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "raw_sources" ADD COLUMN "related_life_event_id" text;
--> statement-breakpoint
ALTER TABLE "raw_sources" ADD COLUMN "extracted_medical_facts" jsonb;
--> statement-breakpoint
ALTER TABLE "life_events" DROP COLUMN "featured";
--> statement-breakpoint
ALTER TABLE "life_events" DROP COLUMN "yearbook_selected";
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "story_sections" jsonb;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "location_label" text;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "people" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "growth_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "care_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "event_type" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "hero_media_id" text;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "kept_in_yearbook" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "organizer_run" jsonb;
--> statement-breakpoint
ALTER TABLE "life_events" ADD COLUMN "organization_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "care_episodes" ADD CONSTRAINT "care_episodes_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "care_records" ADD CONSTRAINT "care_records_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "contributors" ADD CONSTRAINT "contributors_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "daily_traces" ADD CONSTRAINT "daily_traces_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "growth_records" ADD CONSTRAINT "growth_records_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_locations" ADD CONSTRAINT "media_locations_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monthly_focus_goals" ADD CONSTRAINT "monthly_focus_goals_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "monthly_snapshot" ADD CONSTRAINT "monthly_snapshot_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organizer_runs" ADD CONSTRAINT "organizer_runs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "raw_sources" ADD CONSTRAINT "raw_sources_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_memory_links" ADD CONSTRAINT "source_memory_links_raw_source_id_raw_sources_id_fk" FOREIGN KEY ("raw_source_id") REFERENCES "public"."raw_sources"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_memory_links" ADD CONSTRAINT "source_memory_links_life_event_id_life_events_id_fk" FOREIGN KEY ("life_event_id") REFERENCES "public"."life_events"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "care_episodes_profile_idx" ON "care_episodes" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "care_episodes_status_idx" ON "care_episodes" USING btree ("status");
--> statement-breakpoint
CREATE INDEX "care_records_profile_idx" ON "care_records" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "care_records_episode_idx" ON "care_records" USING btree ("care_episode_id");
--> statement-breakpoint
CREATE INDEX "contributors_profile_idx" ON "contributors" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "daily_traces_profile_idx" ON "daily_traces" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "daily_traces_fingerprint_idx" ON "daily_traces" USING btree ("organization_fingerprint");
--> statement-breakpoint
CREATE INDEX "growth_records_profile_idx" ON "growth_records" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "life_events_profile_idx" ON "life_events" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "life_events_occurred_idx" ON "life_events" USING btree ("occurred_at");
--> statement-breakpoint
CREATE INDEX "life_events_fingerprint_idx" ON "life_events" USING btree ("organization_fingerprint");
--> statement-breakpoint
CREATE INDEX "media_life_event_idx" ON "media" USING btree ("life_event_id");
--> statement-breakpoint
CREATE INDEX "media_raw_source_idx" ON "media" USING btree ("raw_source_id");
--> statement-breakpoint
CREATE INDEX "media_asset_idx" ON "media" USING btree ("media_asset_id");
--> statement-breakpoint
CREATE INDEX "media_assets_raw_source_idx" ON "media_assets" USING btree ("raw_source_id");
--> statement-breakpoint
CREATE INDEX "monthly_focus_goals_profile_idx" ON "monthly_focus_goals" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "raw_sources_profile_idx" ON "raw_sources" USING btree ("profile_id");
--> statement-breakpoint
CREATE INDEX "raw_sources_status_idx" ON "raw_sources" USING btree ("status");
