# Organizer Canary #2 — RC-12 Memory canary and legacy retirement (2026-09-03)

Status: **ORGANIZER CANARY #2 PASSED — CUTOVER READY** (not cut over; see §7).

This document records one bounded production session: one reversible legacy
retirement ledger row, one live V2 Judgment + Writer attempt on window RC-12,
one production Memory write through the real adapter plan, and one exact replay.
No family text is reproduced here; the Judgment/Writer records live outside the
repo (session scratchpad `canary2/`).

THIS IS PRODUCTION-PATH VALIDATION. THIS IS NOT FRESH RECALL / GENERALISATION
EVIDENCE. RC-12 was already known to promote under `judgment-v6-frozen`; the
canary proves the write path, identity, pointer semantics and replay — not recall.

Tool: [`v2/scripts/organizer-v2-memory-canary.mjs`](../v2/scripts/organizer-v2-memory-canary.mjs)
(stages `plan | judge | write | predeclare | apply | replay`; `--out` must be
outside the repo; judge/write refuse to overwrite an existing record so the
model is called at most once per case).

## 1. Legacy retirement — `event-6b2dfc4d` ("36.7")

Independent data-quality correction, predeclared in
[`organizer-legacy-lifeevent-audit-2026-09-03.md`](organizer-legacy-lifeevent-audit-2026-09-03.md) §8.

| | before | after |
|---|---|---|
| `content_quality_reviews` (profile) | 105 | 106 |
| every other table | — | delta 0 |
| target row `md5(row)` | `e273a2f479234e9ae0c1cc237133c0a6` | unchanged |
| target `source_ids` / `media_ids` | 144 / 15 | unchanged |
| evidence pointers (sources / links / media) | 144 / 144 / 15 | unchanged |
| `isEventPublishable` | false (rule-derived, fail-closed) | false (now explicit) |

Row: `quality-review-legacy-audit-6b2dfc4d`, decision `downgrade_to_daily_trace`,
`prompt_version legacy-audit-2026-09-03`, `policy_version quality-review-v1`,
provider `human`, reason codes `whole_day_batch, health_reading_title,
milestone_regex_false_hit`. Insert is `on conflict (target_kind, target_id,
prompt_version) do nothing`; replay `rowCount=0`, delta 0.

Two deliberate deviations from the §8 predeclaration:

- `superseded_by:<id>` was **omitted**. Nothing in code parses it, and including
  it would have tied the retirement to a canary that might have blocked.
- `downgrade_to_daily_trace` is a **ledger label only**. No code path creates a
  DailyTrace from it; `daily_traces` stayed at 155. The legacy row is retired
  (never publishable) but not converted.

## 2. RC-12 collision gate (before write)

Exact pointer state at write time (not "≤4"):

- 33 `raw_sources.related_life_event_id` → legacy, status `organized`
- 33 `source_memory_links` owned by legacy (legacy has 144 links; window ⊂ event)
- 4 confirmed media bindings: `321e8642…` (photo) → legacy; `40cf5066…`,
  `f1a93d77…`, `3993f66a…` (videos) → null
- No other LifeEvent on 2025-08-29; no existing row under the V2 identity

## 3. Live pipeline (ONE Judgment call, ONE Writer call)

- Selector: `organizer-v2-adapter-v1 v2=on judgment=judgment-v6-frozen
  writer=writer-v2 prompt=memory-editor-v4 media=[confirmed] allowlist=33`
- Fingerprint `9b4e61ab8d16…f50e`; deterministic id
  `event-v2-f9ad332467926c9273c60d6ba0bc4396`; run
  `organizer-run-canary-9b4e61ab8d16`; review `quality-review-canary-9b4e61ab8d16`
- Judgment (15.2 s): `life_event_candidate`, worthiness 42, subject explicit /
  primary, blockers none, grounding 5 claims (1 promotable, 5 trace), 33 sources,
  routing `worthiness-v6-grounded`, reason codes none
- Writer (11.9 s, 1076 in / 1206 out): `insufficient=false`,
  `narrative-validator-v2.3` ACCEPT, 0 issues; 6 narrative claims each mapped to
  a grounded claim id and exact source ids; 3 verbatim quotes; all 4 confirmed media used

Manual truth audit: PASS. Every sentence traces to a verified span; speakers
resolve through the family registry; the caregiver's interpretation of the
child's behaviour is attributed ("妈妈觉得"), not asserted; no
developmental-novelty, personality or mind-reading language. Non-blocking notes:
the title uses a mild interpretive paraphrase of a quoted phrase; one sentence
widens the agent from one parent to "家里人" — the widening originates in the
grounded claim text produced by Judgment, not in the Writer; the narrated moment
is the previous night while `occurredAt`/lifeDate is the chat date, which the
prose handles with "昨晚". Writer was not tuned.

## 4. Memory write and actual DB delta

| table | before | after | delta |
|---|---|---|---|
| life_events | 82 | 83 | +1 |
| daily_traces | 155 | 155 | 0 |
| dupe groups | 0 | 0 | 0 |
| content_quality_reviews | 106 | 107 | +1 |
| organizer_runs | 306 | 307 | +1 |
| source_memory_links | 2793 | 2826 | +33 |
| media | 1153 | 1153 | 0 |
| raw_sources | 8796 | 8796 | 0 |

Repoint (exactly as predeclared): 33 `raw_sources` → new event; 4 `media` →
new event (1 from legacy, 3 from null); legacy pointer-owned sources 144 → 111,
media 15 → 14; legacy `source_ids`/`media_ids` arrays untouched (144 / 15).
New event: `created_by ai`, `organizer-v2-adapter-v1`, 33 sources, 4 media,
hero `40cf5066…`, visibility family. Review row `needs_review`
(`memory-editor-v4` / `evidence-contract-v1`, deepseek / deepseek-v4-pro).

Publication: `requiresQualityReview=true`, `isEventPublishable=false` with and
without the ledger row. Nothing inherits publishability from the legacy row or
the same day.

## 5. Exact replay

`applied=false (already organized under this fingerprint)`; all deltas 0;
pointer, review and run rows identical; exit 0. **CANARY REPLAY CLEAN.**

## 6. Legacy collision implication (not solved here)

**Retiring a legacy container via ledger does NOT by itself remove its source
pointers. Therefore historical V2 reprocessing will need an explicit legacy
supersede/repoint strategy.**

Observed mechanics of `persistOrganization`:

- `raw_sources.related_life_event_id` and `media.life_event_id` are single-owner
  and get **moved** to the new event.
- `source_memory_links` are **additive**: the 33 legacy links remain, so the 33
  sources are now linked to both events (legacy 144, new 33).
- `life_events.source_ids` / `media_ids` on the legacy row are never edited.

Consequences for a global cutover: every historical window inside a retired
legacy container will leave dual links and a stale legacy array; a supersede
step (explicit link removal or a `superseded_by` relation with code that reads
it) has to be designed before backfill. The other 65 RETIRE verdicts were **not**
swept in this session.

## 7. Cutover prerequisites still open

1. `Repository` (`createPostgresRepository()`) has no `persistQualityReview`;
   the canary supplied a pg upsert. The worker cannot run the adapter until the
   repository gains it.
2. The adapter writes review decision `needs_review`, which is outside the
   `QualityDecision` union (still non-publishing; align the literal or the union).
3. Worker default is still `legacy-rule-v2 v2=off`; AI Organizer must move to the
   async job/outbox path before any default switch.
4. Legacy supersede/repoint strategy (§6).
5. RC-12 remains one of the two known-promoting windows; recall on unseen
   windows is unmeasured (Holdout V3 recall 0/2).

Next gate: implement `Repository.persistQualityReview` + a second **unseen**
window canary through the same script, with the supersede strategy decided
before any batch.
