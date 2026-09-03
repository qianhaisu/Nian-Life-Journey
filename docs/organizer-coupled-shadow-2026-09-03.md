# Coupled Candidate — Fresh Shadow Evaluation, 2026-09-03

**Decision: COUPLED POLICY REJECTED — V6 RETAINED.**

The coupled candidate (zero-anaphora subject resolution + grounded promotion eligibility, judged as
one change) produced two demonstrated Phase 5 hard failures on a fresh shadow corpus. It also
produced one genuine, evidence-defensible Memory that frozen V6 misses. Both facts are real; the
hard-failure rule is unconditional, so the candidate is rejected.

No production writes, no migration, no Writer validation, no Canary. Frozen V6 remains the judgment
policy. Both halves remain experimental and default-off.

---

## 1. Method

49 windows, one Memory Editor call each, that single verdict routed through both judgment policies
(`scripts/organizer-coupled-shadow.mjs`). 48 scored; RC-17 was refused by the contract validator
because the editor emitted an `evidenceRef` that does not resolve — a correct refusal, and itself a
small finding about editor reliability.

Labels were assigned by reading every window's verbatim messages **before any model call**, then
frozen and hashed (`d5d8408957e9c69f7748886b5b1c9094bf98909392bece618971865116e41df8`).

> **Labelling authority.** These labels are mine, not Teddy's. The clean-positive judgements on the
> earlier 47-window corpus were his. Any recall claim resting on these labels inherits that weaker
> authority.

Corpus composition: 4 likely_memory (3 of them clean positives), 8 ambiguous, 26 daily_trace,
11 negative. Strata span explicit-subject, zero-anaphora, pronoun, competing-person, other-child,
question, plan, ordinary routine, capability, relationship and sparse windows.

### Independence — weaker than a holdout, and stated as such

Window/message-level exclusion, not day-level. 248 of 383 candidate windows sit on a
previously-visited day. This is development/shadow evidence and must not be cited as a
generalisation test.

### Recall power — insufficient, by construction

After honest exclusion the entire archive holds **6 `capability_named` and 3 `capability_pronoun`**
unspent windows. The coupled candidate's benefit lives precisely there. **No result from this corpus
can establish meaningful recall improvement, and none is claimed.** Per Teddy's instruction, a clean
result here would still not have justified adoption.

---

## 2. Results

| | frozen V6 | coupled candidate |
|---|---|---|
| Promotions (all labels) | **0** | **4** |
| likely_memory promoted | 0 / 4 | 2 / 4 |
| clean positives promoted | 0 / 3 | 1 / 3 |
| ambiguous promoted | 0 | 2 |
| **negative promoted** | **0 / 11** | **0 / 11** |
| daily_trace lost | — | **0** |
| Memories lost | — | **0** |
| retention monotonicity violations | — | **0** |

Route changes, all in the same direction (`daily_trace → life_event_candidate`): RC-01
(likely_memory), RC-03 (ambiguous), RC-06 (ambiguous), RC-09 (likely_memory).

Per Phase 5, ambiguous promotions are not recall success. The genuine gain is 2 windows, and one of
those two rests partly on a misattributed claim (below).

---

## 3. Audit of every new Memory

### RC-09 — GENUINE. The case the candidate exists for.

Claim: *he now rolls over in the cradle, his head keeps coming out*. Nanny (verified caregiver),
supported assertion, affirmative, epistemically settled, present tense, observed firsthand. Subject
resolved by `antecedent_in_neighbour` — an adjacent message in the same episode names him.

Frozen V6 refuses it only because both claims carry `attributed_claim`. Evidence-defensible, and a
correct promotion. This is the clean positive the coupled candidate recovers.

### RC-01 — PROMOTED, but on partly misattributed evidence. **Wrong-subject leakage.**

Three claims counted as promotion-eligible. One of them is about the **father**:

> span: 「夸下海口说要走7公里，说不需要雪姨抱一下」 (*boasted he'd walk 7km and wouldn't need to be carried*)
> resolved subject: **张年**, basis `antecedent_in_window_zero_anaphora`

The preceding message is 「他爸已经要没电了」 — the local discourse topic is the father. The editor's
own claim text says 「张年爸爸…」, so the model knew. **Grounding did not**: the zero-anaphora walk
saw a subjectless span in a window that names the child and attributed it to the child.

Root cause, in code: `COMPETING_PERSON` (claim-grounding.ts) enumerates other *children* —
其他小朋友, 哥哥, 姐姐, 弟弟, 妹妹, 同学, 小女孩 … — and **no adults**. `FIRST_PERSON` does not fire
because the span contains no 我. So zero-anaphora's premise, "a dropped subject defaults to the
discourse topic," fails whenever the local topic is another *adult*.

This is the same class as other-child leakage, with a parent as the wrong referent.

### RC-06 — **HARD FAILURE: speculative inner state flattened into fact.**

The claim that grounded a `capability:developmental_ability` promotion:

> span: 「对呀，我每次抱他的时候，他其实都挺想站起来的，就站我腿上」
> (*every time I hold him he really **wants** to stand up, standing on my legs*)
> epistemicStatus: **settled** → `mayGroundPromotion: true`

Wanting to stand is an inferred desire, not an observed ability. It became a standing-capability
Memory.

Root cause, in code: `INNER_STATE_MATRIX` (speech-act.ts) is
`觉得|以为|感觉|怀疑|担心|怕|希望|盼|猜|估摸|寻思|认为|感觉到` — it **omits 想**, the most common
volition verb in this family's writing. `HEDGE` does not match 其实/都/挺…的 either.

I flagged RC-06 as an anticipation trap in the pre-model labels, before seeing any output.

**The important part is why frozen V6 does not hit this.** V6 refuses the claim for its
`attributed_claim` label, not because any guard caught the inner state. The label was doing unearned
protective work. Removing it — which is the *correct* thing to do semantically — exposes an
under-specified epistemic guard that was never load-bearing before. That is a general lesson about
this change, not a quirk of one window.

### RC-03 — ambiguous inflation, not a hard failure.

「他现在就是扶站」 is a genuine supported caregiver assertion, so promoting it is defensible on the
evidence. But it arrives as a clarification inside a discussion about whether to *limit* standing,
which is why I labelled the window ambiguous. A second qualifying claim is a neighbour-noise
complaint (*upstairs throwing things disturbs his sleep*) — true and attributable, but routine
complaint material counted toward promotion.

---

## 4. What the guards got right

Worth recording, because the rejection is narrow and the rest held up well.

- **Zero negative promotions.** All 11 negatives stayed `store_only`/`plan_marker` under both policies.
- **Retention is monotone on real data**: 0 lost traces, 0 lost Memories, 0 violations. The
  `9488fe3` fix holds outside its unit tests.
- **RC-22 — the corpus's hardest precision test** (first day at daycare: other children present,
  several unknown speakers). The competing-person guard correctly refused two claims
  (`subject_unresolved_competing_person`), and the unknown-speaker guard correctly refused teacher
  quotes (`reported_by_unknown_speaker`). No leakage, under either policy.

---

## 5. The two clean positives that were missed

Both miss ABOVE the policy layer, so neither is evidence for or against the candidate.

- **RC-08** (teeth five and six emerged): the editor returned `subjectRelevance: ambiguous` and the
  bounded resolver returned `unresolved`, so validator.ts's window-level subject gate fired before
  routing. Four messages, no name in-window, none in the neighbours. Correctly conservative — but
  note the day is discarded to `store_only`, so a true day is lost, not merely un-promoted.
- **RC-22** (first day at daycare): the editor scored it `ordinary_action` (capability 1), so no
  strong signal ever existed. A genuine life event was missed at the model layer.

---

## 6. Contamination impact of the `--exclude` parser defect

The corpus builder's `--exclude` parser read `results`, `scored`, `cases`, `windows`,
`manifest.windows` and `records` — but not `worksheet` or `candidates`, both of which are shapes
this project writes. A file it did not understand contributed nothing and the corpus still described
itself as fresh. Fixed in `1efaf1e`; it now reads both and hard-fails on an exclude file that yields
no rows or no window identifiers.

| Evaluation / corpus | Builder | Used this parser? | Intended to exclude | Actual overlap after fix | Downgrade? |
|---|---|---|---|---|---|
| **Holdout V2** | `organizer-fresh-shadow-corpus.mjs` | **No** — no `--exclude`; hardcoded constants | dev set, Holdout 1 | n/a | **No. Unaffected.** |
| **Holdout V3** (15 scored windows) | `organizer-holdout-v3-candidates.mjs` | **No** — `--spent-corpus`, reads `manifest.windows`, a shape its input does write | dev, Holdout 1, V2, V6 shadow | n/a | **No. Unaffected.** |
| V6 fresh shadow (30) | `organizer-fresh-shadow-corpus.mjs` | No | hardcoded sets | n/a | No. |
| Continuity corpus (35) | `organizer-continuity-corpus.mjs` | Own parser (`manifest.windows` + `cases`) | prior corpora, all of which write `manifest.windows` | none | No. |
| **47-window recall corpus** | `organizer-recall-corpus.mjs` | **Yes** | funnel, V6 shadow, **hv3-candidates**, continuity | **8 / 47** windows from the Holdout V3 *candidate pool*; the other 3 exclude files parsed correctly (163 windows excluded) | **Narrowed** — see below |
| **49-window coupled shadow** (this run) | same, parser fixed | Yes | recall corpus + 2 run files (100 windows, 1,178 sourceIds, 47 fingerprints excluded) | **11 / 49** overlap the hv3 candidate pool | Already development-grade |

**Only `hv3-candidates.json` was actually skipped** — it stores rows under `candidates`, so it
contributed 0 identifiers instead of 131. The `worksheet` gap was **latent, never realised**:
`recall-corpus.json` is the only file in that shape, it was created after the runs that would have
needed it, and the first time it was ever passed as an exclusion was after the parser was fixed.

**Bound on the damage.** Overlap with the **actually scored** Holdout V3 set is **0 by windowId and
0 by anchorSourceId**, for both corpora — those 15 windows were excluded by the `HOLDOUT_V3_SET`
constant, which never went through this parser. What leaked is *candidate-pool membership*: windows
a builder enumerated and classified with regexes, carrying no model score and no human label. No
judgement leaked with them.

So the 47-window recall corpus is **not** reclassified as contaminated. Its conclusions were already
development-grade ("not a holdout, not a generalisation test"), so no prior conclusion changes
category. Its independence claim is simply narrower than stated: it shares 8 windows with a
previously-enumerated candidate pool. **Nothing else has been relabelled.**

This corpus was deliberately **not** rebuilt to exclude that pool: it would cost a full rebuild and
drop ~11 of 49 windows from an already power-limited sample, for a contamination class that carries
no model or human judgement.

---

## 7. What must be true before the coupled candidate is measured again

Neither defect is a reason to abandon the direction — RC-09 shows the change does what it was
designed to do. Both are under-specified guards that frozen V6's `raw_fact` label was accidentally
hiding.

1. **Volition verbs must not settle a proposition.** `INNER_STATE_MATRIX` needs 想 and its
   neighbours (要, 打算 in the volitional reading). This does not touch frozen V6: `epistemicStatus`
   is read only by the promotion-eligibility count.
2. **A subjectless span must not inherit the child when the local discourse topic is another
   person.** Adding adults to `COMPETING_PERSON` is the wrong fix — family chat names parents
   constantly and it would refuse most legitimate resolutions. The right fix tracks the *nearest
   preceding named referent* and refuses when it is not the child. That is a design change and needs
   its own measurement.
3. Fresh capability-shaped material. Nine unspent windows cannot support an adoption decision. This
   likely requires new archive intake rather than better sampling.

Until then: **frozen V6 is the judgment policy. Both halves stay experimental and default-off.**
