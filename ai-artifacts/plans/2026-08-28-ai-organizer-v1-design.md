# Nian Life V2 — AI Organizer V1

## Outcome

Add a runnable AI Memory Organizer without changing Quark authorization, R2, Hot Storage, or core media models. The existing capture and connector paths continue to work when AI is disabled or unavailable.

## Chosen approach

Use a thin provider boundary and keep application ownership of persistence:

```text
RawSource
  -> deterministic pre-group
  -> OrganizerContext
  -> AIProvider
  -> strict OrganizerDecision
  -> schema + provenance + safety policy
  -> JSON/PostgreSQL repository mutation
```

`OpenAICompatibleProvider` is the single real provider in V1 and uses the configured `AI_MODEL`/`AI_API_KEY`; `MockAIProvider` is used by synthetic evaluation. Business code depends on `MemoryOrganizer`, with `AIMemoryOrganizer` and `RuleBasedMemoryOrganizer` behind the factory.

## Data and privacy boundaries

- Context contains source text, safe metadata, nearby memory summaries, media metadata, and at most the configured number of representative inputs.
- Images are read only from ready Hot Storage `thumbnail` derivatives, falling back to `web`; videos use poster derivatives and metadata only. No Quark original path is read by the resolver.
- PDFs do not enter an OCR pipeline. Existing reliable text can be passed as source text.
- Raw evidence is never overwritten. AI can propose Story/classification/relationships, while contributor text remains on the RawSource.
- Organizer runs store version, provider/model, prompt version, fingerprint, counts, latency, optional token usage, and fallback reason—never secrets or raw content.

## Policy

The policy prefers `attach_existing` and `daily_trace`, caps ordinary material below `chapter`, removes narrative from `daily_trace`/`store_only`/`care_episode`, rejects invalid source/event IDs and impossible dates, rejects unsupported first-time claims, and turns medical material into a private fact-only Care Episode. Any provider, schema, or policy failure falls back to RuleBased organization.

## State and idempotency

Capture marks a source `uploaded -> processing -> organized`. An organization fingerprint is derived from sorted RawSource IDs, captured timestamps, media IDs/checksums, and organizer version. Re-running a successful AI batch returns the recorded result without another provider call; explicit `reorganizeSources()` can force a new application decision while retaining RawSource evidence.

## Verification

Synthetic fixtures cover ordinary daycare, explicit milestone, related video, high-volume ordinary material, one sentence, travel, medical, and uncertain image cases. Tests additionally cover create/daily/attach, invalid schema, timeout, medical inference, invalid target, idempotency, safe fallback, and configured-provider absence. The release checks are `npm run typecheck`, `npm test`, `npm run lint`, and `npm run build`.

## Rejected alternatives

- Direct LLM-to-database mutation: rejected because model output must remain a proposal.
- Sending every original/full-size image: rejected for privacy and cost; derivative-only representative sampling is sufficient for V1.
- Multiple provider SDKs: rejected to keep the first integration small and replaceable.
- Candidate approval/review queue: rejected because V2 preserves zero-confirmation ingestion.
- Full video transcription, FFmpeg, and OCR: deferred; outside V1 source guarantees.
