# Legacy LifeEvent quality audit — 2026-09-03

**OVERALL STATUS: LEGACY QUALITY DEBT FOUND — RC-12 CANARY REPAIR PATH IDENTIFIED**

Read-only audit of all 82 production LifeEvents. No production row was written, updated or deleted. No model
was called. Tooling: [`v2/scripts/organizer-legacy-lifeevent-audit.mjs`](../v2/scripts/organizer-legacy-lifeevent-audit.mjs)
(SELECT-only, prints no family text; `--overlap=<json>` answers the source-collision question for any
candidate window). This document deliberately quotes no chat content; per-row descriptors are neutral
paraphrases, and the four already-known titles below (`36.7`, `37.4`, `39.4`, medication name) are the
only literal title values repeated here because the prior audits already record them.

Baseline verified at start: `main == origin/main` (c9a356b), clean tree; `life_events 82`, `daily_traces 155`,
`distinct fingerprints 155`, `duplicate fingerprint groups 0`, `source_memory_links 2793`, `content_quality_reviews
105` (35 for life_events), `organizer_runs 306`; V2 plumbing-canary rows intact (RC-04 trace + 2 V2 runs, 0 V2
review rows); global organizer default still legacy; selector default-off.

## 1. Creation mechanism (proved, not assumed)

Every one of the 82 rows has an `organizer_runs` row with `action = create_memory`, `organizer_version = rule-v2`.
The generator is [`rule-based.ts`](../v2/lib/organizer/rule-based.ts):

- `text` = the **first** source in `sourceIds` order that has any text.
- `title = text.slice(0, 80)`, `story = text.slice(0, 420)` — verbatim, exporter escaping included.
- `create_memory` fires on either of two conditions over the **whole batch**:
  - **signal path** — `/第一次|首次|开始|学会|主动|生日|旅行|里程碑|…/` matches *anywhere in the joined text of the
    batch* → `memory_weight = memory`, `event_type = milestone`; or
  - **≤2-source path** — `Boolean(text) && sources.length <= 2` → `memory_weight = trace`, `event_type = moment`.
- links: index 0 `primary`, all others `supporting`; `hero_media_id = media_ids[0]`; `createdBy = rule`.
- `persistOrganization` then sets `raw_sources.related_life_event_id` (single-valued) and `media.life_event_id`
  for every source/media in the batch.

Measured against production: 82/82 `create_memory`; 72 rows still carry rule-v2 text, and 71 of those have
`title === firstText.slice(0,80)` and `story === firstText.slice(0,420)` exactly. Signal path = 41 rows,
≤2-source path = 41 rows. Batches never span more than 24 h (max 16.3 h); 0 sources are linked to more than
one event; 0 pointer mismatches (`related_life_event_id` equals the linking event for all 2793 links).

The 10 non-rule rows were rewritten afterwards by `deepseek-family-writer-v1` (3 approved, 5 downgraded,
2 needs_human_review); 6 of them had `source_ids` narrowed by `deepseek-evidence-narrow` while the links were
left intact, which explains the 6 `link_count ≠ source_ids.length` rows (e.g. 2 ids vs 74 links).

**The regex fired on `开始` in 33/41 signal-path events.** In 29 of the 41 it fired on an unrelated phrase
(weather starting, cleaning starting, a fever "starting to rise again", a medication start, a schedule change) —
tag `SIGFALSE` below. Where it fired on a genuine child statement (`学会` ×2, `第一次`/`首次` on a child
sentence, `旅行` on an actual outing) the row is at least REWRITE-worthy.

## 2. 82-event audit summary

| class | rows | memory-weight | trace-weight | no ledger row |
|---|---|---|---|---|
| KEEP | 3 | 3 | 0 | 0 |
| REWRITE_CANDIDATE | 5 | 5 | 0 | 4 |
| RETIRE_CANDIDATE | 66 | 25 | 41 | 37 |
| UNCERTAIN | 8 | 8 | 0 | 6 |

Full per-row table (id prefix, date, links, weight, text version, ledger, class, tags):

| # | id | date | links | w | ver | ledger | class | tags |
|---|---|---|---|---|---|---|---|---|
| 1 | 8d516420 | 2025-05-19 | 15 | memory | DSW | needs_human_review | UNCERTAIN | DAY SIGFALSE |
| 2 | 147e12e1 | 2025-05-22 | 26 | memory | DSW | downgrade | RETIRE | DAY SIGFALSE |
| 3 | 89b54e63 | 2025-05-23 | 2 | trace | rule | store_only | RETIRE | WEAK LOG SLICE |
| 4 | 98b920ba | 2025-05-23 | 1 | trace | rule | store_only | RETIRE | WEAK LOG SLICE |
| 5 | 0b459760 | 2025-05-24 | 1 | trace | rule | store_only | RETIRE | WEAK LOG SLICE |
| 6 | 04b6503e | 2025-06-09 | 2 | trace | rule | rejected_unrelated | RETIRE | WEAK LOG SLICE |
| 7 | 715b65af | 2025-06-13 | 2 | trace | rule | store_only | RETIRE | WEAK EMO |
| 8 | 3c1ba8b8 | 2025-06-17 | 2 | trace | rule | store_only | RETIRE | WEAK MEDIA |
| 9 | f28bc982 | 2025-06-18 | 1 | trace | rule | store_only | RETIRE | WEAK URL |
| 10 | dec4f4a2 | 2025-06-20 | 2 | trace | rule | store_only | RETIRE | WEAK MEDIA |
| 11 | 5c3a9d42 | 2025-06-21 | 1 | trace | rule | store_only | RETIRE | WEAK MEDIA |
| 12 | 98e3ddc7 | 2025-06-21 | 2 | trace | rule | store_only | RETIRE | WEAK EMO |
| 13 | 01e64d93 | 2025-06-23 | 17 | memory | rule | store_only | RETIRE | DAY SIGFALSE SLICE AD LOG |
| 14 | 5f122471 | 2025-06-25 | 38 | memory | DSW | downgrade | RETIRE | DAY SIGFALSE |
| 15 | b1c7cee8 | 2025-06-27 | 2 | trace | rule | rejected_unrelated | RETIRE | WEAK LOG SLICE |
| 16 | 01e69d62 | 2025-06-28 | 17 | memory | rule | store_only | RETIRE | DAY SIGFALSE MEDIA |
| 17 | 5d47165d | 2025-06-29 | 1 | trace | rule | rejected_unrelated | RETIRE | WEAK LOG SLICE |
| 18 | 8c38c528 | 2025-06-29 | 1 | trace | rule | rejected_unrelated | RETIRE | WEAK LOG SLICE |
| 19 | da3e8f50 | 2025-07-08 | 37 | memory | rule | rejected_unrelated | RETIRE | DAY SIGFALSE SLICE LOG |
| 20 | 510dbdf6 | 2025-07-13 | 28 | memory | rule | downgrade | RETIRE | DAY SIGFALSE SLICE Q |
| 21 | 33819c2d | 2025-07-14 | 63 | memory | rule | store_only | REWRITE | DAY MEDIA |
| 22 | d7acbf51 | 2025-07-15 | 124 | memory | DSW | downgrade | RETIRE | DAY SIGFALSE |
| 23 | 251b675a | 2025-07-16 | 152 | memory | rule | downgrade | RETIRE | DAY SIGFALSE SLICE LOG |
| 24 | 0226c115 | 2025-07-18 | 74 | memory | DSW | approved | KEEP | DAY |
| 25 | c84a6165 | 2025-07-19 | 1 | trace | rule | rejected_unrelated | RETIRE | WEAK GPS |
| 26 | 77f5a5f9 | 2025-07-21 | 73 | memory | DSW | downgrade | RETIRE | DAY |
| 27 | 5a4e98a8 | 2025-07-25 | 103 | memory | DSW | downgrade | RETIRE | DAY SIGFALSE |
| 28 | 855af16b | 2025-07-30 | 72 | memory | rule | store_only | RETIRE | DAY EMO SIGFALSE |
| 29 | b24f36cb | 2025-07-31 | 96 | memory | rule | store_only | RETIRE | DAY MEDIA SIGFALSE |
| 30 | 972c4c45 | 2025-08-01 | 73 | memory | DSW | needs_human_review | UNCERTAIN | DAY SIGFALSE |
| 31 | 428dfacc | 2025-08-03 | 2 | trace | rule | store_only | RETIRE | WEAK URL |
| 32 | a9623b23 | 2025-08-04 | 95 | memory | rule | downgrade | RETIRE | DAY SIGFALSE SLICE LOG |
| 33 | 7f060955 | 2025-08-05 | 75 | memory | DSW | approved | KEEP | DAY |
| 34 | dc7193ad | 2025-08-11 | 107 | memory | DSW | approved | KEEP | DAY |
| 35 | 57d610c4 | 2025-08-12 | 64 | memory | rule | downgrade | RETIRE | DAY FILE SIGFALSE |
| 36 | 7b8c5421 | 2025-08-13 | 186 | memory | rule | — | UNCERTAIN | DAY FILE |
| 37 | dc9a29dd | 2025-08-19 | 56 | memory | rule | — | RETIRE | DAY EMO SIGFALSE |
| 38 | 10bf8e70 | 2025-08-21 | 78 | memory | rule | — | UNCERTAIN | DAY MEDIA SIGFALSE |
| 39 | 9b58b446 | 2025-08-27 | 1 | trace | rule | — | RETIRE | WEAK NUM SLICE |
| 40 | a9587087 | 2025-08-28 | 24 | memory | rule | — | RETIRE | DAY NUM SLICE SIGFALSE |
| 41 | 6b2dfc4d | 2025-08-29 | 144 | memory | rule | — | RETIRE | DAY NUM SLICE SIGFALSE |
| 42 | 5d020c1a | 2025-08-30 | 2 | trace | rule | — | RETIRE | WEAK LOG SLICE |
| 43 | 90a77911 | 2025-08-31 | 14 | memory | rule | — | RETIRE | DAY LOG SLICE SIGFALSE |
| 44 | 51644090 | 2025-09-01 | 150 | memory | rule | — | UNCERTAIN | DAY FILE SIGFALSE |
| 45 | 4929af6c | 2025-09-02 | 2 | trace | rule | — | RETIRE | WEAK PLAN SLICE |
| 46 | 1972df69 | 2025-09-03 | 84 | memory | rule | — | RETIRE | DAY SLICE SIGFALSE |
| 47 | 4d81473c | 2025-09-03 | 1 | trace | rule | — | RETIRE | WEAK EMO |
| 48 | 74a7640d | 2025-09-04 | 2 | trace | rule | — | RETIRE | WEAK MEDIA |
| 49 | b249db8a | 2025-09-04 | 47 | memory | rule | — | UNCERTAIN | DAY MEDIA |
| 50 | f0a6c150 | 2025-09-05 | 90 | memory | rule | — | RETIRE | DAY SLICE LOG SIGFALSE |
| 51 | 09f42eff | 2025-09-08 | 73 | memory | rule | — | RETIRE | DAY SLICE LOG SIGFALSE |
| 52 | 53808606 | 2025-09-09 | 1 | trace | rule | — | RETIRE | WEAK URL |
| 53 | 96c45ae0 | 2025-09-15 | 2 | trace | rule | — | RETIRE | WEAK URL |
| 54 | 3f584a63 | 2025-09-16 | 1 | trace | rule | — | RETIRE | WEAK URL |
| 55 | 769f734f | 2025-09-25 | 2 | trace | rule | — | RETIRE | WEAK EMO |
| 56 | 95e73587 | 2025-09-29 | 2 | trace | rule | — | RETIRE | WEAK MEDIA |
| 57 | 267d456f | 2025-09-30 | 49 | memory | rule | — | REWRITE | DAY FILE |
| 58 | 69c887c0 | 2025-09-30 | 1 | trace | rule | — | RETIRE | WEAK SLICE |
| 59 | 89593616 | 2025-10-02 | 2 | trace | rule | — | RETIRE | WEAK LOG SLICE |
| 60 | 7ff2cb22 | 2025-10-03 | 57 | memory | rule | — | RETIRE | DAY Q SLICE SIGFALSE |
| 61 | 213342b1 | 2025-10-04 | 4 | memory | rule | — | REWRITE | FILE |
| 62 | 3f742571 | 2025-10-06 | 10 | memory | rule | — | RETIRE | MEDIA LOG SIGFALSE |
| 63 | ac236246 | 2025-10-08 | 1 | trace | rule | — | RETIRE | WEAK LOG SLICE |
| 64 | ab7f2991 | 2025-10-11 | 15 | memory | rule | — | REWRITE | SLICE SIGFALSE |
| 65 | 706d602f | 2025-10-12 | 1 | trace | rule | — | RETIRE | WEAK LOG SLICE |
| 66 | 995c0121 | 2025-10-13 | 26 | memory | rule | — | UNCERTAIN | MEDIA SIGFALSE |
| 67 | bba83328 | 2025-10-14 | 82 | memory | rule | — | RETIRE | DAY PLAN SLICE |
| 68 | e688a5ce | 2025-10-14 | 2 | trace | rule | — | RETIRE | WEAK EMO |
| 69 | 364c7c32 | 2025-10-17 | 1 | trace | rule | — | RETIRE | WEAK SLICE |
| 70 | f3653d0d | 2025-10-18 | 1 | trace | rule | — | RETIRE | WEAK SLICE |
| 71 | 58d6a303 | 2025-10-20 | 1 | trace | rule | — | RETIRE | WEAK SLICE |
| 72 | dd9c8340 | 2025-10-20 | 109 | memory | rule | — | UNCERTAIN | DAY FILE SIGFALSE |
| 73 | d181aae4 | 2025-10-21 | 1 | trace | rule | — | RETIRE | WEAK MEDIA |
| 74 | 18a74417 | 2025-10-26 | 2 | trace | rule | — | RETIRE | WEAK LOG SLICE |
| 75 | 470d7244 | 2025-10-26 | 2 | trace | rule | — | RETIRE | WEAK SLICE |
| 76 | aae2e896 | 2025-10-29 | 53 | memory | rule | — | RETIRE | DAY AD LOG |
| 77 | 669bce78 | 2025-11-01 | 1 | trace | rule | — | RETIRE | WEAK SLICE |
| 78 | c0114c1f | 2025-11-03 | 1 | trace | rule | — | RETIRE | WEAK FILE |
| 79 | 1e47478e | 2025-11-04 | 2 | trace | rule | — | RETIRE | WEAK NUM SLICE |
| 80 | 286bdc3f | 2025-11-07 | 1 | trace | rule | — | RETIRE | WEAK MEDIA |
| 81 | cbb6bb96 | 2025-11-08 | 2 | trace | rule | — | RETIRE | WEAK LOG SLICE |
| 82 | a5960c71 | 2026-02-23 | 32 | memory | rule | — | REWRITE | MEDIA DAY |

Why the non-RETIRE rows are where they are:

- **KEEP (3)** — #24, #33, #34: DSW-rewritten, ledger `approved`, currently the only 3 visible rows. Note the
  link over-coverage (74/75/107 links vs 2–3 `source_ids`): provenance is wider than the narrative.
- **REWRITE_CANDIDATE (5)** — the batch contains an explicit, bounded child capability/first-time statement
  in the family's own words, but the row's prose is a slice or placeholder: #21 (first "pretend crying" noted
  2025-07-14), #57 (a distinctive expression moment + real outing), #61 (a learned gesture, 4 sources), #64
  (self-settling to sleep unaided), #82 (walking + first day away from family at daycare, 2026-02-23).
- **UNCERTAIN (8)** — #1 and #30 are DSW `needs_human_review` rows about caregivers more than the child;
  #36, #44, #72 are 100–186-message days with growth remarks but no single visible moment; #38, #49, #66 carry
  one secondary capability remark (self-feeding practice, "almost running", "basically self-settles now")
  inside an ordinary day. They need V2 windowing, not a title fix.

## 3. Failure taxonomy (counts over 82; a row can carry several tags)

| tag | meaning | rows | A/B/C |
|---|---|---|---|
| SLICE | title/story is `text.slice()` of the first message | 71 (regex on current title: 36 still visibly raw) | prose defect (A) when content is worthy, otherwise B |
| DAY | whole-day batch container (≥3 h or ≥10 sources) | 40 | container problem — the true unit is a sub-window |
| SIGFALSE | milestone regex fired on an unrelated phrase | 29 | B — promotion was accidental |
| WEAK | ≤2-source path (single/paired message) | 41 | B |
| LOG | ordinary logistics (errands, meals, wifi, deliveries) | 22 | B |
| MEDIA | `[media]` placeholder title | 15 | B when bare; A inside #21/#82 |
| EMO | sticker / emoji-code title | 7–10 | B |
| FILE | `[视频文件](…)` / `\[视频\]` title | 7 | B when bare; A for #57/#61 |
| URL | link / article title | 5 | B |
| NUM | temperature or medication title (#39, #40, #41, #79) | 4 | B — health readings, not memories |
| AD | product / booking card (#13 taobao inside, #76 携程) | 2 | B |
| Q | question title (#20, #60) | 2 | B |
| PLAN | future/plan statement (#45, #67) | 2 | B |
| GPS | location card (#25) | 1 | B |
| DUP | duplicate event | 0 | — (0 sources multi-linked, 0 fingerprint dupes) |
| UNSUP | narrative unsupported by evidence | 0 among rule rows (slices are literal) | the 3 DSW approved rows were checked in the prior DSW session |

Every RETIRE verdict rests on evidence-not-worth-a-LifeEvent (B), not on an ugly title. Rows whose evidence
is worthy but whose prose is broken are REWRITE (A) or UNCERTAIN (C).

## 4. "36.7" — `event-6b2dfc4d-6268-4f44-8456-b0c6689c5e03` deep audit

- **Batch**: the whole of 2025-08-29 (UTC 00:31 → 16:49, 16.3 h), 144 sources, 100 textual, 15 photo media,
  hero = first photo of the day; `organizer_runs` row processed 2026-09-02T08:08:48Z, `source_count 144`.
- **Title/story**: the first message of the day — a body-temperature reading during fever recovery (this row
  is day 3 of a fever thread: #39 medication name 08-27, #40 `37.4` 08-28, #41 `36.7` 08-29). Not a slice bug:
  the slice worked exactly as coded; the first message simply was a number.
- **Why it became a Memory**: `开始` matched two unrelated phrases — one asking when the antibiotic course was
  started, one about an early-morning routine. No child milestone phrase triggered it.
- **What the day actually contains** (chronologically): fever-recovery/antibiotic decision (health); morning
  banter (teeth, mouth, toenail); unrelated adult topics; an observation that the child looked better than
  last visit; talk about another family's child; a **05:44–06:38Z segment in which the family describes the
  child's "pretend crying" behaviour in detail** (this is RC-12); later a fast rolling remark and an
  older standing-support link.
- **Is there a real underlying Memory?** Yes — the 05:44–06:38Z segment. It is exactly RC-12's 33 sources,
  and frozen V6 judged it `life_event_candidate` 3/3 on an identical worthiness axis.
- **Is the row only a malformed title?** No. Rewriting the title would leave a 144-source container whose
  primary source is a temperature reading, whose hero image is unrelated to the 假哭 segment, and whose
  provenance covers health data, adult chat and another family's child. The container itself is wrong.
- **Pointers**: all 144 `raw_sources.related_life_event_id` and all 15 `media.life_event_id` point at this
  row. RC-12's 33 sources are all `organized` → this row; of RC-12's 4 media, 3 videos have
  `life_event_id = null` and 1 photo points at this row. No `content_quality_reviews` row exists (hidden by
  fail-closed gate). The same-day DailyTrace `trace-d1504aef` is actually 2025-08-28 (202 sources,
  0 overlap) — the shared first-entry value is a coincidence of two temperature readings.

**Conclusion: RETIRE.** Reasons in order of weight: (1) promoted by a false regex hit, not by a child event;
(2) whole-day container fronted by a health reading — no prose fix produces a Memory from this unit;
(3) the genuine Memory inside it has its own bounded window and fingerprint (RC-12), so retiring the container
loses nothing; (4) retire is reversible via ledger, and no RawSource, link or media is touched.

## 5. RC-12 semantic collision analysis (no V6 rerun; frozen evidence only)

| question | answer |
|---|---|
| Same evidence? | Partial: RC-12's 33 sources ⊂ event's 144 (23 %). Window-only 0; event-only 111. |
| Same semantic event? | No. Event = "the day of 2025-08-29, keyed on a temperature"; RC-12 = "the child's pretend-crying behaviour, one bounded segment". |
| Partial overlap? | Yes — RC-12 is the only Memory-worthy segment inside the container. |
| Both valid if prose fixed? | No. A fixed-prose legacy row would either narrate the whole day (not a Memory) or narrate 假哭 (then it *is* RC-12 with 111 extra unrelated sources attached). |
| Would writing RC-12 today duplicate family history? | Visible: no — legacy row is hidden (no approved ledger row). Archive-level: yes, two LifeEvents would share 33 sources, and `persistOrganization` would **repoint** `related_life_event_id` for those 33 sources (and any confirmed media) from the legacy row to the V2 artifact, silently partial-orphaning the legacy row. |
| If legacy retired first, is RC-12 clean? | Yes at the semantic level. At the pointer level the repoint still happens and must be recorded as an explicit supersede (see §7). |

## 6. Systemic severity

Not isolated. "36.7" is one member of a systemic pattern: 41 whole-day containers created by a regex over
joined text (29 with a false hit), plus 41 single/paired-message rows promoted by the `≤2 sources` rule.
Only 3/82 rows are visible today, so the family-facing damage is contained by the fail-closed ledger; the debt
is archival (wrong containers own `related_life_event_id` for 2793 sources and `life_event_id` for the
confirmed media) and it will collide with every V2 Memory whose window falls inside a legacy day.
Days with >1 legacy event: 9. Sources linked to >1 event: 0. Fingerprint duplicates: 0.

## 7. Reversible repair design (design only)

**Retire** (66 RETIRE rows; 37 have no ledger row today, 29 are already gated):
- Insert one `content_quality_reviews` row per event: `(target_kind='life_event', target_id, decision,
  provider='human', prompt_version='legacy-audit-2026-09-03', policy_version=QUALITY_REVIEW_POLICY_VERSION,
  reason_codes=[…tags…])`. Decision `rejected_unrelated` for WEAK/LOG/URL/EMO/MEDIA/GPS/AD/NUM rows,
  `downgrade_to_daily_trace` for DAY containers whose day is otherwise ordinary. Unique key
  `(target_kind, target_id, prompt_version)` makes it idempotent; the existing gate already honours it.
- Add a supersede marker for containers that a V2 artifact replaces: `reason_codes` includes
  `superseded_by:<v2 artifact id>` (string in the existing jsonb array; no schema change).
- Nothing is deleted: `life_events`, `raw_sources`, `source_memory_links`, `media` rows all stay. Reversal =
  delete or re-decide that single ledger row.
- **Pointer semantics**: a retired container keeps `raw_sources.related_life_event_id` until a V2 artifact
  claims a sub-window; the claim (`persistOrganization`) repoints only the claimed sources. Sources never
  claimed remain attributed to the retired container, which is honest provenance ("organized into a retired
  legacy batch"). No repoint-to-null pass is proposed.

**Rewrite** (5 REWRITE rows): do not rewrite in place. The V2 path (frozen V6 routing + Writer v2) should be
fed the *sub-window* that carries the capability statement, producing a new artifact with its own fingerprint;
the legacy container is then retired with `superseded_by`. In-place rewriting would keep the wrong provenance
envelope (e.g. #21's 63 sources for a one-segment moment). The V2 Writer can regenerate safely once the
sub-window has a V6-stable verdict — RC-12 already has one; the other four need corpus windows first.

**Duplicate**: canonical survivor is always the V2 artifact (bounded window, deterministic id, V6 evidence);
the legacy row is retired via ledger, never deleted. There are no legacy-vs-legacy duplicates to resolve.

## 8. Exact production delta if later authorised (not executed)

Minimum to unblock RC-12:
- `+1 content_quality_reviews` row: `target_id = event-6b2dfc4d-6268-4f44-8456-b0c6689c5e03`, decision
  `downgrade_to_daily_trace`, provider `human`, prompt_version `legacy-audit-2026-09-03`,
  reason_codes `["whole_day_batch","health_reading_title","milestone_regex_false_hit","superseded_by:<RC-12 V2 artifact id>"]`.
- 0 updates, 0 deletes, 0 changes to `life_events`, `raw_sources`, `source_memory_links`, `media`.
- Side effect to expect from the *subsequent* RC-12 Memory write (not part of the retire step): 33
  `raw_sources.related_life_event_id` repointed, up to 4 `media.life_event_id` set — the canary report must
  record these counts.

Full sweep (optional, same mechanism): +37 ledger rows for the RETIRE rows lacking one; 0 deletes.

## 9. Unblock decision

**B — RC-12 COULD BE UNBLOCKED — LEGACY EVENT INDEPENDENTLY QUALIFIES FOR RETIREMENT.**

Independence: the row would be RETIRE even if RC-12 did not exist — it is a false-regex, whole-day, health-
reading-fronted container of the same kind as 24 other memory-weight RETIRE rows. RC-12 is not the reason;
it is the beneficiary.

Not done this session: no retire, no Writer, no Memory Canary.

## 10. Recommended next gate

1. Authorise the single ledger insert in §8 (one row, reversible).
2. Re-run `organizer-legacy-lifeevent-audit.mjs --overlap=<RC-12 window>` to confirm the container is now
   gated and the overlap is unchanged.
3. Run the RC-12 Memory Canary through the V2 selector allowlist, recording the pointer-repoint counts.
4. Only after the canary: decide whether the 37-row ledger sweep and the 5 REWRITE sub-windows go through the
   same path.
