CREATE TABLE "upcoming_extraction_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"window_from" text NOT NULL,
	"window_to_message_at" timestamp,
	"cursor_last_message_at" timestamp,
	"status" text NOT NULL,
	"conversations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"units_total" integer DEFAULT 0 NOT NULL,
	"units_covered" integer DEFAULT 0 NOT NULL,
	"units_failed" integer DEFAULT 0 NOT NULL,
	"items_created" integer DEFAULT 0 NOT NULL,
	"items_updated" integer DEFAULT 0 NOT NULL,
	"failures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "upcoming_item_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"day" text NOT NULL,
	"change" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"from_when" jsonb,
	"to_when" jsonb,
	"note" text,
	"quote" text,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"batch_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upcoming_items" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"category" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"when_kind" text NOT NULL,
	"when_from" text,
	"when_to" text,
	"when_certainty" text NOT NULL,
	"when_original_text" text,
	"when_basis" text,
	"who_asked" text,
	"anchor_source_id" text NOT NULL,
	"source_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status_note" text,
	"evidence" jsonb,
	"status_evidence" jsonb,
	"supersedes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extraction_batch_id" text NOT NULL,
	"review_decision" text DEFAULT 'needs_human_review' NOT NULL,
	"visibility" text DEFAULT 'family' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upcoming_extraction_runs" ADD CONSTRAINT "upcoming_extraction_runs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upcoming_item_changes" ADD CONSTRAINT "upcoming_item_changes_item_id_upcoming_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."upcoming_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upcoming_items" ADD CONSTRAINT "upcoming_items_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upcoming_extraction_runs_profile_idx" ON "upcoming_extraction_runs" USING btree ("profile_id","started_at");--> statement-breakpoint
CREATE INDEX "upcoming_item_changes_item_idx" ON "upcoming_item_changes" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upcoming_item_changes_identity_idx" ON "upcoming_item_changes" USING btree ("item_id","day","change");--> statement-breakpoint
CREATE INDEX "upcoming_items_profile_idx" ON "upcoming_items" USING btree ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "upcoming_items_anchor_idx" ON "upcoming_items" USING btree ("profile_id","anchor_source_id","title");--> statement-breakpoint
CREATE INDEX "upcoming_items_status_idx" ON "upcoming_items" USING btree ("profile_id","status");