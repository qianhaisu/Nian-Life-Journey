# V2 Production Adapter — 2026-09-03

**Status: V2 PRODUCTION ADAPTER READY FOR CANARY — with one gap the Canary design must respect.**

The adapter is built, tested and dry-run against production with zero collisions. The gap is not a
defect in it: **frozen V6 produces no Memory route on any available corpus**, so the Memory path is
proven by fixtures and not yet by production input. A Canary that must include ≥1 Memory cannot be
satisfied from the corpora that exist.

No production writes were made.

---

## 1. Architecture before

**Legacy (what actually runs):**

```
POST /api/internal/organizer-worker → runOrganizerWorker → processOneJob
  → getConfiguredOrganizer().organize()          MEMORY_ORGANIZER defaults to "rule"
  → RuleBasedMemoryOrganizer
      idempotency  findOrganizerRun(organizationFingerprint) short-circuits
      create_memory  persistOrganization(sourceIds, event, links) + persistOrganizerRun
      daily_trace    persistDailyTrace({…organizationFingerprint}) + persistOrganizerRun
      store_only     markSourcesOrganized + persistOrganizerRun
      care_episode   persistCareEpisode + persistOrganizerRun
      reviews        never written
```

**V2 (what was evaluated):** `runPipeline` → Evidence → Grounding → Judgment → Validator →
`upsertMemoryCandidate`, **and stops**. Nothing converted a candidate into an artifact. All 82
LifeEvents and 154 DailyTraces are `created_by: rule`.

## 2. Adapter design

One boundary, split into a **pure planner** and a **thin applier**. `planArtifacts` touches no
database, so every safety rule is decided before a row is written and the dry run inspects the same
object the tests assert on.

Its one rule: **it persists a decision, it never makes one.** Nothing re-reads evidence, re-scores
worthiness or reconsiders a route.

## 3. Memory persistence

`life_event_candidate` → LifeEvent + source links + review row + run. Requires Writer output; a
Memory route without it throws rather than inventing a title. A story arriving on a `store_only`
route does not resurrect a Memory.

## 4. DailyTrace persistence

`daily_trace` → DailyTrace keyed by `organizationFingerprint`, carrying evidence lines, **no media
links and no review row** — a trace is provenance, not published prose. The 171→154 remediation is
untouched: identity is the fingerprint, the calendar day remains a presentation grouping.

`store_only` and `plan_marker` create **no artifact at all**; a route that did not say "trace" never
produces one.

## 5. Provenance

Source ids must be a subset of the evidence window; an outcome citing anything else throws. Links
cover exactly those sources, one `primary` and the rest `supporting`. The adapter never widens a
source set and never infers one from a date.

## 6. Media-link enforcement

| tier | attachable | narratable |
|---|---|---|
| confirmed | yes | yes |
| strong_contextual | only if the policy opts in | **no** |
| day_level / month_level / unbound | **never** | no |

`assertPolicy` **refuses** a policy that lists a non-attachable tier — a config typo cannot attach a
same-day Quark photo. A Writer naming media the window does not contain is refused, not written. No
linked media means **no hero**, never a borrowed one. A confirmed **video** links even though its
derivative is unavailable: the 120 backfilled videos are original-only, and "cannot play it yet" is
not "not evidence".

## 7. Review independence — and a hole closed

`requiresQualityReview` only flagged *rule* artifacts, and `isEventPublishable` fell back to
provenance when no ledger row existed. **So an AI artifact with no row published.** That was safe
only while no AI artifact could exist. Under the adapter it would mean a generated Memory whose
review row failed to write appears to the family immediately.

AI provenance is now fail-closed (`b6045d3`). Affects zero existing rows. Three tests that asserted
the old behaviour were updated, not deleted — they were *documenting* the hazard (one called it "the
fail-open") rather than defending it.

Every adapter Memory gets its own row, `needs_review`, keyed `(targetKind, targetId, promptVersion)`.
A sibling artifact's approval cannot leak across ids.

## 8. OrganizerRun lifecycle

`findOrganizerRun(fingerprint)` short-circuits a replay — the same guard, keyed the same way, as the
legacy organizer. Write order is **artifact → review → run**, because the run marks the batch done:
a crash between them leaves a retryable batch rather than an artifact no ledger row covers.

There is no cross-table transaction, so partial failure is handled by construction instead — see §10.

## 9. Explicit policy selection

`AdapterPolicy` requires organizer version, judgment policy id, writer version, prompt version,
policy version and provider. A blank one throws. Runs record `organizerType: "ai"` and the adapter
version, so a V2 artifact is distinguishable from a legacy one forever.

**Not wired into the worker.** The production path still selects the legacy organizer; that switch is
a separate, reviewable change and is deliberately not made here.

## 10. Replay / idempotency

Artifact ids are **derived** from the organization fingerprint, not minted. The run guard stops an
ordinary replay but cannot stop a retry after a *partial* failure: event written, ledger row not, no
run recorded — so the retry proceeds, and a random id would write a **second Memory for the same
evidence**. A derived id makes the retry land on the same row and repair the batch.

That flaw was found by the partial-failure test, not by reading the code.

Proven: replay → 0 duplicate event, review, or run. Two concurrent DailyTrace writers → one artifact.
Partial failure → no run recorded, batch retryable, retry completes with 1 event and 1 review.

## 11. Dry run against production

20 captured results planned against live rows (82 events, 154 traces, 304 fingerprints, 2,793 linked
sources) with the media index built from real `media_locations` (1,153 entries, 3,960 locations).

```
routes: {"daily_trace":16, "store_only":4}
DRY RUN — 20 planned, 0 with collisions. NOTHING WRITTEN.
```

**No collisions**: every planned fingerprint and artifact id is new. One window shares all 40 of its
sources with an existing LifeEvent — correct and not flagged, since a source may inform both a legacy
Memory and a new trace.

**The gap:** zero `life_event_candidate` routes. Frozen V6 promoted 0 of 48 on this corpus, so the
Memory path — including media linking against real bindings — is exercised only by fixtures.

## 12. Parser / video maintenance

Not performed. Deferred as instructed: the parser change alters `messageType` and `attachments`,
hence `canonicalMessageId`, so it needs a re-import identity decision and is not a small isolated
patch. The importer half (media type derivation) landed earlier; the 120 backfilled video assets are
unaffected.

## 13. Tests

553 tests, 543 pass, 10 skipped, **0 fail**. Typecheck, lint and `git diff --check` clean. New: 25
adapter tests covering all 14 required routes.

## 14. Git

`030cdce` adapter · `b6045d3` AI fail-closed publication · `814dbc3` dry run · this document.

## 15. Canary readiness

Ready on every mechanical gate: media contract enforced, review independence guaranteed, identity
deterministic, replay and concurrency proven, dry run collision-free, no active writer, tests green.

**One substantive blocker for the Canary as specified**, and it is a Judgment fact rather than an
adapter fault: Phase M requires ≥1 Memory, and frozen V6 yields no Memory on any corpus that exists.
A Canary run today would exercise DailyTrace and store_only only — which is more than Canary #1 did,
but is not the "genuinely persist a Memory" bar.

### Next actions (max 3)

1. **Decide the Canary's Memory case.** Either accept a trace-and-store-only Canary as a first
   bounded write, or find/construct a window frozen V6 actually promotes. Do not lower the Memory bar
   to manufacture one.
2. **Wire the worker to the adapter behind an explicit, default-off selector** with a named policy id
   and an obvious rollback — a separate reviewable change from this one.
3. **Run Writer v2 against a real Memory candidate** once (1) identifies one; the dry run currently
   substitutes a labelled placeholder, so Writer output has never reached the adapter on real input.
