# Nian Life V2 - Hybrid Media Architecture

## Storage contract

PostgreSQL stores metadata and relationships. Binary data stays outside the
database:

    RawSource -> MediaAsset -> MediaLocation[]
                             |-> quark / original
                             |-> hot / thumbnail, web, poster, preview, document_preview

MediaAsset is one logical photo or video. It stores type, MIME type,
dimensions, duration, capture time, checksum, and original filename. It does
not store a provider URL. MediaLocation stores provider, variant, stable
providerRef, status, and optional dimensions. Memory and LifeEvent reference
media assets and never store a provider URL.

Quark is the long-term Original Vault. Hot Storage is Web Delivery. The
development adapter is local and credential-free; production will select one
private S3-compatible provider behind lib/storage/hot-storage.ts.

## Ingestion

There is one business flow with two entry paths:

    Website upload -> hot staging -> RawSource -> existing Organizer -> Memory
    Quark backup   -> connector/API -> RawSource -> existing Organizer -> Memory

Website originals begin as awaiting_archive. A connector archives them to the
Nian Quark Archive area, verifies checksum and size, and only then allows a
retention job to remove the staging copy. Quark originals are never
automatically deleted. Existing automatic RuleBasedMemoryOrganizer and
source_memory_links remain unchanged; there is no candidate confirmation queue.

The connector requires an explicit folder, query, or date window. It persists a
cursor and version in connector_states. Quark imports are idempotent by provider
plus providerRef. The connector calls the authenticated internal ingest API
with a separately scoped INGESTION_TOKEN and never receives the production
database password.

## Delivery policy

Images use two WebP targets: approximately 480px thumbnail and 1280px web.
Timeline and Home use those derivatives with lazy loading and intrinsic
dimensions. Video timelines load poster only; preview is optional and may be
generated later for meaningful Memories. PDF and medical originals remain in
Quark and only a controlled document preview is delivered. Medical visibility
is private by default.

Quark is never called during a page request. If it is unavailable, Home and
Memory continue to render from ready Hot Storage locations or local fallback.
The media route rejects private media and refuses unsafe object paths.

## Backup and migration

A Postgres dump must be paired with an exported media manifest containing
mediaAssetId, checksum, Quark providerRef, hot derivative locations, statuses,
and life-event links. This lets providers change without changing Memory or
LifeEvent.

The repository has two adapters:

    development -> Local JSON Repository and .data/media
    production  -> PostgreSQL Repository and selected Hot Storage provider

No provider credential, OAuth token, AUTH_SECRET, DATABASE_URL, or ingestion
token is committed. The connector remains an official-client boundary rather
than a fabricated API implementation. When the official skill is available in
WSL or another Linux host, it supplies list, download, archive, and verify
implementations; without that configuration, the interfaces, explicit-scope
import path, idempotency, and recovery state machine remain locally testable.

## Storage Phase 2 decisions

Quark is a family-instance infrastructure binding, not a Nian user
integration. One family has one hidden `original_vault` binding. OAuth state is
stored on `connector_states`; ordinary Home, Memory, About, and Capture flows
never expose a Quark login or call Quark during a page request.

Direct upload writes an original to Hot Storage staging, computes SHA-256, and
generates only two image derivatives: orientation-normalized WebP thumbnail
(max width 480) and WebP web (max width 1280). The source aspect ratio is
preserved with `fit: inside`; video gets a lightweight poster placeholder and
PDF gets a document placeholder, with no FFmpeg/HLS/PDF rendering service.

The archive worker processes pending staging originals independently of the
user flow. It must receive a stable Quark `providerRef`, verify existence and
size (and checksum when the provider reports support), persist the verified
Quark location, and only then delete the staging object. Auth loss changes the
family connector to `auth_required` and the asset to `paused_auth_required`
while retaining the staging location as `awaiting_archive`. Non-auth failures
are recorded as `archive_failed`; neither case blocks existing media reads or
new uploads.

Hot Storage has a credential-free Local adapter and a Cloudflare R2 adapter
selected by `MEDIA_STORAGE_PROVIDER`. R2 configuration is lazy and validated
only when `r2` is selected, so development remains runnable without secrets.
The media route accepts only ready Hot derivatives. It never falls back to a
Quark or staging original; original retrieval is reserved for an explicit,
authenticated archive workflow that is not part of normal page rendering.

The connector's two directions share the same model:

```text
Nian upload -> Hot staging -> archive worker -> Quark original
Quark backup -> explicit scope -> RawSource -> Organizer -> Memory
```

`media-manifest.json` is the migration artifact containing `mediaAssetId`,
checksum, verified Quark original, Hot derivatives, archive state, and
life-event links. Quark folders are never treated as the database or as a
signal that a memory has been organized.
