# Subject continuity — bounded pronoun recall, built, tested, and found inert (2026-09-03)

> **Status: STRICT V6 RETAINED. Continuity shipped as opt-in and inert in production.**
> Bounded same-conversation subject continuity is implemented under an explicit evidence contract,
> covered by 20 regression cases, and was run in shadow over a frozen 35-window corpus against the
> same model verdicts as frozen V6. It changed **nothing**: 0 claims resolved that V6 refused, 0
> claims lost, 0 routing changes, 0 leakage. The recall limitation Holdout V3 exposed is structural,
> not a threshold, and this document says why.
>
> Read with [`organizer-holdout-v3-result-2026-09-03.md`](organizer-holdout-v3-result-2026-09-03.md)
> and [`organizer-v6-freeze-2026-09-03.md`](organizer-v6-freeze-2026-09-03.md). No family chat text
> appears here; the corpus and full results live outside the repository.

## 1. The decision this implements

Teddy's Decision 1 (2026-09-03): a bare pronoun may resolve to 张年 **only** by bounded
same-conversation continuity — same conversation, an earlier explicit naming, temporally and
conversationally bounded, topic continuous, no plausible competing subject in between, verified
speaker continuity, and a persisted, auditable antecedent. "This is 张年's site" and "single-child
household" are never evidence. Ambiguous fails closed.

Explicitly **not** done: raising the numeric ±5 neighbour lookback (the A1 audit below shows why
that would have been the wrong lever), rerunning or tuning against Holdout V3, creating a Holdout V4.

## 2. What was built

| what | where |
| --- | --- |
| Resolver + evidence contract | `v2/lib/organizer/subject-continuity.ts` |
| Claim-level hook (after `antecedent_in_neighbour` fails) | `v2/lib/organizer/claim-grounding.ts` |
| Gate A hook (after `explicit_antecedent_nearby` fails) | `v2/lib/organizer/subject-resolver.ts` |
| Regression cases (12 required + invariants) | `v2/test/organizer-subject-continuity.test.mjs` |
| Frozen corpus builder (read-only, zero model calls) | `v2/scripts/organizer-continuity-corpus.mjs` |
| Shadow runner (persist hard-wired off) | `v2/scripts/organizer-continuity-shadow.mjs` |

**Contract.** Every consultation returns a `SubjectResolutionEvidence`:
`{ version, subjectId?, basis: explicit_in_claim | local_antecedent | conversation_continuity | unresolved, antecedentSourceIds, antecedentSpan?, antecedentDistance? {messages, minutes}, competingSubjectIds, continuityReason?, blockers, chainSpeakerIds }`.
Bounds: 60 messages, 120 minutes, topic gap 8 (`DEFAULT_CONTINUITY_BOUNDS`). A resolution
requires a verified caregiver as anchor speaker and as antecedent speaker, an antecedent span that
names the child in the family's own words (a `[链接]` title or a `> ` quoted reply does not count),
child-care topic corroboration somewhere on the chain, no other-child noun and no third-person adult
noun between antecedent and anchor, and no topic run longer than the gap bound.

**Opt-in by construction.** The resolver only runs when a caller attached
`attachContinuityContext(...)` to the windows. Every production caller passes plain windows, so
frozen V6 behaviour is byte-for-byte unchanged; the frozen-path invariance is a test. Window ids and
fingerprints are unaffected by the attached context (also a test).

## 3. A1 — where the pronouns actually are (read-only audit, whole archive)

671 windows, main family conversation:

| shape | windows |
| --- | --- |
| names the child in-window | 256 |
| neither pronoun nor name (zero-anaphora / logistics) | 292 |
| pronoun, already resolvable through ±5 neighbours | 49 |
| pronoun, competing person in scope | 7 |
| **pronoun, no name in window ±5 (the Holdout V3 failure shape)** | **67** |

For those 67, distance to the nearest earlier naming:

| messages | 6–10 | 11–20 | 21–40 | 41–80 | >80 |
| --- | --- | --- | --- | --- | --- |
| windows | 11 | 21 | 13 | 17 | 5 |

| minutes | ≤15 | 16–45 | 46–120 | 2–6 h | 6–24 h | >24 h |
| --- | --- | --- | --- | --- | --- | --- |
| windows | 1 | 2 | 5 | 17 | 22 | 20 |

**Only 7 of 67 are inside both bounds** (13 inside 40 messages / 180 minutes). The ceiling for
bounded continuity is therefore ~1 % of all windows. The other 60 have antecedents 2 hours to days
old — exactly what Decision 1 forbids resolving — and the 292 zero-anaphora windows have no pronoun
to resolve at all. A larger numeric lookback would have "recovered" stale antecedents, not
continuity.

## 4. The corpus (frozen before any verdict)

All 7 in-bounds candidates are spent: 2 are the Holdout V3 positives themselves (never rerun), 1 is
on a Holdout V3 day, 4 are on development / Holdout 1 / Holdout V2 days. **The archive holds no
fully fresh continuity candidate.** The corpus was therefore built as a safety experiment plus a
labelled probe:

| stratum | selected | role |
| --- | --- | --- |
| continuity_probe_day_spent | 3 | window never used, day used by dev / H1 / H2 (never HV3 / V6 / Writer days) — the only recall probe available |
| stale_antecedent | 8 | must stay unresolved |
| competing_child | 3 | must stay unresolved |
| adult_ambiguity | 8 | must stay unresolved |
| resolvable_now | 5 | control: already resolved by ±5; must not change |
| logistics | 5 | control: no pronoun; must not change |
| named | 3 | control: explicit; must not change |

35 windows, selected deterministically by fingerprint order from 237 fresh windows (434 excluded as
spent). Classified by regex shape only, before any model call.

## 5. Shadow result — same verdict, two judgements

One Memory Editor v4 call per window on the plain window (the prompt does not read the continuity
context, so the model saw exactly what V6 shows it). The same raw verdict was then judged by frozen
V6 and by V6-with-continuity. 35/35 calls succeeded (1 retry), persist off.

| | frozen V6 | with continuity |
| --- | --- | --- |
| life_event_candidate / daily_trace / store_only | 0 / 5 / 29 (+1 plan_marker) | 0 / 5 / 29 (+1 plan_marker) |
| claims unresolved → resolved | — | **0** |
| claims resolved → unresolved | — | **0** |
| Gate A level changes | — | 0 |
| promotions / demotions | — | 0 / 0 |
| leakage in competing_child / adult_ambiguity / logistics / stale strata | — | **0** |

Continuity blockers seen: `antecedent_out_of_bounds` 12 windows, `topic_discontinuity` 5,
`competing_person_in_anchor` 1.

### The three probes, and why each failed closed

Each probe is a real window with a real earlier naming inside the bounds, and each failed on
`topic_discontinuity`. Described by shape, not text:

1. **35-minute gap, then furniture logistics.** The naming was an affectionate remark; the next
   twelve messages were a video and a discussion of where to put a piece of equipment; then a
   one-line remark about "his" weight. The pronoun most plausibly refers to whatever was in the
   video — content nobody has seen. Fail closed is correct.
2. **Eight media/emoji messages, then a one-hour gap, then two videos.** The remark that followed
   is a joke whose "他" reads, to a human, as the child in the videos. The chain between has no
   content at all. The contract's topic bound tripped by exactly one message. Making media-only
   messages neutral in the gap count is a defensible refinement, but it was **not** applied — that
   would be tuning a bound against the very corpus that measures it, and the antecedent here is a
   video, not a sentence.
3. **The nearest "naming" was an article title.** 「…的宝宝从床上掉下去」 shared as a `[链接]` is
   somebody else's baby. The forty messages that followed discussed bed safety with a dozen
   pronouns. The walk failed on a sixteen-message topic run before ever reaching the link — but had
   it reached it, the alias 宝宝 in a link title would have been accepted as naming 张年. That is now
   excluded in the continuity resolver (`10c` regression case). Re-running the shadow after this
   change is unnecessary: it only removes antecedents, so every one of the 35 outcomes is unchanged.

### Success criterion

"Recover clearly supported child continuity with zero demonstrated dangerous leakage; otherwise
retain strict V6 and report the recall limitation." Half of it holds — zero leakage across 24
adversarial windows — but nothing was recovered, and §3 shows nothing could have been.

## 6. Decision

- **Production default: strict V6, unchanged.** No caller attaches continuity context.
- **Continuity stays in the codebase**, tested and opt-in, so that if the archive's conversation
  style changes (more explicit naming, tighter exchanges) it can be turned on behind the same
  contract, with the same corpus builder and shadow runner, without re-deriving any of this.
- **The recall limitation is structural.** 43 % of windows have no pronoun and no name; of the
  pronoun windows V6 refuses, 90 % have antecedents more than two hours old. Any pipeline that
  resolves those is doing "single child, therefore 他 = 张年" under another name, which Decision 1
  rules out. Recall on this archive is capped by how the family writes, not by the resolver.

## 7. A precision hazard noticed in frozen V6 (recorded, not changed)

Frozen V6's explicit path treats any in-window occurrence of an alias as naming the child. An
article title containing 宝宝 shared as a `[链接]`, or a quoted reply, therefore counts as an
explicit naming for Gate A and for `explicit_in_span` claim grounding. The continuity resolver
excludes these (§5.3); V6 itself is frozen and was not touched. No production LifeEvent was found
to rest on such a span during this task, but the 11-artifact audit
([`organizer-artifact-memories-audit-2026-09-03.md`](organizer-artifact-memories-audit-2026-09-03.md))
should be read with this mechanism in mind. Closing it in V6 is a separate, precision-only change
for a future session.
