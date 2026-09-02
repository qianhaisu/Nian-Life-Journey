# Production content findings (2026-09-03) — read-only audit, nothing changed

Found while running the Writer v2 shadow against existing LifeEvents. **Nothing here was fixed.**
Rewriting existing LifeEvents and repairing media are both on the list that needs Teddy's explicit
authorization, so these are reported for a decision, not acted on.

## 1. Eleven Memories in 张年's archive are raw WeChat artifacts

All 82 LifeEvents are `visibility: family`, so all of them are live to the family.

| organizer_version | n |
| --- | --- |
| `rule-v2` | 72 |
| `deepseek-family-writer-v1` | 10 |

Only 10 of the 82 ever went through Family Writer v1. The other 72 come from the rule-based
organizer, which used a raw message as both title and story. **Eleven of those are a bare exporter
token**, with the same string as title and as story:

- `\[视频\]` ×3, `\[表情包\]` ×3
- `\[小程序\]携程旅行`
- `\[位置\] …` — a shared location: a hotel name plus precise GPS coordinates (redacted here; it is family location data)
- `\[链接\]当前微信版本不支持展示该内容，请升级至最新版本。`
- `\[链接\]警惕！带娃遇到这种"热心人"立刻远离` — a parenting scare article
- `\[链接\]✨7-9个月宝宝学坐小技巧` — a parenting tips article

The last three are worse than empty. Two are third-party marketing content about babies in general,
now recorded as events in *this* child's life; one is a Memory whose entire content is a WeChat
version-upgrade notice.

A further 47 events have a story under 20 characters — mostly a single unedited chat line.

This is a direct violation of the product principles: Media First / Metadata Back (no engineering or
platform artifacts in front-facing content), and Life Is Not Equal Weight (an exporter token is not
a chapter).

**Needs a decision.** Options, in rough order of conservatism: hide the 11 behind the existing
`content_quality_reviews` ledger rather than deleting them; leave them and let Writer v2 rewrite
them once it is calibrated and canaried; or delete them. Nothing should happen without Teddy
choosing, and no rewrite should happen before the Writer is calibrated.

## 2. Media

1,011 media assets, all `image/jpeg`, all with a checksum.

- **904 of 1,011 are still `archive_status: awaiting_archive`**; only 107 are `archived`. No asset
  carries an `archive_last_error`, so nothing has failed — the work simply has not run.
- **25 assets have no storage location at all** — no `original`, no `web`, no `thumbnail` row in
  `media_locations`. Those bytes are currently unreachable through the repository.
- `taken_at` is set on only 107 assets (the 2026-08 Quark batch). The other 904 have no capture
  time, so they cannot participate in life-time ordering.
- **Zero media assets are referenced by any LifeEvent.** No Memory in the archive currently carries
  a photo at all.

That last point matters for Writer v2's media work: the confirmed / strong_contextual binding tiers
are correct as a design, but there is currently no production Memory with an attached photo to
exercise them on.

## 3. Historical coverage

Months with any source material: 9 of the 21 months from 2025-01 to 2026-09. Every month that has
material also has narrative, so there is no month silently dropped by the Organizer.

| | months |
| --- | --- |
| material present | 2025-05 … 2025-11, 2026-02, 2026-08 |
| no material at all | 2025-01…04, 2025-12, 2026-01, 2026-03…07, 2026-09 |

2026-08 is the only month with photos (107) and it has 12 traces but **0 LifeEvents**.

The gaps are import coverage, not processing failures. Backfill is out of scope tonight and is not
started.

## 4. Repository performance — `getStore()` loads the whole archive

`assembleStore()` in `lib/db/postgres-repository.ts` issues 18 parallel `select * from <table>` with
no `LIMIT` and no column projection. Measured against the live database:

| table | rows | payload |
| --- | --- | --- |
| raw_sources | 8,796 | 11.6 MB |
| media_locations | 3,840 | 2.4 MB |
| media | 1,032 | 0.8 MB |
| organizer_runs | 299 | 1.0 MB |
| source_memory_links | 2,793 | 0.6 MB |
| media_assets | 1,011 | 0.6 MB |
| daily_traces + life_events | 253 | 1.0 MB |
| **total** | **18,042** | **17.2 MB** |

Every page render that reaches `getStore()` pays that. `raw_sources` alone is 67% of it, and it is
there mainly so the Organizer and ingest paths can look rows up by id — a page showing a memory does
not need 8,796 WeChat message bodies. The cost grows with the archive, so it gets worse every import.

Two cheap, additive observations rather than a rewrite:

- `raw_sources` has indexes on the primary key, `profile_id`, `status` and `provider_external_id` —
  but **not on `captured_at`**, which is what almost every Organizer and window query orders by.
  `daily_traces.occurred_at` is likewise unindexed. Both are additive index adds, safe to do
  independently of any refactor.
- The scoped read paths already exist (`scopeStoreToProfile`, `getHomeEvents`, `getAllEvents`); the
  problem is that the full-store assembly is the default entry point rather than the exception.

Deliberately **not** rewritten tonight — the brief scoped this to inventory and safe profiling only,
and a repository refactor during an Organizer freeze is the wrong order.

## 5. What was NOT done

No LifeEvent or DailyTrace was created, updated or deleted. No media was downloaded, moved, repaired
or re-derived. No Quark search was run. The publication ledger was not touched. All counts verified
unchanged at the end of the session: 82 / 171 / 299 / 105 / 8,796 / 1,011, with zero rows created in
the preceding six hours.
