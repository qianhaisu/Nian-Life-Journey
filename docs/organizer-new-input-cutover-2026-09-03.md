# New-input V2 cutover — implementation record (2026-09-03)

Status: **NEW-INPUT V2 CUTOVER READY — NOT SWITCHED.** Production default is still
`legacy-rule-v2 v2=off`. Activation is a Vercel environment change, which CLAUDE.md
reserves for Teddy (「修改生产环境变量或密钥」).

This closes the three implementation issues left open by
[Organizer Canary #2](organizer-memory-canary-2026-09-03.md). No production row was
written, read or reprocessed by this work; the only database writes were fixture
ledger rows under `profile-contract-test-fixture`, deleted by the same run.

## 1. Repository quality-review API

`Repository` gained two typed methods, implemented on **both** backends:

```ts
persistQualityReview(review: QualityReview): Promise<QualityReview>;
findQualityReview(targetKind, targetId, promptVersion): Promise<QualityReview | null>;
```

Identity is the ledger's own unique key `(target_kind, target_id, prompt_version)`, the
semantics the RC-12 canary proved: insert `on conflict do nothing`, then read back and
return the stored row. A repeat is a no-op that returns what is already there — so a retry
after a partial failure repairs the batch instead of duplicating the ledger, and a decision
a human has since revisited is never silently reverted by a worker. A *new* decision on the
same artifact is a new `promptVersion`, i.e. a new row.

`Store` gained `qualityReviews`, so the JSON backend has somewhere to put a review and the
ledger is readable through the repository rather than through the PostgreSQL adapter's own
private helper.

Verified on PostgreSQL (bounded run, fixture profile, self-cleaning): create + read back,
replay writes no second row and never overwrites, independent artifacts and review rounds
keep independent decisions, unknown artifact returns null, out-of-union decision text reads
back fail-closed, `getOrganizerWindowInput` reads one job's sources and their media. 张年's
107 ledger rows were untouched.

## 2. One typed decision

The adapter used to write the literal `needs_review`, which is the Memory Editor's
`reviewRequirement` vocabulary, not a `QualityDecision`. It stayed unpublished only because
everything that is not `approved` is unpublished — a coincidence, not a guarantee.

- `QualityReviewPlan.decision` is now `QualityDecision`, and the adapter writes exactly one
  value: `ADAPTER_REVIEW_DECISION = "needs_human_review"`.
- `normalizeQualityDecision()` is the single read-time interpretation: anything outside the
  union — including the existing RC-12 row's `needs_review` — becomes `needs_human_review`.
  Fail-closed, and **nothing rewrites the stored row**; the canary row stays exactly as it
  was written and stays auditable.
- `indexReviews()` normalizes, so every publication decision goes through it.

## 3. No canary-only persistence path

`scripts/organizer-v2-memory-canary.mjs` no longer carries a raw `insert into
content_quality_reviews`. It calls `Repository.persistQualityReview`, the same method the
worker uses. RC-12's production rows were **not** rewritten: the canary's replay stage is
refused by the run guard, and a repeat of its ledger write would be a no-op on the same
unique key. Equivalence is proven by fixtures and dry runs, not by re-writing production.

`applyPlan` also now recognises `life_event_candidate` as a Memory-producing run action, so
a replay of a V2 Memory reports its artifact id instead of nothing.

## 4. DailyTrace semantics (frozen)

Already true in code, now pinned by a test that goes through the real repository:

- a calendar day is a **presentation grouping key**, never artifact identity;
- several independent DailyTrace artifacts may exist on one day;
- a V2 trace on a day that already holds a legacy trace is a **second artifact** — the
  legacy row's entries, `organizerRun` and approval are untouched, and the new artifact
  inherits none of its publication state;
- identity is `organizationFingerprint` alone; there is no date-based merge.

## 5. New-input-only boundary

How work reaches an organizer, exhaustively: `enqueueOrganizerJob` is called from exactly
two places — capture (`app/actions.ts`) and Quark ingest (`lib/ingest/quark.ts`) — and the
worker (`lib/organizer/worker.ts`) only ever processes rows of `organizer_jobs`. Nothing in
the codebase enqueues existing rows, and this change adds nothing that does.

The selector therefore gained a second scope:

| scope | boundary | env |
|---|---|---|
| `allowlist` (unchanged) | jobs whose every source id is named | `ORGANIZER_V2_SOURCE_ALLOWLIST` |
| `new_input` (new) | jobs **created after** an activation instant | `ORGANIZER_V2_NEW_INPUT_AFTER` |

`jobUsesV2` refuses, in new-input scope: a job created at or before the instant, a job with
no creation time (never assumed new), and any `force` re-organization (by definition aimed
at evidence already organized). Setting both boundaries, setting neither, or an unparseable
instant is a loud startup error — V2 never silently degrades to legacy.

Consequence: the 8,796 RawSources, 83 LifeEvents, 155 DailyTraces, the WeChat corpus and the
Quark corpus stay exactly as they are. The legacy supersede/repoint problem from Canary #2 §6
is therefore **not** a blocker for this cutover — it belongs to the later Full-history
Recalibration.

## 6. Worker wiring

`getOrganizerForJob(job, env)` routes per job and returns the organizer plus a one-line
description; `worker.ts` logs it for every job:

```
[organizer] job=<id> sources=N organizer=organizer-v2-adapter-v1 v2=on
  judgment=judgment-v6-frozen writer=writer-v2 prompt=memory-editor-v4
  policy=evidence-contract-v1 media=[confirmed] scope=new_input after=<ISO> job=v2
```

New modules:

- `lib/organizer/v2-pipeline.ts` — Judgment and Writer as a dependency instead of a script.
  One live call each, no retries (a retried Judgment is "ask until it promotes"; a retried
  Writer is a second story for one evidence set). The frozen V6 router's V4 worthiness axis
  is shape-checked, not asserted.
- `lib/organizer/v2-organizer.ts` — the worker-facing organizer: repository read by source
  id → Evidence Builder → fingerprint → **run guard before any model call** → pipeline →
  `planArtifacts` → `applyPlan` through Repository methods only. Honors `dryRun`.

A Memory route whose page the Writer declines (or the Narrative Validator rejects) is
recorded as a `store_only` run carrying the reason. It is **not** downgraded into a
DailyTrace and **not** rewritten with weaker prose: a trace is a different claim than the one
Judgment made, and manufacturing it would be the adapter inventing a route.

## 7. Worker-level dry run (Phase 8/9)

There is no unseen production-eligible input: `organizer_jobs` holds 13 rows, all
`succeeded`, newest 2026-08-31; all 8,796 raw sources are `organized`. Per the plan, no input
was fabricated — the worker-level dry run stands in for the bounded smoke.

`scripts/organizer-v2-worker-dryrun.mjs` runs the real chain with two guards: every
repository **write** method throws if called, and the pipeline is a fixture (no model call,
no cost). Result over one real source, read-only:

```
route new job     V2 (EvidenceOrganizerV2)   … scope=new_input job=v2
route old job     legacy (RuleBasedMemoryOrganizer)
route forced job  legacy
read              sources=1 media=1 assets=1 locations=4 profile=profile-zhangnian
fingerprint       f0b7f7ba…e179     existing run (none)
PLANNED           create_memory / run.action=life_event_candidate
                  artifact event-v2-cacb66a1fb7a026129e4d857fccb5340, 1 source
repository writes attempted: none
WORKER DRY RUN CLEAN
```

## 8. What activation would take (not done)

```
ORGANIZER_V2_ENABLED=true
ORGANIZER_V2_JUDGMENT_POLICY=judgment-v6-frozen
ORGANIZER_V2_WRITER_VERSION=writer-v2
ORGANIZER_V2_PROMPT_VERSION=memory-editor-v4
ORGANIZER_V2_MODEL=<the DeepSeek model id>
ORGANIZER_V2_NEW_INPUT_AFTER=<the activation instant, ISO>
# and leave ORGANIZER_V2_SOURCE_ALLOWLIST unset
```

Rollback is unsetting `ORGANIZER_V2_ENABLED` (or moving the instant): one variable, no
deploy of code, no data change. Activation schedules no work — it changes only how the next
job that arrives is routed.

Before switching, two things are worth knowing:

1. **Recall is unproven on unseen windows.** V6 promoted 0 Memories from 115 fresh windows;
   Holdout V3 recall was 0/2. A new-input cutover is safe (nothing publishes without a human
   approving the ledger row) but should be expected to produce mostly `store_only` and traces
   at first.
2. **Latency.** Judgment plus Writer is roughly 15–30 s per Memory, inside a worker whose
   route drains up to 25 jobs per invocation. The queue is the async boundary, but the
   platform's function timeout is the real ceiling — worth a look before high-volume ingest.
