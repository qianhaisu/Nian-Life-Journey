ALTER TABLE media_locations ADD COLUMN IF NOT EXISTS source_parent_ref text;
ALTER TABLE media_locations ADD COLUMN IF NOT EXISTS source_created_at timestamptz;
ALTER TABLE media_locations ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS media_locations_provider_ref_unique ON media_locations(provider, provider_ref);

ALTER TABLE connector_states ADD COLUMN IF NOT EXISTS last_keyword text;
ALTER TABLE connector_states ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE connector_states ADD COLUMN IF NOT EXISTS last_successful_at timestamptz;
ALTER TABLE connector_states ADD COLUMN IF NOT EXISTS artifact_item_count integer;
ALTER TABLE connector_states ADD COLUMN IF NOT EXISTS imported_count integer;
ALTER TABLE connector_states ADD COLUMN IF NOT EXISTS failed_count integer;
ALTER TABLE connector_states ADD COLUMN IF NOT EXISTS last_error_code text;
