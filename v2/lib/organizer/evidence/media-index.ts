// Builds the Evidence Builder's media index from repository rows.
//
// Availability is derived from `media_locations`, never from `media_assets.archive_status`. That
// flag is demonstrably stale in production: all 904 WeChat photo assets say `awaiting_archive` with
// `archive_verified_at` null, while 879 of them have a working hot `web` derivative whose bytes
// return on request. A single status column that disagrees with the locations is not evidence of
// anything, so it is not consulted here.
//
// The three states are kept distinct on purpose. `unknown` is what a caller gets when it supplied no
// rows at all; it must never be reported as `unavailable`, because "we did not look" and "there is
// no renderable copy" lead to different, and oppositely wrong, downstream behaviour.
import type { MediaRef } from "./types";

export type MediaLocationRow = {
  mediaAssetId: string;
  provider: string;
  variant: string;
  status?: string | null;
};

export type MediaRow = {
  mediaId: string;
  mediaAssetId?: string | null;
  mediaType?: string | null;
  mimeType?: string | null;
  /** The asset's own SHA-256, with or without the `sha256:` prefix. */
  checksum?: string | null;
  takenAt?: string | Date | null;
  /** Which system the media came from — `wechat`, `quark`, … Derived from the original location. */
  provider?: string | null;
};

/** A location counts as usable unless it is explicitly in a failed/pending state. */
function usable(status: string | null | undefined): boolean {
  return status !== "archive_failed" && status !== "pending" && status !== "paused_auth_required";
}

const MEDIA_TYPES = new Set(["photo", "video", "document"]);
function mediaTypeOf(value: string | null | undefined): MediaRef["mediaType"] | undefined {
  return value && MEDIA_TYPES.has(value) ? (value as MediaRef["mediaType"]) : undefined;
}

function isoOf(value: string | Date | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}

export type MediaIndexEntry = Omit<MediaRef, "mediaId">;

/**
 * @param media    one row per `media.id` the Organizer might see
 * @param locations every `media_locations` row for those assets
 */
export function buildMediaIndex(media: readonly MediaRow[], locations: readonly MediaLocationRow[]): Map<string, MediaIndexEntry> {
  const byAsset = new Map<string, MediaLocationRow[]>();
  for (const location of locations) {
    const list = byAsset.get(location.mediaAssetId);
    if (list) list.push(location); else byAsset.set(location.mediaAssetId, [location]);
  }

  const index = new Map<string, MediaIndexEntry>();
  for (const row of media) {
    const assetLocations = row.mediaAssetId ? byAsset.get(row.mediaAssetId) ?? [] : [];
    // A renderable copy is a hot derivative — that is exactly what the delivery route serves, and
    // an `original` sitting in the source provider is not renderable however healthy it looks.
    const hasDerivative = assetLocations.some((l) => l.provider === "hot" && l.variant !== "original" && usable(l.status));
    const hasOriginal = assetLocations.some((l) => l.variant === "original" && usable(l.status));
    // The provider of the ORIGINAL is where the media actually came from; hot storage is only where
    // a copy of it lives, so it must never be reported as the provider.
    const originProvider = row.provider ?? assetLocations.find((l) => l.variant === "original" && l.provider !== "hot")?.provider;

    index.set(row.mediaId, {
      mediaAssetId: row.mediaAssetId ?? undefined,
      provider: originProvider ?? undefined,
      mediaType: mediaTypeOf(row.mediaType),
      mimeType: row.mimeType ?? undefined,
      assetSha256: row.checksum ? String(row.checksum).replace(/^sha256:/, "") : undefined,
      takenAt: isoOf(row.takenAt),
      // No locations at all is a real answer — the asset exists and nothing holds bytes for it —
      // so it is `unavailable`, not `unknown`. `unknown` belongs to media absent from the index.
      derivative: hasDerivative ? "available" : "unavailable",
      original: hasOriginal ? "available" : "unavailable",
    });
  }
  return index;
}
