CREATE TABLE IF NOT EXISTS organizer_runs (
  id text PRIMARY KEY,
  profile_id text NOT NULL,
  organization_fingerprint text NOT NULL UNIQUE,
  organizer_type text NOT NULL,
  organizer_version text NOT NULL,
  provider text NOT NULL,
  model text,
  prompt_version text,
  action text NOT NULL,
  source_ids jsonb NOT NULL,
  target_id text,
  source_count integer NOT NULL,
  media_input_count integer NOT NULL,
  processed_at timestamptz NOT NULL,
  fallback_reason text,
  latency_ms integer,
  token_usage jsonb
);
