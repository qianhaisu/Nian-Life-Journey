# Quark connector

This directory is an ingestion connector boundary, not a web runtime dependency. The connector must use the official quarkclouddrive skill/client for OAuth and stable file identifiers; it must never receive the production database password.

Run it from WSL or a Linux host once the official skill is installed. Scope the first sync to an explicit folder, date window, or query. Persist the returned cursor and providerRef in connector_states/media_locations so repeated runs are idempotent.

The connector sends metadata to /api/internal/ingest with a separately scoped INGESTION_TOKEN. It does not scan the whole Quark account and it does not call Quark during page requests.
