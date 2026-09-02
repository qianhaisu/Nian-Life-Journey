DROP INDEX "life_events_fingerprint_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "life_events_fingerprint_unique_idx" ON "life_events" USING btree ("organization_fingerprint");