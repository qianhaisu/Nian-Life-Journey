import { and, desc, eq, inArray } from "drizzle-orm";
import { TransactionRollbackError } from "drizzle-orm/errors";
import { sql } from "drizzle-orm";
import type { CareEpisode, ChatImportCheckpoint, ChatImportStage, ChatImportTask, ChatImportWarning, DailyTrace, LifeEvent, Media, MediaAsset, MediaLocation, MonthlySnapshot, OrganizerJob, OrganizerRun, RawSource, SourceMemoryLink, ConnectorState } from "@/lib/types";
import { getDb } from "./client";
import * as t from "./schema";
import { newId, organizerJobKey } from "./repository-interface";
import { CANONICAL_PROFILE_ID } from "./config";
import type { ChatImportTaskAcknowledgeInput, ChatImportTaskClaimInput, ChatImportTaskCompletionInput, ChatImportTaskCreateInput, ChatImportTaskFailureInput, ChatImportTaskLeaseInput, ChatImportTaskListFilter, ChatImportTaskWarningsInput, OrganizerWindowInput, Repository, Store, UploadPersistInput, UploadPersistResult } from "./repository-interface";
import { normalizeSha256 } from "./chat-import-persistence";
import { indexReviews, isEventPublishable, isTracePublishable, normalizeQualityDecision, type QualityReview } from "@/lib/organizer/quality-review";
import { ChatImportStateError, acknowledgeChatImportCancel, claimChatImportTask, completeChatImportTask, completeChatImportWithWarnings, createChatImportTask, failChatImportTask, heartbeatChatImportTask, listChatImportTasks, requestChatImportCancel, retryChatImportTask, saveChatImportCheckpoint } from "./chat-import-state";

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

// Postgres unique_violation. Narrow on the SQLSTATE only: the driver's message text is not a
// contract, and matching on it would silently stop working after a driver upgrade.
//
// Drizzle wraps a driver error in DrizzleQueryError and puts the pg error on `cause`, so the code
// is NOT on the object thrown to us. Walking the cause chain is what makes this actually fire —
// checking only the top-level `code` looks right and silently never matches.
function isUniqueViolation(error: unknown): boolean {
  for (let current: unknown = error, depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function taskFromRow(row: Record<string, unknown>): ChatImportTask {
  const timestamp = (value: unknown) => {
    if (value === null || value === undefined) return undefined;
    const text = value instanceof Date ? value.toISOString() : String(value);
    const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text.replace(" ", "T")}Z`;
    const parsed = Date.parse(withTimezone);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : text;
  };
  let checkpoint: ChatImportCheckpoint | undefined;
  if (typeof row.checkpoint === "string" && row.checkpoint) {
    try { checkpoint = JSON.parse(row.checkpoint) as ChatImportCheckpoint; } catch { checkpoint = undefined; }
  } else if (row.checkpoint && typeof row.checkpoint === "object") checkpoint = row.checkpoint as ChatImportCheckpoint;
  const currentStage = (row.currentStage ?? row.phase) as ChatImportStage;
  return { ...(row as unknown as ChatImportTask), phase: currentStage, currentStage, warningCounts: (Array.isArray(row.warningCounts) ? row.warningCounts : []) as ChatImportWarning[], attempt: Number(row.attempt ?? 0), maxAttempts: Number(row.maxAttempts ?? 3), checkpoint, leaseExpiresAt: timestamp(row.leaseExpiresAt), cancelRequestedAt: timestamp(row.cancelRequestedAt), startedAt: timestamp(row.startedAt), completedAt: timestamp(row.completedAt), createdAt: timestamp(row.createdAt) ?? String(row.createdAt), updatedAt: timestamp(row.updatedAt) ?? String(row.updatedAt) };
}

function taskRowValues(task: ChatImportTask) {
  return { status: task.status, phase: task.phase, currentStage: task.currentStage, processedMessages: task.processedMessages, createdMessages: task.createdMessages, reusedMessages: task.reusedMessages, warnings: task.warnings, warningCounts: task.warningCounts, checkpoint: task.checkpoint ? JSON.stringify(task.checkpoint) : null, leaseOwner: task.leaseOwner ?? null, leaseExpiresAt: task.leaseExpiresAt ?? null, attempt: task.attempt, maxAttempts: task.maxAttempts, cancelRequestedAt: task.cancelRequestedAt ?? null, startedAt: task.startedAt ?? null, completedAt: task.completedAt ?? null, safeErrorCode: task.safeErrorCode ?? null, updatedAt: task.updatedAt };
}

// Real PostgreSQL, via drizzle-orm/node-postgres. Every method replicates the exact dedup /
// idempotency decision made by json-repository.ts for the same call — that behavioral parity,
// not raw SQL cleverness, is what test/repository-contract.test.mjs verifies against both
// backends. Never falls back to another backend on a query error: a failure here throws.
export function createPostgresRepository(env: NodeJS.ProcessEnv = process.env): Repository {
  const db = getDb(env);

  async function persistUpload(input: UploadPersistInput): Promise<UploadPersistResult> {
    return db.transaction(async (tx) => {
      const [sourceIdRow] = await tx.select().from(t.rawSources).where(eq(t.rawSources.id, input.source.id));
      if (sourceIdRow && input.source.provider && input.source.providerExternalId && (sourceIdRow.provider !== input.source.provider || sourceIdRow.providerExternalId !== input.source.providerExternalId)) throw new Error("RAW_SOURCE_ID_CONFLICT");
      const sourceRows = input.source.provider && input.source.providerExternalId
        ? await tx.insert(t.rawSources).values(input.source as any).onConflictDoNothing({ target: [t.rawSources.provider, t.rawSources.providerExternalId] }).returning()
        : await tx.insert(t.rawSources).values(input.source as any).onConflictDoNothing({ target: t.rawSources.id }).returning();
      let sourceRow = sourceRows[0];
      let sourceCreated = Boolean(sourceRow);
      if (!sourceRow) {
        const existingRows = input.source.provider && input.source.providerExternalId
          ? await tx.select().from(t.rawSources).where(and(eq(t.rawSources.provider, input.source.provider), eq(t.rawSources.providerExternalId, input.source.providerExternalId)))
          : await tx.select().from(t.rawSources).where(eq(t.rawSources.id, input.source.id));
        sourceRow = existingRows[0];
        if (!sourceRow) throw new Error("RAW_SOURCE_CONFLICT");
        sourceCreated = false;
      }

      const assetsByInputId = new Map<string, MediaAsset>();
      const createdAssetIds: string[] = [];
      const reusedAssetIds: string[] = [];
      for (const assetInput of input.assets ?? []) {
        const asset = { ...assetInput, checksum: normalizeSha256(assetInput.checksum) };
        const [assetIdRow] = await tx.select().from(t.mediaAssets).where(eq(t.mediaAssets.id, asset.id));
        const [assetChecksumRow] = asset.checksum ? await tx.select().from(t.mediaAssets).where(eq(t.mediaAssets.checksum, asset.checksum)) : [undefined];
        if (assetIdRow && assetChecksumRow && assetIdRow.id !== assetChecksumRow.id) throw new Error("MEDIA_ASSET_ID_CONFLICT");
        if (assetIdRow && asset.checksum && normalizeSha256(assetIdRow.checksum) !== asset.checksum) throw new Error("MEDIA_ASSET_ID_CONFLICT");
        const assetRows = asset.checksum
          ? await tx.insert(t.mediaAssets).values(asset as any).onConflictDoNothing({ target: t.mediaAssets.checksum }).returning()
          : await tx.insert(t.mediaAssets).values(asset as any).onConflictDoNothing({ target: t.mediaAssets.id }).returning();
        let actual = assetRows[0] as unknown as MediaAsset | undefined;
        if (!actual) {
          const existingRows = asset.checksum
            ? await tx.select().from(t.mediaAssets).where(eq(t.mediaAssets.checksum, asset.checksum))
            : await tx.select().from(t.mediaAssets).where(eq(t.mediaAssets.id, asset.id));
          actual = existingRows[0] as unknown as MediaAsset | undefined;
        }
        if (!actual) throw new Error("MEDIA_ASSET_CONFLICT");
        assetsByInputId.set(asset.id, actual);
        if (assetRows[0]) createdAssetIds.push(actual.id);
        else reusedAssetIds.push(actual.id);
      }

      const mediaIds: string[] = [];
      for (const mediaInput of input.media) {
        const mappedAsset = mediaInput.mediaAssetId ? assetsByInputId.get(mediaInput.mediaAssetId) : undefined;
        const media = mappedAsset && mappedAsset.id !== mediaInput.mediaAssetId ? { ...mediaInput, mediaAssetId: mappedAsset.id } : mediaInput;
        const mediaRows = await tx.insert(t.media).values(media as any).onConflictDoNothing({ target: t.media.id }).returning();
        if (!mediaRows[0]) {
          const [existing] = await tx.select().from(t.media).where(eq(t.media.id, media.id));
          if (!existing || (existing as unknown as Media).mediaAssetId !== media.mediaAssetId) throw new Error("MEDIA_ID_CONFLICT");
        }
        mediaIds.push(media.id);
      }

      const createdLocationIds: string[] = [];
      const reusedLocationIds: string[] = [];
      for (const locationInput of input.locations ?? []) {
        const mappedAsset = assetsByInputId.get(locationInput.mediaAssetId);
        const location = mappedAsset && mappedAsset.id !== locationInput.mediaAssetId ? { ...locationInput, mediaAssetId: mappedAsset.id } : locationInput;
        const [locationIdRow] = await tx.select().from(t.mediaLocations).where(eq(t.mediaLocations.id, location.id));
        if (locationIdRow && (locationIdRow.provider !== location.provider || locationIdRow.providerRef !== location.providerRef)) throw new Error("MEDIA_LOCATION_ID_CONFLICT");
        const locationRows = await tx.insert(t.mediaLocations).values(location as any).onConflictDoNothing({ target: [t.mediaLocations.provider, t.mediaLocations.providerRef] }).returning();
        if (locationRows[0]) {
          createdLocationIds.push(locationRows[0].id);
          continue;
        }
        const existingRows = await tx.select().from(t.mediaLocations).where(and(eq(t.mediaLocations.provider, location.provider), eq(t.mediaLocations.providerRef, location.providerRef)));
        const existing = existingRows[0];
        if (!existing || existing.mediaAssetId !== location.mediaAssetId || existing.variant !== location.variant) throw new Error("MEDIA_LOCATION_CONFLICT");
        reusedLocationIds.push(existing.id);
      }
      return { source: sourceRow as unknown as RawSource, sourceCreated, createdAssetIds, reusedAssetIds, createdLocationIds, reusedLocationIds, mediaIds: (sourceRow as unknown as RawSource).mediaIds.slice() };
    });
  }

  // Bulk equivalent of persistUpload: one transaction for the whole batch, bulk multi-row
  // INSERT ... ON CONFLICT ... RETURNING per table instead of one transaction (and several selects)
  // per item — this is the change that actually reduces round trips (see the wechat-worker.ts
  // batch loop). Requires every item's source to carry provider+providerExternalId, which every
  // WeChat message does; anything else is out of scope for this method (persistUpload still
  // handles the general case one item at a time).
  async function persistChatImportBatch(inputs: UploadPersistInput[]): Promise<{ items: UploadPersistResult[] }> {
    if (!inputs.length) return { items: [] };
    return db.transaction(async (tx) => {
      for (const input of inputs) {
        if (!input.source.provider || !input.source.providerExternalId) throw new Error("CHAT_IMPORT_BATCH_REQUIRES_PROVIDER_IDENTITY");
      }

      // --- RawSource: dedupe by (provider, providerExternalId), first occurrence in input order wins ---
      const sourceKey = (s: { provider?: string; providerExternalId?: string }) => `${s.provider} ${s.providerExternalId}`;
      const sourceByKey = new Map<string, RawSource>();
      for (const input of inputs) if (!sourceByKey.has(sourceKey(input.source))) sourceByKey.set(sourceKey(input.source), input.source);
      const sourceInputs = [...sourceByKey.values()];
      const insertedSourceRows = (await tx.insert(t.rawSources).values(sourceInputs as any).onConflictDoNothing({ target: [t.rawSources.provider, t.rawSources.providerExternalId] }).returning()) as unknown as RawSource[];
      const insertedSourceByKey = new Map(insertedSourceRows.map((row) => [sourceKey(row), row] as const));
      const missingSourceInputs = sourceInputs.filter((s) => !insertedSourceByKey.has(sourceKey(s)));
      const existingSourceRows = missingSourceInputs.length
        ? (await tx.select().from(t.rawSources).where(inArray(t.rawSources.providerExternalId, missingSourceInputs.map((s) => s.providerExternalId!)))) as unknown as RawSource[]
        : [];
      const sourceRowByKey = new Map<string, { row: RawSource; created: boolean }>();
      for (const [key, row] of insertedSourceByKey) sourceRowByKey.set(key, { row, created: true });
      for (const row of existingSourceRows) if (!sourceRowByKey.has(sourceKey(row))) sourceRowByKey.set(sourceKey(row), { row, created: false });
      for (const key of sourceByKey.keys()) if (!sourceRowByKey.has(key)) throw new Error("RAW_SOURCE_CONFLICT");

      // --- MediaAsset: dedupe by normalized checksum (our callers derive the id from the checksum,
      // so a checksum collision within the batch is always the same logical asset) ---
      const allAssetInputs = inputs.flatMap((i) => i.assets ?? []).map((a) => ({ ...a, checksum: normalizeSha256(a.checksum) }));
      const assetKey = (a: { checksum?: string | null; id: string }) => a.checksum ?? `id:${a.id}`;
      const assetByKey = new Map<string, MediaAsset>();
      for (const asset of allAssetInputs) if (!assetByKey.has(assetKey(asset))) assetByKey.set(assetKey(asset), asset as MediaAsset);
      const assetInputs = [...assetByKey.values()];
      const assetsWithChecksum = assetInputs.filter((a) => a.checksum);
      const assetsWithoutChecksum = assetInputs.filter((a) => !a.checksum);
      const insertedAssetRows: MediaAsset[] = [];
      if (assetsWithChecksum.length) insertedAssetRows.push(...((await tx.insert(t.mediaAssets).values(assetsWithChecksum as any).onConflictDoNothing({ target: t.mediaAssets.checksum }).returning()) as unknown as MediaAsset[]));
      if (assetsWithoutChecksum.length) insertedAssetRows.push(...((await tx.insert(t.mediaAssets).values(assetsWithoutChecksum as any).onConflictDoNothing({ target: t.mediaAssets.id }).returning()) as unknown as MediaAsset[]));
      const insertedAssetByKey = new Map(insertedAssetRows.map((row) => [assetKey({ checksum: normalizeSha256(row.checksum), id: row.id }), row] as const));
      const missingAssetInputs = assetInputs.filter((a) => !insertedAssetByKey.has(assetKey(a)));
      const missingChecksums = missingAssetInputs.filter((a) => a.checksum).map((a) => a.checksum!);
      const missingAssetIds = missingAssetInputs.filter((a) => !a.checksum).map((a) => a.id);
      const existingAssetRows: MediaAsset[] = [];
      if (missingChecksums.length) existingAssetRows.push(...((await tx.select().from(t.mediaAssets).where(inArray(t.mediaAssets.checksum, missingChecksums))) as unknown as MediaAsset[]));
      if (missingAssetIds.length) existingAssetRows.push(...((await tx.select().from(t.mediaAssets).where(inArray(t.mediaAssets.id, missingAssetIds))) as unknown as MediaAsset[]));
      const assetRowByKey = new Map<string, { row: MediaAsset; created: boolean }>();
      for (const [key, row] of insertedAssetByKey) assetRowByKey.set(key, { row, created: true });
      for (const row of existingAssetRows) { const key = assetKey({ checksum: normalizeSha256(row.checksum), id: row.id }); if (!assetRowByKey.has(key)) assetRowByKey.set(key, { row, created: false }); }
      for (const key of assetByKey.keys()) if (!assetRowByKey.has(key)) throw new Error("MEDIA_ASSET_CONFLICT");
      // input asset.id -> resolved actual row, so `media`/`locations` referencing mediaAssetId by the
      // input's own id can be remapped exactly like persistUpload does for a single item.
      const assetsByInputId = new Map<string, MediaAsset>();
      for (const asset of allAssetInputs) { const resolved = assetRowByKey.get(assetKey(asset)); if (resolved) assetsByInputId.set(asset.id, resolved.row); }

      // --- Media (display layer): dedupe by id ---
      const allMediaInputs = inputs.flatMap((i) => i.media).map((m) => {
        const resolved = m.mediaAssetId ? assetsByInputId.get(m.mediaAssetId) : undefined;
        return resolved && resolved.id !== m.mediaAssetId ? { ...m, mediaAssetId: resolved.id } : m;
      });
      const mediaByKey = new Map<string, Media>();
      for (const media of allMediaInputs) if (!mediaByKey.has(media.id)) mediaByKey.set(media.id, media);
      const mediaInputs = [...mediaByKey.values()];
      const insertedMediaRows = mediaInputs.length ? ((await tx.insert(t.media).values(mediaInputs as any).onConflictDoNothing({ target: t.media.id }).returning()) as unknown as Media[]) : [];
      const insertedMediaIds = new Set(insertedMediaRows.map((r) => r.id));
      const missingMediaIds = mediaInputs.filter((m) => !insertedMediaIds.has(m.id)).map((m) => m.id);
      const existingMediaRows = missingMediaIds.length ? ((await tx.select().from(t.media).where(inArray(t.media.id, missingMediaIds))) as unknown as Media[]) : [];
      for (const m of mediaInputs) {
        if (insertedMediaIds.has(m.id)) continue;
        const existing = existingMediaRows.find((e) => e.id === m.id);
        if (!existing || existing.mediaAssetId !== m.mediaAssetId) throw new Error("MEDIA_ID_CONFLICT");
      }

      // --- MediaLocation: dedupe by (provider, providerRef) ---
      const locationKey = (l: { provider: string; providerRef: string }) => `${l.provider} ${l.providerRef}`;
      const allLocationInputs = inputs.flatMap((i) => i.locations ?? []).map((l) => {
        const resolved = assetsByInputId.get(l.mediaAssetId);
        return resolved && resolved.id !== l.mediaAssetId ? { ...l, mediaAssetId: resolved.id } : l;
      });
      const locationByKey = new Map<string, MediaLocation>();
      for (const location of allLocationInputs) if (!locationByKey.has(locationKey(location))) locationByKey.set(locationKey(location), location);
      const locationInputs = [...locationByKey.values()];
      const insertedLocationRows = locationInputs.length ? ((await tx.insert(t.mediaLocations).values(locationInputs as any).onConflictDoNothing({ target: [t.mediaLocations.provider, t.mediaLocations.providerRef] }).returning()) as unknown as MediaLocation[]) : [];
      const insertedLocationByKey = new Map(insertedLocationRows.map((row) => [locationKey(row), row] as const));
      const missingLocationInputs = locationInputs.filter((l) => !insertedLocationByKey.has(locationKey(l)));
      const existingLocationRows = missingLocationInputs.length
        ? ((await tx.select().from(t.mediaLocations).where(inArray(t.mediaLocations.providerRef, missingLocationInputs.map((l) => l.providerRef)))) as unknown as MediaLocation[])
        : [];
      const locationRowByKey = new Map<string, { row: MediaLocation; created: boolean }>();
      for (const [key, row] of insertedLocationByKey) locationRowByKey.set(key, { row, created: true });
      for (const row of existingLocationRows) { const key = locationKey(row); if (!locationRowByKey.has(key)) locationRowByKey.set(key, { row, created: false }); }
      for (const location of locationInputs) {
        const resolved = locationRowByKey.get(locationKey(location));
        if (!resolved) throw new Error("MEDIA_LOCATION_CONFLICT");
        if (!resolved.created && (resolved.row.mediaAssetId !== location.mediaAssetId || resolved.row.variant !== location.variant)) throw new Error("MEDIA_LOCATION_CONFLICT");
      }

      // --- Assemble per-item results in original order. A canonical identity that repeats within
      // the batch (same checksum/providerRef/providerExternalId in two items) must attribute
      // "created" to only the first occurrence — matching what two sequential persistChatImportMessage
      // calls would report — so the worker's cumulative created/reused counters never double-count. ---
      const claimedSourceCreated = new Set<string>();
      const claimedAssetCreated = new Set<string>();
      const claimedLocationCreated = new Set<string>();
      const items: UploadPersistResult[] = inputs.map((input) => {
        const sKey = sourceKey(input.source);
        const sourceResolved = sourceRowByKey.get(sKey)!;
        const sourceCreatedForItem = sourceResolved.created && !claimedSourceCreated.has(sKey);
        if (sourceResolved.created) claimedSourceCreated.add(sKey);

        const createdAssetIds: string[] = [];
        const reusedAssetIds: string[] = [];
        for (const raw of input.assets ?? []) {
          const key = assetKey({ checksum: normalizeSha256(raw.checksum), id: raw.id });
          const resolved = assetRowByKey.get(key);
          if (!resolved) continue;
          const createdForItem = resolved.created && !claimedAssetCreated.has(key);
          if (resolved.created) claimedAssetCreated.add(key);
          (createdForItem ? createdAssetIds : reusedAssetIds).push(resolved.row.id);
        }

        const createdLocationIds: string[] = [];
        const reusedLocationIds: string[] = [];
        for (const raw of input.locations ?? []) {
          const resolvedAsset = assetsByInputId.get(raw.mediaAssetId);
          const loc = resolvedAsset && resolvedAsset.id !== raw.mediaAssetId ? { ...raw, mediaAssetId: resolvedAsset.id } : raw;
          const key = locationKey(loc);
          const resolved = locationRowByKey.get(key);
          if (!resolved) continue;
          const createdForItem = resolved.created && !claimedLocationCreated.has(key);
          if (resolved.created) claimedLocationCreated.add(key);
          (createdForItem ? createdLocationIds : reusedLocationIds).push(resolved.row.id);
        }

        return { source: sourceResolved.row, sourceCreated: sourceCreatedForItem, createdAssetIds, reusedAssetIds, createdLocationIds, reusedLocationIds, mediaIds: sourceResolved.row.mediaIds.slice() };
      });
      return { items };
    });
  }

  // See the Repository interface doc comment: scoped columns + a profile_id filter instead of
  // getStore()'s unfiltered select() across every table. An empty array/placeholder for every
  // Store field the Organizer doesn't read keeps this a real (if partial) Store — callers outside
  // the Organizer's own read path must use getStore() instead, not this.
  async function assembleOrganizerStore(profileId: string): Promise<Store> {
    const [profileRows, contributors, rawSources, media, mediaAssets, events] = await Promise.all([
      db.select({ id: t.profiles.id, displayName: t.profiles.displayName, birthDate: t.profiles.birthDate, timezone: t.profiles.timezone, bio: t.profiles.bio, visibility: t.profiles.visibility }).from(t.profiles).where(eq(t.profiles.id, profileId)).limit(1),
      db.select({ id: t.contributors.id, profileId: t.contributors.profileId, role: t.contributors.role, displayName: t.contributors.displayName }).from(t.contributors).where(eq(t.contributors.profileId, profileId)),
      db.select({ id: t.rawSources.id, profileId: t.rawSources.profileId, sourceType: t.rawSources.sourceType, contentTypes: t.rawSources.contentTypes, contributorId: t.rawSources.contributorId, capturedAt: t.rawSources.capturedAt, text: t.rawSources.text, mediaIds: t.rawSources.mediaIds, sourceLabel: t.rawSources.sourceLabel, visibility: t.rawSources.visibility, deletedAt: t.rawSources.deletedAt }).from(t.rawSources).where(eq(t.rawSources.profileId, profileId)),
      db.select({ id: t.media.id, mediaAssetId: t.media.mediaAssetId }).from(t.media).where(eq(t.media.profileId, profileId)),
      db.select({ id: t.mediaAssets.id, checksum: t.mediaAssets.checksum }).from(t.mediaAssets).where(eq(t.mediaAssets.profileId, profileId)),
      db.select({ id: t.lifeEvents.id, profileId: t.lifeEvents.profileId, occurredAt: t.lifeEvents.occurredAt, visibility: t.lifeEvents.visibility, contentTypes: t.lifeEvents.contentTypes, title: t.lifeEvents.title, story: t.lifeEvents.story, mediaIds: t.lifeEvents.mediaIds, sourceIds: t.lifeEvents.sourceIds }).from(t.lifeEvents).where(eq(t.lifeEvents.profileId, profileId)),
    ]);
    if (!profileRows[0]) throw new Error("PostgreSQL repository: no profile row found for getOrganizerStore.");
    return {
      profile: profileRows[0] as unknown as Store["profile"],
      contributors: contributors as unknown as Store["contributors"],
      rawSources: rawSources as unknown as Store["rawSources"],
      media: media as unknown as Store["media"],
      mediaAssets: mediaAssets as unknown as Store["mediaAssets"],
      events: events as unknown as Store["events"],
      mediaLocations: [], connectorStates: [], dailyTraces: [], growthRecords: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [], qualityReviews: [],
      monthlySnapshots: [],
    };
  }

  // One job's evidence, read by id. Four small keyed selects instead of a whole-profile (or
  // whole-database) load — the V2 organizer runs inside a queue worker with a request budget, so
  // its read has to be proportional to the job rather than to the archive.
  async function assembleOrganizerWindowInput(sourceIds: string[]): Promise<OrganizerWindowInput> {
    if (!sourceIds.length) throw new Error("PostgreSQL repository: getOrganizerWindowInput needs at least one source id.");
    const sources = (await db.select().from(t.rawSources).where(inArray(t.rawSources.id, sourceIds))) as unknown as RawSource[];
    const live = sources.filter((source) => !source.deletedAt);
    const profileIds = [...new Set(live.map((source) => source.profileId))];
    if (profileIds.length > 1) throw new Error(`PostgreSQL repository: getOrganizerWindowInput spans ${profileIds.length} profiles; one job is one profile's evidence.`);
    const [profileRow] = profileIds.length ? await db.select().from(t.profiles).where(eq(t.profiles.id, profileIds[0])).limit(1) : [];
    const mediaIds = [...new Set(live.flatMap((source) => source.mediaIds))];
    const media = mediaIds.length ? ((await db.select().from(t.media).where(inArray(t.media.id, mediaIds))) as unknown as Media[]) : [];
    const assetIds = [...new Set(media.map((item) => item.mediaAssetId).filter((id): id is string => Boolean(id)))];
    const mediaAssets = assetIds.length ? ((await db.select().from(t.mediaAssets).where(inArray(t.mediaAssets.id, assetIds))) as unknown as MediaAsset[]) : [];
    const mediaLocations = assetIds.length ? ((await db.select().from(t.mediaLocations).where(inArray(t.mediaLocations.mediaAssetId, assetIds))) as unknown as MediaLocation[]) : [];
    return { profile: (profileRow as unknown as Store["profile"]) ?? null, sources: live, media, mediaAssets, mediaLocations };
  }

  // The profile row is pinned by id — never `profiles limit 1`, which once handed a stranded
  // contract-test profile (born 2020) to the whole site as 张年. The collections stay the full
  // backend view (Organizer, archive and ingest pipelines read them by source/asset id); pages
  // narrow them to the profile with scopeStoreToProfile.
  async function assembleStore(): Promise<Store> {
    // P1-5: scoped read — the rendering path never touches rawSources.text (the single heaviest
    // column at 44k rows of chat messages) and never reads pipeline-only tables (organizerRuns,
    // organizerJobs, chatImportTasks, connectorStates). Dropping them cuts the query payload from
    // ~120 MB to ~5 MB and eliminates the >30 s archive-expander timeouts.
    const [profileRows, contributors, media, mediaAssets, mediaLocations, rawSources, events, dailyTraces, growthRecords, careRecords, careEpisodes, monthlyFocusGoals, links, qualityReviewRows, snapshotRows] = await Promise.all([
      db.select().from(t.profiles).where(eq(t.profiles.id, CANONICAL_PROFILE_ID)).limit(1),
      db.select().from(t.contributors),
      db.select().from(t.media),
      db.select().from(t.mediaAssets),
      db.select().from(t.mediaLocations),
      // Only the columns composeFamilyArchive actually reads: mediaPrivilegeOf needs id +
      // sourceType + sourceLabel; latestActivityDay needs capturedAt + deletedAt;
      // scopeStoreToProfile needs profileId. The `text` column (chat message bodies) is the
      // single largest contributor to payload and is never read by any page.
      db.select({ id: t.rawSources.id, profileId: t.rawSources.profileId, contributorId: t.rawSources.contributorId, sourceType: t.rawSources.sourceType, contentTypes: t.rawSources.contentTypes, capturedAt: t.rawSources.capturedAt, mediaIds: t.rawSources.mediaIds, sourceLabel: t.rawSources.sourceLabel, visibility: t.rawSources.visibility, deletedAt: t.rawSources.deletedAt }).from(t.rawSources),
      db.select().from(t.lifeEvents),
      db.select().from(t.dailyTraces),
      db.select().from(t.growthRecords),
      db.select().from(t.careRecords),
      db.select().from(t.careEpisodes),
      db.select().from(t.monthlyFocusGoals),
      db.select().from(t.sourceMemoryLinks),
      db.select().from(t.contentQualityReviews),
      // T20-B: every month's own snapshot, not just the newest — a month page needs its own.
      db.select().from(t.monthlySnapshot).where(eq(t.monthlySnapshot.profileId, CANONICAL_PROFILE_ID)),
    ]);
    if (!profileRows[0]) throw new Error(`PostgreSQL repository: no profile row "${CANONICAL_PROFILE_ID}" found. Run the JSON→Postgres migration first.`);
    // Same publication gate as getHomeEvents/getAllEvents: the store feeds the memory timeline and
    // the homepage canvas, so unreviewed rule-derived artifacts must not reach it either.
    const reviews = await reviewIndex();
    const publishableEvents = (events as unknown as LifeEvent[]).filter((event) => isEventPublishable(event, reviews));
    const publishableTraces = (dailyTraces as unknown as DailyTrace[]).filter((trace) => isTracePublishable(trace, reviews));
    return {
      profile: profileRows[0] as Store["profile"],
      contributors: contributors as Store["contributors"],
      media: media as unknown as Store["media"],
      mediaAssets: mediaAssets as unknown as Store["mediaAssets"],
      mediaLocations: mediaLocations as unknown as Store["mediaLocations"],
      connectorStates: [],
      rawSources: rawSources as unknown as Store["rawSources"],
      events: publishableEvents as unknown as Store["events"],
      dailyTraces: publishableTraces as unknown as Store["dailyTraces"],
      growthRecords: growthRecords as unknown as Store["growthRecords"],
      careRecords: careRecords as unknown as Store["careRecords"],
      careEpisodes: careEpisodes as unknown as Store["careEpisodes"],
      monthlyFocusGoals: monthlyFocusGoals as unknown as Store["monthlyFocusGoals"],
      organizerRuns: [],
      organizerJobs: [],
      chatImportTasks: [],
      links: links as Store["links"],
      qualityReviews: qualityReviewRows.map((row) => reviewFromRow(row as unknown as Record<string, unknown>)),
      monthlySnapshots: snapshotRows as unknown as Store["monthlySnapshots"],
    };
  }

  async function lockTask(tx: any, taskId: string) {
    const locked = await tx.execute(sql`select id from chat_import_tasks where id = ${taskId} for update`);
    const id = (locked.rows[0] as { id?: string } | undefined)?.id;
    if (!id) return null;
    const [row] = await tx.select().from(t.chatImportTasks).where(eq(t.chatImportTasks.id, id));
    return row ? taskFromRow(row as unknown as Record<string, unknown>) : null;
  }

  async function storeTask(tx: any, task: ChatImportTask) {
    const rows = await tx.update(t.chatImportTasks).set(taskRowValues(task) as any).where(eq(t.chatImportTasks.id, task.id)).returning();
    return rows[0] ? taskFromRow(rows[0] as unknown as Record<string, unknown>) : null;
  }

  // The quality ledger is small (one row per reviewed artifact) and read alongside every event
  // listing, so it is fetched whole rather than joined per row.
  async function reviewIndex() {
    const rows = await db.select().from(t.contentQualityReviews);
    return indexReviews(rows as unknown as Array<Omit<QualityReview, "decision"> & { decision: unknown }>);
  }
  // `decision` is a text column, so what comes back is interpreted through the one canonical
  // mapping (normalizeQualityDecision) rather than cast and believed.
  const reviewFromRow = (row: Record<string, unknown>): QualityReview => ({ ...(row as unknown as QualityReview), decision: normalizeQualityDecision(row.decision) });
  // Page-facing event listings belong to the canonical profile only.
  const canonicalEvents = () => db.select().from(t.lifeEvents).where(eq(t.lifeEvents.profileId, CANONICAL_PROFILE_ID));

  // The single-attempt body of persistDailyTrace. Extracted so the 23505 retry can re-enter it
  // with a FRESH transaction; see persistDailyTrace for why retrying inside the aborted one cannot
  // work.
  const persistDailyTraceOnce = (trace: DailyTrace): Promise<DailyTrace> =>
    db.transaction(async (tx) => {
        // Fingerprint is the whole identity. There used to be a `(profileId, day)` fallback here,
        // and it was a cutover blocker: every day the evidence organizer will ever write already
        // holds a rule-derived trace, so the fallback made a new artifact adopt the legacy row —
        // inheriting its id, its ledger binding and therefore its publication state, while
        // `organizerRun` was overwritten with the incoming run. Because requiresQualityReview()
        // reads `organizerRun.organizerType`, that overwrite also flipped the legacy row from
        // rule-derived (fail closed) to AI-derived (fail open): of 171 production traces, 101 are
        // hidden only by that check and would have published themselves on merge, and 33 approved
        // rows would have absorbed unreviewed entries. Same evidence → same fingerprint → same
        // artifact; different evidence → a separate artifact, grouped with it only for display.
        // FOR UPDATE, because the merge below is a read-modify-write on `entries` and `sourceIds`.
        // The unique index alone does not make that safe: it stops a duplicate ROW, but two callers
        // that both find the existing row would both read the same arrays, both compute a union
        // missing the other's contribution, and the last UPDATE would silently drop an entry. A
        // five-writer race reproduced exactly that. The lock serialises the mergers, so each one
        // reads what the previous committed.
        const existing = trace.organizationFingerprint
          ? ((await tx.select().from(t.dailyTraces).where(eq(t.dailyTraces.organizationFingerprint, trace.organizationFingerprint)).for("update"))[0] as unknown as DailyTrace | undefined)
          : undefined;
        let result: DailyTrace;
        if (existing) {
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


  return {
    async getHomeEvents() {
      const [rows, reviews] = await Promise.all([canonicalEvents(), reviewIndex()]);
      return (rows as unknown as LifeEvent[])
        .filter((event) => event.visibility !== "private" && isEventPublishable(event, reviews))
        .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },
    async getAllEvents() {
      const [rows, reviews] = await Promise.all([canonicalEvents(), reviewIndex()]);
      return (rows as unknown as LifeEvent[])
        .filter((event) => isEventPublishable(event, reviews))
        .toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    },
    async getStore() { return assembleStore(); },
    async getOrganizerStore(profileId: string) { return assembleOrganizerStore(profileId); },
    async getOrganizerWindowInput(sourceIds: string[]) { return assembleOrganizerWindowInput(sourceIds); },
    async getEventDetail(id: string) {
      const [event] = await db.select().from(t.lifeEvents).where(eq(t.lifeEvents.id, id));
      if (!event) return null;
      const e = event as unknown as LifeEvent;
      // An unreviewed rule-derived event must 404 rather than stay reachable by direct URL.
      if (!isEventPublishable(e, await reviewIndex())) return null;
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
    async appendUpload(input) { return (await persistUpload(input)).source; },
    async persistUpload(input) { return persistUpload(input); },
    async findMediaAssetByChecksum(checksum) {
      const normalized = normalizeSha256(checksum);
      if (!normalized) return null;
      const [row] = await db.select().from(t.mediaAssets).where(eq(t.mediaAssets.checksum, normalized));
      return (row as unknown as MediaAsset) ?? null;
    },
    async persistChatImportMessage(input) { return persistUpload(input); },
    async persistChatImportBatch(inputs) { return persistChatImportBatch(inputs); },
    async createChatImportTask(input: ChatImportTaskCreateInput) {
      const candidate = createChatImportTask([], input);
      const rows = await db.insert(t.chatImportTasks).values({ ...candidate, checkpoint: null } as any).onConflictDoNothing({ target: t.chatImportTasks.importBatchId }).returning();
      if (rows[0]) return taskFromRow(rows[0] as unknown as Record<string, unknown>);
      const [existing] = await db.select().from(t.chatImportTasks).where(eq(t.chatImportTasks.importBatchId, input.importBatchId));
      if (!existing) throw new ChatImportStateError("TASK_CREATE_CONFLICT");
      return taskFromRow(existing as unknown as Record<string, unknown>);
    },
    async getChatImportTask(id: string) {
      const [row] = await db.select().from(t.chatImportTasks).where(eq(t.chatImportTasks.id, id));
      return row ? taskFromRow(row as unknown as Record<string, unknown>) : null;
    },
    async listChatImportTasks(filter: ChatImportTaskListFilter = {}) {
      const rows = await db.select().from(t.chatImportTasks);
      return listChatImportTasks(rows.map((row) => taskFromRow(row as unknown as Record<string, unknown>)), filter);
    },
    async claimChatImportTask(input: ChatImportTaskClaimInput) {
      return db.transaction(async (tx) => {
        const now = input.now ?? new Date().toISOString();
        const result = input.taskId
          ? await tx.execute(sql`select id from chat_import_tasks where id = ${input.taskId} and (status in ('pending', 'retry_pending') or (status = 'running' and lease_expires_at is not null and lease_expires_at <= ${now})) for update skip locked`)
          : await tx.execute(sql`select id from chat_import_tasks where (status in ('pending', 'retry_pending') or (status = 'running' and lease_expires_at is not null and lease_expires_at <= ${now})) order by created_at asc, id asc limit 1 for update skip locked`);
        const id = (result.rows[0] as { id?: string } | undefined)?.id;
        if (!id) return null;
        const [row] = await tx.select().from(t.chatImportTasks).where(eq(t.chatImportTasks.id, id));
        if (!row) return null;
        const task = taskFromRow(row as unknown as Record<string, unknown>);
        const claimed = claimChatImportTask([task], input);
        if (!claimed) {
          if (task.status === "failed") await storeTask(tx, task);
          return null;
        }
        return storeTask(tx, claimed);
      });
    },
    async heartbeatChatImportTask(input: ChatImportTaskLeaseInput) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, input.taskId);
        if (!task) return null;
        const next = heartbeatChatImportTask([task], input);
        return next ? storeTask(tx, next) : null;
      });
    },
    async saveChatImportCheckpoint(input) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, input.taskId);
        if (!task) return null;
        const next = saveChatImportCheckpoint([task], input);
        return next ? storeTask(tx, next) : null;
      });
    },
    async requestChatImportCancel(taskId: string, now?: string) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, taskId);
        if (!task) return null;
        const next = requestChatImportCancel([task], taskId, now);
        return next ? storeTask(tx, next) : null;
      });
    },
    async acknowledgeChatImportCancel(input: ChatImportTaskAcknowledgeInput) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, input.taskId);
        if (!task) return null;
        const next = acknowledgeChatImportCancel([task], input);
        return next ? storeTask(tx, next) : null;
      });
    },
    async failChatImportTask(input: ChatImportTaskFailureInput) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, input.taskId);
        if (!task) return null;
        const next = failChatImportTask([task], input);
        return next ? storeTask(tx, next) : null;
      });
    },
    async retryChatImportTask(taskId: string, now?: string) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, taskId);
        if (!task) return null;
        const next = retryChatImportTask([task], taskId, now);
        return next ? storeTask(tx, next) : null;
      });
    },
    async completeChatImportTask(input: ChatImportTaskCompletionInput) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, input.taskId);
        if (!task) return null;
        const next = completeChatImportTask([task], input);
        return next ? storeTask(tx, next) : null;
      });
    },
    async completeChatImportWithWarnings(input: ChatImportTaskWarningsInput) {
      return db.transaction(async (tx) => {
        const task = await lockTask(tx, input.taskId);
        if (!task) return null;
        const next = completeChatImportWithWarnings([task], input);
        return next ? storeTask(tx, next) : null;
      });
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
        // Fingerprint guard: prevents parallel workers from creating duplicate events.
        // Mirrors persistDailyTrace's fingerprint-first lookup pattern.
        const fpRow = eventInput.organizationFingerprint
          ? (await tx.select().from(t.lifeEvents).where(eq(t.lifeEvents.organizationFingerprint, eventInput.organizationFingerprint)))[0]
          : undefined;
        const [existing] = fpRow ? [fpRow] : await tx.select().from(t.lifeEvents).where(eq(t.lifeEvents.id, eventInput.id));
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
          const rows = await tx.update(t.lifeEvents).set(merged).where(eq(t.lifeEvents.id, e.id)).returning();
          result = rows[0] as unknown as LifeEvent;
        } else {
          const toInsert = { ...eventInput, sourceIds: [...new Set(eventInput.sourceIds.length ? eventInput.sourceIds : sourceIds)] };
          // Safety-net: the unique fingerprint index prevents a concurrent INSERT from slipping past
          // the SELECT-then-INSERT gap when two workers race for the same batch.
          const rows = eventInput.organizationFingerprint
            ? await tx.insert(t.lifeEvents).values(toInsert).onConflictDoNothing({ target: t.lifeEvents.organizationFingerprint }).returning()
            : await tx.insert(t.lifeEvents).values(toInsert).returning();
          if (rows[0]) {
            result = rows[0] as unknown as LifeEvent;
          } else {
            // Concurrent INSERT won; read back the winning event.
            const [reread] = await tx.select().from(t.lifeEvents).where(eq(t.lifeEvents.organizationFingerprint, eventInput.organizationFingerprint!));
            result = reread as unknown as LifeEvent;
          }
        }
        // Use result.id — the single winning event's ID — so all downstream refs converge.
        await tx.update(t.rawSources).set({ status: "organized", relatedLifeEventId: result.id }).where(inArray(t.rawSources.id, sourceIds));
        for (const link of links) {
          await tx.insert(t.sourceMemoryLinks).values({ ...link, lifeEventId: result.id }).onConflictDoNothing({ target: [t.sourceMemoryLinks.rawSourceId, t.sourceMemoryLinks.lifeEventId] });
        }
        if (eventInput.mediaIds.length) await tx.update(t.media).set({ lifeEventId: result.id }).where(inArray(t.media.id, eventInput.mediaIds));
        return result;
      });
    },
    async persistDailyTrace(trace: DailyTrace) {
      // SELECT-then-INSERT under READ COMMITTED cannot see a concurrent inserter's uncommitted row,
      // so two workers organizing the same evidence both miss and both insert. That is how
      // production acquired 17 duplicate-fingerprint pairs. `daily_traces_fingerprint_unique_idx`
      // now makes the loser fail instead of duplicating — but a raised 23505 must not become a 500,
      // because losing that race is a NORMAL outcome and both callers are entitled to the same
      // artifact. One retry is enough and cannot loop: the winner has committed by the time the
      // loser's constraint fires, so the retry's SELECT finds it and takes the merge branch.
      //
      // The retry is deliberately OUTSIDE the failed transaction. A statement error aborts the whole
      // transaction in Postgres, so retrying inside it would only produce
      // "current transaction is aborted".
      try {
        return await persistDailyTraceOnce(trace);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return await persistDailyTraceOnce(trace);
      }
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
    // Idempotent on the ledger's own unique key. `onConflictDoNothing` + read-back rather than an
    // UPDATE: a second write of the same decision must be a no-op, and a row a human has since
    // revisited must not be silently reverted by a retrying worker.
    async persistQualityReview(review: QualityReview) {
      const rows = await db.insert(t.contentQualityReviews).values(review as any)
        .onConflictDoNothing({ target: [t.contentQualityReviews.targetKind, t.contentQualityReviews.targetId, t.contentQualityReviews.promptVersion] })
        .returning();
      if (rows[0]) return reviewFromRow(rows[0] as unknown as Record<string, unknown>);
      const [existing] = await db.select().from(t.contentQualityReviews).where(and(
        eq(t.contentQualityReviews.targetKind, review.targetKind),
        eq(t.contentQualityReviews.targetId, review.targetId),
        eq(t.contentQualityReviews.promptVersion, review.promptVersion),
      ));
      if (!existing) throw new Error("PostgreSQL repository: quality review insert reported a conflict but no row was found.");
      return reviewFromRow(existing as unknown as Record<string, unknown>);
    },
    // T20-B, 2026-09-04: a month's own written review ("这个月的张年"). Upsert on the schema's
    // real unique key (profileId, month) — re-running the generator for a month (a fixed prompt
    // version, a corrected draft) replaces that month's row rather than duplicating it.
    async persistMonthlySnapshot(snapshot: MonthlySnapshot) {
      const rows = await db.insert(t.monthlySnapshot).values(snapshot as any)
        .onConflictDoUpdate({ target: [t.monthlySnapshot.profileId, t.monthlySnapshot.month], set: { summary: snapshot.summary, highlights: snapshot.highlights, visibility: snapshot.visibility } })
        .returning();
      return rows[0] as unknown as MonthlySnapshot;
    },
    async findQualityReview(targetKind: QualityReview["targetKind"], targetId: string, promptVersion: string) {
      const [row] = await db.select().from(t.contentQualityReviews).where(and(
        eq(t.contentQualityReviews.targetKind, targetKind),
        eq(t.contentQualityReviews.targetId, targetId),
        eq(t.contentQualityReviews.promptVersion, promptVersion),
      ));
      return row ? reviewFromRow(row as unknown as Record<string, unknown>) : null;
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
    async enqueueOrganizerJob(input: { sourceIds: string[]; profileId: string; force?: boolean }) {
      const jobKey = organizerJobKey(input.sourceIds);
      const now = new Date().toISOString();
      const job: OrganizerJob = { id: newId("organizer-job"), jobKey, profileId: input.profileId, sourceIds: input.sourceIds.slice(), force: input.force ?? false, status: "pending", attempts: 0, availableAt: now, createdAt: now, updatedAt: now };
      const rows = await db.insert(t.organizerJobs).values(job)
        .onConflictDoNothing({ target: t.organizerJobs.jobKey, where: sql`${t.organizerJobs.status} in ('pending', 'processing')` })
        .returning();
      if (rows[0]) return rows[0] as unknown as OrganizerJob;
      const [existing] = await db.select().from(t.organizerJobs).where(and(eq(t.organizerJobs.jobKey, jobKey), inArray(t.organizerJobs.status, ["pending", "processing"])));
      return existing as unknown as OrganizerJob;
    },
    async claimNextOrganizerJob(now: Date = new Date()) {
      return db.transaction(async (tx) => {
        const nowIso = now.toISOString();
        const claimable = await tx.execute(sql`select id from organizer_jobs where status = 'pending' and available_at <= ${nowIso} order by created_at asc limit 1 for update skip locked`);
        const row = claimable.rows[0] as { id: string } | undefined;
        if (!row) return null;
        const [updated] = await tx.update(t.organizerJobs)
          .set({ status: "processing", lockedAt: nowIso, attempts: sql`${t.organizerJobs.attempts} + 1`, updatedAt: nowIso })
          .where(eq(t.organizerJobs.id, row.id))
          .returning();
        return (updated as unknown as OrganizerJob) ?? null;
      });
    },
    async completeOrganizerJob(id: string, patch: { resultAction?: string; resultTargetId?: string }) {
      const now = new Date().toISOString();
      await db.update(t.organizerJobs).set({ status: "succeeded", resultAction: patch.resultAction, resultTargetId: patch.resultTargetId, completedAt: now, updatedAt: now }).where(eq(t.organizerJobs.id, id));
    },
    async failOrganizerJob(id: string, error: string, nextAvailableAt: string | null) {
      const now = new Date().toISOString();
      if (nextAvailableAt) await db.update(t.organizerJobs).set({ status: "pending", availableAt: nextAvailableAt, lastError: error, lockedAt: null, updatedAt: now }).where(eq(t.organizerJobs.id, id));
      else await db.update(t.organizerJobs).set({ status: "failed", lastError: error, lockedAt: null, completedAt: now, updatedAt: now }).where(eq(t.organizerJobs.id, id));
    },
    async getOrganizerJob(id: string) {
      const [row] = await db.select().from(t.organizerJobs).where(eq(t.organizerJobs.id, id));
      return (row as unknown as OrganizerJob) ?? null;
    },
    async recoverStuckOrganizerJobs(olderThanMs: number, now: Date = new Date()) {
      const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
      const rows = await db.update(t.organizerJobs)
        .set({ status: "pending", lockedAt: null, updatedAt: now.toISOString() })
        .where(and(eq(t.organizerJobs.status, "processing"), sql`${t.organizerJobs.lockedAt} < ${cutoff}`))
        .returning();
      return rows.length;
    },
  };
}
