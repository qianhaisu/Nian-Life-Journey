-- HEALTH-02 proposed Postgres shape for the health ledger. NOT applied anywhere, NOT in drizzle/meta/_journal.json,
-- so `db:migrate` never picks it up. Authored and reviewed only; it was not executed in this batch because no
-- isolated Postgres was available. Run it first against a throwaway local database, never the shared Neon one.
-- App rollback: nothing in V2 reads these tables, so rolling the app back needs no data action.
-- Data rollback: `DROP TABLE health_* ` is safe ONLY on a database where these tables hold no reviewed data;
-- otherwise restore from a pg_dump taken before the migration (a rolled-back image is not a data restore).
BEGIN;

CREATE TABLE health_entities (
  kind text NOT NULL CHECK (kind IN ('source','observation','canonical_fact','encounter','episode')),
  id text NOT NULL,
  identity text NOT NULL CHECK (identity IN ('strong','weak')),
  aliases text[] NOT NULL DEFAULT '{}', -- weak identities adopted by this strong one (R1)
  raw_source_id text,                 -- optional soft reference to raw_sources.id (no FK: health rows must not pin story rows)
  PRIMARY KEY (kind, id)
);

CREATE TABLE health_entity_versions (
  kind text NOT NULL,
  id text NOT NULL,
  version integer NOT NULL CHECK (version >= 1),
  content_hash text NOT NULL,
  content jsonb NOT NULL,
  run_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (kind, id, version),
  UNIQUE (kind, id, content_hash),    -- same content is never a new version (idempotent replay, no revival)
  FOREIGN KEY (kind, id) REFERENCES health_entities (kind, id)
);

CREATE TABLE health_links (
  id text PRIMARY KEY,                -- role|from|to  : same triple can exist once
  role text NOT NULL,
  from_kind text NOT NULL, from_id text NOT NULL,
  to_kind text NOT NULL, to_id text NOT NULL,
  basis text,
  to_version integer,                 -- version of the target the link was derived from (sources keep their bound version)
  run_id text NOT NULL,
  FOREIGN KEY (from_kind, from_id) REFERENCES health_entities (kind, id),
  FOREIGN KEY (to_kind, to_id) REFERENCES health_entities (kind, id)
);
CREATE INDEX health_links_to_idx ON health_links (to_kind, to_id, role);

CREATE TABLE health_corrections (
  id text PRIMARY KEY,                -- caller-supplied, idempotent
  type text NOT NULL CHECK (type IN ('field','link','historical')), -- historical = pre-ledger history, never changes effective content
  req_hash text NOT NULL,             -- normalized request; same id + different hash is refused
  method text, status text, targets jsonb,
  kind text, entity_id text, field text, link_id text REFERENCES health_links (id),
  before_value jsonb, after_value jsonb, before_role text, after_role text,
  base_version integer,
  author text NOT NULL, reason text NOT NULL, at timestamptz NOT NULL,
  seq bigserial NOT NULL              -- history order; latest seq per (entity, field)/(link) is current
);

CREATE TABLE health_ambiguities (
  a text NOT NULL, b text NOT NULL, reason text NOT NULL, PRIMARY KEY (a, b)   -- sorted pair; same-slot weak/strong messages with different text, both kept
);

CREATE TABLE health_analyses (
  id text NOT NULL, version integer NOT NULL,
  body jsonb NOT NULL, conditions jsonb NOT NULL, reassess_when jsonb NOT NULL,
  snapshot jsonb NOT NULL,            -- fact effective hashes, episode membership hashes, evidence versions
  author text NOT NULL, at timestamptz NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE TABLE health_evidence (id text PRIMARY KEY, version text NOT NULL, status text NOT NULL CHECK (status IN ('valid','withdrawn')));

-- Operational run log, kept apart from business rows: never part of any content digest.
CREATE TABLE health_import_runs (
  run_id text PRIMARY KEY, batch_id text NOT NULL, input_hash text NOT NULL, at timestamptz NOT NULL, counts jsonb NOT NULL
);
COMMIT;
-- Concurrency plan for the eventual repository: one transaction per import; INSERT ... ON CONFLICT DO NOTHING on
-- (kind,id,content_hash) and on health_links.id; version number taken with SELECT ... FOR UPDATE on health_entities;
-- corrections INSERT-only. Not yet exercised against a real Postgres.
