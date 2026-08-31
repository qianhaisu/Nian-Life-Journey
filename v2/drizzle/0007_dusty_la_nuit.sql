CREATE TABLE IF NOT EXISTS "chat_import_tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "profile_id" text NOT NULL,
  "import_batch_id" text NOT NULL,
  "status" text NOT NULL,
  "phase" text NOT NULL,
  "current_stage" text NOT NULL DEFAULT 'snapshot_validation',
  "processed_messages" integer NOT NULL DEFAULT 0,
  "created_messages" integer NOT NULL DEFAULT 0,
  "reused_messages" integer NOT NULL DEFAULT 0,
  "warnings" integer NOT NULL DEFAULT 0,
  "warning_counts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "checkpoint" text,
  "lease_owner" text,
  "lease_expires_at" timestamp,
  "attempt" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 3,
  "cancel_requested_at" timestamp,
  "started_at" timestamp,
  "completed_at" timestamp,
  "safe_error_code" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "chat_import_tasks_import_batch_id_unique" UNIQUE("import_batch_id")
);
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "current_stage" text;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "warning_counts" jsonb;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "lease_owner" text;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "attempt" integer;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "max_attempts" integer;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
ALTER TABLE "chat_import_tasks" ADD COLUMN IF NOT EXISTS "safe_error_code" text;
UPDATE "chat_import_tasks" SET
  "current_stage" = COALESCE("current_stage", "phase", 'snapshot_validation'),
  "warning_counts" = COALESCE("warning_counts", '[]'::jsonb),
  "attempt" = COALESCE("attempt", 0),
  "max_attempts" = COALESCE("max_attempts", 3);
ALTER TABLE "chat_import_tasks" ALTER COLUMN "current_stage" SET DEFAULT 'snapshot_validation';
ALTER TABLE "chat_import_tasks" ALTER COLUMN "current_stage" SET NOT NULL;
ALTER TABLE "chat_import_tasks" ALTER COLUMN "warning_counts" SET DEFAULT '[]'::jsonb;
ALTER TABLE "chat_import_tasks" ALTER COLUMN "warning_counts" SET NOT NULL;
ALTER TABLE "chat_import_tasks" ALTER COLUMN "attempt" SET DEFAULT 0;
ALTER TABLE "chat_import_tasks" ALTER COLUMN "attempt" SET NOT NULL;
ALTER TABLE "chat_import_tasks" ALTER COLUMN "max_attempts" SET DEFAULT 3;
ALTER TABLE "chat_import_tasks" ALTER COLUMN "max_attempts" SET NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'chat_import_tasks'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (profile_id)%profiles%'
  ) THEN
    ALTER TABLE "chat_import_tasks"
      ADD CONSTRAINT "chat_import_tasks_profile_id_profiles_id_fk"
      FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "chat_import_tasks_profile_idx" ON "chat_import_tasks" USING btree ("profile_id");
CREATE INDEX IF NOT EXISTS "chat_import_tasks_status_idx" ON "chat_import_tasks" USING btree ("status");

ALTER TABLE "raw_sources" ADD COLUMN IF NOT EXISTS "provider" text;
ALTER TABLE "raw_sources" ADD COLUMN IF NOT EXISTS "provider_external_id" text;

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'media_locations'::regclass
    AND contype = 'u'
    AND pg_get_constraintdef(oid) LIKE 'UNIQUE (media_asset_id, provider, variant)%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "media_locations" DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "media_assets_checksum_unique" ON "media_assets" USING btree ("checksum");
CREATE UNIQUE INDEX IF NOT EXISTS "raw_sources_provider_external_id_unique" ON "raw_sources" USING btree ("provider", "provider_external_id");
