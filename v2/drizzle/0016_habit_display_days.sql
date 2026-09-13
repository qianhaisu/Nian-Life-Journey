CREATE TABLE "habit_display_days" (
	"profile_id" text NOT NULL,
	"item_id" text NOT NULL,
	"shown_day" text NOT NULL,
	"first_shown_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "habit_display_days" ADD CONSTRAINT "habit_display_days_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "habit_display_days_identity_idx" ON "habit_display_days" USING btree ("profile_id","item_id","shown_day");--> statement-breakpoint
CREATE INDEX "habit_display_days_item_idx" ON "habit_display_days" USING btree ("profile_id","item_id");