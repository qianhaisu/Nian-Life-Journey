# Multimodal Evidence — 2026-09-03 (session 2)

**Status: MULTIMODAL EVIDENCE READY — SHADOW BLOCKED.**

The evidence layer is fixed. The videos were never missing — they were never parsed. 120 of them are
now ingested, media availability is derived from real location rows instead of a hardcoded `false`,
and every media ref carries provider, type, checksum and timestamp.

The shadow was not run, and the reason is not budget. **The V2 Organizer pipeline has no production
persistence path at all** — see §6. Canary #2 as specified is unreachable, so a multimodal shadow
this session would produce evidence for a decision nothing can execute.

---

## 1. WeChat video audit — the files were there

`wechat-markdown.ts` extracts media with `/!\[[^\]]*\]\(([^)]+)\)/g` — **image markdown only**. The
exporter writes a video as `[视频文件](media/videos/x.mp4)`, without the leading `!`. So a video
never became a `mediaRef`, never reached the importer, and survived only as link text inside
`raw_sources.text`. That is the whole reason the archive held 1,011 assets and every one was
`image/jpeg`.

Export located at `E:\WechatHis\texts\群聊_…-05fd0f156e\` (228 videos, 1,485 images on disk). All 122
references audited against it, read-only:

| class | count | |
|---|---|---|
| **A — exists and readable** | **120** | 222.4 MB, 120 distinct checksums |
| B — missing from export | 1 | `20260224_033307_3076.mp4` (the daycare day) |
| C — malformed reference | 0 | |
| D — duplicate reference | 1 | second citation of bytes already counted |
| E — unsupported format | 0 | all `.mp4` |

## 2. Video ingestion — applied and replay-verified

`scripts/wechat-video-backfill.mjs` (`a04757f`), dry-run by default. Applied once:

```
Created: {"assets":120,"locations":120,"media":121,"sourcesLinked":121}
Replay:  {"assets":0,  "locations":0,  "media":0,  "sourcesLinked":0}   (121 alreadyLinked)
```

Backfill, not re-import — deliberately. Re-parsing changes `messageType` and `attachments`, both
inputs to `canonicalMessageId`, so every affected message would get a **new id** and a re-import
would duplicate rather than reuse it. The backfill adds rows for messages that already exist, keyed
exactly as `wechat-import.ts` keys them, so a future corrected import reuses them.

Identity is the file's own SHA-256, recomputed from the bytes. All inserts `ON CONFLICT DO NOTHING`,
`media_ids` merged not replaced, one transaction, rollback ids written out.

`width`/`height`/`duration` are left NULL rather than guessed, and `src` points at the delivery route
which answers "derivative is not ready". **Original available, poster unavailable — a real video,
not an absent one.**

Production after: 1,131 MediaAssets (+120), 120 of type `video`, all with `taken_at` and checksum.
LifeEvents 82, DailyTraces 154 / 154 distinct / 0 duplicates, runs 304, reviews 105 — all unchanged.

## 3. Real media evidence fields

`hasHotDerivative` was a boolean hardcoded `false` at the only construction site, so the pipeline
could not distinguish "there is no renderable copy" from "nobody looked". Those must not collapse:
reporting the second as the first is a fail-open toward "media is unavailable", which sounds safe and
is how you lose real photos.

Now three-state (`available` / `unavailable` / `unknown`), and a ref carries `mediaAssetId`,
`provider`, `mediaType`, `mimeType`, `assetSha256`, `takenAt`.

`buildMediaIndex` derives availability from `media_locations` and **never reads
`media_assets.archive_status`** — that column is stale in production (904 WeChat photos say
`awaiting_archive`; 879 serve bytes). A renderable copy means a *hot derivative* specifically; the
reported provider is the origin of the original, never hot storage.

Ten tests cover the four shapes production actually holds: working WeChat photo, one of the 25 with
no derivative, a backfilled original-only video, an archived Quark photo — plus failed/pending
locations, no-locations, and index-absent.

## 4. Media binding contract

Unchanged from `8974fd5` and still correct: `confirmed` alone may be narrated as depicting;
`strong_contextual` may be attached but not described as showing the moment; `day_level` /
`month_level` / `unbound` may not be attached. A test asserts `bindMedia` produces neither
cross-source tier today.

Verified this session: a text+video message binds `confirmed` by the same path a photo does — the
tier rule does not read media type.

## 5. Existing Quark

Untouched, as required. No WorkBuddy, no search, no fetch. 107 photos, all archived + verified, full
`taken_at`, full derivatives. Still not reachable by the Organizer: windows are built per
conversation and Quark photos are `family_photo` sources in their own, so no cross-source path
exists. Not built here — a same-day Quark photo is `day_level`, which may not be attached to a
Memory, so the honest use is Day/Month/gallery, not Memory illustration.

## 6. Why the shadow and Canary #2 are blocked — the real finding

Last session I reported that production "falls back to V1 routing policy". That understated it.
Tracing the actual production path:

```
POST /api/internal/organizer-worker
  → runOrganizerWorker            (lib/organizer/worker.ts)
  → processOneJob
  → getConfiguredOrganizer().organize(...)      MEMORY_ORGANIZER defaults to "rule"
  → RuleBasedMemoryOrganizer      (legacy)   — or AIMemoryOrganizer (legacy ai.ts)
```

**`runPipeline` is never called.** The entire V2 stack — Evidence Builder, Memory Editor, Subject
Resolver, Claim Grounding, Judgment policies, Writer v2, Narrative Validator — is reachable only from
`evaluator-v2.ts` and evaluation scripts. Production never reaches `validate()` at all, which is why
no `routingPolicy` is ever set.

Worse for Canary purposes: `runPipeline`'s only persistence is `upsertMemoryCandidate`. **Nothing
converts a MemoryCandidate into a LifeEvent or DailyTrace**, and nothing writes source links, media
links or review rows from a V2 outcome. The existing 82 LifeEvents and 154 DailyTraces were written
by the legacy organizer.

So Canary #2's requirement — "must genuinely persist a Memory if the sealed input produces one" —
cannot be satisfied by any code that currently exists. Cutover is not a config flip or an explicit
policy selection; **it is building the production adapter**: job → Evidence Builder (with media
index) → pipeline → Judgment → Writer → Narrative Validator → LifeEvent/DailyTrace persistence →
source and media links → review lifecycle → organizer run.

That adapter is a substantial, reviewable piece of engineering with real persistence semantics
(idempotency, fingerprint uniqueness, review independence, media-tier enforcement at the link
boundary). Writing it at speed at the end of a session, then immediately running it against
production, is exactly the shape of change that should not be rushed — so it is not started here.

## 7. Production safety

No bulk processing, no historical organizer, no Quark network, no WorkBuddy, no deletions, no review
changes, no `.env.local` access, no migrations. One additive, idempotent, replay-verified write
(§2) with rollback identifiers retained outside the repo. No active production writer throughout.

## 8. Tests

528 tests, 518 pass, 10 skipped, 0 fail. Typecheck clean, lint clean, `git diff --check` clean.

## 9. Next actions

1. **Build the V2 production adapter** (§6). Until it exists, no Canary and no cutover is possible,
   and shadow results cannot be acted on.
2. **Fix `wechat-markdown.ts` to parse non-image media**, with a `parserVersion` bump — and note
   that it changes `canonicalMessageId` for the 122 video-bearing messages, so it must land together
   with a decision about re-import identity. The importer half is already fixed: `mediaType` and
   `mimeType` are now derived rather than hardcoded `photo`/`image/jpeg`.
3. **Wire the media index into the evaluation scripts**, then build the reserve and run the
   multimodal shadow — in that order, once 1 gives the result somewhere to go.
