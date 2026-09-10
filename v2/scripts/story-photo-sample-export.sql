-- Read-only export for the story/photo re-association samples (2026-09-10).
--
-- WHY THIS EXISTS
-- Since 2026-09-10 a photograph may illustrate a story only when it arrived in one of the very
-- sources that story was written from (lib/media/story-binding.ts). Measured on the private site,
-- that leaves zero story photographs in every month sampled (2025-12, 2026-05..09). Deciding which
-- of the old bindings have real content support — and which, like the 08-19 meal board, do not —
-- needs the binding side of the data, which the rendered page does not expose.
--
-- WHAT IT DELIBERATELY DOES NOT READ
-- `raw_sources.text` is never selected, and photograph bytes are not touched.
--
-- To be clear about what that costs: this export gives association *clues*, not a verdict. Timing,
-- conversation and role cannot settle whether a picture belongs to a story — the 08-19 meal board
-- shares a day, a conversation and a role with the music story and is still not it. Every sample
-- must still be judged by actually reading the story, its original context and the photograph.
-- Bodies are omitted here only because that reading is done on the page's own evidence disclosure
-- (/events/<id>), which already renders the messages in full and needs no second copy of them.
--
-- TIME SEMANTICS — VERIFIED 2026-09-11, DO NOT INFER FROM COLUMN NAMES
-- The two timestamps this comparison depends on are stored in different conventions, and nothing
-- in their names says so:
--   raw_sources.captured_at  timestamptz — comes back as +08 (e.g. 2026-08-01 11:47:15+08)
--   media.taken_at           timestamp WITHOUT time zone — holds the UTC instant (…03:47:15)
-- They are 8 hours apart for the same event. Confirmed on real rows: a photograph whose own source
-- was captured at 11:47:15+08 carries taken_at 03:47:15. Comparing them directly silently shifts
-- every window by 8h and yields confident, wrong answers about whether a photograph falls inside
-- the messages a story was written from.
--
-- So: compare like with like. Result set 3 selects `s.captured_at AS source_captured_at` for
-- exactly this reason — use it, not taken_at, against result set 2's captured_at. If a future
-- column is added here, check its declared type rather than trusting the name.
--
-- KNOWN MISSING, DO NOT SUBSTITUTE
--   * Reply / quote relations are NOT stored anywhere. WeChat's 「[引用 …]」 survives only as literal
--     characters inside raw_sources.text; no column records which message was quoted, so the
--     strongest available basis for restoring a binding cannot be queried and has to be read off
--     the evidence chain by eye. Treat its absence as absence, not as "no quote existed".
--   * Conversation identity: for WeChat rows `raw_sources.source_label` IS the conversation id
--     verbatim (lib/ingest/wechat-import.ts sets sourceLabel = message.conversationId), and
--     metadata->>'conversationDigest' is its stable digest. Both are selected below. They are the
--     identifier, not a stand-in for one — but note the same column carries batch labels for
--     non-WeChat sources, so match on source_type before comparing.
--
-- STATUS: NOT YET EXECUTED AGAINST A REAL DATABASE (as of 2026-09-11).
-- Written against lib/db/schema.ts, not validated by a live run. If a statement errors, report the
-- error rather than adapting it in place, so the correction lands here instead of in a shell
-- history. This line stays until someone has actually run it.
--
-- SAFETY
-- Every statement is a SELECT. No table is written, created or locked beyond a read snapshot.
-- Scoped to one month (2026-08) and the events published in it, so it stays small — this is a
-- sample, not a full-archive audit.
--
-- HOW TO RUN (executor)
--   psql "$DATABASE_URL" --csv -f scripts/story-photo-sample-export.sql > story-photo-sample.csv
-- To sample a different month, edit the \set line below — it is the only place the month appears.
-- Hand back all five result sets.

\set month '2026-08'

-- 1. The month's published events: their sources, the media the old backfill bound, and the hero.
--    `hero_media_id = 'none'` is the withdrawal sentinel (NO_HERO_MEDIA_ID); any other value is
--    what scripts/t18-backfill-media-binding.mjs wrote from a same-day pick, not a human decision.
SELECT
  e.id,
  e.occurred_at,
  e.title,
  e.hero_media_id,
  e.visibility,
  e.created_by,
  e.organizer_version,
  jsonb_array_length(e.media_ids) AS bound_media_count,
  e.media_ids,
  e.source_ids
FROM life_events e
WHERE to_char(e.occurred_at, 'YYYY-MM') = :'month'
ORDER BY e.occurred_at, e.id;

-- 2. Which raw source each of those events was actually written from, and in what role.
--    `role` is the part the flat source_ids array cannot express (primary / supporting / context).
SELECT
  l.life_event_id,
  l.raw_source_id,
  l.role,
  s.captured_at,
  s.source_type,
  s.source_label,                              -- WeChat: the conversation id verbatim
  s.metadata ->> 'conversationDigest' AS conversation_digest,
  s.provider_external_id AS message_id,        -- stable per-message id, for pinning context
  s.metadata ->> 'recordOrdinal' AS record_ordinal,
  jsonb_array_length(s.media_ids) AS source_media_count
FROM source_memory_links l
JOIN life_events e ON e.id = l.life_event_id
LEFT JOIN raw_sources s ON s.id = l.raw_source_id
WHERE to_char(e.occurred_at, 'YYYY-MM') = :'month'
ORDER BY l.life_event_id, s.captured_at NULLS LAST;

-- 3. The month's photographs with the source each arrived in. This is the other half of the join:
--    a photograph is Basis A associated when its raw_source_id appears in the story's sources.
SELECT
  m.id,
  m.taken_at,
  m.type,
  m.visibility,
  m.life_event_id,                             -- the other half of the original binding record
  m.raw_source_id,
  s.captured_at AS source_captured_at,
  s.source_type,
  s.source_label,                              -- WeChat: the conversation id verbatim
  s.metadata ->> 'conversationDigest' AS conversation_digest,
  s.provider_external_id AS message_id
FROM media m
LEFT JOIN raw_sources s ON s.id = m.raw_source_id
WHERE to_char(m.taken_at, 'YYYY-MM') = :'month'
ORDER BY m.taken_at, m.id;

-- 4. How far Basis A actually reaches this month: for each event, how many of its bound photographs
--    share a source with it. Expected to be ~0 — that is the finding to confirm, not assume.
SELECT
  e.id AS life_event_id,
  e.occurred_at,
  e.title,
  count(m.id) FILTER (WHERE m.raw_source_id IS NOT NULL AND e.source_ids ? m.raw_source_id) AS basis_a_matches,
  count(m.id) AS bound_photos
FROM life_events e
LEFT JOIN LATERAL jsonb_array_elements_text(e.media_ids) AS bound(media_id) ON true
LEFT JOIN media m ON m.id = bound.media_id
WHERE to_char(e.occurred_at, 'YYYY-MM') = :'month'
GROUP BY e.id, e.occurred_at, e.title
ORDER BY e.occurred_at;

-- 5. Archive-wide hero_media_id shape. Distinguishes explicit withdrawal from the same-day backfill
--    across the whole archive (two counts, no row contents).
SELECT
  CASE
    WHEN hero_media_id IS NULL THEN 'unset'
    WHEN hero_media_id = 'none' THEN 'withdrawn_sentinel'
    ELSE 'backfilled_or_set'
  END AS hero_state,
  count(*) AS events
FROM life_events
GROUP BY 1
ORDER BY 2 DESC;
