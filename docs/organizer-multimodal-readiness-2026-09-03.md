# Multi-Source Cutover Readiness — 2026-09-03

**Status: MULTIMODAL EVIDENCE BLOCKED.**

Not blocked on Quark, and not blocked on anything requiring Teddy to be home. Blocked on two facts
found by reading production:

1. **There are zero videos in the system.** 122 WeChat messages reference a video file; none
   produced a MediaAsset. `media_assets` holds 1,011 rows, all `image/jpeg`. The "text + video" half
   of the multimodal premise has no data behind it.
2. **The Evidence Builder has no cross-source media path.** Windows are built per conversation and
   Quark photos are `family_photo` sources in their own conversation, so a Quark photo can never
   enter a WeChat window. There is no Quark-to-story evidence today, at any tier.

Images are in good shape: 879 of 904 WeChat photos and all 107 Quark photos have working hot
derivatives, spot-checked byte-for-byte. So a *text + photo* multimodal Organizer is reachable; a
*text + video* one is not, and a *cross-source* one needs a builder that does not exist.

Canary #2 was not run: precondition 2 (media Evidence contract clean) fails, and 5 and 6 (a genuine
fresh Memory candidate, Writer fresh validation) are downstream of it. No production writes.

---

## 1. Starting state — verified, not assumed

`main == origin/main`, clean tree, `git fetch` clean. Every stated count reproduced exactly:

| | stated | verified |
|---|---|---|
| LifeEvents | 82 | 82 |
| DailyTraces | 154 | 154 |
| distinct trace fingerprints | 154 | 154 |
| duplicate fingerprint groups | 0 | 0 |
| review/quality rows | 105 | 105 |
| organizer runs | 304 | 304 |
| RawSources | 8,796 | 8,796 (8,689 wechat + 107 family_photo, 0 deleted) |
| MediaAssets | 1,011 | 1,011 |

`daily_traces_fingerprint_unique_idx` present, valid, unique. Latest organizer run 00:52Z, zero runs
in the last two hours — **no active production writer**.

## 2. RC-08 trace retention — existing semantics are safe, left alone

The question was whether "not safe enough to assert as 张年's Memory" must mean "discard the day".
In principle no, and `routeV4` already separates promotion from retention. But `validator.ts`'s
subject gate returns `store_only` **before** routing, so `traceEvidenceCount` is never consulted for
an ambiguous window — the careful retention model is short-circuited.

So the question is empirical. Measured over **69 saved editor verdicts** from two corpora, zero new
model calls: 15 windows hit that gate.

- In **every** window the editor called `ambiguous`, deterministic claim grounding independently
  agreed — 0 resolved claims, `traceEvidenceCount` 0. The two subject determinations never disagree
  in the direction that would cost a real day.
- The 4 windows where grounding *did* resolve a claim were all `unrelated`: a shopping link, a shelf
  return, groceries, an air-conditioner install. Relaxing the gate rescues exactly those — routine
  inflation, not life evidence.

RC-08 itself is unfixable at the trace layer: one claim, zero resolved, no name in the window or in
either neighbour. Attributing it needs looser subject resolution — the standing open decision — not
a new retention path.

**No redesign.** Two regressions pin it (`02a1ede`), including the forbidden transformation: a
hedged, unattributable family remark must never be written out as an asserted child fact.

## 3. Existing media inventory

### WeChat

| | count |
|---|---|
| raw_sources | 8,689 |
| with `media_ids` | 925 (7,764 text-only) |
| MediaAssets | 904, all `photo` / `image/jpeg` |
| with working hot `web` derivative | **879** |
| **without** hot derivative | **25** |
| **videos ingested** | **0** |
| messages referencing a video file | **122** — all with `mediaEvidence: []` and no `media_ids` |
| messages mentioning 视频 at all | 423 |
| voice files | 3 |
| `mediaEvidence` states | 925 present, 3 invalid, 1 missing, 1 needs_review |

`media_assets.archive_status` says `awaiting_archive` for all 904 WeChat photos with
`archive_verified_at` null — **this flag is stale and does not reflect reality**. The derivatives
exist in hot storage and return bytes (spot-checked: 6/6 WeChat, 6/6 Quark, every requested byte
length returned).

### Quark (existing only — no network, no WorkBuddy, no search)

| | count |
|---|---|
| raw_sources (`family_photo`) | 107 |
| MediaAssets | 107, all `photo` / `image/jpeg` |
| `archive_status: archived` + verified | 107 / 107 |
| `taken_at` coverage | **107 / 107** |
| hot `web` derivative | 107 / 107 |
| videos | 0 |
| unresolved HEIC | 0 (all jpeg) |

Quark data is the healthiest media in the system. It is also, today, entirely unreachable by the
Organizer — see §4.

### Missing / unavailable

- 25 WeChat MediaAssets with no hot derivative.
- 122 referenced WeChat videos with no asset at all.
- 5 `mediaEvidence` entries not in `present` state (3 invalid, 1 missing, 1 needs_review).

`media` (presentation table): 1,032 rows, all `photo`, **0 with `object_key`**, 0 with
`poster_src`, 0 with `duration_seconds`. 43 LifeEvents carry media (244 rows).

## 4. Media Evidence contract

Audited against the required shape. The contract was `{ mediaId, boundItemId, confidence, rule }`
plus `mediaRefs: { mediaId, assetSha256?, hasHotDerivative }`.

**Fixed in `8974fd5`:** every binding now carries a named `tier` and a `basis`, built through a
single constructor so a binding cannot exist without them. Tier is derived from the *rule*, not the
number, so "silently upgrade a tier" means editing one table under test. An unrecognised rule fails
closed to `unbound`.

| rule | confidence | tier | narratable | attachable |
|---|---|---|---|---|
| `same_message_mixed` | 1.0 | **confirmed** | yes | yes |
| `same_sender_after_90s` | 0.85 | strong_contextual | **no** | yes |
| `same_sender_before_60s` | 0.75 | strong_contextual | **no** | yes |
| `cross_sender_indicator_120s` | 0.55 | unbound | no | **no** |
| (none) | 0 | unbound | no | no |

`day_level` and `month_level` are declared and **deliberately never produced**, with a test asserting
so — the words exist so cross-source binding cannot quietly borrow `strong_contextual` when it is
built. Same date is not enough; same month is not enough.

**Still missing, and this is what blocks Phases D–J:**

- `hasHotDerivative` is **hardcoded `false`** in `evidence/window.ts:66`. The Organizer cannot tell
  whether media is renderable, so "unavailable media must not fail open" cannot be enforced from
  evidence. `assetSha256` is likewise never populated by the builder.
- No `provider`, `mediaType`, or `timestamp` on media refs — so a Quark photo and a WeChat photo are
  indistinguishable to the Organizer.
- **No cross-source binding path at all.** `buildEvidenceWindows(conversation, …)` is per
  conversation; Quark photos live in their own. Every Quark asset is therefore invisible to the
  Organizer regardless of tier.

## 5. Evaluation reserve

**Not created.** Deliberately: partitioning is only meaningful over the evidence the Organizer can
actually consume, and until §4's gaps close, the consumable multimodal evidence is "WeChat text +
same-message photo" — a population I cannot size honestly yet, and one that overlaps corpora already
spent. Building a reserve now would repeat the contamination-theatre failure in a new form: a
manifest that looks rigorous over a set that isn't the real one.

## 6–8. Recall development, fresh shadow, Writer validation

**Not run.** All three are downstream of a media evidence contract the Organizer can consume. Running
a multimodal recall experiment against a builder that cannot see Quark, cannot see videos, and
cannot tell whether a photo is renderable would measure the stub, not the system.

Also unchanged from the last session and still binding: only 6 `capability_named` and 3
`capability_pronoun` unspent windows remain, so recall evidence is power-limited regardless.

## 9. Canary #2

**Not run.** Precondition 2 fails. No production writes were made in this session.

## 10. Cutover

**Not executed.** One finding worth recording for whenever it is: the app never sets `routingPolicy`
at all — `validator.ts` falls back to `V1_ROUTING_POLICY`. So "switching the production default" is
not a config flip today; the production path does not select V6, and wiring that is itself the
cutover work.

## 11. Production safety

No writes, no migrations, no bulk processing, no historical Organizer, no Quark network activity, no
WorkBuddy, no deletions, no review changes, no `.env.local` access. All DB access read-only apart
from nothing. Path-specific staging only.

## 12. Tests

508 pass, 10 skipped, 0 fail. Typecheck clean, lint clean, `git diff --check` clean. New: 2 trace
retention regressions, 11 media tier tests.

## 13. Git

`02a1ede` trace retention semantics · `8974fd5` media binding tiers · this document.

## 14. Next actions

1. **Ingest WeChat videos, or formally drop video from scope.** 122 referenced files, zero assets.
   This single fact decides whether "multimodal" means text+photo or text+photo+video.
2. **Make media availability real in evidence**: populate `hasHotDerivative` and `assetSha256` from
   `media_locations`, and add `provider` / `mediaType` / `timestamp` to media refs.
3. **Decide whether Quark participates at all.** It needs a cross-source binding path that does not
   exist. If yes, it lands at `day_level` for same-day association — which by §4 may not be narrated
   or attached — so the honest question is what Quark media is *for*: Month chapters and gallery,
   not Memory illustration.
