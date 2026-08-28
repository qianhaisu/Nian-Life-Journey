import type { MediaAsset, MediaLocation, MediaVariant } from "@/lib/types";

export type HotStorageObject = { providerRef: string; mimeType: string; fileSize?: number; width?: number; height?: number };

export interface HotStorage {
  put(input: { key: string; body: Uint8Array; mimeType: string }): Promise<HotStorageObject>;
  delete(key: string): Promise<void>;
  url(location: MediaLocation): string | null;
}

// The local adapter is intentionally credential-free. A production adapter can
// implement the same contract for the single selected S3-compatible provider.
export class LocalHotStorage implements HotStorage {
  async put(input: { key: string; body: Uint8Array; mimeType: string }) {
    return { providerRef: input.key, mimeType: input.mimeType, fileSize: input.body.byteLength };
  }
  async delete(_key: string) {}
  url(location: MediaLocation) { return location.status === "ready" ? "/api/media/" + location.mediaAssetId + "?variant=" + location.variant : null; }
}

export const hotStorage = new LocalHotStorage();

export function preferredVariant(asset: MediaAsset, requested: MediaVariant = "web"): MediaVariant[] {
  if (asset.mediaType === "video") return requested === "preview" ? ["preview", "poster"] : ["poster"];
  if (asset.mimeType === "application/pdf") return requested === "document_preview" ? ["document_preview"] : ["document_preview"];
  return requested === "thumbnail" ? ["thumbnail", "web"] : ["web", "thumbnail"];
}

export function selectLocation(locations: MediaLocation[], asset: MediaAsset, requested: MediaVariant = "web") {
  const variants = preferredVariant(asset, requested);
  return variants.map((variant) => locations.find((location) => location.provider === "hot" && location.variant === variant && location.status === "ready")).find(Boolean)
    ?? locations.find((location) => location.provider === "hot" && location.variant === "original" && location.status === "awaiting_archive")
    ?? locations.find((location) => location.provider === "hot" && location.variant === "original" && location.status === "ready")
    ?? null;
}

export function derivativePlan(asset: MediaAsset): Array<{ variant: MediaVariant; maxWidth: number }> {
  if (asset.mediaType === "video") return [{ variant: "poster", maxWidth: 1280 }];
  if (asset.mimeType === "application/pdf") return [{ variant: "document_preview", maxWidth: 1280 }];
  return [{ variant: "thumbnail", maxWidth: 480 }, { variant: "web", maxWidth: 1280 }];
}
