# DailyTrace artifact identity vs. calendar-day grouping (2026-09-03)

> **Status: FIXED IN THE APPLICATION LAYER. NO MIGRATION REQUIRED.** `persistDailyTrace()` now
> dedups by `organizationFingerprint` alone. The `(profileId, day)` fallback that Canary #1 found is
> gone, so a new evidence-organizer trace can never adopt a legacy rule trace's row, id, provenance
> or review state. The read path already grouped several trace rows into one calendar day, and
> production already contains 17 such days, so nothing downstream had to change.
>
> The audit behind every number here is `v2/scripts/organizer-trace-provenance-audit.mjs`
> (SELECT-only, run 2026-09-03). No row in `daily_traces`, `life_events` or
> `content_quality_reviews` was inserted, updated or deleted.

## 1. What Canary #1 found, and what it actually was

Canary #1 recorded the hazard as "merge into an already-approved rule trace, inheriting its
approval". That is real but it is the smaller half. The full mechanism:

```
persistDailyTrace(trace)
  → SELECT by organizationFingerprint            -- miss: this is a new artifact
  → SELECT any trace with the same (profileId, day)  -- HIT: every day has a rule trace
  → UPDATE that row:  entries ∪= new, sourceIds ∪= new,
                      organizerRun := the INCOMING run     ← the damage
                      organizationFingerprint := existing  ← the new identity is discarded
```

Three separate failures in one statement, at
[`postgres-repository.ts:646`](../v2/lib/db/postgres-repository.ts) (and the same shape in
`json-repository.ts`):

1. **Publication escalation.** `requiresQualityReview()` reads `organizerRun.organizerType`. Rule
   provenance is fail-closed: no ledger row means hidden. AI provenance is fail-open: no ledger row
   means published. Overwriting `organizerRun` flips a legacy row from the first to the second.
2. **Approval inheritance.** The row keeps its id, so the ledger lookup still finds its `approved`
   decision while the entries are new and unreviewed.
3. **Identity loss.** The incoming fingerprint is thrown away (`existing ?? incoming`), so replaying
   the same evidence would not find the row by fingerprint and would merge again.

### How much of production was exposed

| | traces | what a merge would have done |
| --- | --- | --- |
| rule provenance, **no ledger row** | **101** | hidden only by the provenance check → **publishes itself** |
| rule provenance, `approved` | **33** | absorbs unreviewed evidence entries under the old approval |
| explicit `store_only` / `rejected_unrelated` / `needs_human_review` | 37 | safe — an explicit decision still fails closed |
| **total** | **171** | **134 of 171 unsafe** |

All 171 traces are rule-derived; none is AI-derived yet. 33 of 171 pass the publication gate today,
138 are hidden. Those 101 rows link 4–186 raw messages each, so the escalation would not have been
a cosmetic change — it would have published whole days of raw chat.

## 2. The model

**Identity is the fingerprint. The calendar day is a presentation grouping key.**

The read path already implements the second half and always has —
[`memory-chapters.ts:135`](../v2/lib/memory-chapters.ts): *"Several DailyTrace rows can land on one
day; the reader only cares that the day was noticed."* `buildChapters()` folds every trace on a day
into one `TraceDay` and concatenates their entries. Production already has **17 days carrying two
rows**, and they render as single days today.

So the fix is one rule, and it is subtraction rather than addition:

| incoming trace | behaviour |
| --- | --- |
| fingerprint matches an existing row | merge into it — same evidence, same artifact, idempotent replay |
| fingerprint matches nothing | **INSERT**, even if the day already holds traces |
| no fingerprint | **INSERT** — no identity means no dedup claim, and never adoption |

Fingerprint composition is unchanged and deliberately excludes generated prose: it is derived from
the conversation, the day and the set of source ids, so re-running the Writer over the same evidence
does not create a new artifact, and different evidence on the same day is a different artifact.

`daily_traces` now behaves exactly like `life_events` and `organizer_runs`, which have always
deduped on fingerprint alone.

## 3. Why there is no migration

The one-row-per-day rule lived **only in application code**. `daily_traces` has a plain index on
`organization_fingerprint` and a plain index on `profile_id`
([`0004_platform_foundation.sql`](../v2/drizzle/0004_platform_foundation.sql)) — no unique
constraint, no `(profile_id, day)` constraint, nothing that forbids several rows per day. Removing
the fallback therefore needed no schema change, no data rewrite, no backfill, and no production
migration was executed in this session.

Legacy ids stay valid, source links stay bound, and every existing review decision stays attached to
the artifact it was made about.

## 4. A separate pre-existing defect: fingerprint is not a key

The audit turned up something Canary #1 did not look for. **171 trace rows carry only 154 distinct
fingerprints: 17 collision pairs.** Every pair is same-day, created 0.1–13 seconds apart on
2026-09-02 by the rule-organizer backfill, and 6 pairs are byte-identical in entries and source
count.

The cause is that `persistDailyTrace()` does SELECT-then-INSERT under READ COMMITTED with no
constraint to catch a lost race. `persistOrganization()` and `persistOrganizerRun()` both guard the
same pattern with `onConflictDoNothing({ target: organizationFingerprint })` because their tables
have unique indexes; `daily_traces` does not, so concurrent backfill workers both missed the SELECT
and both inserted.

This predates the change above and is unaffected by it. It matters because it means fingerprint —
now the whole identity — is not currently enforced as a key.

**Not fixed here, because every available fix needs Teddy's authorisation.** A plain
`CREATE UNIQUE INDEX` cannot be created while the 17 pairs exist. The options are:

1. **Partial unique index** — `CREATE UNIQUE INDEX CONCURRENTLY … ON daily_traces
   (organization_fingerprint) WHERE created_at > '<cutoff>'`. Additive, non-destructive, leaves the
   17 legacy rows untouched, and enforces the key on every future write. This is the recommended
   one, and it is a production migration, which this session had no need to run.
2. **Resolve the 17 pairs first**, then a full unique index. That means merging or deleting existing
   business records — squarely inside the "needs Teddy's confirmation" list in CLAUDE.md.

Until one is applied, the app-level guard is the only protection, and it is sufficient for a
single-threaded bounded canary but not for a concurrent bulk run.

## 5. What is pinned by tests

- [`v2/test/organizer-dailytrace-identity.test.mjs`](../v2/test/organizer-dailytrace-identity.test.mjs)
  — 6 pure-function cases over `quality-review.ts` and `buildChapters()`. Two are named
  `REGRESSION:` and assert the exact publication damage a day-merge caused, so anyone reintroducing
  one sees what they are turning back on. One asserts that several artifacts on a day still render
  as one day.
- [`v2/test/repository-contract.test.mjs`](../v2/test/repository-contract.test.mjs) — 4 new cases
  run against **both** backends: a new evidence trace does not merge into an existing trace on the
  same day and leaves its `entries`, `sourceIds` and `organizerRun` untouched; replaying the same
  evidence is idempotent and adds no third row; different evidence on one day yields distinct
  artifacts; a trace with no fingerprint gets its own row rather than adopting one.

## 6. The remaining review-lifecycle gap (not a regression, but a cutover decision)

With provenance separated, a new evidence trace gets its own ledger key and cannot inherit anything.
But AI-derived artifacts are **fail-open**: `requiresQualityReview()` returns false for them, so an
evidence trace with no ledger row publishes immediately. Nothing is exposed today (there are zero
AI-derived artifacts), and the canary writes an explicit gating row, but at cutover this is the
difference between "the evidence organizer fills the site" and "the evidence organizer proposes and
a human accepts". It is pinned as a test so the behaviour is at least explicit, and it belongs in
the cutover decision list rather than being silently flipped here.
