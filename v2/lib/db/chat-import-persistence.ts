import type { Media, MediaAsset, MediaLocation, RawSource } from "@/lib/types";
import type { ChatImportBatchResult, Store, UploadPersistInput, UploadPersistResult } from "./repository-interface";

export function normalizeSha256(value: string | null | undefined) {
  if (!value) return value ?? null;
  const hex = value.replace(/^sha256:/i, "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(hex) ? `sha256:${hex}` : value;
}

function conflict(code: string): never {
  throw new Error(code);
}

export function persistUploadInStore(store: Store, input: UploadPersistInput): UploadPersistResult {
  const sourceMatch = input.source.provider && input.source.providerExternalId
    ? store.rawSources.find((source) => source.provider === input.source.provider && source.providerExternalId === input.source.providerExternalId)
    : store.rawSources.find((source) => source.id === input.source.id);
  const sourceIdMatch = store.rawSources.find((source) => source.id === input.source.id);
  if (sourceIdMatch && !sourceMatch) conflict("RAW_SOURCE_ID_CONFLICT");
  const source = sourceMatch ?? input.source;
  if (!sourceMatch) store.rawSources.push(source);
  const assetsByInputId = new Map<string, MediaAsset>();
  const createdAssetIds: string[] = [];
  const reusedAssetIds: string[] = [];
  for (const assetInput of input.assets ?? []) {
    const asset = { ...assetInput, checksum: normalizeSha256(assetInput.checksum) };
    const existing = asset.checksum
      ? store.mediaAssets.find((candidate) => normalizeSha256(candidate.checksum) === asset.checksum)
      : store.mediaAssets.find((candidate) => candidate.id === asset.id);
    if (existing) {
      const idMatch = store.mediaAssets.find((candidate) => candidate.id === asset.id);
      if (idMatch && idMatch.id !== existing.id) conflict("MEDIA_ASSET_ID_CONFLICT");
      if (!asset.checksum && existing.id !== asset.id) conflict("MEDIA_ASSET_ID_CONFLICT");
      assetsByInputId.set(asset.id, existing);
      reusedAssetIds.push(existing.id);
      continue;
    }
    if (store.mediaAssets.some((candidate) => candidate.id === asset.id)) conflict("MEDIA_ASSET_ID_CONFLICT");
    store.mediaAssets.push(asset);
    assetsByInputId.set(asset.id, asset);
    createdAssetIds.push(asset.id);
  }

  const mediaIds: string[] = [];
  for (const mediaInput of input.media) {
    const asset = mediaInput.mediaAssetId ? assetsByInputId.get(mediaInput.mediaAssetId) : undefined;
    const media: Media = asset && mediaInput.mediaAssetId !== asset.id ? { ...mediaInput, mediaAssetId: asset.id } : { ...mediaInput };
    const existing = store.media.find((candidate) => candidate.id === media.id);
    if (!existing) store.media.push(media);
    else if (existing.mediaAssetId !== media.mediaAssetId) conflict("MEDIA_ID_CONFLICT");
    mediaIds.push(media.id);
  }

  const createdLocationIds: string[] = [];
  const reusedLocationIds: string[] = [];
  for (const locationInput of input.locations ?? []) {
    const asset = assetsByInputId.get(locationInput.mediaAssetId);
    const location: MediaLocation = asset && locationInput.mediaAssetId !== asset.id ? { ...locationInput, mediaAssetId: asset.id } : { ...locationInput };
    const existing = store.mediaLocations.find((candidate) => candidate.provider === location.provider && candidate.providerRef === location.providerRef);
    if (existing) {
      if (existing.mediaAssetId !== location.mediaAssetId || existing.variant !== location.variant) conflict("MEDIA_LOCATION_CONFLICT");
      reusedLocationIds.push(existing.id);
      continue;
    }
    if (store.mediaLocations.some((candidate) => candidate.id === location.id)) conflict("MEDIA_LOCATION_ID_CONFLICT");
    store.mediaLocations.push(location);
    createdLocationIds.push(location.id);
  }

  return { source, sourceCreated: !sourceMatch, createdAssetIds, reusedAssetIds, createdLocationIds, reusedLocationIds, mediaIds: source.mediaIds.slice() };
}

// Batch persist for the JSON/in-memory backends: no network round trips exist here to save, so
// this is just persistUploadInStore run in a loop against the SAME store object — which already
// gives correct behavior for a canonical identity that repeats within the batch itself, because
// each call sees the previous call's mutations.
export function persistChatImportBatchInStore(store: Store, inputs: UploadPersistInput[]): ChatImportBatchResult {
  return { items: inputs.map((input) => persistUploadInStore(store, input)) };
}

export function sourceByCanonical(store: Store, provider: string, providerExternalId: string) {
  return store.rawSources.find((source) => source.provider === provider && source.providerExternalId === providerExternalId) ?? null;
}

export function assetByChecksum(store: Store, checksum: string) {
  const normalized = normalizeSha256(checksum);
  return store.mediaAssets.find((asset) => normalizeSha256(asset.checksum) === normalized) ?? null;
}

export function normalizeTaskCheckpoint(value: unknown) {
  if (!value) return undefined;
  if (typeof value === "object") return value as Store["chatImportTasks"][number]["checkpoint"];
  try { return JSON.parse(String(value)) as Store["chatImportTasks"][number]["checkpoint"]; } catch { return undefined; }
}

export function normalizeChatImportTask(task: Store["chatImportTasks"][number]) {
  const currentStage = task.currentStage ?? task.phase;
  return {
    ...task,
    phase: currentStage,
    currentStage,
    warningCounts: task.warningCounts ?? [],
    attempt: task.attempt ?? 0,
    maxAttempts: task.maxAttempts ?? 3,
    checkpoint: normalizeTaskCheckpoint(task.checkpoint),
  };
}
