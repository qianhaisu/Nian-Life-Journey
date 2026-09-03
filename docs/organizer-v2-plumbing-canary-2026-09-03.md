# V2 Production Plumbing Canary — 2026-09-03

**Status: V2 PRODUCTION PLUMBING CANARY PASSED — FULL MEMORY CANARY BLOCKED.**

The V2 pipeline wrote its first real production artifact. Two predeclared inputs, both correct,
replay clean, nothing else touched.

The Memory canary did not run, and that is a finding rather than a shortfall: **no window in any
corpus satisfies all eleven candidate conditions.** Details in §4 — the two near-misses are near in
opposite directions, and taking either would have meant lowering the bar.

---

## 1. Selector / wiring

`lib/organizer/production-selector.ts` (`b8b98a8`), default-off, with tests.

- **Legacy is the default.** Unset, empty or misspelled flag → legacy. The legacy path stays
  reachable with none of the V2 variables set.
- **Misconfigured V2 fails closed, loudly.** Missing Judgment policy or Writer version, or an
  unknown policy → throws rather than quietly running legacy. The rejected coupled policy is refused
  **by name**, with its reason in the error.
- **V2 is bounded by an allowlist.** Enabling with an empty allowlist throws — a canary is a list,
  not a flag. A job runs on V2 only when *every* source is allowlisted, so no batch splits across two
  organizers.
- The canary passes `expectedRoutingPolicyId`, so a routing-policy mismatch throws inside the
  validator — no silent V1 fallback.

**The global production default is unchanged.** The worker still selects legacy; nothing in
`app/` or `lib/organizer/index.ts` references the adapter.

## 2. Plumbing canary — before / after

Selector line: `organizer=organizer-v2-adapter-v1 v2=on judgment=judgment-v6-frozen writer=writer-v2 prompt=memory-editor-v4 media=[confirmed] allowlist=19`

| case | route | fingerprint | artifact | sources |
|---|---|---|---|---|
| RC-04 | `daily_trace` | `e50925abfbfb2476…` | `trace-v2-0f8fab8edd0869e801c3c12603aa9593` | 15 |
| RC-08 | `store_only` | `5821a35e5f9b2b1b…` | none | 4 |

```
BEFORE {"life_events":82,"daily_traces":154,"distinct_fp":154,"dupe_groups":0,"reviews":105,"runs":304,"links":2793,"media":1153}
AFTER  {"life_events":82,"daily_traces":155,"distinct_fp":155,"dupe_groups":0,"reviews":105,"runs":306,"links":2793,"media":1153}
DELTA  {daily_traces:+1, distinct_fp:+1, runs:+2, everything else 0}
```

Exactly the predeclared delta. All 19 sources were already `organized`, so `markSourcesOrganized`
changed nothing.

**The persisted trace:**

- entries are real evidence content — `["张小年下楼玩了","雪姨回来了，家人表示解放了"]` — not a
  `N 条消息` count string
- `organizerRun` records `organizerType: ai`, `organizer-v2-adapter-v1`, provider, model, prompt
  version, and the fingerprint
- **0 review rows**, `requiresQualityReview: true`, `isTracePublishable: false` → fail-closed, not
  shown to the family
- the same day also holds a legacy rule trace under a *different* fingerprint. Two artifacts, one
  day, no merge, no review inheritance — identity vs presentation grouping intact.

`store_only` created no LifeEvent, no DailyTrace, and no review row; the run records the decision and
the sources are preserved.

## 3. Plumbing replay

Byte-identical input, second apply:

```
DELTA {"life_events":0,"daily_traces":0,"distinct_fp":0,"dupe_groups":0,"reviews":0,"runs":0,"links":0,"media":0}
RC-04  APPLIED: false (already organized under this fingerprint)
RC-08  APPLIED: false (already organized under this fingerprint)
```

0 duplicate traces, 0 duplicate runs, 0 review drift, 0 unrelated updates.

## 4. Memory candidate search — blocked, and why

Every recorded run was scanned for a frozen-V6 Memory promotion. Across the 47-window recall corpus,
the 49-window shadow, the deterministic 21-verdict replay and every smoke run, frozen V6 has ever
promoted **exactly one window**, and the two apparent extras do not survive inspection:

| candidate | V6 stability | sources already linked | verdict |
|---|---|---|---|
| **RC-12** (假哭) | **3/3 calls**, promoted in every run | **33 of 33** — all bound to legacy event `event-6b2dfc4d…` (`"36\.7"`) | **fails #10** |
| **RC-03** | **1 of 3 calls** (2/3 → daily_trace) | **0** | **fails #1** — not reproducible |
| RC-06 | only under zero-anaphora | — | fails — rejected policy |

The two near-misses fail in opposite directions, which is what makes this a genuine block rather
than an inconvenience:

- Using **RC-12** would create a second LifeEvent over **100 %-overlapping sources**. The legacy
  artifact covering them is junk — the rule organizer titled it `"36.7"` by slicing a temperature
  reading — but that makes it a *repair* problem, not a licence to double-cover the evidence.
  Rewriting or replacing an existing LifeEvent is explicitly out of scope this session.
- Using **RC-03** would mean picking the one call in three where V6 happened to promote. That is
  precisely "lowering the Memory bar to reach a number", and it would make the Writer validation
  rest on a route the policy does not reliably produce.

Per the instruction, this stops the session after the plumbing canary. **No model calls were made.**

## 5–7. Writer validation, Memory canary, Memory replay

**Not run** — gated on §4.

## 8. Publication / review safety

- The one AI artifact created is **not publishable**: AI provenance is fail-closed and it has no
  ledger row.
- No review row was created, approved, or modified. Review count unchanged at 105.
- No automatic publication anywhere.

## 9. DB deltas

`daily_traces +1`, `distinct fingerprints +1`, `organizer_runs +2`. Everything else zero:
LifeEvents 82, reviews 105, source links 2 793, media 1 153, duplicate fingerprint groups 0.

## 10. Rollback

Single-artifact, fully reversible. Identities recorded in the canary record outside the repo.

```sql
delete from daily_traces  where id = 'trace-v2-0f8fab8edd0869e801c3c12603aa9593';
delete from organizer_runs where organizer_version = 'organizer-v2-adapter-v1';
```

No source rows were modified (all were already `organized`), so nothing else needs undoing. Disabling
V2 needs no rollback at all — the selector is default-off and the worker was never wired to it.

## 11. Tests

567 tests, 557 pass, 10 skipped, **0 fail**. Typecheck, lint, `git diff --check` clean. New: 14
selector tests.

## 12. Git

`b8b98a8` selector · `8fa5067` plumbing canary · this document.

## 13. Next actions (max 3)

1. **Decide what to do about `event-6b2dfc4d…` (`"36.7"`).** It is the only thing standing between
   RC-12 and a real Memory canary, and it is a legacy mis-organization worth fixing on its own
   merits. Repairing or retiring it is a deliberate decision about existing family data — yours, not
   mine to make unprompted.
2. **Or widen the search for a V6-stable, unlinked Memory** — which realistically means new evidence,
   since every existing corpus is exhausted and frozen V6 promoted nothing in the 49-window shadow.
3. **Then** run Writer v2 real validation → Memory canary → replay, and only after that consider
   wiring the worker behind the selector.
