# Organizer canary — one bounded end-to-end run (2026-09-03)

> **Status: ORGANIZER CANARY PASSED (bounded) — CUTOVER NOT READY.** Five predeclared windows went
> through the real pipeline (Evidence Builder → Memory Editor v4 → contract → claim grounding → V6
> routing → Writer v2 / Narrative Validator when eligible) and persisted through the production
> repository. Judgment was correct on all five, persistence was idempotent under both a payload
> replay and a full re-run, and the only production change is **5 `organizer_runs` rows**. The
> canary did **not** get to persist a DailyTrace or a LifeEvent, for two reasons that are the real
> findings: V6 promoted nothing (as in every fresh set so far), and `persistDailyTrace()` would have
> merged canary entries into an already-approved rule trace. Cutover is blocked on that second one.

Script: `v2/scripts/organizer-canary.mjs` (`preflight` read-only / `run` / `replay`). Run records
with family text live in the session scratchpad, outside the repository.

## 1. Predeclared plan (written before the run)

Windows come from the fresh V6-scored pool (`writer-v2-fresh-shadow.mjs`), chosen on their V6
result and never on Writer output. All are from the main family conversation, days with no
LifeEvent, sources already `organized` by the legacy rule organizer (every raw source is — there
are no rule-unprocessed windows left; "unprocessed" means unprocessed by the evidence pipeline).

| fingerprint | day | why | V6 in shadow | expected |
| --- | --- | --- | --- | --- |
| `bec7ab92…` | 2025-05-27 | strongest fresh window: 4 claims, 3 promotable | daily_trace | daily_trace; day holds an **approved** rule trace |
| `40a682b6…` | 2025-10-28 | 3 claims, 2 promotable, 4 strong media bindings | daily_trace | daily_trace |
| `5524a486…` | 2025-09-20 | ordinary day, 1 promotable | daily_trace | daily_trace |
| `5d9d7aa5…` | 2025-06-22 | conservative: 0 promotable | store_only | store_only, run row only |
| `f8441fd6…` | 2025-10-15 | plan case, subject only contextually resolved | plan_marker | plan_marker, run row only |

Persistence scope declared: ≤5 `organizer_runs` rows keyed `canary:organizer-canary-2026-09-03:<fp>`;
a DailyTrace row only on a day with no foreign trace; a LifeEvent only if V6 promotes and the Writer
is accepted, in which case a `needs_human_review` ledger row binds it (the `quality-review.ts`
change in this slice makes an explicit ledger row bind AI-derived artifacts too); media only
`confirmed` / `strong_contextual`; no raw_source status change (they are all `organized` already).

## 2. Preflight finding that changed the plan

`persistDailyTrace()` dedups by fingerprint, then falls back to **any trace on the same
(profile, day)** and merges entries, sourceIds and — replacing — `organizerRun`. Every fresh-pool
day already holds a rule-derived trace, and on 2025-05-27 and 2025-06-22 that trace is `approved`.
Merging would therefore have (a) published canary entries with no review, through the legacy row's
approval, and (b) overwritten the legacy row's provenance. The canary withholds the trace row on
any day that holds a foreign trace and records the V6 outcome and the trace lines in the run row
(`fallback_reason = v6:daily_trace|trace_row_withheld:legacy_trace_on_day:<trace id>`) and the
audit record instead.

## 3. What happened

BEFORE: 82 LifeEvents · 171 DailyTraces · 299 organizer runs · 105 ledger rows · 2,793 source links ·
244 media linked to events · 8,796 raw sources (all `organized`).

| window | V6 this run | subject | claims / promotable | worthiness | persisted |
| --- | --- | --- | --- | --- | --- |
| `bec7ab92…` 05-27 | daily_trace (ordinary_day) | explicit | 4 / 3 | 20 | run row; trace withheld (approved rule trace on day) |
| `40a682b6…` 10-28 | daily_trace (ordinary_day) | explicit | 3 / 2 | 20 | run row; trace withheld (rule trace on day) |
| `5524a486…` 09-20 | store_only (below threshold) | explicit | 2 / 1 | 14 | run row |
| `5d9d7aa5…` 06-22 | store_only (below threshold) | explicit | 4 / 0 | 29 | run row |
| `f8441fd6…` 10-15 | plan_marker (`planned_not_occurred`) | contextually_resolved | 2 / 1 | 0 | run row |

AFTER: identical except `organizer_runs` 299 → 304. Editor latency 10–15 s per window. The 09-20
window scored daily_trace in the shadow and store_only here — the editor is not deterministic
across calls; both are below the Memory threshold, so routing is stable where it matters.

Trace lines V6 produced for the two daily_trace windows are grounded facts with evidence refs (a
posed photo/video; a hat remark; an outfit share; a remark about a front tooth) — ordinary-life
material, correctly not Memories.

## 4. Idempotency and reversibility

- `replay` re-applied the recorded payloads through the same repository calls: 5/5 IDENTICAL, delta `{}`.
- `run` again with the same five fingerprints: 5/5 skipped at the `findOrganizerRun` checkpoint
  before any model call, delta `{}`.
- Rollback, if ever wanted, is `delete from organizer_runs where id like 'organizer-run-canary-%'`
  (5 rows). Nothing else was written.

## 5. Pass criteria

- JUDGMENT: subject correct on all five (explicit ×4, contextual ×1); the plan window failed closed;
  no promotion. **Pass.**
- WRITER: not exercised — V6 promoted nothing. **Not tested** (not a failure; see §6).
- MEDIA: no association made. **Pass** (vacuous).
- PERSISTENCE: exactly the declared rows, fingerprint-keyed, replay and re-run silent. **Pass.**
- OPERATIONS: no unrelated change; counts explained to the row. **Pass.**

## 6. What blocks cutover

1. **DailyTrace day-merge semantics** (data model, Teddy's call). At cutover the evidence pipeline
   will produce daily traces on days the rule organizer already covered — that is every day. Options:
   per-organizer trace rows (dedup by fingerprint only for the AI path), or a merge that resets the
   review state and keeps both provenances. The canary's withhold guard is a stopgap, not a design.
2. **V6 yield.** 0 Memories from 115 fresh windows (30 stratified + 35 continuity + 45 fresh + 5
   canary). The Writer and the LifeEvent persistence path are frozen but unproven on fresh material
   because nothing reaches them. Precision must not be traded for recall to change this; the honest
   next step is a recall investigation on V6's worthiness threshold with a *new* labelled set, not a
   re-tune against Holdout V3.
3. Artifact-Memory cleanup and the 47 unreviewed LifeEvents remain as documented in
   `organizer-artifact-memories-audit-2026-09-03.md`.
