# Recall diagnosis on a labelled corpus — V6 retained, V7 built and not adopted (2026-09-03)

> **Status: RECALL DIAGNOSED — V6 RETAINED.** Frozen V6 keeps perfect precision on 47 human-labelled
> windows (0 false promotions across 9 negatives, 22 daily_trace and 9 ambiguous) and produced
> **RC-12, the first fresh Memory candidate the pipeline has generated in 157 windows.** V7
> (zero-anaphora claim subject resolution) was built, tested and measured; it recovers **no**
> additional clean positive, so it is **not adopted** — it ships opt-in and inert, like
> `subject-continuity.ts` before it.
>
> The corpus, labels and per-case results carry family chat and live outside the repository.

## 1. Two corrections to the numbers this round inherited

1. **It was 110 fresh windows, not 115.** The canary drew its five windows from the writer-fresh
   scored pool, so they are re-runs, not new material.
2. **The archive is nearly exhausted under the holdout rule.** Of 671 windows, 652 are day-spent,
   leaving 9 — none capability-shaped. This corpus therefore uses window/message-level exclusion (no
   previously-scored message is re-read) and is recorded in its manifest as a development set, never
   a holdout.

## 2. The retrospective funnel (110 windows), and why it was only half right

| layer | entering | lost |
| --- | --- | --- |
| subject resolved | 110 | 65 |
| temporal eligibility | 45 | 1 |
| ≥1 grounded occurred fact | 44 | 19 |
| strong signal survives grounding | 25 | 25 |
| **Memory** | | **0** |

The last row was a *residual*: no earlier runner recorded the worthiness axis, so "no strong signal"
could only be inferred. Recording it directly changed the story — see §5.

## 3. The labelled corpus

47 windows, labelled from evidence text **before any model call**: 7 `likely_memory`, 9 `ambiguous`,
22 `daily_trace`, 9 `negative`. Each `likely_memory` then went through a clean-positive audit
(subject really 张年 / occurred / evidence supports / strong signal present / not already
represented / not a repeat capability / not routine). **4 survived as CLEAN POSITIVES**; three did
not, and saying why up front is what makes the recall number honest:

- **RC-02** — 不认生, smiles at strangers. Real, firsthand, but temperament, which is a *medium*
  signal. v5 deliberately decided medium signals cannot promote; counting this as a miss would
  re-litigate that decision.
- **RC-06** — self-feeding. A qualifying independence, but RC-17 has the caregiver saying 很早就会
  and RC-01 has it lapsing. A Memory here asserts a novelty that is not there.
- **RC-18** — standing unaided. A real milestone whose entire evidence is a four-character video
  caption (自己站起来) in a window that never names him.

## 4. Frozen V6 on the corpus

| label | n | store_only | daily_trace | **Memory** |
| --- | --- | --- | --- | --- |
| negative | 9 | 9 | 0 | **0** |
| daily_trace | 22 | 6 | 16 | **0** |
| ambiguous | 9 | 4 | 5 | **0** |
| likely_memory | 7 | 1 | 5 | **1** |

**Precision: perfect.** The one promotion is RC-12 — 假哭 with strategic eye-opening to check whether
anyone is coming: caregiver-asserted, video-evidenced, independently corroborated by the mother, and
marked new. Clean-positive recall is **1 of 4**.

All nine negatives are refused by `subjectRelevance !== "primary"`, not by claim-level grounding.
That matters for §6: it is a gate no claim-level change can reach.

## 5. Where the three clean positives actually die

Recording the axis directly replaced the inference in §2 with a measurement, and it is not one cause
but three, in three different layers:

| case | cause | layer |
| --- | --- | --- |
| RC-09 已经学会欢迎欢迎 | the span drops the subject; the previous message, same speaker, names him | claim subject resolution |
| RC-08 问他鼻子在哪里，他会去摸 | subject resolves fine; `settlesItsProposition` refuses it because 哪里 marks an embedded interrogative | claim representation |
| RC-05 外婆抱哭了，外公抱笑了 | the editor scored distinctiveness 2 — medium, and medium cannot promote | worthiness (by design) |

RC-08's guard is load-bearing: it is what stopped HV2-N03's 「会自己站了？」 from becoming a false
milestone. On one observed case it stays untouched (Teddy's call, 2026-09-03).

## 6. V7 — built, measured, NOT adopted

`claim-grounding.ts` refused any claim whose span carried neither name nor pronoun, from a guard
sitting *before* the competing-person check and the antecedent walk. So 「已经学会欢迎欢迎」 was
unresolvable while 「他已经学会欢迎欢迎」 in the same window resolved. V7 removes that asymmetry
behind every guard the pronoun path already passes, plus a first-person guard of its own.

Measured by routing **one** editor verdict through both policies, so no delta is model noise:

| | V6 | V7 |
| --- | --- | --- |
| zero-anaphora resolutions | — | 37, across 21 of 47 windows |
| traceEvidence (total claims) | 72 | 109 |
| promotions | RC-12 | RC-12, **RC-06**, **RC-03** |
| **clean-positive recall** | **1 / 4** | **1 / 4** |
| false promotions (negative or daily_trace) | 0 | 0 |

**V7 recovers no clean positive.** Its two extra promotions are RC-06 — the case §3 pre-identified as
a novelty error — and RC-03, an ambiguous. Under Teddy's Phase K rule (recall must improve without
precision worsening) it fails the first half outright, so it is not adopted. It stays in the tree,
opt-in via `zeroAnaphoraAntecedent`, default off, with 12 regression cases including a frozen-V6
invariance test.

Its one clearly good effect is retention, not promotion: traceEvidence rises 72 → 109 and RC-26
moves store_only → daily_trace. That is the same class of fix the V6 freeze already blessed for
retention, and it is available whenever retention is worked on deliberately.

## 7. The blocker this round actually found

RC-09's claim resolves under V7, is a supported affirmative assertion about 张年, and still does not
promote — because `promotableGroundedFactCount` counts only `assertionKind === "raw_fact"`:

> **85 claims in the corpus carry `mayGroundDevelopmentalSignal = true`. 47 of them are not
> `raw_fact`.** The editor framed 75 of 146 claims as `attributed_claim`.

This is the promotion-side twin of the retention bug the V6 freeze record §3.2 already found and
fixed for traces only. On this evidence it, not subject resolution, is the dominant promotion
blocker — and it is a change to the promotion gate itself, so it is reported here rather than made
under a critical budget.

## 8. Production safety

Nothing was written. Every script in this round issues SELECTs only or hard-wires `persist: false`.
The 82 LifeEvents, 171 DailyTraces, 105 ledger rows and 8,796 raw sources are unchanged; the only
production delta this session is the 5 `organizer_runs` rows Canary #1 left, plus contract-test rows
under `profile-contract-test-fixture`.
