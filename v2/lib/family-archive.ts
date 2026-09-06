// Server-side entry point for every family-facing page. One read of the store, one chapter build;
// pages take the slice they need. Repository and schema are untouched — this only decides what is
// shown, using the same publication rules the pages already applied individually.
import { CANONICAL_PROFILE_ID } from "@/lib/db/config";
import { scopeStoreToProfile } from "@/lib/db/profile-scope";
import { getAllEvents, getOrganizerStore, getStore, type Store } from "@/lib/db/repository";
import { deliverableMediaIds } from "@/lib/media/deliverability";
import { buildChapters, type YearChapter } from "@/lib/memory-chapters";
import { calendarMonthOf } from "@/lib/timeline-dates";
import { birthDayOf } from "@/lib/time-signature";
import { isSnapshotPublishable, mediaBindingTrusted } from "@/lib/organizer/quality-review";
import { isTrustedPhotoSource } from "@/lib/trusted-photo-sources";
import { latestActivityDay, latestMemoryDay, latestTraceDay, productToday, type RecencyReference } from "@/lib/time-truth";
import type { MediaPrivilege } from "@/lib/publication-moments";
import type { LifeEvent, Media, MonthlySnapshot, RawSource } from "@/lib/types";

// The one set of clocks every page reads (lib/time-truth.ts). Pages never compute their own "now".
export type ArchiveTime = RecencyReference & {
  today: string;
  // The last day life reached the archive at all (raw sources by capturedAt, traces, memories).
  activityDay?: string;
  traceDay?: string;
  memoryDay?: string;
};

export type FamilyArchive = {
  store: Store;
  // The media a family page may show and count: family-visible AND actually deliverable
  // (lib/media/deliverability.ts). Pages read this, never store.media — a row whose derivative
  // is missing renders as nothing, so counting it would print a number the family cannot see.
  media: Media[];
  events: LifeEvent[];
  // P2 trace tier (B-17, 2026-09-06): the A-6 subject-confirmed subset of store_only life_events —
  // rows a human/Cowork read in full and marked "sinks in as real, ordinary life about the child"
  // (content_quality_reviews target_kind='life_event_trace', decision='trace_eligible'; NOT
  // target_kind='life_event' — that key holds the real publication decision, deliberately isolated
  // from this marker by A-6). "宁可没有，不要错的" — the full store_only set is not an acceptable
  // fallback; a row with no trace_eligible mark does not appear here, full stop.
  traceEvents: LifeEvent[];
  chapters: YearChapter[];
  birthDay?: string;
  // Only the months with real published memories standing behind them (see quality-review.ts).
  // T20-B, 2026-09-04: every P0 month gets its own snapshot now, not just one archive-wide —
  // pages find their own month's entry (`snapshots.find(s => s.month === month)`).
  snapshots: MonthlySnapshot[];
  // Which pictures something real vouches for (lib/publication-moments.ts): media of a published
  // memory, and media that arrived from the family's own photo archive. Derived from existing
  // rows only — no content is judged here.
  privilege: MediaPrivilege;
  time: ArchiveTime;
};

// `confirmed`: claimed by a published (quality-approved) event WHOSE MEDIA BINDING is trusted —
// the legacy rule organizer bound every same-day chat image to its events, and that harvest must
// not vouch a screenshot into a hero slot (quality-review.ts mediaBindingTrusted). `trusted`: the
// picture's RawSource passes isTrustedPhotoSource (lib/trusted-photo-sources.ts) — either a
// family_photo import (Quark album) or a WeChat group Teddy confirmed contains only Zhang Nian.
export function mediaPrivilegeOf(events: LifeEvent[], media: Media[], rawSources: Pick<RawSource, "id" | "sourceType" | "sourceLabel">[]): MediaPrivilege {
  const confirmed = new Set<string>(events.filter(mediaBindingTrusted).flatMap((event) => event.mediaIds));
  const trustedSources = new Set(
    rawSources.filter(isTrustedPhotoSource).map((source) => source.id),
  );
  const trusted = new Set<string>(media.filter((item) => item.rawSourceId && trustedSources.has(item.rawSourceId)).map((item) => item.id));
  return { confirmed, trusted };
}

// `allEvents` defaults to the published-only `events` array so a 2-arg call (as before this trace
// tier existed) still computes an empty `traceEvents` — a published event can never carry a
// store_only decision, so nothing regresses for a caller that hasn't been told about the wider set.
export function composeFamilyArchive(rawStore: Store, events: LifeEvent[], now: Date = new Date(), allEvents: LifeEvent[] = events): FamilyArchive {
  // Pages read the book about 张年 only: rows another profile id owns (contract-test fixtures,
  // debugging profiles) stay in the backend but never reach a chapter or a home page.
  const store = scopeStoreToProfile(rawStore, CANONICAL_PROFILE_ID);
  const traces = store.dailyTraces.filter((trace) => trace.visibility !== "private");
  const birthDay = birthDayOf(store.profile);
  // Two views of the same pictures, kept apart on purpose: family-visible media is archive truth
  // and decides which months exist; the deliverable subset is publication eligibility and decides
  // what is shown and counted. A month whose photos are all waiting on derivatives keeps its
  // chapter — withheld is not missing.
  const familyMedia = store.media.filter((item) => item.visibility !== "private");
  const deliverable = deliverableMediaIds(store);
  const media = familyMedia.filter((item) => deliverable.has(item.id));
  const chapters = buildChapters({ events, traces, media: familyMedia, deliverable, birthDay });
  const publishedMonths = new Set(events.map((event) => calendarMonthOf(event.occurredAt)).filter((value): value is string => Boolean(value)));
  const snapshots = store.monthlySnapshots.filter((item) => isSnapshotPublishable(item.month, publishedMonths));
  const privilege = mediaPrivilegeOf(events, familyMedia, store.rawSources);
  // store.events (from getStore()) is already the publishable-only set — the same fail-closed gate
  // getAllEvents() applies — so a store_only event is never in it. `allEvents` is the organizer's
  // own unfiltered read (getOrganizerStore), the one place the app already reads every life_event
  // row regardless of review decision.
  //
  // The gate is A-6's own marker, target_kind='life_event_trace' + decision='trace_eligible' — NOT
  // the raw store_only decision on target_kind='life_event'. A-6 read every store_only row in full
  // (not just its title) and rejected the ones whose subject is a pet, a household errand, or a
  // family member other than the child; the raw store_only set includes those rejects (2026-09-06
  // acceptance caught three live: "奶奶说儿子有个幸福的家"、"妈妈提醒上传照片到亲宝宝"、
  // "妈妈问雪姨新游泳圈会不会好点"). "宁可没有，不要错的" — no marker, no trace line.
  //
  // NOT filtered on `review.decision`, even by string cast: postgres-repository.ts's assembleStore()
  // runs EVERY row (any target_kind) through reviewFromRow(), which unconditionally calls
  // normalizeQualityDecision() — that function's QualityDecision union does not include
  // "trace_eligible", so by the time a row reaches `store.qualityReviews` its decision has already
  // been silently rewritten to "needs_human_review", not just when read through indexReviews(). This
  // was caught by 2026-09-06 acceptance: item 1 initially still fixed with a decision check that
  // matched nothing, so ALL trace lines silently vanished, not just the three rejects. Filed as a
  // proper cross-track bug (v2/lib/db/** is A-track's file, not touched here): `provider` +
  // `promptVersion` are untouched by reviewFromRow and uniquely identify these 153 rows (verified
  // 2026-09-06: every target_kind='life_event_trace' row has provider='cowork-a6',
  // promptVersion='a6-trace-layer-v1', decision='trace_eligible' — no rejected variant is ever
  // written under this target_kind, so this is not a laxer gate, just a decision-column-safe one).
  const traceEligibleIds = new Set(
    (store.qualityReviews ?? [])
      .filter((review) => (review.targetKind as string) === "life_event_trace" && review.provider === "cowork-a6" && review.promptVersion === "a6-trace-layer-v1")
      .map((review) => review.targetId),
  );
  const traceEvents = allEvents.filter((event) => traceEligibleIds.has(event.id));
  const time: ArchiveTime = {
    today: productToday(now),
    activityDay: latestActivityDay({ rawSources: store.rawSources, dailyTraces: traces, events }),
    traceDay: latestTraceDay(traces),
    memoryDay: latestMemoryDay(events),
  };
  return { store, media, events, traceEvents, chapters, birthDay, snapshots, privilege, time };
}

export async function loadFamilyArchive(): Promise<FamilyArchive> {
  const [events, rawStore, organizerStore] = await Promise.all([getAllEvents(), getStore(), getOrganizerStore(CANONICAL_PROFILE_ID)]);
  return composeFamilyArchive(rawStore, events, new Date(), organizerStore.events);
}
