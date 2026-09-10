import type { MediaLocation } from "@/lib/types";

// Shared by every object-storage backend (local disk, R2, OSS) so hot-storage.ts and
// oss-storage.ts can both depend on this instead of on each other.
export type HotStorageObject = { providerRef: string; mimeType: string; fileSize?: number; width?: number; height?: number; checksum?: string };
export type HotStorageBody = Uint8Array | AsyncIterable<Uint8Array>;
export type HotStorageInput = { key: string; body: HotStorageBody; mimeType: string; checksum?: string; fileSize?: number };
export type HotStorageVerification = { exists: boolean; checksumVerified: boolean; fileSize?: number };

export interface HotStorage {
  put(input: HotStorageInput): Promise<HotStorageObject>;
  get(key: string): Promise<Uint8Array | null>;
  // Streams the object instead of buffering it fully in memory — used by the
  // page-delivery route so TTFB isn't gated on the whole file arriving first.
  getStream(key: string): Promise<ReadableStream<Uint8Array> | null>;
  // Bytes [start, end] inclusive, for a Range request. Optional: a backend that does not implement
  // it makes the delivery route fall back to fetching the object and slicing, which is correct but
  // reads more than it needs. Video is why this exists — a browser will not let the reader drag the
  // scrubber unless the server answers ranges (see app/api/media/[id]/route.ts).
  getRange?(key: string, start: number, end: number): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  verify(key: string, checksum: string): Promise<HotStorageVerification>;
  url(location: MediaLocation): string | null;
}

export function safeKey(key: string) {
  const normalized = key.replaceAll("\\", "/");
  if (!normalized.startsWith("media/") || normalized.includes("..")) throw new Error("Unsafe storage key");
  return normalized;
}
