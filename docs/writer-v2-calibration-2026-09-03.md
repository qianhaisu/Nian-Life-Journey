# Writer v2 — editorial calibration and freeze (2026-09-03)

> **Status: WRITER V2 FROZEN (engineering contract).** Prompt `family-writer-v2-calibrated-r2.1`,
> Narrative Validator `narrative-validator-v2.3`. Frozen on the strength of a 14-case shadow over
> existing production LifeEvents (round 5: 7 accepted, 3 rejected, 4 declined-as-insufficient, zero
> Writer-level truth failures in the accepted stories after hand review). The fresh, V6-approved
> validation Shadow that Phase D asked for could not be built — see §5 — so this freeze is on the
> Writer's *contract*, not on a claim that it has been seen writing new Memories.
>
> Continues [`writer-v2-fable-handoff-2026-09-03.md`](writer-v2-fable-handoff-2026-09-03.md). Product
> truth is [`nianlife-product-principles.md`](nianlife-product-principles.md). Sample packs and
> per-round JSON contain family chat and stay outside the repository.

## 1. The six decisions

All six open questions from the handoff (§7, §8.1) are now settled in the prompt and, where a rule
can be checked mechanically, in the validator. None of them was settled by asking the family.

| # | decision | where it lives |
| --- | --- | --- |
| 1 | Name the person whose observation or judgement it is; about half the sentences on a page carry a name; a single-speaker day names once. An unresolved speaker is never given a name. | prompt 家人是有名字的 |
| 2 | Short days produce short pages; no floor. A page whose only assertable material is a static state with no action is `insufficient: true`, and that is a complete answer. | prompt 不够就少写; validator keeps no floor |
| 3 | Preserved uncertainty is written in family register (已经能自己爬了), never as report register or as an invented "first". | prompt 保留当时的不确定 |
| 4 | Text stands alone; a confirmed photo is paired by the layout, never described. | prompt 照片; validator media checks |
| 5 | At most one "从……到……" contrast per page, only when both ends are evidenced. | prompt 更早的背景; validator `unsupported_longitudinal_contrast` |
| 6 | Inner state is part of the truth contract. Observable action may be stated; a feeling, wish or preference must be attributed in the same sentence — and **the title counts**. | prompt 动作可以直接写; validator `inner_state_stated_as_fact` over title + story sentences |

Two further rules surfaced during calibration and are now in the contract:

- **Second person is not resolved.** A quoted 「你」 or 「我」 keeps its pronoun; the Writer may not
  substitute a family member (prompt 「你」「我」不要替换; validator `second_person_resolved_to_person`).
- **Only assertable lines are quotable.** A verbatim line that only exists in a question, a plan or an
  unresolved-subject claim is not offered to the Writer at all (`quoteIsAssertable`, shared by prompt
  and validator), so a truthful story can no longer be rejected for quoting something the package
  itself put on the menu.

## 2. Rounds

Same 14 cases each round (existing production LifeEvents with v1 stories and grounded claims; 4 of
them have nothing assertable and are declined every round). `persist: false` throughout.

| round | prompt | validator | accepted / runs | what changed |
| --- | --- | --- | --- | --- |
| r2 (handoff) | v2 | v2 | 8 / 10 | baseline from the handoff session |
| r3 | calibrated-r1 | v2.1 | 3 / 10 | inner-state and 你-resolution rules added; validator became much stricter than the prompt |
| r4 | calibrated-r2 | v2.2 | 5 / 10 | prompt taught the title rule and no-substitution; validator learned attributed-in-sentence |
| r5 | calibrated-r2.1 | v2.3 | 7 / 10 | quotes filtered to assertable; stage directions checked; 觉得/新鲜/敏感 counted as inner state |

The two substantial iterations the task allowed were r3 and r4. r5 changed only what the validator
already implied (offer the Writer no line the validator would reject) and added checks; it was run to
confirm the contract is consistent, not to tune taste.

Round 5 hand review of the seven accepted stories against the hard-failure list (invented fact,
invented milestone, attribution error, unsupported inner state, question/plan/negation
factualization, other-child leakage, unsupported quote, unsupported media–event relationship,
ungrounded narrative claim): **0 failures.** Every sentence maps to an assertable claim, every quote
is verbatim from the offered list, negated claims stay negated (还没学会), inner states are attributed
in-sentence, media used is `confirmed` only.

The three rejections are correct rejections: two unsupported stage directions (妈妈看着 / 妈妈笑着
with no evidence anyone looked or laughed), one flat inner state in a title.

## 3. Residuals (reported separately, not blocking the freeze)

These are true of the accepted stories and are **not Writer failures**; they are where the Writer
faithfully rendered something upstream that is imprecise.

- **Recounted event written as this day (JUDGMENT).** One window is a chat about a video of an
  earlier moment; the editor grounded the recounted action as `observed_firsthand` with no temporal
  anchor, so it became the dated page's headline. The Writer cannot know. This is an Evidence
  Builder / editor hazard: recounted events need an "as told on" marker before they reach a page.
- **Composite multi-speaker claims (GROUNDING).** When grounding fuses two speakers' spans into one
  claim, the Writer attributes the action to both ("妈妈和雪姨记下"), which over-states one of them.
  Claims should be split per speaker at grounding time rather than repaired in prose.
- **Entity introduction through 你 (GROUNDING).** Grounding has produced a claim "太爱妈妈了" from a
  span 「他太爱你了」. The validator now blocks the Writer from doing this, but the claim text itself
  is still upstream of the Writer; the Writer's prompt tells it to prefer the span.
- **Validator stage-direction support is lexical.** `笑称` is accepted when the cited text contains 笑
  — including 假笑 said *about the child*. Cheap to tighten later; it did not admit a false story here.
- **Editorial taste.** One story says 原话是「…」, which reads like a report; one records a joke that
  is truthful but odd on a page. Neither is a truth issue.

## 4. What is frozen

- `v2/lib/organizer/writer-v2.ts` — package/output contract, `isAssertable`, `isInnerStateText`,
  `quoteIsAssertable`, `GENERIC_ALIASES`, `NOT_AN_UTTERANCE`.
- `v2/lib/organizer/writer-v2-prompt.ts` — `family-writer-v2-calibrated-r2.1`.
- `v2/lib/organizer/narrative-validator.ts` — `narrative-validator-v2.3`, fail-closed.
- `v2/test/organizer-narrative-validator.test.mjs` — 34 tests, the failure taxonomy.

Changing the prompt or validator after this point bumps the version string; the canary and any
later persistence record the versions they ran under.

## 5. The fresh V6-approved shadow is empty — a V6 yield finding

Phase D asked for a validation set the Writer had not been calibrated on: 16–24 genuine V6-approved
Memory candidates from unprocessed windows, fewer if fewer exist, never by lowering the threshold.

`v2/scripts/writer-v2-fresh-shadow.mjs` built that set from the main conversation, excluding every
spent day (Development, Holdout, Holdout V2, Holdout V3, and every day that already has a LifeEvent)
and every window with fewer than four messages or an unresolvable subject. **45 fresh windows were
scored by the real judge chain (editor v4 → grounding → V6 routing): 0 became `life_event_candidate`**
(25 `daily_trace`, 19 `store_only`, 1 `plan_marker`). 22 of them carried at least one promotable
grounded claim and 5 carried two or more; worthiness still routed all of them to DailyTrace.

Together with the earlier stratified and continuity sets this makes **0 Memories out of 110 fresh
windows** under V6. The Writer was therefore not exercised on a single fresh, V6-approved candidate.
The threshold was not lowered to manufacture material. This is the most important number in this
document: V6 is precision-safe and effectively never promotes. It is reported here, not fixed here.
