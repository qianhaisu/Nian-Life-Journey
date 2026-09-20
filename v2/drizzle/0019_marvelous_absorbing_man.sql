CREATE TABLE "upcoming_checks" (
	"profile_id" text NOT NULL,
	"item_id" text NOT NULL,
	"title_at_check" text,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upcoming_checks" ADD CONSTRAINT "upcoming_checks_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upcoming_checks_identity_idx" ON "upcoming_checks" USING btree ("profile_id","item_id");