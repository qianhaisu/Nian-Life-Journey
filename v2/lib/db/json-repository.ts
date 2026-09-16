import { promises as fs } from "node:fs";
import path from "node:path";
import { careEpisodes, careRecords, contributors, dailyTraces, events as seedEvents, growthRecords, media as seedMedia, monthlyFocusGoals, monthlySnapshot, profile, rawSources as seedSources } from "@/lib/mock-data";
import type { CareEpisode, DailyTrace, LifeEvent, Media, MediaAsset, MediaLocation, MonthlySnapshot, OrganizerJob, OrganizerRun, RawSource, SourceMemoryLink, ConnectorState } from "@/lib/types";
import { mediaDeliveryUrl, normalizeMediaUrl } from "@/lib/media/paths";
import { selectLocation } from "@/lib/storage/hot-storage";
import { newId, organizerJobKey } from "./repository-interface";
import type { QualityReview } from "@/lib/organizer/quality-review";
import { CANONICAL_PROFILE_ID } from "./config";
import type { MonthArchiveInput, Repository, Store, UploadPersistInput } from "./repository-interface";
import { calendarMonthOf } from "@/lib/timeline-dates";
import { birthDayOf } from "@/lib/time-signature";
import { assetByChecksum, normalizeChatImportTask, persistChatImportBatchInStore, persistUploadInStore } from "./chat-import-persistence";
import { acknowledgeChatImportCancel, claimChatImportTask, completeChatImportTask, completeChatImportWithWarnings, createChatImportTask, failChatImportTask, heartbeatChatImportTask, listChatImportTasks, requestChatImportCancel, retryChatImportTask, saveChatImportCheckpoint } from "./chat-import-state";
import { ledgerOnlyStoryPhotoIds, storyPhotoConfirmationsFrom } from "@/lib/media/story-binding";
import { storyNeighbours } from "@/lib/story-neighbours";
import { indexReviews, isEventPublishable } from "@/lib/organizer/quality-review";
import { randomUUID } from "node:crypto";
import {
  CLAUDE_REVIEW_PROVIDER, CONTENT_SHA256_REASON_PREFIX, FINGERPRINT_TARGET_PREFIX, MEDIA_CONTENT_VERSION_REASON_PREFIX, PHOTO_SUBJECT_KINDS, ProtectedStoryWriteError, STORY_DECISION_KINDS, STORY_REVIEW_KINDS, StoryWriteContractError,
  assertAutomaticActor, assertClaudeMediaDecisionInput, assertClaudeStoryDecisionInput, assertHumanDecisionInput, assertNotAutomaticApproval, blockingHumanDecision, boundContentSha256, canonicalOccurredAtUtc, evaluateStoryProtection, mediaContentVersion, rowLinksToStory, storyContentSha256,
  type ClaudeMediaDecisionInput, type ClaudeStoryDecisionInput, type HumanStoryDecisionInput, type LedgerRow, type StoryContent,
} from "@/lib/organizer/story-write-guard";

const jsonLedgerRows = (store: Store): LedgerRow[] => store.qualityReviews.map((review) => ({ targetKind: review.targetKind, targetId: review.targetId, decision: review.decision, provider: review.provider, promptVersion: review.promptVersion, reviewedAt: review.reviewedAt }));
const jsonStoryContent = (event: LifeEvent): StoryContent => ({ title: event.title ?? null, story: event.story ?? null, occurredAtUtc: canonicalOccurredAtUtc(event.occurredAt), memoryWeight: event.memoryWeight, sourceIds: event.sourceIds ?? [], mediaIds: event.mediaIds ?? [], heroMediaId: event.heroMediaId ?? null });

// Local-dev parity with postgres-repository.ts refuseIfSharedWithProtected (2026-09-14 P1): every
// story that holds a source or photograph this write would re-point or clear, by all five routes.
function jsonRefuseIfSharedWithProtected(store: Store, input: { operation: string; targetEventId: string | null; organizationFingerprint: string | null; sourceIds: Array<string | null | undefined>; mediaIds: Array<string | null | undefined> }) {
  const S = new Set(input.sourceIds.filter((id): id is string => Boolean(id)));
  const M = new Set(input.mediaIds.filter((id): id is string => Boolean(id)));
  const claims: Array<{ storyId: string; route: string; resourceId: string }> = [];
  for (const source of store.rawSources) if (S.has(source.id) && source.relatedLifeEventId) claims.push({ storyId: source.relatedLifeEventId, route: "raw_sources.related_life_event_id", resourceId: source.id });
  for (const link of store.links) if (S.has(link.rawSourceId)) claims.push({ storyId: link.lifeEventId, route: "source_memory_links", resourceId: link.rawSourceId });
  for (const media of store.media) if (M.has(media.id) && media.lifeEventId) claims.push({ storyId: media.lifeEventId, route: "media.life_event_id", resourceId: media.id });
  for (const event of store.events) {
    for (const id of event.sourceIds ?? []) if (S.has(id)) claims.push({ storyId: event.id, route: "life_events.source_ids", resourceId: id });
    for (const id of event.mediaIds ?? []) if (M.has(id)) claims.push({ storyId: event.id, route: "life_events.media_ids", resourceId: id });
    if (event.heroMediaId && M.has(event.heroMediaId)) claims.push({ storyId: event.id, route: "life_events.hero_media_id", resourceId: event.heroMediaId });
  }
  const others = claims.filter((claim) => claim.storyId !== input.targetEventId);
  const hits = [...new Set(others.map((claim) => claim.storyId))].sort().flatMap((id) => {
    const event = store.events.find((item) => item.id === id) ?? null;
    const verdict = evaluateStoryProtection({ event, eventId: id }, jsonLedgerRows(store));
    return verdict.protected ? [{ id, reasons: verdict.reasons }] : [];
  });
  if (!hits.length) return;
  const hitIds = new Set(hits.map((hit) => hit.id));
  throw new ProtectedStoryWriteError({
    operation: input.operation, eventId: input.targetEventId, organizationFingerprint: input.organizationFingerprint,
    reasons: [...new Set([...others.filter((claim) => hitIds.has(claim.storyId)).map((claim) => `SHARED_RESOURCE:${claim.route}:${claim.resourceId}->${claim.storyId}`), ...hits.flatMap((hit) => hit.reasons.map((reason) => `${hit.id}:${reason}`))])].sort(),
    affectedEventIds: [...hitIds].sort(),
  });
}

const dataDir = path.join(process.cwd(), ".data");
const storeFile = path.join(dataDir, "nian-life.json");

const initialStore = (): Store => ({ profile, contributors, media: seedMedia, mediaAssets: [], mediaLocations: [], connectorStates: [], rawSources: seedSources.map((source) => ({ ...source, status: source.status === "inbox" ? "organized" : source.status })), events: seedEvents, dailyTraces, growthRecords, careRecords, careEpisodes, monthlyFocusGoals, organizerRuns: [], organizerJobs: [], chatImportTasks: [], qualityReviews: [], links: seedSources.flatMap((source) => source.relatedLifeEventId ? [{ rawSourceId: source.id, lifeEventId: source.relatedLifeEventId, role: "supporting" as const, createdAt: source.importedAt }] : []), monthlySnapshots: [monthlySnapshot] });

// A-10 (2026-09-06): qualityReviews used to be re-hydrated through normalizeQualityDecision(),
// which silently rewrites any decision value outside the QualityDecision union (e.g. A-6's
// "trace_eligible") into "needs_human_review" — a real business decision, not a safe fallback.
// This mirrors the same fix in postgres-repository.ts's reviewFromRow: pass the stored value
// through unchanged; indexReviews() applies that normalization itself at the one place it is
// actually needed (computing a fail-closed publication decision).
function normalizeStore(store: Partial<Store>): Store {
  return { ...initialStore(), ...store, media: store.media ?? [], mediaAssets: store.mediaAssets ?? [], mediaLocations: store.mediaLocations ?? [], connectorStates: store.connectorStates ?? [], rawSources: store.rawSources ?? [], events: store.events ?? [], contributors: store.contributors ?? [], links: store.links ?? [], dailyTraces: store.dailyTraces ?? [], growthRecords: store.growthRecords ?? [], careRecords: store.careRecords ?? [], careEpisodes: store.careEpisodes ?? [], monthlyFocusGoals: store.monthlyFocusGoals ?? monthlyFocusGoals, organizerRuns: store.organizerRuns ?? [], organizerJobs: store.organizerJobs ?? [], chatImportTasks: (store.chatImportTasks ?? []).map(normalizeChatImportTask), qualityReviews: store.qualityReviews ?? [] };
}
function hydrateMedia(store: Store): Store {
  store.media = store.media.map((media) => {
    const asset = store.mediaAssets.find((item) => item.id === media.mediaAssetId);
    if (!asset) return { ...media, src: normalizeMediaUrl(media.src) };
    const locations = store.mediaLocations.filter((item) => item.mediaAssetId === asset.id);
    const webLocation = selectLocation(locations, asset, "web");
    const thumbnailLocation = selectLocation(locations, asset, "thumbnail");
    const legacyThumbnailSrc = (media as Media & { thumbnailSrc?: string }).thumbnailSrc;
    return {
      ...media,
      src: webLocation ? mediaDeliveryUrl(media.id, webLocation.variant) : normalizeMediaUrl(media.src),
      thumbnailSrc: thumbnailLocation ? mediaDeliveryUrl(media.id, thumbnailLocation.variant) : legacyThumbnailSrc ? normalizeMediaUrl(legacyThumbnailSrc) : undefined,
    };
  });
  return store;
}

async function readStore(): Promise<Store> {
  try { return hydrateMedia(normalizeStore(JSON.parse(await fs.readFile(storeFile, "utf8")) as Partial<Store>)); }
  catch {
    const store = initialStore();
    // Serverless deployments ship a read-only filesystem; fall back to in-memory seed data instead of crashing the page.
    try { await writeStore(store); } catch { /* not persisted */ }
    return store;
  }
}
// The JSON file holds exactly one Profile object; it must be 张年's, the same pin as the
// PostgreSQL backend's profile lookup by id.
async function readCanonicalStore(): Promise<Store> {
  const store = await readStore();
  if (store.profile.id !== CANONICAL_PROFILE_ID) throw new Error(`JSON repository: store profile is "${store.profile.id}", expected "${CANONICAL_PROFILE_ID}".`);
  return store;
}
async function writeStore(store: Store) { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(storeFile, JSON.stringify(store, null, 2), "utf8"); }

let mutationTail: Promise<void> = Promise.resolve();

async function withStoreMutation<T>(operation: (store: Store) => T | Promise<T>) {
  const next = mutationTail.then(async () => {
    const store = await readStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  }, async () => {
    const store = await readStore();
    const result = await operation(store);
    await writeStore(store);
    return result;
  });
  mutationTail = next.then(() => undefined, () => undefined);
  return next;
}

const persistUploadInJson = (input: UploadPersistInput) => withStoreMutation((store) => persistUploadInStore(store, input));
const persistChatImportBatchInJson = (inputs: UploadPersistInput[]) => withStoreMutation((store) => persistChatImportBatchInStore(store, inputs));

// Local-dev/test adapter: a single JSON file, full read-modify-write per call, no transactions or
// locking. Behavior — including every dedup/idempotency rule — must match postgres-repository.ts;
// that equivalence is what test/repository-contract.test.mjs checks.
export function createJsonRepository(): Repository {
  return {
    // Page-facing event listings belong to the canonical profile only, as in postgres-repository.ts.
    async getHomeEvents() { const store = await readCanonicalStore(); return store.events.filter((event) => event.profileId === CANONICAL_PROFILE_ID && event.visibility !== "private").toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt)); },
    async getAllEvents() { const store = await readCanonicalStore(); return store.events.filter((event) => event.profileId === CANONICAL_PROFILE_ID).toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt)); },
    async getStore() { return readCanonicalStore(); },
    // The local store is already in memory, so the family read has nothing to narrow: it returns
    // the same rows the PostgreSQL backend narrows to columns, which is what makes the two
    // backends comparable in a contract test.
    async getFamilyArchiveInput() {
      const store = await readCanonicalStore();
      const own = store.events.filter((event) => event.profileId === CANONICAL_PROFILE_ID);
      const live = store.rawSources.filter((source) => source.profileId === CANONICAL_PROFILE_ID && !source.deletedAt);
      const latest = live.map((source) => source.capturedAt).toSorted().at(-1) ?? null;
      return {
        store,
        events: own.toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
        eventIdentities: own.map((event) => ({ id: event.id, title: event.title, story: event.story, occurredAt: event.occurredAt })),
        latestSourceCapturedAt: latest,
      };
    },
    // The JSON backend already holds everything in memory, so "scoped" here is just a profile_id
    // filter for behavioral parity with the PostgreSQL implementation — no separate performance
    // concern to address.
    async getOrganizerStore(profileId: string) {
      const store = await readStore();
      if (store.profile.id !== profileId) throw new Error("JSON repository: no profile row found for getOrganizerStore.");
      return {
        ...store,
        contributors: store.contributors.filter((c) => c.profileId === profileId),
        rawSources: store.rawSources.filter((s) => s.profileId === profileId),
        media: store.media.filter((m) => m.profileId === profileId),
        mediaAssets: store.mediaAssets.filter((a) => a.profileId === profileId),
        events: store.events.filter((e) => e.profileId === profileId),
      };
    },
    // Same contract as the PostgreSQL implementation: id/title/story/occurredAt only, for every
    // life_event regardless of publication decision.
    async getAllEventIdentities(profileId: string) {
      const store = await readCanonicalStore();
      return store.events.filter((e) => e.profileId === profileId).map((e) => ({ id: e.id, title: e.title, story: e.story, occurredAt: e.occurredAt }));
    },
    // Same contract as the PostgreSQL implementation: one job's sources, their media, and nothing
    // else. Deleted sources are dropped rather than handed to the Evidence Builder.
    async getOrganizerWindowInput(sourceIds: string[]) {
      if (!sourceIds.length) throw new Error("JSON repository: getOrganizerWindowInput needs at least one source id.");
      const store = await readStore();
      const sources = store.rawSources.filter((source) => sourceIds.includes(source.id) && !source.deletedAt);
      const profileIds = [...new Set(sources.map((source) => source.profileId))];
      if (profileIds.length > 1) throw new Error(`JSON repository: getOrganizerWindowInput spans ${profileIds.length} profiles; one job is one profile's evidence.`);

      const mediaIds = new Set(sources.flatMap((source) => source.mediaIds));
      const media = store.media.filter((item) => mediaIds.has(item.id));
      const assetIds = new Set(media.map((item) => item.mediaAssetId).filter((id): id is string => Boolean(id)));
      return {
        // The JSON store holds exactly one profile; sources belonging to any other (contract-test
        // fixtures) simply have no profile row here, which is the same answer PostgreSQL gives.
        profile: profileIds.length && store.profile.id === profileIds[0] ? store.profile : null,
        sources,
        media,
        mediaAssets: store.mediaAssets.filter((asset) => assetIds.has(asset.id)),
        mediaLocations: store.mediaLocations.filter((location) => assetIds.has(location.mediaAssetId)),
      };
    },
    async getEventDetail(id: string) {
      const store = await readStore();
      const event = store.events.find((item) => item.id === id);
      if (!event) return null;
      const photoConfirmations = storyPhotoConfirmationsFrom(store.qualityReviews ?? []);
      const storyMediaIds = new Set([...event.mediaIds, ...ledgerOnlyStoryPhotoIds(event.id, event.mediaIds, photoConfirmations)]);
      const media = store.media.filter((item) => storyMediaIds.has(item.id));
      const assetIds = new Set(media.map((item) => item.mediaAssetId).filter((v): v is string => Boolean(v)));
      // Same reading order the PostgreSQL backend builds, under the same rule: only stories a
      // reader could already open. The local store is small enough to filter in memory.
      const reviews = indexReviews((store.qualityReviews ?? []) as unknown as Array<Omit<QualityReview, "decision"> & { decision: unknown }>);
      const readable = store.events
        .filter((item) => item.visibility !== "private" && isEventPublishable(item, reviews))
        .map((item) => ({ id: item.id, title: item.title, occurredAt: item.occurredAt }));
      return {
        event,
        media,
        sources: store.rawSources.filter((item) => event.sourceIds.includes(item.id) && !item.deletedAt),
        contributors: store.contributors,
        growth: store.growthRecords.filter((item) => event.growthRecordIds.includes(item.id)),
        care: store.careRecords.filter((item) => event.careRecordIds.includes(item.id) && item.visibility !== "private"),
        links: store.links.filter((link) => link.lifeEventId === id),
        mediaAssets: store.mediaAssets.filter((asset) => assetIds.has(asset.id)),
        mediaLocations: store.mediaLocations.filter((location) => assetIds.has(location.mediaAssetId)),
        birthDay: birthDayOf(store.profile),
        photoConfirmations,
        neighbours: storyNeighbours({ id: event.id, title: event.title, occurredAt: event.occurredAt }, readable),
      };
    },
    // Local dev store is small — no need for the PostgreSQL backend's scoped query, just filter the
    // whole (already in-memory) store down to the requested month.
    async getMonthArchive(month: string): Promise<MonthArchiveInput> {
      const store = await readStore();
      const media = store.media.filter((item) => calendarMonthOf(item.takenAt) === month);
      const sourceIds = new Set(media.map((item) => item.rawSourceId).filter((id): id is string => Boolean(id)));
      const assetIds = new Set(media.map((item) => item.mediaAssetId).filter((id): id is string => Boolean(id)));
      return {
        birthDay: birthDayOf(store.profile),
        events: store.events.filter((item) => calendarMonthOf(item.occurredAt) === month),
        // Matches composeFamilyArchive's own extra visibility filter (lib/family-archive.ts).
        dailyTraces: store.dailyTraces.filter((item) => calendarMonthOf(item.occurredAt) === month && item.visibility !== "private"),
        media,
        mediaAssets: store.mediaAssets.filter((item) => assetIds.has(item.id)),
        mediaLocations: store.mediaLocations.filter((item) => assetIds.has(item.mediaAssetId)),
        rawSources: store.rawSources.filter((item) => sourceIds.has(item.id)),
        photoConfirmations: storyPhotoConfirmationsFrom(store.qualityReviews ?? []),
      };
    },
    async listArchiveMonths() {
      const store = await readStore();
      const months = new Set<string>();
      for (const item of store.events) { const m = calendarMonthOf(item.occurredAt); if (m) months.add(m); }
      for (const item of store.dailyTraces) { const m = calendarMonthOf(item.occurredAt); if (m) months.add(m); }
      for (const item of store.media) { const m = calendarMonthOf(item.takenAt); if (m) months.add(m); }
      return [...months].sort();
    },
    async appendUpload(input: UploadPersistInput) { return (await persistUploadInJson(input)).source; },
    async persistUpload(input: UploadPersistInput) { return persistUploadInJson(input); },
    async findMediaAssetByChecksum(checksum: string) { const store = await readStore(); return assetByChecksum(store, checksum); },
    async getMediaForDelivery(id: string) {
      const store = await readStore();
      const media = store.media.find((item) => item.id === id);
      if (!media) return null;
      const asset = media.mediaAssetId ? store.mediaAssets.find((item) => item.id === media.mediaAssetId) ?? null : null;
      const locations = asset ? store.mediaLocations.filter((item) => item.mediaAssetId === asset.id) : [];
      return { media, asset, locations };
    },
    async persistChatImportMessage(input: UploadPersistInput) { return persistUploadInJson(input); },
    async persistChatImportBatch(inputs: UploadPersistInput[]) { return persistChatImportBatchInJson(inputs); },
    async createChatImportTask(input) { return withStoreMutation((store) => createChatImportTask(store.chatImportTasks, input)); },
    async getChatImportTask(id) { const store = await readStore(); return store.chatImportTasks.find((task) => task.id === id) ?? null; },
    async listChatImportTasks(filter) { const store = await readStore(); return listChatImportTasks(store.chatImportTasks, filter); },
    async claimChatImportTask(input) { return withStoreMutation((store) => claimChatImportTask(store.chatImportTasks, input)); },
    async heartbeatChatImportTask(input) { return withStoreMutation((store) => heartbeatChatImportTask(store.chatImportTasks, input)); },
    async saveChatImportCheckpoint(input) { return withStoreMutation((store) => saveChatImportCheckpoint(store.chatImportTasks, input)); },
    async requestChatImportCancel(taskId, now) { return withStoreMutation((store) => requestChatImportCancel(store.chatImportTasks, taskId, now)); },
    async acknowledgeChatImportCancel(input) { return withStoreMutation((store) => acknowledgeChatImportCancel(store.chatImportTasks, input)); },
    async failChatImportTask(input) { return withStoreMutation((store) => failChatImportTask(store.chatImportTasks, input)); },
    async retryChatImportTask(taskId, now) { return withStoreMutation((store) => retryChatImportTask(store.chatImportTasks, taskId, now)); },
    async completeChatImportTask(input) { return withStoreMutation((store) => completeChatImportTask(store.chatImportTasks, input)); },
    async completeChatImportWithWarnings(input) { return withStoreMutation((store) => completeChatImportWithWarnings(store.chatImportTasks, input)); },
    async updateMediaAsset(id: string, patch: Partial<MediaAsset>) { const store = await readStore(); const asset = store.mediaAssets.find((item) => item.id === id); if (!asset) return null; Object.assign(asset, patch); await writeStore(store); return asset; },
    async updateMediaLocation(id: string, patch: Partial<MediaLocation>) { const store = await readStore(); const location = store.mediaLocations.find((item) => item.id === id); if (!location) return null; Object.assign(location, patch, { updatedAt: new Date().toISOString() }); await writeStore(store); return location; },
    async removeMediaLocation(id: string) { const store = await readStore(); store.mediaLocations = store.mediaLocations.filter((item) => item.id !== id); await writeStore(store); },
    async findMediaLocationByProviderRef(provider: MediaLocation["provider"], providerRef: string) { const store = await readStore(); const location = store.mediaLocations.find((item) => item.provider === provider && item.providerRef === providerRef) ?? null; if (!location) return null; return { location, asset: store.mediaAssets.find((item) => item.id === location.mediaAssetId) ?? null }; },
    async appendMediaAssetWithLocation(asset: MediaAsset, location: MediaLocation) { const store = await readStore(); store.mediaAssets.push(asset); store.mediaLocations.push(location); await writeStore(store); return { asset, location }; },
    async updateMediaAssetWithLocation(assetId: string, locationId: string, assetPatch: Partial<MediaAsset>, locationPatch: Partial<MediaLocation>) { const store = await readStore(); const asset = store.mediaAssets.find((item) => item.id === assetId); const location = store.mediaLocations.find((item) => item.id === locationId); if (!asset || !location) return null; Object.assign(asset, assetPatch); Object.assign(location, locationPatch, { updatedAt: new Date().toISOString() }); await writeStore(store); return { asset, location }; },
    async getConnectorState(provider: "quark", profileId: string) { const store = await readStore(); return store.connectorStates.find((item) => item.provider === provider && item.profileId === profileId) ?? null; },
    async upsertConnectorState(input: ConnectorState) { const store = await readStore(); const index = store.connectorStates.findIndex((item) => item.id === input.id); if (index === -1) store.connectorStates.push(input); else store.connectorStates[index] = input; await writeStore(store); return input; },
    async markArchiveStatus(assetId: string, status: NonNullable<MediaAsset["archiveStatus"]>, error?: string) { const store = await readStore(); const asset = store.mediaAssets.find((item) => item.id === assetId); if (!asset) return null; asset.archiveStatus = status; asset.archiveLastError = error; const original = store.mediaLocations.find((item) => item.mediaAssetId === assetId && item.provider === "hot" && item.variant === "original"); if (original && status !== "archived") original.status = status === "paused_auth_required" ? "awaiting_archive" : status; await writeStore(store); return asset; },
    async recordArchivedOriginal(input: { assetId: string; providerRef: string; path?: string; fileSize?: number; checksumVerified?: boolean }) { const store = await readStore(); const asset = store.mediaAssets.find((item) => item.id === input.assetId); if (!asset) return null; const now = new Date().toISOString(); const existing = store.mediaLocations.find((item) => item.mediaAssetId === input.assetId && item.provider === "quark" && item.variant === "original"); const location: MediaLocation = existing ?? { id: newId("location"), mediaAssetId: input.assetId, provider: "quark", variant: "original", providerRef: input.providerRef, status: "archived", createdAt: now, updatedAt: now }; Object.assign(location, { providerRef: input.providerRef, fileSize: input.fileSize, status: "archived", quarkPathSnapshot: input.path, updatedAt: now }); if (!existing) store.mediaLocations.push(location); asset.archiveStatus = "archived"; asset.archiveVerifiedAt = now; asset.archiveLastError = undefined; await writeStore(store); return location; },
    // Local-dev parity with postgres-repository.ts: same protection verdict, same refusals. There is no
    // lock here because the JSON store is a single local file with no concurrent writer.
    async persistOrganization(sourceIds: string[], eventInput: LifeEvent, links: SourceMemoryLink[], options: { actor?: "organizer"; review?: QualityReview } = {}) { assertAutomaticActor(options.actor); if (options.review) { assertNotAutomaticApproval(options.review); if (options.review.targetKind !== "life_event") throw new StoryWriteContractError("REVIEW_KIND", `persistOrganization only writes a life_event review (got ${options.review.targetKind})`); } const store = await readStore(); const fp = eventInput.organizationFingerprint ?? null; const existing = (fp ? store.events.find((event) => event.organizationFingerprint === fp) : undefined) ?? store.events.find((event) => event.id === eventInput.id); { const verdict = evaluateStoryProtection({ event: existing ?? null, eventId: existing?.id ?? eventInput.id, fingerprints: [fp] }, jsonLedgerRows(store)); if (verdict.protected) throw new ProtectedStoryWriteError({ operation: "persistOrganization", eventId: existing?.id ?? null, organizationFingerprint: fp, reasons: verdict.reasons }); } jsonRefuseIfSharedWithProtected(store, { operation: "persistOrganization", targetEventId: existing?.id ?? eventInput.id, organizationFingerprint: fp, sourceIds: [...sourceIds, ...links.map((link) => link.rawSourceId), ...eventInput.sourceIds], mediaIds: [...eventInput.mediaIds, eventInput.heroMediaId] }); const resultId = existing?.id ?? eventInput.id; if (options.review && !store.qualityReviews.some((item) => item.targetKind === "life_event" && item.targetId === resultId && item.promptVersion === options.review!.promptVersion)) store.qualityReviews.push({ ...options.review, targetId: resultId }); if (existing) { existing.sourceIds = [...new Set([...existing.sourceIds, ...sourceIds])]; existing.mediaIds = [...new Set([...existing.mediaIds, ...eventInput.mediaIds])]; existing.contentTypes = [...new Set([...existing.contentTypes, ...eventInput.contentTypes])]; existing.story = eventInput.story || existing.story; existing.title = eventInput.title || existing.title; existing.memoryWeight = eventInput.memoryWeight; existing.organizerVersion = eventInput.organizerVersion ?? existing.organizerVersion; existing.organizerRun = eventInput.organizerRun ?? existing.organizerRun; existing.organizationFingerprint = eventInput.organizationFingerprint ?? existing.organizationFingerprint; } else store.events.push({ ...eventInput, sourceIds: [...new Set(eventInput.sourceIds.length ? eventInput.sourceIds : sourceIds)] }); for (const source of store.rawSources) if (sourceIds.includes(source.id)) { source.status = "organized"; source.relatedLifeEventId = resultId; } store.links.push(...links.map((link) => ({ ...link, lifeEventId: resultId })).filter((link) => !store.links.some((old) => old.rawSourceId === link.rawSourceId && old.lifeEventId === link.lifeEventId))); for (const media of store.media) if (eventInput.mediaIds.includes(media.id)) media.lifeEventId = resultId; await writeStore(store); return existing ?? eventInput; },
    // Fingerprint-only identity, matching postgres-repository.persistDailyTrace(). The `(profileId,
    // day)` fallback is deliberately gone — see the comment there. The fingerprint check is also
    // guarded on the fingerprint being present, so a trace without one no longer matches the first
    // other trace that happens to have `organizationFingerprint === undefined`.
    async persistDailyTrace(trace: DailyTrace) { const store = await readStore(); jsonRefuseIfSharedWithProtected(store, { operation: "persistDailyTrace", targetEventId: null, organizationFingerprint: trace.organizationFingerprint ?? null, sourceIds: trace.sourceIds, mediaIds: [] }); const existing = trace.organizationFingerprint ? store.dailyTraces.find((item) => item.organizationFingerprint === trace.organizationFingerprint) : undefined; if (existing) { existing.entries = [...new Set([...existing.entries, ...trace.entries])]; existing.sourceIds = [...new Set([...existing.sourceIds, ...trace.sourceIds])]; existing.organizerRun = trace.organizerRun ?? existing.organizerRun; existing.organizationFingerprint = existing.organizationFingerprint ?? trace.organizationFingerprint; } else store.dailyTraces.push(trace); for (const source of store.rawSources) if (trace.sourceIds.includes(source.id)) { source.status = "organized"; source.relatedLifeEventId = undefined; } await writeStore(store); return existing ?? trace; },
    async persistCareEpisode(episode: CareEpisode) { const store = await readStore(); jsonRefuseIfSharedWithProtected(store, { operation: "persistCareEpisode", targetEventId: null, organizationFingerprint: null, sourceIds: episode.sourceIds, mediaIds: [] }); const existing = store.careEpisodes.find((item) => item.profileId === episode.profileId && item.startedAt.slice(0, 10) === episode.startedAt.slice(0, 10) && item.status === "open"); if (existing) { existing.sourceIds = [...new Set([...existing.sourceIds, ...episode.sourceIds])]; existing.organizerRun = episode.organizerRun ?? existing.organizerRun; } else store.careEpisodes.push(episode); for (const source of store.rawSources) if (episode.sourceIds.includes(source.id)) { source.status = "organized"; source.relatedLifeEventId = undefined; } await writeStore(store); return existing ?? episode; },
    // Identity is (targetKind, targetId, promptVersion), the PostgreSQL ledger's own unique key: a
    // repeat returns the stored row untouched instead of writing a second one or overwriting a
    // decision that may since have been revisited.
    async persistQualityReview(review: QualityReview, options: { actor?: "organizer" } = {}) {
      assertAutomaticActor(options.actor);
      if (STORY_REVIEW_KINDS.has(review.targetKind)) assertNotAutomaticApproval(review);
      return withStoreMutation((store) => {
        if (STORY_REVIEW_KINDS.has(review.targetKind)) {
          const head = (review.targetKind as string) === "media_binding" ? review.targetId.split("|")[0] : review.targetId;
          const fp = head.startsWith(FINGERPRINT_TARGET_PREFIX) ? head.slice(FINGERPRINT_TARGET_PREFIX.length) : null;
          const event = (fp ? store.events.find((item) => item.organizationFingerprint === fp) : store.events.find((item) => item.id === head)) ?? null;
          const eventId = event?.id ?? (fp ? null : head);
          const verdict = evaluateStoryProtection({ event, eventId, fingerprints: [fp] }, jsonLedgerRows(store));
          if (verdict.protected) throw new ProtectedStoryWriteError({ operation: "persistQualityReview", eventId, organizationFingerprint: fp ?? event?.organizationFingerprint ?? null, reasons: verdict.reasons });
        }
        const existing = store.qualityReviews.find((item) => item.targetKind === review.targetKind && item.targetId === review.targetId && item.promptVersion === review.promptVersion);
        if (existing) return existing;
        store.qualityReviews.push(review);
        return review;
      });
    },
    async recordHumanStoryDecision(input: HumanStoryDecisionInput) {
      assertHumanDecisionInput(input);
      return withStoreMutation((store) => {
        const event = store.events.find((item) => item.id === input.eventId);
        if (!event) throw new StoryWriteContractError("EVENT_NOT_FOUND", `no life_event ${input.eventId}`);
        const current = storyContentSha256(jsonStoryContent(event));
        if (current !== input.reviewedContentSha256) throw new StoryWriteContractError("STALE_REVIEW_CONTENT", `reviewed content ${input.reviewedContentSha256.slice(0, 12)}… is not the stored story (now ${current.slice(0, 12)}…); nothing written`);
        const existing = store.qualityReviews.find((item) => item.targetKind === "life_event" && item.targetId === input.eventId && item.promptVersion === input.promptVersion);
        if (existing) {
          if (existing.decision === input.decision && boundContentSha256(existing.reasonCodes) === current) return { review: existing, contentSha256: current, idempotent: true };
          throw new StoryWriteContractError("HUMAN_DECISION_CONFLICT", `${input.eventId} already has a different ${input.promptVersion} decision; use a new promptVersion for a new decision`);
        }
        const latest = Math.max(Date.now(), ...store.qualityReviews.filter((item) => item.targetKind === "life_event" && item.targetId === input.eventId).map((item) => Date.parse(item.reviewedAt) + 1).filter((value) => !Number.isNaN(value)));
        const review: QualityReview = { id: `human-review-${randomUUID()}`, profileId: event.profileId, targetKind: "life_event", targetId: input.eventId, decision: input.decision, reasonCodes: [...(input.reasonCodes ?? []), `${CONTENT_SHA256_REASON_PREFIX}${current}`], provider: input.operator, promptVersion: input.promptVersion, policyVersion: input.policyVersion, reviewFingerprint: `${input.eventId}:${input.promptVersion}`, reviewedAt: new Date(latest).toISOString() };
        store.qualityReviews.push(review);
        return { review, contentSha256: current, idempotent: false };
      });
    },
    // 2026-09-16: JSON mirror of the Claude review entries (postgres-repository.ts). Same rules.
    async recordClaudeStoryDecision(input: ClaudeStoryDecisionInput) {
      assertClaudeStoryDecisionInput(input);
      return withStoreMutation((store) => {
        const event = store.events.find((item) => item.id === input.eventId);
        if (!event) throw new StoryWriteContractError("EVENT_NOT_FOUND", `no life_event ${input.eventId}`);
        const current = storyContentSha256(jsonStoryContent(event));
        if (current !== input.reviewedContentSha256) throw new StoryWriteContractError("STALE_REVIEW_CONTENT", `reviewed content ${input.reviewedContentSha256.slice(0, 12)} is not the stored story (now ${current.slice(0, 12)}); nothing written`);
        const ledger: LedgerRow[] = store.qualityReviews
          .filter((item) => rowLinksToStory(item, event.id, [event.organizationFingerprint]))
          .map((item) => ({ targetKind: item.targetKind, targetId: item.targetId, decision: item.decision, provider: item.provider ?? "", promptVersion: item.promptVersion, reviewedAt: item.reviewedAt }));
        const blocker = blockingHumanDecision(ledger, STORY_DECISION_KINDS);
        if (blocker) throw new StoryWriteContractError("HUMAN_DECISION_PRESENT", `${input.eventId} carries a human ${blocker.targetKind} decision (${blocker.provider}: ${blocker.decision}); a Claude decision may not be placed over it`);
        const existing = store.qualityReviews.find((item) => item.targetKind === "life_event" && item.targetId === input.eventId && item.promptVersion === input.promptVersion);
        if (existing) {
          if (existing.provider === CLAUDE_REVIEW_PROVIDER && existing.decision === input.decision && boundContentSha256(existing.reasonCodes) === current) return { review: existing, contentVersion: current, idempotent: true };
          throw new StoryWriteContractError("CLAUDE_DECISION_CONFLICT", `${input.eventId} already has a different ${input.promptVersion} decision; use a new promptVersion for a new decision`);
        }
        const latest = Math.max(Date.now(), ...store.qualityReviews.filter((item) => item.targetKind === "life_event" && item.targetId === input.eventId).map((item) => Date.parse(item.reviewedAt) + 1).filter((value) => !Number.isNaN(value)));
        const review: QualityReview = { id: `claude-review-${randomUUID()}`, profileId: event.profileId, targetKind: "life_event", targetId: input.eventId, decision: input.decision, reasonCodes: [...input.reasonCodes, `${CONTENT_SHA256_REASON_PREFIX}${current}`], provider: CLAUDE_REVIEW_PROVIDER, promptVersion: input.promptVersion, policyVersion: input.policyVersion, reviewFingerprint: `${input.eventId}:${input.promptVersion}`, reviewedAt: new Date(latest).toISOString() };
        store.qualityReviews.push(review);
        return { review, contentVersion: current, idempotent: false };
      });
    },
    async recordClaudeMediaDecision(input: ClaudeMediaDecisionInput) {
      assertClaudeMediaDecisionInput(input);
      return withStoreMutation((store) => {
        const media = store.media.find((item) => item.id === input.mediaId);
        if (!media) throw new StoryWriteContractError("MEDIA_NOT_FOUND", `no media ${input.mediaId}`);
        const asset = media.mediaAssetId ? store.mediaAssets.find((item) => item.id === media.mediaAssetId) : undefined;
        const current = mediaContentVersion({ id: media.id, objectKey: media.objectKey ?? null, width: media.width, height: media.height }, asset?.checksum ?? null);
        if (current !== input.reviewedContentVersion) throw new StoryWriteContractError("STALE_REVIEW_CONTENT", `reviewed picture ${input.reviewedContentVersion.slice(0, 20)} is not the stored one (now ${current.slice(0, 20)}); nothing written`);
        const ledger: LedgerRow[] = store.qualityReviews
          .filter((item) => item.targetKind === "media_subject_check" && item.targetId === input.mediaId)
          .map((item) => ({ targetKind: item.targetKind, targetId: item.targetId, decision: item.decision, provider: item.provider ?? "", promptVersion: item.promptVersion, reviewedAt: item.reviewedAt }));
        const blocker = blockingHumanDecision(ledger, PHOTO_SUBJECT_KINDS);
        if (blocker) throw new StoryWriteContractError("HUMAN_DECISION_PRESENT", `${input.mediaId} carries a human subject check (${blocker.provider}: ${blocker.decision}); a Claude decision may not be placed over it`);
        const existing = store.qualityReviews.find((item) => item.targetKind === "media_subject_check" && item.targetId === input.mediaId && item.promptVersion === input.promptVersion);
        if (existing) {
          const bound = existing.reasonCodes.find((code) => code.startsWith(MEDIA_CONTENT_VERSION_REASON_PREFIX))?.slice(MEDIA_CONTENT_VERSION_REASON_PREFIX.length);
          if (existing.provider === CLAUDE_REVIEW_PROVIDER && existing.decision === input.decision && bound === current) return { review: existing, contentVersion: current, idempotent: true };
          throw new StoryWriteContractError("CLAUDE_DECISION_CONFLICT", `${input.mediaId} already has a different ${input.promptVersion} decision; use a new promptVersion for a new decision`);
        }
        const latest = Math.max(Date.now(), ...store.qualityReviews.filter((item) => item.targetKind === "media_subject_check" && item.targetId === input.mediaId).map((item) => Date.parse(item.reviewedAt) + 1).filter((value) => !Number.isNaN(value)));
        const review: QualityReview = { id: `claude-review-media-${randomUUID()}`, profileId: media.profileId, targetKind: "media_subject_check", targetId: input.mediaId, decision: input.decision, reasonCodes: [...input.reasonCodes, `${MEDIA_CONTENT_VERSION_REASON_PREFIX}${current}`], provider: CLAUDE_REVIEW_PROVIDER, promptVersion: input.promptVersion, policyVersion: input.policyVersion, reviewFingerprint: `${input.mediaId}:${input.promptVersion}`, reviewedAt: new Date(latest).toISOString() };
        store.qualityReviews.push(review);
        return { review, contentVersion: current, idempotent: false };
      });
    },
    async getMediaContentVersion(mediaId: string) {
      const store = await readStore();
      const media = store.media.find((item) => item.id === mediaId);
      if (!media) return null;
      const asset = media.mediaAssetId ? store.mediaAssets.find((item) => item.id === media.mediaAssetId) : undefined;
      return { mediaId, contentVersion: mediaContentVersion({ id: media.id, objectKey: media.objectKey ?? null, width: media.width, height: media.height }, asset?.checksum ?? null) };
    },
    async getStoryContentVersion(eventId: string) {
      const store = await readStore();
      const event = store.events.find((item) => item.id === eventId);
      if (!event) return null;
      const content = jsonStoryContent(event);
      return { eventId, contentSha256: storyContentSha256(content), content };
    },
    async getStoryProtection(eventId: string) {
      const store = await readStore();
      const event = store.events.find((item) => item.id === eventId);
      if (!event) return null;
      return { eventId, ...evaluateStoryProtection({ event }, jsonLedgerRows(store)) };
    },
    async findQualityReview(targetKind: QualityReview["targetKind"], targetId: string, promptVersion: string) {
      const store = await readStore();
      return store.qualityReviews.find((item) => item.targetKind === targetKind && item.targetId === targetId && item.promptVersion === promptVersion) ?? null;
    },
    async persistMonthlySnapshot(snapshot: MonthlySnapshot) {
      return withStoreMutation((store) => {
        const index = store.monthlySnapshots.findIndex((item) => item.profileId === snapshot.profileId && item.month === snapshot.month);
        if (index >= 0) store.monthlySnapshots[index] = snapshot; else store.monthlySnapshots.push(snapshot);
        return snapshot;
      });
    },
    async markSourcesOrganized(sourceIds: string[]) { const store = await readStore(); jsonRefuseIfSharedWithProtected(store, { operation: "markSourcesOrganized", targetEventId: null, organizationFingerprint: null, sourceIds: store.rawSources.filter((source) => sourceIds.includes(source.id) && source.status !== "organized").map((source) => source.id), mediaIds: [] }); for (const source of store.rawSources) if (sourceIds.includes(source.id)) source.status = "organized"; await writeStore(store); },
    async markSourcesProcessing(sourceIds: string[]) { const store = await readStore(); for (const source of store.rawSources) if (sourceIds.includes(source.id) && source.status === "uploaded") source.status = "processing"; await writeStore(store); },
    async findOrganizerRun(organizationFingerprint: string) { const store = await readStore(); return store.organizerRuns.find((run) => run.organizationFingerprint === organizationFingerprint) ?? null; },
    async persistOrganizerRun(run: OrganizerRun) { const store = await readStore(); const existing = store.organizerRuns.find((item) => item.organizationFingerprint === run.organizationFingerprint); if (!existing) store.organizerRuns.push(run); await writeStore(store); return existing ?? run; },
    async undoOrganization(sourceIds: string[], eventId: string) { const store = await readStore(); const event = store.events.find((item) => item.id === eventId); if (!event) return; { const own = evaluateStoryProtection({ event }, jsonLedgerRows(store)); if (own.protected) throw new ProtectedStoryWriteError({ operation: "undoOrganization", eventId: event.id, organizationFingerprint: event.organizationFingerprint ?? null, reasons: own.reasons }); } jsonRefuseIfSharedWithProtected(store, { operation: "undoOrganization", targetEventId: event.id, organizationFingerprint: event.organizationFingerprint ?? null, sourceIds, mediaIds: store.rawSources.filter((source) => sourceIds.includes(source.id)).flatMap((source) => source.mediaIds) }); event.sourceIds = event.sourceIds.filter((id) => !sourceIds.includes(id)); event.mediaIds = event.mediaIds.filter((id) => !store.rawSources.find((source) => source.id === id)?.mediaIds.includes(id)); store.links = store.links.filter((link) => !(link.lifeEventId === eventId && sourceIds.includes(link.rawSourceId))); for (const source of store.rawSources) if (sourceIds.includes(source.id)) { source.status = "uploaded"; source.relatedLifeEventId = undefined; } for (const media of store.media) if (sourceIds.some((sourceId) => store.rawSources.find((source) => source.id === sourceId)?.mediaIds.includes(media.id))) media.lifeEventId = undefined; if (!event.sourceIds.length && event.id.startsWith("event-")) store.events = store.events.filter((item) => item.id !== eventId); await writeStore(store); },
    async enqueueOrganizerJob(input: { sourceIds: string[]; profileId: string; force?: boolean }) {
      const store = await readStore();
      const jobKey = organizerJobKey(input.sourceIds);
      const existing = store.organizerJobs.find((job) => job.jobKey === jobKey && (job.status === "pending" || job.status === "processing"));
      if (existing) return existing;
      const now = new Date().toISOString();
      const job: OrganizerJob = { id: newId("organizer-job"), jobKey, profileId: input.profileId, sourceIds: input.sourceIds.slice(), force: input.force ?? false, status: "pending", attempts: 0, availableAt: now, createdAt: now, updatedAt: now };
      store.organizerJobs.push(job);
      await writeStore(store);
      return job;
    },
    async claimNextOrganizerJob(now: Date = new Date()) {
      const store = await readStore();
      const nowIso = now.toISOString();
      const claimable = store.organizerJobs.filter((job) => job.status === "pending" && job.availableAt <= nowIso).toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
      const job = claimable[0];
      if (!job) return null;
      job.status = "processing";
      job.lockedAt = nowIso;
      job.attempts += 1;
      job.updatedAt = nowIso;
      await writeStore(store);
      return job;
    },
    async completeOrganizerJob(id: string, patch: { resultAction?: string; resultTargetId?: string }) {
      const store = await readStore();
      const job = store.organizerJobs.find((item) => item.id === id);
      if (!job) return;
      const now = new Date().toISOString();
      job.status = "succeeded";
      job.resultAction = patch.resultAction as OrganizerJob["resultAction"];
      job.resultTargetId = patch.resultTargetId;
      job.completedAt = now;
      job.updatedAt = now;
      await writeStore(store);
    },
    async failOrganizerJob(id: string, error: string, nextAvailableAt: string | null) {
      const store = await readStore();
      const job = store.organizerJobs.find((item) => item.id === id);
      if (!job) return;
      const now = new Date().toISOString();
      job.lastError = error;
      job.updatedAt = now;
      job.lockedAt = undefined;
      if (nextAvailableAt) { job.status = "pending"; job.availableAt = nextAvailableAt; }
      else { job.status = "failed"; job.completedAt = now; }
      await writeStore(store);
    },
    async getOrganizerJob(id: string) {
      const store = await readStore();
      return store.organizerJobs.find((item) => item.id === id) ?? null;
    },
    async recoverStuckOrganizerJobs(olderThanMs: number, now: Date = new Date()) {
      const store = await readStore();
      const cutoff = now.getTime() - olderThanMs;
      let count = 0;
      for (const job of store.organizerJobs) {
        if (job.status === "processing" && job.lockedAt && Date.parse(job.lockedAt) < cutoff) {
          job.status = "pending";
          job.lockedAt = undefined;
          job.updatedAt = now.toISOString();
          count += 1;
        }
      }
      if (count) await writeStore(store);
      return count;
    },
  };
}
