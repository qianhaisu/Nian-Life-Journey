# Quark connector

This directory is the project-side ingestion boundary for official Quark search artifacts, not a web runtime dependency. WorkBuddy is the only real CLI executor; project code consumes the resulting JSONL metadata and never receives a database password, OAuth token, cookie, or login flow.

## Current execution boundary

WorkBuddy owns authorization and official CLI execution. The project must not read WorkBuddy configuration, invoke `login`, `get-user-info`, or `search`, or download Quark files. The project-side artifact command only reads an explicitly supplied absolute `.jsonl` path and defaults to a dry run. There is intentionally no `--token` option for the CLI.

## Scope and output

Artifact ingestion is keyword-scoped, accepts at most 3000 non-empty JSONL rows, and does not enumerate a drive. An explicit folder, date window, cursor pagination, and full-drive sync are outside this path. A fake client keeps the older generic connector contract testable without real account access.

The pure parser can consume official NDJSON previews and artifact pointers, map metadata to `QuarkFile`, preserve official error codes/messages, and reject malformed output. It does not start a process, read a config file, or read a CLI runtime file.

The generic `syncQuarkScope()` contract remains available for injected/fake clients and imports by the idempotency key `provider=quark` plus `providerRef`. The project adapter does not provide a real CLI client for that legacy path; use artifact ingestion for WorkBuddy results.

## Internal boundaries

The connector may send already-mapped metadata to `/api/internal/ingest` with the separately scoped `INGESTION_TOKEN`. That endpoint returns structured Quark errors and is not a page dependency. `GET /api/internal/quark/status` is a read-only diagnostic protected by the same token; it reports status and official error information without returning raw CLI output, account data, tokens, or cookies.

Quark is never called during a page request. It does not scan an account by default. Originals remain represented by `MediaLocation(provider="quark", variant="original")`; web pages use ready Hot Storage derivatives only.

## Real usage flow: WorkBuddy search-artifact ingestion

VS Code Copilot cannot run the official CLI in this environment (contract smoke confirmed the authorization service returns `-104` for this Agent). WorkBuddy is the only real CLI executor. Project code never spawns `quark-drive.cjs`, never reads a WorkBuddy config file, and never runs `login`/`get-user-info`/`search` on the user's behalf. The real, verified flow is:

1. **WorkBuddy** runs the official CLI: `search --keyword "<关键词>" --size 3000`.
2. WorkBuddy reports the `type: "artifact"` line's `data.file_path` — the full JSONL result set (stdout's `file_list` is a 5-row preview only and must not be used as the input).
3. Run a dry run first, with the exact artifact path:
   ```bash
   npm run quark:ingest-artifact -- --artifact <absolute-jsonl-path> --keyword "<关键词>" --dry-run
   ```
   This is the default mode even without `--dry-run`; the script never calls the ingestion API, never touches `.data`, and never updates `connector_states` unless `--commit` is passed.
4. Review the printed `total` / `candidates` / `skipped` / `invalid` counts, then re-run with `--commit` to submit:
   ```bash
   npm run quark:ingest-artifact -- --artifact <absolute-jsonl-path> --keyword "<关键词>" --commit
   ```
   `--commit` requires `NIANLIFE_INGESTION_URL` and `INGESTION_TOKEN` in the environment; neither value is ever printed, logged, or echoed back. Submissions are batched (50 items by default, configurable with `--batch-size`) through the existing `/api/internal/ingest` endpoint, with each batch carrying its artifact count and position. Each request has its own timeout; a network failure or timeout marks that batch as failed rather than assumed-succeeded, and any skipped invalid row or failed batch causes a non-zero exit code.
5. This is a **keyword-scoped, selective import** — not a full-drive sync. Only `file === true` items with `category === 1` (video) or `category === 3` (photo) become a `MediaAsset` + `MediaLocation(provider="quark")`; the official `--category` filter is not trusted and is always re-checked locally. Folders, documents, archives, and other categories are counted as skipped, never imported. `providerRef=fid`; `sourcePath=path`; `sourceParentRef=parent_fid`; source `created_at`/`updated_at` are stored as provenance timestamps, while `capturedAt` and `checksum` remain null.
6. The official artifact directory is `<skill_dir>/scripts/search-results/<userId>/` and is cleaned up roughly 24 hours after it is written — read it promptly, and do not treat it as durable storage.
7. WorkBuddy credentials (its config, session, or account state) must never be committed to this repository, pushed to GitHub, or deployed to Vercel. The default `.quarkclouddrive/` runtime output directory is gitignored.

### Capability boundary

- `search-artifact` ingestion (above) is supported.
- Folder browsing, cursor-based pagination, and any `browse`/`list` request return `QUARK_CAPABILITY_UNSUPPORTED` — the CLI adapter never simulates pagination with a fake cursor.
- This connector does not claim full-drive sync. A `share`/`share-detail` command is never used to enumerate or sync a private drive folder.
- No checksum, EXIF, width/height, video duration, or stable download URL is available from the artifact metadata; `capturedAt` and `checksum` stay null. `big_thumbnail`/`check_link` are transient and are never persisted as an original location.
