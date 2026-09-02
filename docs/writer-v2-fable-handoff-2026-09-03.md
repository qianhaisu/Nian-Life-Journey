# Writer v2 — handoff for Fable 5.1 editorial calibration (2026-09-03)

> **Status: architecture ready, editorially uncalibrated.** Writer v2's contracts and validator are
> built and tested. **The Writer itself has never been run** — no prompt was written, no model was
> called, no story exists. This is a handoff of the machinery and the open questions, not of output
> to review.
>
> Read this together with [`organizer-v6-freeze-2026-09-03.md`](organizer-v6-freeze-2026-09-03.md),
> and [`nianlife-product-principles.md`](nianlife-product-principles.md), which wins on any conflict.

## 0. What you own

Final editorial calibration of Writer v2: what a page in 张年's archive should actually read like.
Specifically the five things this session could not settle and deliberately did not guess at —
§7.

What you do **not** own, because it is settled and enforced in code: which windows become Memories
(V6 decides, the Writer has no vote), and what a sentence is allowed to assert (the Narrative
Validator decides, and it fails closed).

## 1. Where everything is

| what | where |
| --- | --- |
| Evidence package + output contract | `v2/lib/organizer/writer-v2.ts` |
| Narrative Validator v2 | `v2/lib/organizer/narrative-validator.ts` |
| Validator tests (the failure taxonomy) | `v2/test/organizer-narrative-validator.test.mjs` |
| Writer v1 prompt and rules | `v2/lib/organizer/family-writer.ts` |
| Writer v1 production script | `v2/scripts/deepseek-family-writer.mjs` |
| Claim Grounding | `v2/lib/organizer/claim-grounding.ts`, `speech-act.ts` |
| Frozen routing | `v2/lib/organizer/worthiness-v4.ts`, `worthiness-v5.ts`, `routing-policies.ts` |

## 2. What the Writer receives

`VerifiedMemoryEvidencePackage`. Not a chat log — editorial material V6 has already verified.

- **Identity.** Verified family members with narrative labels (爸爸 / 妈妈 / 雪姨). An unknown
  speaker stays unknown; it must never become a generic 家人 by default.
- **Time.** Both clocks: the Asia/Shanghai `lifeDate` and `ageAtEvent` ("1 岁 7 个月"). Also
  `priorEvidenceThrough`, the cutoff separating baseline from the current event.
- **Claims.** Each with `assertionStatus`, `polarity`, `observationMode`, `subjectResolved`,
  `subjectBasis`, speakers, sourceIds, evidenceRefs, exact spans, and `assertable`.
- **Quotes.** Verbatim-checked against the window at package build time.
- **Longitudinal context.** Bounded, relevant, verified — and `assertable: false` by construction.
  It exists so you can understand continuity, never to be written as an event of this day.
- **Media.** Binding tier only. **No description of what any image shows exists anywhere in the
  pipeline**, because nothing has looked at the pixels. `contentDescribed: false` is a type-level
  fact, not a placeholder awaiting a caption.

The key field is `assertable`. The package deliberately contains **more than the Writer may state**.
A question, a plan, a hypothetical or an unresolved subject may inform your understanding of the
day; it may never be the support for a sentence.

## 3. What the Writer must return

```
{ insufficient, title?, story?, narrativeClaims[], usedClaimIds[], usedQuoteIds[], usedMediaIds[], editorialNotes? }
```

Each `narrativeClaim` cites `supportedByClaimIds` + `supportedBySourceIds` (optionally quotes and
media). The family never sees these. They exist so the back office can always answer "why was this
sentence written?".

`insufficient: true` is a complete, valid, respected answer. Publishing nothing beats publishing
invention.

## 4. What the validator will reject

Used evidence ⊆ package, and every factual narrative claim → evidence support. Then: question or
plan cited as fact, not-yet written as achieved, invented milestone, unsupported quote, a person not
in the package, weak media used as event evidence, unsupported emotional inference, unsupported
causal link, unsupported time statement, clichés, technical placeholders.

One deliberate change from v1 you should know about: **there is no story length floor.** v1 demanded
60 characters and then needed an escape hatch when the evidence could not honestly fill it. Few
facts may mean a short page. Only the ceiling (180) remains. Do not reintroduce a floor.

## 5. Writer v1: what to keep, what is obsolete

**Keep** — these were right and are not up for revision: verified facts only; verbatim quotes; no
invented milestone; no fake emotion, motive or causality; no clichés; a hypothetical stays visibly
hypothetical; insufficient evidence may produce no story; publishing nothing beats publishing
invention.

**Obsolete** — do not carry these forward:

- Candidate selection by the Writer's own score floor (`worthinessScore >= 30` in
  `deepseek-family-writer.mjs:68`). V6 is the only selection authority.
- Rewriting production `life_events` / `daily_traces` in place (lines 105, 125, 153).
- A generic 家人 where a verified identity exists.
- `mediaCount` in the prompt. v1 passed "当天媒体数量：N（内容未知）" — a number that invites exactly
  the inference it warns against. v2 passes binding tiers and no counts.
- Writing from ungrounded `coreFacts`.

## 6. Media truth (non-negotiable)

1. Text without a photo is a complete Memory. Never pad a page with a picture for layout.
2. `confirmed` and `strong_contextual` may be "the photo of this story". `day_level` and
   `month_level` may not, and **same-day is never enough**.
3. Day- and month-level media may still appear in date browsing, but no sentence or layout may
   imply "this photo records this event".
4. Never infer from an image: first-time-ness, emotion, motive, identity, background, causality.

## 7. The open editorial decisions — your call

These are the five this session refused to settle by personal taste. Each has a real tension.

1. **How much family voice, how often.** "妈妈发现……" is warmer and more specific than "家人".
   But naming a speaker in every sentence reads like a transcript. Where is the line, and does it
   change with how many people spoke that day?
2. **What a short page looks like.** The floor is gone, so a two-fact day may legitimately produce
   two sentences. Does that read as a page in a family book, or as a stub? If a stub, is the answer
   different words — or `insufficient: true`?
3. **How to render preserved uncertainty warmly.** The rule is settled: evidence for "他自己会爬"
   with no evidence of "第一次" must be written as 已经能自己爬, never 第一次学会爬. What is *not*
   settled is whether that reads as careful or as stiff, and what the warm version of the same
   restraint sounds like.
4. **Text-and-photo pages.** When a `confirmed` photo exists, does the text acknowledge it, or stand
   alone and let the layout pair them? v1 never faced this because it had only a count.
5. **Longitudinal reference.** The package carries verified baselines. A page may say the thing
   changed only where evidence supports the change. How much continuity belongs on one page before
   it stops being a moment and becomes a report?

## 8. What is NOT in this handoff, and why

**No Writer v2 outputs, and no v1/v2 comparison.** The night's priority order put correctness gates
first — Time Truth, Claim Grounding, trace retention, the fresh shadow, the V6 freeze, Holdout V3 —
and the Writer sits behind all of them. Two of those gates turned up defects that had to be fixed
and re-verified (see §9), which consumed the time the Writer shadow would have used.

So there is no sample pack of 8–12 real stories to react to. That is the honest state, and the
alternative — a rushed prompt producing stories nobody had time to validate — would have been worse
than nothing, because it would have anchored your calibration on output that was never checked.

**What to do first**, therefore: write the Writer v2 prompt against the contract in §2–§4, run it in
shadow over V6-approved candidates, and calibrate from real output. The machinery to build packages
and to reject bad stories is ready and tested; only the prompt and the taste are missing.

## 9. Two defects found last night that change how you should read old artifacts

1. **`raw_sources.captured_at` is `timestamptz`, not tz-naive.** The "authoritative" Shanghai
   life-date SQL was a bare `to_char`, which Postgres renders through the session timezone (GMT
   here), so it returned the UTC date. 150 of 8,689 messages were a day early — every message sent
   between Shanghai 00:00 and 07:59. Fixed centrally; the stored instants were always correct.
2. **Every day recorded in Holdout 1 was a day early**, built by the older local-Date +
   `.toISOString()` route. Corrected, with the original preserved.

The general lesson, now enforced by `organizer-calibration-dates.test.mjs`: **anything identified by
a date alone will eventually be wrong and nothing will notice.** If you freeze an editorial example
set, anchor every case to a real `sourceId`, not to a day you wrote down.

## 10. Production safety

Nothing in production changed. The default router and default Writer are unchanged, no LifeEvent or
DailyTrace was created, updated or deleted, and no publication ledger was touched. Writer v2 has
never run. Any Writer work you do should stay in shadow until an end-to-end Canary is agreed with
Teddy.
