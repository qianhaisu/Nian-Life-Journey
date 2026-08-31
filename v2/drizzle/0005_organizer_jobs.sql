CREATE TABLE "organizer_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"job_key" text NOT NULL,
	"profile_id" text NOT NULL,
	"source_ids" jsonb NOT NULL,
	"force" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"last_error" text,
	"result_action" text,
	"result_target_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "organizer_jobs" ADD CONSTRAINT "organizer_jobs_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organizer_jobs_profile_idx" ON "organizer_jobs" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX "organizer_jobs_claimable_idx" ON "organizer_jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organizer_jobs_active_job_key_idx" ON "organizer_jobs" USING btree ("job_key") WHERE "organizer_jobs"."status" in ('pending', 'processing');