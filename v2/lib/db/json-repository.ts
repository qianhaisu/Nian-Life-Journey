import { promises as fs } from "node:fs";
import path from "node:path";
import { careEpisodes, careRecords, contributors, dailyTraces, events as seedEvents, growthRecords, media as seedMedia, monthlyFocusGoals, monthlySnapshot, profile, rawSources as seedSources } from "@/lib/mock-data";
import type { CareEpisode, DailyTrace, LifeEvent, Media, MediaAsset, MediaLocation, MonthlySnapshot, OrganizerJob, OrganizerRun, RawSource, SourceMemoryLink, ConnectorState } from "@/lib/types";
import { mediaDeliveryUrl, normalizeMediaUrl } from "@/lib/media/paths";
import { selectLocation } from "@/lib/storage/hot-storage";
import { newId, organizerJobKey } from "./repository-interface";
import { normalizeQualityDecision, type QualityReview } from "@/lib/organizer/quality-review";
import { CANONICAL_PROFILE_ID } from "./config";
import type { MonthArchiveInput, Repository, Store, UploadPersistInput } from "./repository-interface";
import { calendarMonthOf } from "@/lib/timeline-dates";
import { birthDayOf } from "@/lib/time-signature";
import { assetByChecksum, normalizeChatImportTask, persistChatImportBatchInStore, persistUploadInStore } from "./chat-import-persistence";
import { acknowledgeChatImportCancel, claimChatImportTask, completeChatImportTask, completeChatImportWithWarnings, createChatImportTask, failChatImportTask, heartbeatChatImportTask, listChatImportTasks, requestChatImportCancel, retryChatImportTask, saveChatImportCheckpoint } from "./chat-import-state";

const dataDir = path.join(process.cwd(), ".data");
const storeFile = path.join(dataDir, "nian-life.json");

const initialStore = (): Store => ({ profile, contributors, media: seedMedia, mediaAssets: [], mediaLocations: [], connectorStates: [], rawSources: seedSources.map((source) => ({ ...source, status: source.status === "inbox" ? "organized" : source.status })), events: seedEvents, dailyTraces, growthRecords, careRecords, careEpisodes, monthlyFocusGoals, organizerRuns: [], organizerJobs: [], chatImportTasks: [], qualityReviews: [], links: seedSources.flatMap((source) => source.relatedLifeEventId ? [{ rawSourceId: source.id, lifeEventId: source.relatedLifeEventId, role: "supporting" as const, createdAt: source.importedAt }] : []), monthlySnapshots: [monthlySnapshot] });

function normalizeStore(store: Partial<Store>): Store {
  return { ...initialStore(), ...store, media: store.media ?? [], mediaAssets: store.mediaAssets ?? [], mediaLocations: store.mediaLocations ?? [], connectorStates: store.connectorStates ?? [], rawSources: store.rawSources ?? [], events: store.events ?? [], contributors: store.contributors ?? [], links: store.links ?? [], dailyTraces: store.dailyTraces ?? [], growthRecords: store.growthRecords ?? [], careRecords: store.careRecords ?? [], careEpisodes: store.careEpisodes ?? [], monthlyFocusGoals: store.monthlyFocusGoals ?? monthlyFocusGoals, organizerRuns: store.organizerRuns ?? [], organizerJobs: store.organizerJobs ?? [], chatImportTasks: (store.chatImportTasks ?? []).map(normalizeChatImportTask), qualityReviews: (store.qualityReviews ?? []).map((review) => ({ ...review, decision: normalizeQualityDecision(review.decision) })) };
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
    async getEventDetail(id: string) { const store = await readStore(); const event = store.events.find((item) => item.id === id); if (!event) return null; return { event, media: store.media.filter((item) => event.mediaIds.includes(item.id)), sources: store.rawSources.filter((item) => event.sourceIds.includes(item.id) && !item.deletedAt), contributors: store.contributors, growth: store.growthRecords.filter((item) => event.growthRecordIds.includes(item.id)), care: store.careRecords.filter((item) => event.careRecordIds.includes(item.id) && item.visibility !== "private") }; },
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
      };
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
    async persistOrganization(sourceIds: string[], eventInput: LifeEvent, links: SourceMemoryLink[]) { const store = await readStore(); const existing = store.events.find((event) => event.id === eventInput.id); if (existing) { existing.sourceIds = [...new Set([...existing.sourceIds, ...sourceIds])]; existing.mediaIds = [...new Set([...existing.mediaIds, ...eventInput.mediaIds])]; existing.contentTypes = [...new Set([...existing.contentTypes, ...eventInput.contentTypes])]; existing.story = eventInput.story || existing.story; existing.title = eventInput.title || existing.title; existing.memoryWeight = eventInput.memoryWeight; existing.organizerVersion = eventInput.organizerVersion ?? existing.organizerVersion; existing.organizerRun = eventInput.organizerRun ?? existing.organizerRun; existing.organizationFingerprint = eventInput.organizationFingerprint ?? existing.organizationFingerprint; } else store.events.push({ ...eventInput, sourceIds: [...new Set(eventInput.sourceIds.length ? eventInput.sourceIds : sourceIds)] }); for (const source of store.rawSources) if (sourceIds.includes(source.id)) { source.status = "organized"; source.relatedLifeEventId = eventInput.id; } store.links.push(...links.filter((link) => !store.links.some((old) => old.rawSourceId === link.rawSourceId && old.lifeEventId === link.lifeEventId))); for (const media of store.media) if (eventInput.mediaIds.includes(media.id)) media.lifeEventId = eventInput.id; await writeStore(store); return existing ?? eventInput; },
    // Fingerprint-only identity, matching postgres-repository.persistDailyTrace(). The `(profileId,
    // day)` fallback is deliberately gone — see the comment there. The fingerprint check is also
    // guarded on the fingerprint being present, so a trace without one no longer matches the first
    // other trace that happens to have `organizationFingerprint === undefined`.
    async persistDailyTrace(trace: DailyTrace) { const store = await readStore(); const existing = trace.organizationFingerprint ? store.dailyTraces.find((item) => item.organizationFingerprint === trace.organizationFingerprint) : undefined; if (existing) { existing.entries = [...new Set([...existing.entries, ...trace.entries])]; existing.sourceIds = [...new Set([...existing.sourceIds, ...trace.sourceIds])]; existing.organizerRun = trace.organizerRun ?? existing.organizerRun; existing.organizationFingerprint = existing.organizationFingerprint ?? trace.organizationFingerprint; } else store.dailyTraces.push(trace); for (const source of store.rawSources) if (trace.sourceIds.includes(source.id)) { source.status = "organized"; source.relatedLifeEventId = undefined; } await writeStore(store); return existing ?? trace; },
    async persistCareEpisode(episode: CareEpisode) { const store = await readStore(); const existing = store.careEpisodes.find((item) => item.profileId === episode.profileId && item.startedAt.slice(0, 10) === episode.startedAt.slice(0, 10) && item.status === "open"); if (existing) { existing.sourceIds = [...new Set([...existing.sourceIds, ...episode.sourceIds])]; existing.organizerRun = episode.organizerRun ?? existing.organizerRun; } else store.careEpisodes.push(episode); for (const source of store.rawSources) if (episode.sourceIds.includes(source.id)) { source.status = "organized"; source.relatedLifeEventId = undefined; } await writeStore(store); return existing ?? episode; },
    // Identity is (targetKind, targetId, promptVersion), the PostgreSQL ledger's own unique key: a
    // repeat returns the stored row untouched instead of writing a second one or overwriting a
    // decision that may since have been revisited.
    async persistQualityReview(review: QualityReview) {
      return withStoreMutation((store) => {
        const existing = store.qualityReviews.find((item) => item.targetKind === review.targetKind && item.targetId === review.targetId && item.promptVersion === review.promptVersion);
        if (existing) return existing;
        store.qualityReviews.push({ ...review, decision: normalizeQualityDecision(review.decision) });
        return review;
      });
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
    async markSourcesOrganized(sourceIds: string[]) { const store = await readStore(); for (const source of store.rawSources) if (sourceIds.includes(source.id)) source.status = "organized"; await writeStore(store); },
    async markSourcesProcessing(sourceIds: string[]) { const store = await readStore(); for (const source of store.rawSources) if (sourceIds.includes(source.id) && source.status === "uploaded") source.status = "processing"; await writeStore(store); },
    async findOrganizerRun(organizationFingerprint: string) { const store = await readStore(); return store.organizerRuns.find((run) => run.organizationFingerprint === organizationFingerprint) ?? null; },
    async persistOrganizerRun(run: OrganizerRun) { const store = await readStore(); const existing = store.organizerRuns.find((item) => item.organizationFingerprint === run.organizationFingerprint); if (!existing) store.organizerRuns.push(run); await writeStore(store); return existing ?? run; },
    async undoOrganization(sourceIds: string[], eventId: string) { const store = await readStore(); const event = store.events.find((item) => item.id === eventId); if (!event) return; event.sourceIds = event.sourceIds.filter((id) => !sourceIds.includes(id)); event.mediaIds = event.mediaIds.filter((id) => !store.rawSources.find((source) => source.id === id)?.mediaIds.includes(id)); store.links = store.links.filter((link) => !(link.lifeEventId === eventId && sourceIds.includes(link.rawSourceId))); for (const source of store.rawSources) if (sourceIds.includes(source.id)) { source.status = "uploaded"; source.relatedLifeEventId = undefined; } for (const media of store.media) if (sourceIds.some((sourceId) => store.rawSources.find((source) => source.id === sourceId)?.mediaIds.includes(media.id))) media.lifeEventId = undefined; if (!event.sourceIds.length && event.id.startsWith("event-")) store.events = store.events.filter((item) => item.id !== eventId); await writeStore(store); },
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
