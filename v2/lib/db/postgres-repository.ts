import { and, eq, inArray } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import type { CareEpisode, DailyTrace, LifeEvent, Media, MediaAsset, MediaLocation, OrganizerRun, RawSource, SourceMemoryLink, ConnectorState } from "@/lib/types";
import { getDb } from "./client";
import * as t from "./schema";
import { newId } from "./repository-interface";
import type { Repository, Store } from "./repository-interface";

// tx.rollback() doesn't make db.transaction() resolve to whatever the callback returns after it —
// it makes the transaction's own promise reject with TransactionRollbackError. Every "rollback and
// report null" call site below has to catch that one error type and turn it back into a null
// return; any other error must keep propagating, matching this file's no-silent-fallback contract.
async function transactionOrNull<T>(run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof TransactionRollbackError) return null;
    throw err;
  }
}

// Real PostgreSQL, via drizzle-orm/node-postgres. Every method replicates the exact dedup /
// idempotency decision made by json-repository.ts for the same call — that behavioral parity,
// not raw SQL cleverness, is what test/repository-contract.test.mjs verifies against both
// backends. Never falls back to another backend on a query error: a failure here throws.
export function createPostgresRepository(env: NodeJS.ProcessEnv = process.env): Repository {
  const db = getDb(env);

  async function assembleStore(): Promise<Store> {
    const [profileRows, contributors, media, mediaAssets, mediaLocations, connectorStates, rawSources, events, dailyTraces, growthRecords, careRecords, careEpisodes, monthlyFocusGoals, organizerRuns, links, snapshotRows] = await Promise.all([
      db.select().from(t.profiles).limit(1),
      db.select().from(t.contributors),
      db.select().from(t.media),
      db.select().from(t.mediaAssets),
      db.select().from(t.mediaLocations),
      db.select().from(t.connectorStates),
      db.select().from(t.rawSources),
      db.select().from(t.lifeEvents),
      db.select().from(t.dailyTraces),
      db.select().from(t.growthRecords),
      db.select().from(t.careRecords),
      db.select().from(t.careEpisodes),
      db.select().from(t.monthlyFocusGoals),
      db.select().from(t.organizerRuns),
      db.select().from(t.sourceMemoryLinks),
      db.select().from(t.monthlySnapshot).limit(1),
    ]);
    if (!profileRows[0]) throw new Error("PostgreSQL repository: no profile row found. Run the JSON→Postgres migration first.");
    return {
      profile: profileRows[0] as Store["profile"],
      contributors: contributors as Store["contributors"],
      media: media as unknown as Store["media"],
      mediaAssets: mediaAssets as unknown as Store["mediaAssets"],
      mediaLocations: mediaLocations as unknown as Store["mediaLocations"],
      connectorStates: connectorStates as unknown as Store["connectorStates"],
      rawSources: rawSources as unknown as Store["rawSources"],
      events: events as unknown as Store["events"],
      dailyTraces: dailyTraces as unknown as Store["dailyTraces"],
      growthRecords: growthRecords as unknown as Store["growthRecords"],
      careRecords: careRecords as unknown as Store["careRecords"],
      careEpisodes: careEpisodes as unknown as Store["careEpisodes"],
      monthlyFocusGoals: monthlyFocusGoals as unknown as Store["monthlyFocusGoals"],
      organizerRuns: organizerRuns as unknown as Store["organizerRuns"],
      links: links as Store["links"],
      monthlySnapshot: (snapshotRows[0] ?? null) as Store["monthlySnapshot"],
    };
  }

  return {
    async getHomeEvents() {
      const rows = await db.select().from(t.lifeEvents);
      return (rows as unknown as LifeEvent[]).filter((event) => event.visibility !== "private").toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },
    async getAllEvents() {
      const rows = await db.select().from(t.lifeEvents);
      return (rows as unknown as LifeEvent[]).toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },
    async getStore() { return assembleStore(); },
    async getEventDetail(id: string) {
      const [event] = await db.select().from(t.lifeEvents).where(eq(t.lifeEvents.id, id));
      if (!event) return null;
      const e = event as unknown as LifeEvent;
      const [mediaRows, sourceRows, contributorRows, growthRows, careRows] = await Promise.all([
        db.select().from(t.media),
        db.select().from(t.rawSources),
        db.select().from(t.contributors),
        db.select().from(t.growthRecords),
        db.select().from(t.careRecords),
      ]);
      return {
        event: e,
        media: (mediaRows as unknown as Media[]).filter((item) => e.mediaIds.includes(item.id)),
        sources: (sourceRows as unknown as RawSource[]).filter((item) => e.sourceIds.includes(item.id) && !item.deletedAt),
        contributors: contributorRows as Store["contributors"],
        growth: (growthRows as unknown as Store["growthRecords"]).filter((item) => e.growthRecordIds.includes(item.id)),
        care: (careRows as unknown as Store["careRecords"]).filter((item) => e.careRecordIds.includes(item.id) && item.visibility !== "private"),
      };
    },
    async appendUpload(input: { source: RawSource; media: Media[]; assets?: MediaAsset[]; locations?: MediaLocation[] }) {
      await db.transaction(async (tx) => {
        await tx.insert(t.rawSources).values(input.source);
        if (input.media.length) await tx.insert(t.media).values(input.media);
        if (input.assets?.length) await tx.insert(t.mediaAssets).values(input.assets);
        if (input.locations?.length) await tx.insert(t.mediaLocations).values(input.locations);
      });
      return input.source;
    },
    async updateMediaAsset(id: string, patch: Partial<MediaAsset>) {
      // An empty patch is a legitimate no-op read in json-repository.ts (Object.assign(asset, {})
      // is a no-op) — mirror that instead of sending Postgres a SET clause with no columns, which
      // it rejects outright.
      if (Object.keys(patch).length === 0) {
        const [row] = await db.select().from(t.mediaAssets).where(eq(t.mediaAssets.id, id));
        return (row as unknown as MediaAsset) ?? null;
      }
      const rows = await db.update(t.mediaAssets).set(patch).where(eq(t.mediaAssets.id, id)).returning();
      return (rows[0] as unknown as MediaAsset) ?? null;
    },
    async updateMediaLocation(id: string, patch: Partial<MediaLocation>) {
      const rows = await db.update(t.mediaLocations).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(t.mediaLocations.id, id)).returning();
      return (rows[0] as unknown as MediaLocation) ?? null;
    },
    async removeMediaLocation(id: string) {
      await db.delete(t.mediaLocations).where(eq(t.mediaLocations.id, id));
    },
    async findMediaLocationByProviderRef(provider: MediaLocation["provider"], providerRef: string) {
      const [location] = await db.select().from(t.mediaLocations).where(and(eq(t.mediaLocations.provider, provider), eq(t.mediaLocations.providerRef, providerRef)));
      if (!location) return null;
      const [asset] = await db.select().from(t.mediaAssets).where(eq(t.mediaAssets.id, (location as unknown as MediaLocation).mediaAssetId));
      return { location: location as unknown as MediaLocation, asset: (asset as unknown as MediaAsset) ?? null };
    },
    async appendMediaAssetWithLocation(asset: MediaAsset, location: MediaLocation) {
      await db.transaction(async (tx) => {
        await tx.insert(t.mediaAssets).values(asset);
        await tx.insert(t.mediaLocations).values(location);
      });
      return { asset, location };
    },
    async updateMediaAssetWithLocation(assetId: string, locationId: string, assetPatch: Partial<MediaAsset>, locationPatch: Partial<MediaLocation>) {
      return transactionOrNull(() => db.transaction(async (tx) => {
        const assetRows = await tx.update(t.mediaAssets).set(assetPatch).where(eq(t.mediaAssets.id, assetId)).returning();
        const locationRows = await tx.update(t.mediaLocations).set({ ...locationPatch, updatedAt: new Date().toISOString() }).where(eq(t.mediaLocations.id, locationId)).returning();
        if (!assetRows[0] || !locationRows[0]) { tx.rollback(); }
        return { asset: assetRows[0] as unknown as MediaAsset, location: locationRows[0] as unknown as MediaLocation };
      }));
    },
    async getConnectorState(provider: "quark", profileId: string) {
      const [row] = await db.select().from(t.connectorStates).where(and(eq(t.connectorStates.provider, provider), eq(t.connectorStates.profileId, profileId)));
      return (row as unknown as ConnectorState) ?? null;
    },
    async upsertConnectorState(input: ConnectorState) {
      await db.insert(t.connectorStates).values(input).onConflictDoUpdate({ target: t.connectorStates.id, set: input });
      return input;
    },
    async markArchiveStatus(assetId: string, status: NonNullable<MediaAsset["archiveStatus"]>, error?: string) {
      return transactionOrNull(() => db.transaction(async (tx) => {
        const assetRows = await tx.update(t.mediaAssets).set({ archiveStatus: status, archiveLastError: error }).where(eq(t.mediaAssets.id, assetId)).returning();
        if (!assetRows[0]) { tx.rollback(); }
        if (status !== "archived") {
          const nextStatus = status === "paused_auth_required" ? "awaiting_archive" : status;
          await tx.update(t.mediaLocations).set({ status: nextStatus, updatedAt: new Date().toISOString() }).where(and(eq(t.mediaLocations.mediaAssetId, assetId), eq(t.mediaLocations.provider, "hot"), eq(t.mediaLocations.variant, "original")));
        }
        return assetRows[0] as unknown as MediaAsset;
      }));
    },
    async recordArchivedOriginal(input: { assetId: string; providerRef: string; path?: string; fileSize?: number; checksumVerified?: boolean }) {
      return transactionOrNull(() => db.transaction(async (tx) => {
        const [asset] = await tx.select().from(t.mediaAssets).where(eq(t.mediaAssets.id, input.assetId));
        if (!asset) { tx.rollback(); }
        const now = new Date().toISOString();
        const [existing] = await tx.select().from(t.mediaLocations).where(and(eq(t.mediaLocations.mediaAssetId, input.assetId), eq(t.mediaLocations.provider, "quark"), eq(t.mediaLocations.variant, "original")));
        const patch = { providerRef: input.providerRef, fileSize: input.fileSize, status: "archived", quarkPathSnapshot: input.path, updatedAt: now };
        let location: MediaLocation;
        if (existing) {
          const rows = await tx.update(t.mediaLocations).set(patch).where(eq(t.mediaLocations.id, (existing as unknown as MediaLocation).id)).returning();
          location = rows[0] as unknown as MediaLocation;
        } else {
          const rows = await tx.insert(t.mediaLocations).values({ id: newId("location"), mediaAssetId: input.assetId, provider: "quark", variant: "original", createdAt: now, ...patch }).returning();
          location = rows[0] as unknown as MediaLocation;
        }
        await tx.update(t.mediaAssets).set({ archiveStatus: "archived", archiveVerifiedAt: now, archiveLastError: null }).where(eq(t.mediaAssets.id, input.assetId));
        return location;
      }));
    },
    async persistOrganization(sourceIds: string[], eventInput: LifeEvent, links: SourceMemoryLink[]) {
      return db.transaction(async (tx) => {
        const [existing] = await tx.select().from(t.lifeEvents).where(eq(t.lifeEvents.id, eventInput.id));
        let result: LifeEvent;
        if (existing) {
          const e = existing as unknown as LifeEvent;
          const merged: Partial<LifeEvent> = {
            sourceIds: [...new Set([...e.sourceIds, ...sourceIds])],
            mediaIds: [...new Set([...e.mediaIds, ...eventInput.mediaIds])],
            contentTypes: [...new Set([...e.contentTypes, ...eventInput.contentTypes])],
            story: eventInput.story || e.story,
            title: eventInput.title || e.title,
            memoryWeight: eventInput.memoryWeight,
            organizerVersion: eventInput.organizerVersion ?? e.organizerVersion,
            organizerRun: eventInput.organizerRun ?? e.organizerRun,
            organizationFingerprint: eventInput.organizationFingerprint ?? e.organizationFingerprint,
          };
          const rows = await tx.update(t.lifeEvents).set(merged).where(eq(t.lifeEvents.id, eventInput.id)).returning();
          result = rows[0] as unknown as LifeEvent;
        } else {
          const toInsert = { ...eventInput, sourceIds: [...new Set(eventInput.sourceIds.length ? eventInput.sourceIds : sourceIds)] };
          const rows = await tx.insert(t.lifeEvents).values(toInsert).returning();
          result = rows[0] as unknown as LifeEvent;
        }
        await tx.update(t.rawSources).set({ status: "organized", relatedLifeEventId: eventInput.id }).where(inArray(t.rawSources.id, sourceIds));
        for (const link of links) {
          await tx.insert(t.sourceMemoryLinks).values(link).onConflictDoNothing({ target: [t.sourceMemoryLinks.rawSourceId, t.sourceMemoryLinks.lifeEventId] });
        }
        if (eventInput.mediaIds.length) await tx.update(t.media).set({ lifeEventId: eventInput.id }).where(inArray(t.media.id, eventInput.mediaIds));
        return result;
      });
    },
    async persistDailyTrace(trace: DailyTrace) {
      return db.transaction(async (tx) => {
        const byFingerprint = trace.organizationFingerprint ? (await tx.select().from(t.dailyTraces).where(eq(t.dailyTraces.organizationFingerprint, trace.organizationFingerprint)))[0] : undefined;
        const day = trace.occurredAt.slice(0, 10);
        const byDay = byFingerprint ?? (await tx.select().from(t.dailyTraces).where(eq(t.dailyTraces.profileId, trace.profileId))).find((row) => (row as unknown as DailyTrace).occurredAt.slice(0, 10) === day);
        let result: DailyTrace;
        if (byDay) {
          const existing = byDay as unknown as DailyTrace;
          const merged = {
            entries: [...new Set([...existing.entries, ...trace.entries])],
            sourceIds: [...new Set([...existing.sourceIds, ...trace.sourceIds])],
            organizerRun: trace.organizerRun ?? existing.organizerRun,
            organizationFingerprint: existing.organizationFingerprint ?? trace.organizationFingerprint,
            updatedAt: new Date().toISOString(),
          };
          const rows = await tx.update(t.dailyTraces).set(merged).where(eq(t.dailyTraces.id, existing.id)).returning();
          result = rows[0] as unknown as DailyTrace;
        } else {
          const rows = await tx.insert(t.dailyTraces).values(trace).returning();
          result = rows[0] as unknown as DailyTrace;
        }
        if (trace.sourceIds.length) await tx.update(t.rawSources).set({ status: "organized", relatedLifeEventId: null }).where(inArray(t.rawSources.id, trace.sourceIds));
        return result;
      });
    },
    async persistCareEpisode(episode: CareEpisode) {
      return db.transaction(async (tx) => {
        const day = episode.startedAt.slice(0, 10);
        const candidates = await tx.select().from(t.careEpisodes).where(and(eq(t.careEpisodes.profileId, episode.profileId), eq(t.careEpisodes.status, "open")));
        const existing = (candidates as unknown as CareEpisode[]).find((item) => item.startedAt.slice(0, 10) === day);
        let result: CareEpisode;
        if (existing) {
          const merged = { sourceIds: [...new Set([...existing.sourceIds, ...episode.sourceIds])], organizerRun: episode.organizerRun ?? existing.organizerRun, updatedAt: new Date().toISOString() };
          const rows = await tx.update(t.careEpisodes).set(merged).where(eq(t.careEpisodes.id, existing.id)).returning();
          result = rows[0] as unknown as CareEpisode;
        } else {
          const rows = await tx.insert(t.careEpisodes).values(episode).returning();
          result = rows[0] as unknown as CareEpisode;
        }
        if (episode.sourceIds.length) await tx.update(t.rawSources).set({ status: "organized", relatedLifeEventId: null }).where(inArray(t.rawSources.id, episode.sourceIds));
        return result;
      });
    },
    async markSourcesOrganized(sourceIds: string[]) {
      if (!sourceIds.length) return;
      await db.update(t.rawSources).set({ status: "organized" }).where(inArray(t.rawSources.id, sourceIds));
    },
    async markSourcesProcessing(sourceIds: string[]) {
      if (!sourceIds.length) return;
      await db.update(t.rawSources).set({ status: "processing" }).where(and(inArray(t.rawSources.id, sourceIds), eq(t.rawSources.status, "uploaded")));
    },
    async findOrganizerRun(organizationFingerprint: string) {
      const [row] = await db.select().from(t.organizerRuns).where(eq(t.organizerRuns.organizationFingerprint, organizationFingerprint));
      return (row as unknown as OrganizerRun) ?? null;
    },
    async persistOrganizerRun(run: OrganizerRun) {
      const [existing] = await db.select().from(t.organizerRuns).where(eq(t.organizerRuns.organizationFingerprint, run.organizationFingerprint));
      if (existing) return existing as unknown as OrganizerRun;
      const rows = await db.insert(t.organizerRuns).values(run).onConflictDoNothing({ target: t.organizerRuns.organizationFingerprint }).returning();
      if (rows[0]) return rows[0] as unknown as OrganizerRun;
      const [reread] = await db.select().from(t.organizerRuns).where(eq(t.organizerRuns.organizationFingerprint, run.organizationFingerprint));
      return reread as unknown as OrganizerRun;
    },
    async undoOrganization(sourceIds: string[], eventId: string) {
      await db.transaction(async (tx) => {
        const [event] = await tx.select().from(t.lifeEvents).where(eq(t.lifeEvents.id, eventId));
        if (!event) return;
        const e = event as unknown as LifeEvent;
        const sourceRows = await tx.select().from(t.rawSources).where(inArray(t.rawSources.id, sourceIds));
        const removedMediaIds = new Set((sourceRows as unknown as RawSource[]).flatMap((source) => source.mediaIds));
        const nextSourceIds = e.sourceIds.filter((id) => !sourceIds.includes(id));
        const nextMediaIds = e.mediaIds.filter((id) => !removedMediaIds.has(id));
        await tx.delete(t.sourceMemoryLinks).where(and(eq(t.sourceMemoryLinks.lifeEventId, eventId), inArray(t.sourceMemoryLinks.rawSourceId, sourceIds)));
        if (sourceIds.length) {
          await tx.update(t.rawSources).set({ status: "uploaded", relatedLifeEventId: null }).where(inArray(t.rawSources.id, sourceIds));
          const mediaIds = [...removedMediaIds];
          if (mediaIds.length) await tx.update(t.media).set({ lifeEventId: null }).where(inArray(t.media.id, mediaIds));
        }
        if (!nextSourceIds.length && eventId.startsWith("event-")) {
          await tx.delete(t.lifeEvents).where(eq(t.lifeEvents.id, eventId));
        } else {
          await tx.update(t.lifeEvents).set({ sourceIds: nextSourceIds, mediaIds: nextMediaIds }).where(eq(t.lifeEvents.id, eventId));
        }
      });
    },
  };
}
