CREATE INDEX IF NOT EXISTS "content_quality_reviews_target_reviewed_idx" ON "content_quality_reviews" USING btree ("target_id","reviewed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_traces_profile_occurred_idx" ON "daily_traces" USING btree ("profile_id","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "life_events_profile_vis_occurred_idx" ON "life_events" USING btree ("profile_id","visibility","occurred_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_profile_taken_at_idx" ON "media" USING btree ("profile_id","taken_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_assets_profile_idx" ON "media_assets" USING btree ("profile_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_locations_provider_status_variant_idx" ON "media_locations" USING btree ("provider","status","variant");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_sources_profile_active_captured_idx" ON "raw_sources" USING btree ("profile_id","captured_at") WHERE "raw_sources"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "source_memory_links_life_event_idx" ON "source_memory_links" USING btree ("life_event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upcoming_items_profile_review_decision_idx" ON "upcoming_items" USING btree ("profile_id","review_decision");