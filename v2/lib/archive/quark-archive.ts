import { getConnectorState, getStore, markArchiveStatus, recordArchivedOriginal, removeMediaLocation, upsertConnectorState, updateMediaLocation } from "@/lib/db/repository";
import type { ConnectorState, MediaAsset } from "@/lib/types";
import { hotStorage } from "@/lib/storage/hot-storage";

export type QuarkArchiveClient = {
  archive(input: { filename: string; body: Uint8Array; checksum?: string; size?: number }): Promise<{ providerRef: string; path?: string; size?: number }>;
  verify(input: { providerRef: string; size?: number; checksum?: string }): Promise<{ exists: boolean; size?: number; checksumVerified?: boolean }>;
};

export function isQuarkAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /auth|oauth|token|unauthor|forbidden|expired/i.test(message);
}

function stateFor(profileId: string, status: ConnectorState["status"], pendingArchiveCount: number, patch: Partial<ConnectorState> = {}): ConnectorState {
  return { id: `connector-quark-${profileId}`, provider: "quark", profileId, pendingArchiveCount, connectorVersion: "quark-connector/0.1", status, updatedAt: new Date().toISOString(), ...patch };
}

export async function getOrCreateQuarkState(profileId: string) {
  return await getConnectorState("quark", profileId) ?? await upsertConnectorState(stateFor(profileId, "idle", 0));
}

function pendingOriginals(store: Awaited<ReturnType<typeof getStore>>) {
  const pending = new Set(["awaiting_archive", "archive_failed", "paused_auth_required"]);
  return store.mediaLocations.filter((location) => location.provider === "hot" && location.variant === "original" && pending.has(location.status)).map((location) => ({ location, asset: store.mediaAssets.find((asset) => asset.id === location.mediaAssetId) })).filter((item): item is { location: (typeof store.mediaLocations)[number]; asset: MediaAsset } => Boolean(item.asset));
}

export async function archivePendingOriginals(client: QuarkArchiveClient, profileId: string) {
  const store = await getStore();
  const pending = pendingOriginals(store).filter(({ asset }) => asset.profileId === profileId);
  await upsertConnectorState(stateFor(profileId, "syncing", pending.length));
  let archived = 0; let failed = 0; let paused = false;
  for (const { location, asset } of pending) {
    await updateMediaLocation(location.id, { status: "archiving" });
    try {
      const body = await hotStorage.get(location.providerRef);
      if (!body) throw new Error("staging original is missing");
      const result = await client.archive({ filename: asset.originalFilename ?? `${asset.id}.${asset.mediaType}`, body, checksum: asset.checksum ?? undefined, size: location.fileSize });
      if (!result.providerRef) throw new Error("Quark archive did not return providerRef");
      const verification = await client.verify({ providerRef: result.providerRef, size: location.fileSize, checksum: asset.checksum ?? undefined });
      if (!verification.exists || (location.fileSize !== undefined && verification.size !== undefined && verification.size !== location.fileSize) || verification.checksumVerified === false) throw new Error("Quark archive verification failed");
      await recordArchivedOriginal({ assetId: asset.id, providerRef: result.providerRef, path: result.path, fileSize: verification.size ?? location.fileSize, checksumVerified: verification.checksumVerified });
      await hotStorage.delete(location.providerRef);
      await removeMediaLocation(location.id);
      archived += 1;
    } catch (error) {
      if (isQuarkAuthError(error)) { await markArchiveStatus(asset.id, "paused_auth_required", error instanceof Error ? error.message : String(error)); paused = true; }
      else { await markArchiveStatus(asset.id, "archive_failed", error instanceof Error ? error.message : String(error)); failed += 1; }
    }
  }
  const remaining = pendingOriginals(await getStore()).filter(({ asset }) => asset.profileId === profileId).length;
  await upsertConnectorState(stateFor(profileId, paused ? "auth_required" : failed ? "failed" : "idle", remaining, { lastSuccessfulSync: !failed && !paused ? new Date().toISOString() : undefined, lastError: failed ? "One or more originals failed archive verification" : paused ? "Quark authorization required" : undefined }));
  return { archived, failed, paused, pendingArchiveCount: remaining };
}
