import { getMediaForDelivery } from "@/lib/db/repository";

export const MEDIA_DELIVERY_CACHE_MAX = 5000;
export const MEDIA_DELIVERY_CACHE_TTL_MS = 300_000;

export type MediaDeliveryRecord = Awaited<ReturnType<typeof getMediaForDelivery>>;

type CacheEntry = {
  record: NonNullable<MediaDeliveryRecord>;
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<MediaDeliveryRecord>>();
let cacheEpoch = 0;

function isCacheableDeliveryRecord(record: MediaDeliveryRecord): record is NonNullable<MediaDeliveryRecord> {
  if (!record?.asset || record.media.visibility === "private") return false;
  return record.locations.some(
    (location) =>
      (location.provider === "oss" || location.provider === "hot") &&
      location.variant !== "original" &&
      location.providerRef.startsWith("media/"),
  );
}

export async function getCachedMediaForDelivery(id: string): Promise<MediaDeliveryRecord> {
  const now = Date.now();
  const hit = cache.get(id);
  if (hit) {
    if (hit.expiresAt > now) {
      // Refresh LRU position on hit.
      cache.delete(id);
      cache.set(id, hit);
      return hit.record;
    }
    cache.delete(id);
  }

  const pending = inFlight.get(id);
  if (pending) return pending;

  const epochAtStart = cacheEpoch;
  const load = (async () => {
    const record = await getMediaForDelivery(id);
    if (epochAtStart === cacheEpoch && isCacheableDeliveryRecord(record)) {
      if (cache.has(id)) cache.delete(id);
      else if (cache.size >= MEDIA_DELIVERY_CACHE_MAX) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(id, { record, expiresAt: Date.now() + MEDIA_DELIVERY_CACHE_TTL_MS });
    }
    return record;
  })().finally(() => {
    if (inFlight.get(id) === load) inFlight.delete(id);
  });

  inFlight.set(id, load);
  return load;
}

export function invalidateMediaDeliveryCache(id?: string): void {
  cacheEpoch += 1;
  if (id === undefined) {
    cache.clear();
    inFlight.clear();
    return;
  }
  cache.delete(id);
  inFlight.delete(id);
}

function normalizeWeakEtag(tag: string): string {
  return tag.trim().replace(/^W\//i, "");
}

export function matchesIfNoneMatch(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  const normalizedTarget = normalizeWeakEtag(etag);
  return header
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .some((candidate) => candidate === "*" || normalizeWeakEtag(candidate) === normalizedTarget);
}
