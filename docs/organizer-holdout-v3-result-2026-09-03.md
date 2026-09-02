# Holdout V3 — one-shot result (2026-09-03). SPENT.

> **Verdict: PASS on every hard-failure criterion. 0/2 positives kept.**
>
> Holdout V3 is spent. It was run once against frozen V6 and will not be re-run, and nothing was
> tuned after the result was seen.

Run: DeepSeek `deepseek-v4-pro`, prompt `memory-editor-v4`, router `worthiness-v6-grounded`,
`persist: false`. 15 cases, 15/15 completed, 0 errors, 0 retries. 33,715 input + 17,398 output
tokens. Latency min 8.1s / p50 12.1s / max 19.5s. Nothing was written to production.

Preflight was 100% green before any model call: 15/15 valid, 0 invalid, 0 ambiguous, 0 date
mismatch.

## 1. Result by class

| class | n | promoted to Memory |
| --- | --- | --- |
| positive | 2 | **0** |
| borderline | 6 | 0 |
| negative | 7 | 0 |

| case | outcome | score |
| --- | --- | --- |
| HV3-P01 stands unaided | `store_only` | 0 |
| HV3-P02 cruises along door | `store_only` | 0 |
| HV3-B01 settles himself to sleep | `daily_trace` | 28 |
| HV3-B02 hedged + disputed fake crying | `daily_trace` | 23 |
| HV3-B03 incidental self-soothing | `daily_trace` | 23 |
| HV3-B04 ordinary pleasant outfit day | `daily_trace` | 32 |
| HV3-B05 pacifier no longer used | `daily_trace` | 19 |
| HV3-B06 bed-in-bed experiment | `daily_trace` | 23 |
| HV3-N01 aspirational first-step question | `daily_trace` | 19 |
| HV3-N02 parenting article pasted in | `store_only` | 0 |
| HV3-N03 English plan and imagining | `plan_marker` | 0 |
| HV3-N04 adult restaurant logistics | `store_only` | 0 |
| HV3-N05 dinner venue logistics | `store_only` | 0 |
| HV3-N06 fever day, health only | `store_only` | 0 |
| HV3-N07 density without a moment | `daily_trace` | 18 |

## 2. Hard-failure checks — all PASS

| check | result |
| --- | --- |
| no negative promoted to Memory | PASS |
| no borderline promoted to Memory | PASS |
| no question-derived claim became an emitted fact | PASS |
| no plan / hypothetical became an emitted fact | PASS |
| no unresolved-subject claim became an emitted fact | PASS |
| every emitted fact cites evidence inside its own window | PASS |
| window lifeDate matches the frozen lifeDate | PASS |
| no routing mismatch, no fail-open | PASS |

The traps did their job. **HV3-N01** — a parent asking *when* he will finally take his first step
instead of marching in place — used first-step milestone vocabulary in a question about something
that had not happened, and produced no Memory and no factual claim. **HV3-N03**, a plan to start
English plus an explicit imagining of what he would do with the reading pen, routed to
`plan_marker`: recorded as a plan, not as an event. **HV3-N02**, a general parenting article about
five-to-six-month-olds pasted into the chat, produced nothing about 张年. **HV3-N06**, a day of
fever readings, produced no Memory and no medical inference. **HV3-B02** contains 「学会」 and was
still held as a trace, because the claim is hedged and disputed in the same window.

## 3. The failure that matters: 0/2 positives

Both positives were genuine, unhedged, firsthand capability reports — standing unaided for a few
seconds with an explicit 现在 change marker, and cruising along a glass door. Both were lost.

**Diagnosis. Neither window ever names the child.** In both, the family refers to him only as 他,
or drops the subject entirely. There is no name in the window and none in its neighbours. The
bounded subject resolver therefore returns unresolved, Gate A downgrades `subjectRelevance`, and the
validator's subject gate returns `store_only` with `subject_ambiguous`.

**This is not a Claim Grounding regression, and that is checkable rather than asserted.** The
validator's subject gate is at `validator.ts:178`; the routing policy is not consulted until line
228. The decision is therefore router-independent: frozen V5 would have produced exactly the same
`store_only` on both windows. Claim Grounding independently agreed with the assessment — all 3 and
all 2 claims respectively resolved to no subject — but it did not cause the outcome, and no
worthiness dimension was zeroed in either case.

**Why this matters more than the number suggests.** A three-person family group chat that exists
entirely to talk about one baby refers to him by pronoun almost all the time. Naming him is the
exception. So the shape that fails here is not an edge case — it is the archive's most common way of
recording exactly the events most worth keeping. The V6 shadow saw the same thing from a different
angle: 53% of claims had unresolved subjects, dominated by spans carrying neither a name nor a
pronoun.

And the trace-retention fix cannot soften it, because `traceEvidenceCount` also requires a resolved
subject — both windows reported `traceEvidence: 0`. These days are dropped entirely, not kept as
traces.

**Not fixed tonight, deliberately.** Holdout V3 is spent; changing subject resolution and re-running
it would turn a holdout into a development set. The fix must be designed against the general
problem and measured on a corpus it was not built from.

## 4. What this set does and does not establish

**Established:** precision. Across 13 borderline and negative cases — including four deliberate
traps for question-, plan-, article- and health-factualization — nothing false reached 张年's
archive, no fact was invented, no evidence was cited from outside its window, and no unresolved
subject became an assertion.

**Not established:** recall, at all. With 2 positives and both lost to a cause upstream of routing,
this set cannot say whether V6's promotion path works on real data. The V6 shadow could not say so
either — it produced zero Memories on 30 windows. **The promotion path remains unverified on fresh
real data**, and no set constructed so far has tested it.

That is the honest state, and it is the first thing the next round should fix.

## 5. Status

**JUDGMENT/GROUNDING READY — precision only.**

Not "Organizer Stable": the Writer and an end-to-end Canary are both still ahead, and recall is
unmeasured.

## 6. Artifacts (outside the repository)

`<scratchpad>/hv3-results.json` — full per-case output including every claim, its speech act,
polarity, subject basis and verbatim spans. Contains family chat text; must not be committed.
