DROP INDEX "daily_traces_fingerprint_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "daily_traces_fingerprint_unique_idx" ON "daily_traces" USING btree ("organization_fingerprint");