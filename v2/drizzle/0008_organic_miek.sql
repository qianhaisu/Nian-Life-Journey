CREATE TABLE "content_quality_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"decision" text NOT NULL,
	"gate_a" text,
	"subject_relevance" text,
	"worthiness_score" integer,
	"reason_codes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text,
	"prompt_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"review_fingerprint" text NOT NULL,
	"reviewed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_quality_reviews" ADD CONSTRAINT "content_quality_reviews_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_quality_reviews_target_idx" ON "content_quality_reviews" USING btree ("target_kind","target_id","prompt_version");--> statement-breakpoint
CREATE INDEX "content_quality_reviews_profile_idx" ON "content_quality_reviews" USING btree ("profile_id");