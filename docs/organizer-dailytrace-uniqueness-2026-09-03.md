# DailyTrace fingerprint uniqueness — 17 collision pairs consolidated, constraint applied (2026-09-03)

> **Status: DAILYTRACE UNIQUENESS COMPLETE.** All 17 duplicate-fingerprint groups were audited,
> consolidated inside one transaction, and the fingerprint is now a database-enforced unique key.
> Production went from 171 DailyTrace rows / 154 distinct fingerprints to **154 / 154, zero duplicate
> groups**. LifeEvents (82), quality reviews (105), organizer_runs (304), raw_sources (8,796) and
> media_assets (1,011) are unchanged.

## 1. What the collisions were, and what caused them

`persistDailyTrace()` does SELECT-then-INSERT. Under READ COMMITTED the second worker cannot see the
first's uncommitted row, so two workers organizing the *same* evidence both miss and both insert.
Every one of the 17 groups fits that signature exactly: same fingerprint, same profile, same
`occurred_at`, same scopes, same visibility, all rule-derived, inserted 0.4–19 seconds apart.

The divergence *inside* seven of those groups has a second, already-fixed cause. The same-day merge
removed in `573f4cc` appended later batches to whichever row it found first, and it replaced
`organizerRun` wholesale while keeping the row's original fingerprint. The fingerprint is that row's
evidence identity, so the corruption is directly visible:

| | rows | `run.sourceCount` vs row's `sourceIds` | run fingerprint matches column |
| --- | --- | --- | --- |
| 10 groups | byte-identical | equal on both rows | both, or neither |
| 6 groups | one row dominates | pristine row equal; other row's run counts FEWER | exactly one |
| 1 group (`f508916…`) | neither dominates | both rows' runs count fewer | neither |

In `141abbd…` the surviving row carries 20 sources while its `organizerRun` records 9 and names a
*different* fingerprint (`eb864ccd…`) — the later batch it absorbed. That is the day-merge, not the
race.

## 2. Why consolidation was not a judgement call

Had the race not happened, the second call would have found the first row and taken the merge branch,
which is literally:

```
entries:   [...new Set([...existing.entries,   ...incoming.entries])]
sourceIds: [...new Set([...existing.sourceIds, ...incoming.sourceIds])]
```

The remediation applies that same merge to the rows that exist. It is not a new consolidation
semantic invented for a migration — it is the repository's own, replayed. That is what dissolves the
apparent ambiguity in `f508916…`, where neither row dominates: both rows are one identity holding a
partial accretion, and the union is what a single row would have held.

**Display impact: none, in the direction that matters.** `memory-chapters.ts` already concatenates
the entries of *every* trace on a day into one `TraceDay`, so the family already saw the union —
twice over for any line both rows held. Consolidation removes that doubling. And all 34 rows are
rule-derived with **zero** ledger rows, so `isTracePublishable()` was false for every one: none was
on the site, and none became visible.

## 3. Deterministic rules

| field | rule |
| --- | --- |
| survivor | earliest `created_at`, ties broken by `id` ascending — the row a non-racing run keeps |
| `entries` | union, survivor-first, de-duplicated (the repository's merge) |
| `sourceIds` | union, survivor-first, de-duplicated (the repository's merge) |
| `organizerRun` | the run whose `organizationFingerprint` equals the row's, else earliest `processedAt` — repairs the day-merge's foreign run rather than propagating it. Cannot change publication state: `requiresQualityReview()` reads `organizerType`, which is `rule` on all 34 |
| `occurredAt` / `scopes` / `visibility` / `profileId` | asserted EQUAL across the group and carried through; the script aborts rather than picking |

The script refuses outright if any row in a group carries a `content_quality_reviews` row, and
asserts losslessness per group (every entry and source id present anywhere must be present after).
Nothing else in the schema points at a `daily_traces` row — zero foreign keys reference it, and
`source_memory_links` targets `life_events` only — so there was nothing to repoint.

## 4. What was executed

`scripts/organizer-trace-fingerprint-remediate.mjs`, dry-run first, then `--apply`. One transaction:
17 UPDATEs, 17 DELETEs, with in-transaction verification that zero duplicate groups remain and the
row count matches `before - deleted`, rolling back otherwise.

- 15 groups: pure de-duplication (survivor already held everything; `entries +0`, `sources +0`).
- 2 groups: the survivor **gained** — `a3e0f86…` +1 entry / +3 sources, `f508916…` +1 entry / +11
  sources. No group lost anything.

Then `drizzle/0010_dt_fingerprint_unique.sql` replaced the plain index with
`daily_traces_fingerprint_unique_idx`, mirroring `0009_le_fingerprint_unique.sql`. Verified
`indisvalid = true`.

**Recovery material.** The complete pre-state of all 34 rows — `id`, `entries`, `sourceIds`,
`organizerRun`, `occurredAt`, `scopes`, `visibility`, `profileId`, `createdAt`, `updatedAt` — plus
the full consolidation plan, was captured before the write to:

```
C:\Users\teddy\AppData\Local\Temp\claude\c--Users-teddy-Documents-Nianlife\
  5320298d-14df-4107-97b9-6ef26fa3d8c4\scratchpad\trace-before-applied.json
```

It carries family chat text and is deliberately outside the repository. Every deleted row can be
reconstructed from it column-for-column. `trace-before.json` in the same directory is the identical
capture from the dry run.

## 5. The constraint alone was not enough

Adding the unique index turns a lost race from a silent duplicate into a `23505`. Two further code
changes were required, and the tests found both:

1. **The 23505 must not become a 500.** Losing the race is a normal outcome and both callers are
   entitled to the same artifact, so `persistDailyTrace()` retries once in a *fresh* transaction —
   outside the failed one, because a statement error aborts the whole transaction in Postgres. The
   first attempt at this silently never fired: Drizzle wraps the driver error in
   `DrizzleQueryError` and puts the pg error on `cause`, so `error.code` is not `23505` at the top
   level. `isUniqueViolation()` walks the cause chain.

2. **The merge branch needed `FOR UPDATE`.** The unique index stops a duplicate *row*; it does
   nothing about the read-modify-write on `entries`/`sourceIds`. A five-writer race reproduced the
   consequence: two retriers both read the same arrays, both computed a union missing the other's
   contribution, and the last UPDATE dropped an entry. The two-writer test passed on timing alone.
   Row-level locking serialises the mergers.

## 6. Tests

`test/organizer-dailytrace-uniqueness.test.mjs`, 8 cases, all passing against the real database
(skipped, never faked, without `CONTRACT_DATABASE_URL`):

- the unique index exists and is unique
- two concurrent writes of one fingerprint → one artifact, both callers resolve to the same id,
  union of entries
- a concurrent write links every source and writes no review decision
- **five** concurrent writers → one artifact, no entry lost
- two different fingerprints on one day → two artifacts, folded into one `TraceDay` by the read layer
- sequential replay is idempotent — no second row, no duplicate entry, no duplicate source link
- a fingerprint-less trace still has no identity to collide on (Postgres treats NULLs as distinct)

Alongside: `organizer-dailytrace-identity`, `organizer-trace-retention`, `organizer-claim-grounding`,
`organizer-grounding-invariants`, `organizer-subject-continuity` and the new
`organizer-promotion-eligibility` — 88 cases, 0 failures.

## 7. Production safety

Read-only verification after the write:

| | before | after |
| --- | --- | --- |
| daily_traces | 171 | **154** |
| distinct fingerprints | 154 | **154** |
| duplicate groups | 17 | **0** |
| life_events | 82 | 82 |
| content_quality_reviews | 105 | 105 |
| organizer_runs | 304 | 304 |
| raw_sources | 8,796 | 8,796 |
| media_assets | 1,011 | 1,011 |

No open transaction and no other active backend on the database at completion; no organizer job has
run in over 24 hours. Test rows were deleted by id; zero `profile-contract-test-fixture` trace rows
remain.
