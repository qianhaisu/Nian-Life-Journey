# Organizer Recall Closure — 2026-09-03

Closes the recall questions left open by the promotion-eligibility candidate (`412c767`). No
production writes, no migration, no Canary. All corpus figures below come from the 47-window
labelled development corpus and from 21 saved Memory Editor verdicts replayed offline.

**Decision: the promotion candidate stays EXPERIMENTAL. Frozen V6 remains the judgment policy.**

One separate deterministic bug was found and fixed (`9488fe3`): trace retention was coupled to the
promotion gate. That fix is independent of the candidate and is adopted.

---

## 1. RC-25 — the retention regression was not the candidate's fault

RC-25 moved `daily_trace → store_only` when only the promotion policy changed. Every retention input
was identical on both sides:

| field | frozen V6 | candidate |
|---|---|---|
| gate A subject | `explicit` / `primary` | same |
| `temporalStatus` | `present` | same |
| `evidenceConfidence` | `medium` | same |
| grounded axis / `zeroed` | `[]` | same |
| strong / medium signals | `[]` / `[]` | same |
| `traceEvidenceCount` | 1 | same |
| worthiness score | 14 | same |
| **promotion count fed to `routeV5`** | **0** (`promotableGroundedFactCount`) | **1** (`promotionEligibleFactCount`) |

All three of RC-25's claims are `attributed_claim`, so the frozen count is 0 by label alone; one of
them is fully grounded, so the candidate's count is 1.

### Root cause

`routeV4`'s trace-retention floor lived **inside** the `blockedBy` branch. The only way to reach it
was to *fail* `no_unhedged_fact`. RC-25 was kept as a trace **because** it had been refused a Memory.
Pass that gate and the window falls through to the terminal branch, which had no floor and handed
`noDistinctiveMemorySignal` straight to `store_only`.

Retention was therefore **anti-monotone in promotion evidence**: the same day, with strictly more
grounded evidence, was thrown away.

Answers to the five questions asked:

1. **Which field changed?** Only the promotion count fed to `routeV5` (0 → 1). Nothing else.
2. **Why did it affect retention?** Passing the promotion gate removed the window from the branch
   that owns the retention floor.
3. **Is promotion eligibility leaking into trace eligibility?** Yes — inverted. Retention was
   conditioned on *failing* a promotion-only gate.
4. **Runner/context bug?** No. One editor verdict, one grounding object, both policies reading it.
   Reproduced deterministically with zero model calls.
5. **Pre-existing policy behaviour exposed by the candidate?** Yes. Frozen V6 has the same defect on
   its own inputs: a window with a grounded `raw_fact`, no signal and `noDistinctiveMemorySignal`
   loses the trace an otherwise identical window keeps. The candidate only made it observable.

### Fix (`9488fe3`)

`mayRetain` is now computed from the retention inputs alone, before any branch, and applied on both
paths. It weakens nothing: it still requires no subject, temporal or evidence-confidence blocker and
at least one claim with a resolved subject and a content-bearing span, and the terminal branch is
reached only when every gate already passed. It can only ever turn `store_only` into `daily_trace` —
no input there can reach `life_event_candidate`, so no Memory precision guard is touched. It stays
opt-in through `traceEvidenceCount`, which v4/v5 never supply.

Six regressions pin the invariant rather than RC-25's phrasing; the first two fail on the parent
commit. The invariant asked for is the second one: **a promotion-policy change alone cannot erase an
otherwise legitimate trace unless a truth, subject or temporal gate changes.**

**Blast radius on the corpus: RC-25 only.** RC-27 was the sole other window that could have been
affected; replay shows its `store_only` call carried `evidenceConfidence: low`, a genuine retention
blocker, and it routes identically in all four policy cells. Frozen V6's corpus behaviour is
unchanged in practice, and the frozen-V6 invariant test still passes.

---

## 2. Separating model variance from policy effect

`scripts/organizer-verdict-replay.mjs` splits the two into phases that never run together.
`--capture` makes N editor calls per case and saves every verdict, axis and bounded resolution;
`--replay` re-grounds and re-routes those saved bytes through a 2×2 grid with **zero** model calls.

|  | `promotableGroundedFactCount` | `promotionEligibleFactCount` |
|---|---|---|
| **zero-anaphora OFF** | `v6` | `v7prom` |
| **zero-anaphora ON** | `v6+za` | `v7prom+za` |

Neither v7 is adopted. `zeroAnaphora` is a *grounding* option; `v7prom` is a *routing* policy. They
are independent, and the grid exists because RC-09 turns out to need both.

21 verdicts: 7 cases × 3 calls. Captured verdicts are family text and live outside the repository.

### RC-09 is deterministic, not stochastic

This was the session's biggest correction. RC-09 promotes in **exactly one cell, 3/3 calls**:

| cell | route | why |
|---|---|---|
| `v6` | daily_trace 3/3 | claim subject unresolved → strong signal zeroed; count 0 |
| `v7prom` | daily_trace 3/3 | same subject miss → `promotionEligibleFactCount` 0 |
| `v6+za` | daily_trace 3/3 | signal survives, but both claims are `attributed_claim` → count 0 |
| `v7prom+za` | **life_event_candidate 3/3** | signal survives **and** the gate passes |

The editor emitted `capability:developmental_ability` in 3/3 fresh calls with identical assertion
kinds, and in 6/6 runs recorded earlier today. **RC-09 never oscillated.** What oscillated across
earlier sessions was the zero-anaphora flag, not the model.

Its residual blocker under `+za` is `negated_or_not_yet` on the second claim — a genuine not-yet
state, correctly refused.

### Editor nondeterminism, measured (not averaged)

Production gets one call, so these are instability counts, never ensemble votes.

| case | strong signal emitted | assertionKind varied | other verdict fields varied |
|---|---|---|---|
| RC-03 | 3/3 | yes (6 vs 5 facts) | — |
| RC-05 | 0/3 | yes | — |
| RC-08 | 3/3 | no | — |
| RC-09 | 3/3 | no | — |
| RC-12 | 3/3 | no | — |
| RC-25 | 0/3 | yes | `noDistinctiveMemorySignal` true×2 / false×1 |
| RC-27 | 0/3 | yes | `evidenceConfidence` low×1 / medium×2 |

**Strong-signal emission was stable in 7/7 cases** — no case ever split. Instability sits in fact
segmentation and in the two scalar judgements above.

Final-route instability, per cell:

| cell | unstable cases |
|---|---|
| `v6` | RC-03 (1 promote / 2 trace), RC-27 (1 store_only / 2 trace) |
| `v7prom` | RC-27 only |
| `v6+za` | RC-27 only |
| `v7prom+za` | RC-27 only |

The candidate *reduces* route instability: RC-03 goes from 1/3 to 3/3 promote. RC-27's remaining
variance is the editor's `evidenceConfidence` call, which no routing policy can or should override.

---

## 3. The four clean positives

| case | why it is a clean positive | V6 result | miss layer | deterministic? | candidate helps? | deliberate precision trade-off? | structural defect? |
|---|---|---|---|---|---|---|---|
| **RC-05** | genuine developmental report | daily_trace 3/3 | **Editor** — never emits a strong signal (`capability none:0`, 0/3) | yes (stable miss) | no | no | no — model capability limit |
| **RC-08** | genuine capability report | daily_trace 3/3 | **`unsettled_proposition`** (embedded interrogative) **+ `subject_unresolved_competing_person`** ×2 | yes | no (no cell promotes it) | **yes, twice over** | no |
| **RC-09** | genuine capability report | daily_trace 3/3 | **`subject_unresolved_no_reference`** then **the `raw_fact` label** | yes | **only with zero-anaphora** | partly — the open subject-resolution trade | yes — the label dependency, fixed by the candidate but not sufficient alone |
| **RC-12** | genuine capability report | **life_event_candidate 3/3** | — kept | yes | n/a | n/a | n/a |

Clean-positive recall: **v6 1/4 · v7prom 1/4 · v6+za 1/4 · v7prom+za 2/4.**

RC-08 stays a miss deliberately. Its embedded-interrogative guard is the N03 question→fact
protection, and weakening it on one case was already declined. Note that zero-anaphora makes RC-08
*worse*, not better — competing-person blockers rise 2 → 3 — which is the other-child leakage guard
doing its job.

---

## 4. Promotion-policy decision — KEEP EXPERIMENTAL

Against the adoption bar:

- ✅ RC-25 regression resolved and explained — and it was never the candidate's defect.
- ✅ No demonstrated precision regression: 0 false promotions in every cell; the one route change the
  candidate makes alone (RC-03) is `ambiguous`, not `negative` or `daily_trace`.
- ✅ The semantics are genuinely more correct. `assertionKind` is not a truth signal — `validator.ts`
  demotes a hedged `raw_fact` into `attributed_claim`, and RC-09's fully grounded claim is
  `attributed_claim` while RC-12 promotes on a `raw_fact` whose three siblings are not.
- ❌ **Clean-positive behaviour does not improve: 1/4 → 1/4.** Its only clean-positive rescue is
  RC-09, and that requires zero-anaphora, a separate and explicitly unadopted decision.

So it is not ADOPT — adopting on cleaner semantics alone is exactly what the bar forbids. It is not
REJECT either: it introduces no regression, it reduces route instability, and it is the necessary
half of the only available RC-09 fix. It stays **experimental**, opt-in, default off.

**Consequence for the standing subject-resolution decision:** the two unadopted experiments are
entangled and must be judged together. Zero-anaphora alone buys nothing on the clean positives;
zero-anaphora *plus* the promotion policy converts RC-09. Measuring either alone understates it.

Phase E was therefore **not** run: no fresh shadow corpus was spent on an unjustified candidate.

---

## 5. Recall Closure status

- No unexplained retention regression — RC-25 explained, fixed, regression-tested.
- Promotion-policy decision made — experimental.
- Clean-positive misses classified — RC-05 model limitation, RC-08 deliberate precision trade-off,
  RC-09 understood and gated behind the subject-resolution decision, RC-12 kept.
- Judgment policy selected — **frozen V6 grounding and promotion semantics, plus the monotone
  retention floor.** V6's promotion behaviour is unchanged; its retention behaviour is corrected in
  one direction only (`store_only → daily_trace`), on no corpus window.

Recall Closure is complete. The next phase — Writer fresh validation, then Canary #2 — was
deliberately **not** started in this session.
