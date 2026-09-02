# Organizer V6 — Claim Grounding freeze record (2026-09-03)

> Status: **V6 FROZEN** for evaluation. This is a judgement/grounding freeze only. It is not
> "Organizer Stable": the Writer and an end-to-end Canary are both still ahead.

V6 = frozen V5 routing over a **claim-grounded** worthiness axis, plus a split between Memory
promotion and DailyTrace retention. V5's gates, signal definitions and capability semantics are
untouched; what changed is what reaches them.

No family chat text appears in this document. The evidence behind every number below is in the
run artifacts named at the end, which are kept outside the repository.

## 1. What V6 changes

| | V5 | V6 |
| --- | --- | --- |
| Worthiness axis | as the model emitted it | every dimension whose cited evidence is not a supported assertion about a resolved subject is **zeroed** |
| Promotion fact count | `coreFacts` where `assertionKind === "raw_fact"` | `promotableGroundedFactCount` — grounded, subject-resolved raw facts |
| Trace retention | same gate set as promotion | `traceEvidenceCount` — subject resolved, speech act need not be an assertion |
| Emitted facts | hedge list only | hedge list **plus** speech-act check (a question is not a fact) |

A dimension is zeroed, never reduced. There is no threshold to tune: either the evidence
establishes the thing about this child, or it contributes nothing.

## 2. Fresh shadow — corpus

Built by `scripts/organizer-fresh-shadow-corpus.mjs`. Windows already used to tune anything were
excluded by construction (V1 development set, spent Holdout 1, spent Holdout V2), by
(conversation, day) **and** by anchorSourceId.

- 671 EvidenceWindows built from the live archive
- 220 excluded as spent → 451 fresh → 369 with ≥ 3 messages
- **30 selected**, one per stratum, across 42 available strata
- of those 30, **26 are genuinely untouched**; 4 turned out to sit on real Holdout 1 days — see §2.1

Coverage: 8 months (2025-05 … 2026-08), 3 conversations, sparse 16 / medium 10 / dense 4,
single-sender 6 / pair 9 / multi-speaker 15, 20 windows carrying images.

### 2.1 A contamination found afterwards, and what it does to the numbers

While drawing Holdout V3 candidates, several candidates turned out to repeat spent Holdout 1
content exactly one day later. The cause is that **every day recorded in Holdout 1 was one day
early** — built before life-date.ts existed, by the local-Date + `.toISOString()` route that module
replaced. Verified: for all 7 Holdout 1 cases carrying an anchor text, that text occurs on `day + 1`
in Asia/Shanghai and not on `day` — 7 shifted, 0 exact, 0 unmatched.

Consequence for this shadow: exclusion removed an unrelated day and left the real spent day in the
pool, so **4 of the 30 windows sit on real Holdout 1 days** (2025-09-23, 2025-10-20, 2025-11-04 ×2).
The corpus is therefore 26/30 genuinely untouched, not 30/30.

It does not change the conclusions, and the reason is checkable rather than convenient: **none of
the 4 produced a divergence.** All four routed identically under V5 and V6. Every one of the 6
deltas — the demotion and all five promotions — came from an uncontaminated window. The contaminated
windows are also the weaker kind of contamination: Holdout 1 was a spent one-shot *evaluation*, not
a tuning set, so those days were measured once and never tuned against.

DEVELOPMENT_SET and HOLDOUT_V2_SET are unaffected — 19/19 exact each, verified against their own
anchors. The difference is that both carry an `anchorSourceId` and Holdout 1 does not, which is the
whole lesson: a case identified only by a date has nothing to catch it when the date is wrong.
Holdout 1's days are now corrected with the original preserved, exclusion covers both days, and
`organizer-calibration-dates.test.mjs` pins all of it.

A selection bug was also found and fixed while building this. Strata were visited in alphabetical key
order and the key begins with the month, so with more strata than the target, round 0 never reached
the end of the list: the "stratified" sample was silently just the earliest months, and 2025-11 and
2026-08 drew zero windows. Strata are now visited in hash order — still deterministic and
reproducible, but carrying no calendar information.

## 3. Fresh shadow — result

The Memory Editor was called **once** per window (DeepSeek, `deepseek-v4-pro`, prompt
`memory-editor-v4`, variant v4) and that single verdict was routed through both V5 and V6, so every
difference below is attributable to grounding and nothing else. `persist: false` throughout.

| | count |
| --- | --- |
| windows attempted / scored | 30 / 30 |
| pipeline errors | 0 |
| same decision | 24 |
| demotions | 1 |
| promotions (any rank) | 5 |
| **new Memory promotions** | **0** |

| action | V5 | V6 |
| --- | --- | --- |
| `life_event_candidate` | 1 | 0 |
| `daily_trace` | 9 | 15 |
| `store_only` | 20 | 15 |

What grounding found across 66 claims: 7 question-derived, 2 plan/hypothetical, 3 negated,
0 unsupported by span, 35 with an unresolved subject, 16 resolved through a bounded antecedent,
9 worthiness dimensions zeroed.

Model run: 30 calls, 30 ok, 0 failed, 2 retries, 53,411 input + 29,739 output tokens,
latency min 6.8s / p50 11.4s / max 48.7s.

### 3.1 The one demotion (`life_event_candidate` → `daily_trace`)

A family outing day. V5 promoted it on capability + relationship + future-recall signals; V6 zeroed
all three and the window became a trace.

This demotion is **correct, and it prevented a false Memory**. The model had written a core fact
asserting a completed 7-kilometre walk. The cited evidence was a boast about intending to walk that
far, plus a message saying they had not arrived yet — grounding read the not-yet marker and set the
claim's polarity to negated. A second claim in the same window was built from a wh-question and was
correctly classified as a question rather than an assertion. A third asserted a capability from a
span with no person reference at all, in a window where three different people were walking.

Under V5 this window would have produced a Memory recording a walk that had not happened.

### 3.2 The five promotions (`store_only` → `daily_trace`)

All five are the trace-retention fix. Each is a real, ordinary, subject-resolved day about 张年 —
what he ate, how he slept, the family looking back at old photos of him, his recovery from being
unwell — that V5 was discarding entirely.

This exposed the retention bug as **wider than a grounding side effect**. V5's `rawFactCount` counts
only `assertionKind === "raw_fact"`, so whenever the model chose attributed-claim framing for a whole
window, the count was 0, the `no_unhedged_fact` gate failed, and `store_only` threw the day away.
That happened on 5 of 30 fresh windows — 17% of a stratified sample — with no involvement from Claim
Grounding at all.

## 4. Freeze criteria

| criterion | verdict | evidence |
| --- | --- | --- |
| question / plan / negation cannot produce a developmental capability | **met** | 7 question, 2 plan, 3 negated claims; 9 dimensions zeroed; 0 new Memory promotions |
| per-claim attribution valid | **met** | 16 antecedent resolutions; 35 refusals; each claim carries its own speaker and basis |
| other-child leakage blocked | **met by unit test only** | no competing-person window occurred in this fresh sample — see §5 |
| pronoun resolution not over-damaged | **met, with a noted conservatism** | see §5 |
| Time Truth stable | **met** | SQL and JS agree on life date and activity date for all 8,689 messages |
| DailyTrace no longer meaninglessly lost | **met** | +6 windows retained |
| no unsupported evidence | **met** | 0 claims unsupported by span; 0 invented refs |
| no invented novelty | **met** | §3.1 is precisely this catch, on fresh data |
| no unsafe media influence | **met by unit test only** | see §5 |
| no new dangerous Memory promotions | **met** | 0 |

**V6 is frozen.**

## 5. What this shadow did NOT establish

Stated plainly, because a percentage that hides these would be worse than useless.

1. **V6 produced zero Memories on 30 fresh windows.** The corpus was stratified for coverage, not
   enriched for positives, and most ordinary days should not become Memories — but this run
   therefore demonstrates V6's refusals without demonstrating that its promotion path still fires on
   genuine positives. Unit tests cover that a strong signal still promotes; fresh real data does
   not yet. Holdout V3 must carry positives for this reason.
2. **Other-child leakage and weak-media influence were not exercised** by this sample. Both are
   covered by deterministic tests, neither by fresh real data.
3. **Zero-anaphora conservatism is an open question.** 53% of claims (35/66) had unresolved
   subjects, dominated by `unresolved_no_reference` — a claim whose span carries no name and no
   pronoun. Chinese family chat drops subjects constantly, so this is a real population, not an
   artifact. The current rule refuses such a claim outright rather than trying a window antecedent,
   which a pronoun-bearing claim would get.

   It causes **no regression**: all 10 windows whose claims were entirely unresolved were already
   `store_only` under V5. But it does mean the trace-retention fix cannot reach them, since
   `traceEvidenceCount` requires a resolved subject.

   Deliberately **not** changed here. Loosening it is a substantive judgement change that must be
   measured on a corpus it was not designed against — not slipped in on the corpus that revealed it.
   Recorded for a future round.

## 6. Run artifacts (outside the repository)

- corpus: `<scratchpad>/fresh-shadow-corpus.json`
- results: `<scratchpad>/v6-shadow-results.json`
- log: `<scratchpad>/v6-shadow.log`

These carry family chat text and must not be committed.

## 7. Production safety

Nothing in production changed. The default router is unchanged, no LifeEvent or DailyTrace was
created, updated or deleted, no MemoryCandidate was persisted, and no publication ledger was
touched. The 82 LifeEvents / 171 DailyTraces / 299 organizer runs / 105 quality reviews counted at
the start of the session are unchanged.
