# Quark connector

This directory is an ingestion connector boundary, not a web runtime dependency. It uses the official `quarkclouddrive` CLI for stable file identifiers and file reads; it never receives a database password and it never handles an OAuth token, cookie, or login flow.

## Current authorization boundary

The official Quark authorization service does not support the VS Code GitHub Copilot Agent runtime. In this environment, authorization and user-info checks can return the official result `-104` with `无法识别当前 Agent 环境，禁止继续使用`. Do not work around that response or paste credentials into the connector.

Authorize the official Skill once in an Agent environment that it supports, such as the documented WSL/Linux host. After that authorization succeeds, the adapter needs no code change and the only V2 sync command is:

```bash
npm run quark:sync -- --query "张年家庭照片"
```

Optional flags are `--profile-id`, `--contributor-id`, `--visibility`, `--max-retries`, and `--session-input`. The session input should be the original user request when an agent is invoking the command. There is intentionally no `--token` option.

## Scope and output

The shared connector contract accepts an explicit folder, date window, keyword, or cursor. The official CLI adapter currently supports only one keyword query because the documented `search` command is keyword-based, allows at most 3000 results, and does not provide pagination. It rejects folder/date/cursor requests rather than silently broadening the scope. A fake client keeps cursor pagination and retry behavior testable without real account access.

The CLI emits NDJSON. The adapter consumes `result`, `progress`, `list`, and `artifact` records, maps search metadata to `QuarkFile`, preserves official error codes/messages, and rejects malformed output. `read-file` results are read only from the CLI runtime directory; provider references and returned paths are validated before use. CLI processes are started with an argument array and `shell: false`.

`syncQuarkScope()` performs a read-only auth check when the client provides one, retries only retryable list/import failures, persists cursor and connector status, and imports by the idempotency key `provider=quark` plus `providerRef`. An auth or unsupported-agent error is recorded as `auth_required` and stops before any `MediaAsset`, `MediaLocation`, or `RawSource` write.

## Internal boundaries

The connector may send already-mapped metadata to `/api/internal/ingest` with the separately scoped `INGESTION_TOKEN`. That endpoint returns structured Quark errors and is not a page dependency. `GET /api/internal/quark/status` is a read-only diagnostic protected by the same token; it reports status and official error information without returning raw CLI output, account data, tokens, or cookies.

Quark is never called during a page request. It does not scan an account by default. Originals remain represented by `MediaLocation(provider="quark", variant="original")`; web pages use ready Hot Storage derivatives only.
