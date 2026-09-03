# Artifact Memories — read-only audit and hide plan (2026-09-03)

> **Status: AUDITED, NOTHING CHANGED. No hide action is needed for display — all 34 artifact
> Memories are already invisible to the family through the existing publication gate.**
> This corrects [`production-content-findings-2026-09-03.md`](production-content-findings-2026-09-03.md) §1,
> which read `visibility: family` as "live to the family". Publication is `visibility AND review`
> (`lib/organizer/quality-review.ts`), and every read path in `postgres-repository.ts` applies it:
> `getHomeEvents`, `getAllEvents`, `getEventDetail` (404) and `getStore`. A rule-derived LifeEvent with
> no `approved` ledger row is never rendered.
>
> Produced by `v2/scripts/organizer-artifact-memories-audit.mjs` (SELECT only). The production
> ledger was not written. The one row that carries family location data is redacted here.

## 1. What the family actually sees today

| | count |
| --- | --- |
| LifeEvents in the archive | 82 |
| … that pass the publication gate | **3** |
| `content_quality_reviews` rows for LifeEvents | 35 (approved 3, store_only 15, downgrade_to_daily_trace 9, rejected_unrelated 6, needs_human_review 2) |
| LifeEvents with no ledger row at all (hidden, fail-closed) | 47 |

79 of 82 Memories are hidden. The Memory layer of nianlife.cn is, in effect, three pages. That is
the real starting point for the Organizer canary and for any later "rewrite existing 82" decision:
there is no visible artifact content to protect the family from, but there is also almost nothing
visible at all.

## 2. The eleven (Decision 2 — exact rows)

The findings document's eleven: title, story and the single anchoring message are the same bare,
markdown-escaped exporter token. Source ids are omitted from this file (they are 64-hex message
digests; the JSON produced by the script carries them). `sources` is the count of raw messages
linked to the event; `=` marks how many of the first three linked messages have exactly the token as
their whole text.

| # | LifeEvent id | day | token | why it is an artifact | sources | ledger row | shown? |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `event-aae2e896-be08-434f-9540-804039021cb4` | 2025-10-29 | `\[小程序\]携程旅行` | mini-program share card — a booking tool, not a life fact | 53 | none | hidden |
| 2 | `event-dd9c8340-dec7-461a-97c0-023ceda6c1e8` | 2025-10-20 | `\[视频\]` | video placeholder, no caption — nothing happened in words | 109 | none | hidden |
| 3 | `event-213342b1-d3ef-44fc-9afd-55a2600630ae` | 2025-10-04 | `\[视频\]` | same | 4 | none | hidden |
| 4 | `event-769f734f-6450-46d1-8297-ddaab29d697e` | 2025-09-25 | `\[表情包\]` | sticker placeholder | 2 | none | hidden |
| 5 | `event-96c45ae0-ec1d-4b66-b224-3b67aaf47a97` | 2025-09-15 | `\[链接\]当前微信版本不支持展示该内容…` | WeChat version-upgrade notice — platform text | 2 | none | hidden |
| 6 | `event-dc9a29dd-56ef-4aa8-aff5-9771dd3af5b2` | 2025-08-19 | `\[表情包\]` | sticker placeholder | 56 | none | hidden |
| 7 | `event-7b8c5421-9345-4a9a-bced-51fbd618ff41` | 2025-08-13 | `\[视频\]` | video placeholder | 186 | none | hidden |
| 8 | `event-428dfacc-bf19-45f6-be05-a59a25a40ff1` | 2025-08-03 | `\[链接\]警惕！带娃遇到这种"热心人"…` | third-party scare article — about babies in general | 2 | `store_only` (memory-editor-v1) | hidden |
| 9 | `event-855af16b-b7eb-4cd9-952f-120f0df15ed0` | 2025-07-30 | `\[表情包\]` | sticker placeholder | 72 | `store_only` (memory-editor-v1) | hidden |
| 10 | `event-c84a6165-d802-470e-95a5-aa7e69619342` | 2025-07-19 | `\[位置\] <hotel + GPS, redacted>` | shared location card — family location data, not a memory | 1 | `rejected_unrelated` (memory-editor-v1) | hidden |
| 11 | `event-f28bc982-6928-47a3-b462-f7445543e357` | 2025-06-18 | `\[链接\]✨7-9个月宝宝学坐小技巧` | third-party parenting-tips article | 1 | `store_only` (memory-editor-v1) | hidden |

Row 11 is also the live example of the V6 precision hazard recorded in
[`organizer-subject-continuity-2026-09-03.md`](organizer-subject-continuity-2026-09-03.md) §7: the
alias 宝宝 inside a `[链接]` title. It was not what promoted this event (rule-v2 promoted it with no
subject check at all), but it is exactly the string frozen V6's explicit path would accept as naming
the child.

Note the source counts: rows 1, 2, 6, 7, 9 link 50–186 messages to an event whose text is one
token. The rule organizer attached whole days of chat to a placeholder title. Hiding the event does
not lose those messages — they remain `raw_sources` and are re-windowed by the Organizer on every
run.

## 3. The same criterion finds 23 more

Applying "title == story == bare token" to all 82, not only the escaped-bracket shapes the findings
document counted:

| shape | n | example title | ledger | shown? |
| --- | --- | --- | --- | --- |
| `[media]` import placeholder | 14 | `[media]` | 6 store_only, 8 none | all hidden |
| `[视频文件](media/videos/…mp4)` markdown media path | 5 | — | 1 downgrade_to_daily_trace, 4 none | all hidden |
| sticker / fallback code | 4 | `\[呲牙\]`, `\[呲牙\]\[呲牙\]\[呲牙\]`, `\[发呆\]`, `\[其他消息\]` | 2 store_only, 2 none | all hidden |

Together with the eleven: **34 of 82 LifeEvents are bare artifacts, 0 of them visible.** The
`[media]` and `[视频文件]` shapes are additionally caught by the belt-and-braces text gate
(`containsTechnicalPlaceholder`) even if someone approved them; the escaped shapes (`\[视频\]`) are
**not** — that regex expects unescaped brackets — so for the eleven the ledger gate is the only thing
hiding them. That is a real, if currently dormant, single point of failure.

## 4. Proposed action (approval-ready; NOT executed)

Nothing is required for display. The eleven are hidden today and would stay hidden unless someone
inserts an `approved` row for them. Two optional, additive, reversible steps if Teddy wants the
state to be explicit rather than implicit:

1. **Ledger rows for the 34 with no row** (28 of the 34 have none), each
   `{ target_kind: "life_event", target_id: <id>, decision: "rejected_unrelated", provider: "human",
   prompt_version: "artifact-audit-2026-09-03", policy_version: "quality-review-v1", reason_codes:
   ["exporter_artifact"] }`. `visibility` untouched, no delete, no update to `life_events`. Six rows
   already carry `store_only` / `downgrade_to_daily_trace` / `rejected_unrelated`, all of which
   already fail closed, so they need nothing.
2. **Close the escaped-bracket gap in `containsTechnicalPlaceholder`** so that `\[视频\]` and
   friends are caught by the text gate as well as the ledger. One regex change plus a test; a
   precision-only fix that cannot expose anything.

Not proposed: deleting the 34, rewriting them with Writer v2, or touching the 48 non-artifact
LifeEvents. Rewriting existing Memories is outside this task's authorisation and, given §1, the
bigger question is not these 34 but why 47 of 82 have never been reviewed at all.

## 5. What was not done

No row in `life_events`, `content_quality_reviews`, `daily_traces` or any other table was inserted,
updated or deleted. The script is SELECT-only and was run twice (once failing on a column name,
once succeeding). Counts at the end of the audit: 82 LifeEvents, 35 LifeEvent ledger rows —
unchanged.
