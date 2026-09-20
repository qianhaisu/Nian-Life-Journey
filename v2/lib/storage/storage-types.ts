import type { MediaLocation } from "@/lib/types";

// Shared by every object-storage backend (local disk, R2, OSS) so hot-storage.ts and
// oss-storage.ts can both depend on this instead of on each other.
export type HotStorageObject = { providerRef: string; mimeType: string; fileSize?: number; width?: number; height?: number; checksum?: string };
export type HotStorageBody = Uint8Array | AsyncIterable<Uint8Array>;
export type HotStorageInput = { key: string; body: HotStorageBody; mimeType: string; checksum?: string; fileSize?: number };
export type HotStorageVerification = { exists: boolean; checksumVerified: boolean; fileSize?: number };

// Why every read below takes a signal (2026-09-20 incident). A reader who navigates away, locks
// the phone, or loses signal mid-download leaves the delivery route's response stream abandoned.
// Without a signal threaded down to the SDK call, the upstream object-storage request is never
// cancelled: its socket stays checked out of the connection pool with unread bytes sitting in the
// kernel receive buffer, forever. Fifty of those exhausted the pool and every photo on
// nianlife.cn stopped loading. Pass `request.signal` from any request-scoped caller; a worker or
// script with no request omits it and behaves exactly as before.
export interface HotStorage {
  put(input: HotStorageInput): Promise<HotStorageObject>;
  get(key: string, signal?: AbortSignal): Promise<Uint8Array | null>;
  // Streams the object instead of buffering it fully in memory — used by the
  // page-delivery route so TTFB isn't gated on the whole file arriving first.
  getStream(key: string, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null>;
  // Bytes [start, end] inclusive, for a Range request. Optional: a backend that does not implement
  // it makes the delivery route fall back to fetching the object and slicing, which is correct but
  // reads more than it needs. Video is why this exists — a browser will not let the reader drag the
  // scrubber unless the server answers ranges (see app/api/media/[id]/route.ts). Video is also why
  // the signal matters most here: a preview averages 3.6 MB and reaches 35 MB, and scrubbing
  // abandons ranges constantly.
  getRange?(key: string, start: number, end: number, signal?: AbortSignal): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  verify(key: string, checksum: string): Promise<HotStorageVerification>;
  url(location: MediaLocation): string | null;
}

// Connection-pool limits shared by every S3-SDK-backed object store (OSS today, R2 if it is ever
// switched back on — same SDK, same failure mode). The SDK's default NodeHttpHandler allows 50
// sockets and sets NO timeout of any kind, so a socket that stops being drained is checked out
// forever. On 2026-09-20 fifty abandoned reads pinned the whole pool, 458 further requests queued
// behind them, and every photograph on nianlife.cn timed out for ~2.5 hours. Two independent
// guards, because either alone still fails:
//   - MAX_SOCKETS raises the ceiling so ordinary concurrency (a month page is ~20 images, and
//     several readers can open one at once) never approaches it.
//   - REQUEST_TIMEOUT_MS is the backstop that actually RECLAIMS a leaked socket. It is an
//     inactivity timeout, not a total-duration one: a transfer making progress is never cut off,
//     and a socket nothing has read from in two minutes is gone whatever the cause. Deliberately
//     generous — the correct, immediate cleanup path is the abort signal threaded through every
//     read above, and this only catches what that misses.
export const MEDIA_STORAGE_POOL = {
  maxSockets: Number(process.env.MEDIA_STORAGE_MAX_SOCKETS ?? 256),
  requestTimeoutMs: Number(process.env.MEDIA_STORAGE_REQUEST_TIMEOUT_MS ?? 120_000),
  connectionTimeoutMs: Number(process.env.MEDIA_STORAGE_CONNECTION_TIMEOUT_MS ?? 5_000),
};

export function safeKey(key: string) {
  const normalized = key.replaceAll("\\", "/");
  if (!normalized.startsWith("media/") || normalized.includes("..")) throw new Error("Unsafe storage key");
  return normalized;
}
