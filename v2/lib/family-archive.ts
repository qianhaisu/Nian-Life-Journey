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
import { indexReviews, isSnapshotPublishable, mediaBindingTrusted } from "@/lib/organizer/quality-review";
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
  // P2 trace tier (B-17, 2026-09-06): store_only life_events — the Organizer read them and wrote a
  // real one-line description, but judged them not significant enough to publish. Today this is the
  // whole store_only set (A-6's subject-confirmed subset has not landed); publication-moments.ts's
  // buildTraceNotes still gates each row (garbage/placeholder text) before it can appear.
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
  const reviews = indexReviews(store.qualityReviews ?? []);
  // store.events (from getStore()) is already the publishable-only set — the same fail-closed gate
  // getAllEvents() applies — so a store_only event is never in it. `allEvents` is the organizer's
  // own unfiltered read (getOrganizerStore), the one place the app already reads every life_event
  // row regardless of review decision.
  const traceEvents = allEvents.filter((event) => reviews.get(`life_event:${event.id}`) === "store_only");
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
