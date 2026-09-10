import { getMediaForDelivery } from "@/lib/db/repository";
import { getStorageForProvider, selectLocation } from "@/lib/storage/hot-storage";
import type { MediaVariant } from "@/lib/types";
import { NextResponse } from "next/server";

const NOT_CACHEABLE = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await getMediaForDelivery(id);
  if (!record?.asset || record.media.visibility === "private") return new NextResponse("Not found", { status: 404, headers: NOT_CACHEABLE });
  const { media, asset, locations } = record;
  const value = new URL(request.url).searchParams.get("variant");
  if (value === "original") return new NextResponse("Original media is not available through page delivery", { status: 404, headers: NOT_CACHEABLE });
  const requested: MediaVariant = value === "thumbnail" || value === "poster" || value === "preview" || value === "document_preview" ? value : "web";
  const location = selectLocation(locations, asset, requested);
  // This route is deliberately object-storage-derivative only (Phase 3B1: "hot" R2/local or
  // "oss"). Original retrieval is an authenticated connector/admin workflow and is never a page
  // image URL — quark/wechat provider rows are never selected here regardless of variant.
  if (!location || (location.provider !== "hot" && location.provider !== "oss") || location.variant === "original" || !location.providerRef.startsWith("media/")) return new NextResponse("Media derivative is not ready", { status: 404, headers: NOT_CACHEABLE });

  // id + variant fully determine the bytes at this URL — content never changes for a given
  // (id, variant), so this is safe to cache for a year at both the browser and the CDN.
  const etag = `"${(asset.checksum ?? asset.id).replace(/^sha256:/i, "")}-${location.variant}"`;
  const cacheHeaders = { "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: cacheHeaders });

  const contentType = location.mimeType || media.mimeType || "application/octet-stream";

  // Stream straight from the origin (R2/local disk, or OSS) so TTFB isn't gated on the whole
  // derivative arriving before we can write a single response byte — this is the difference that
  // matters on a cache MISS (first view of a photo), since a cache HIT is already served by the
  // CDN before this code runs. Which backend that origin actually is comes from this location's
  // own `provider`, never from a single fixed instance (see getStorageForProvider's doc comment).
  const storage = getStorageForProvider(location.provider);

  // Range, and why it is not optional now that a video can be played here (2026-09-10). A browser
  // will not let the reader drag a video's scrubber unless the server advertises ranges and answers
  // them: with a plain 200 the media element reports nothing seekable, and setting currentTime
  // snaps straight back to zero — measured on the first playable clip before this existed. Photos
  // are unaffected; nothing requests a range for them.
  const totalSize = location.fileSize ?? undefined;
  const rangeHeader = request.headers.get("range");
  if (rangeHeader && totalSize) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
    if (match && (match[1] || match[2])) {
      // "bytes=-500" means the last 500 bytes; "bytes=500-" means from 500 to the end.
      const start = match[1] ? Number(match[1]) : Math.max(0, totalSize - Number(match[2]));
      const end = match[1] ? (match[2] ? Math.min(Number(match[2]), totalSize - 1) : totalSize - 1) : totalSize - 1;
      if (!(Number.isFinite(start) && Number.isFinite(end)) || start > end || start >= totalSize) {
        return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${totalSize}`, "Accept-Ranges": "bytes", ...NOT_CACHEABLE } });
      }
      const rangeHeaders = {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${totalSize}`,
        "Content-Length": String(end - start + 1),
        "Accept-Ranges": "bytes",
        ...cacheHeaders,
      };
      const ranged = storage.getRange ? await storage.getRange(location.providerRef, start, end) : null;
      if (ranged) return new NextResponse(ranged, { status: 206, headers: rangeHeaders });
      // A backend without a ranged read still answers correctly, just less efficiently.
      const whole = await storage.get(location.providerRef);
      if (whole) return new NextResponse(whole.slice(start, end + 1) as BodyInit, { status: 206, headers: rangeHeaders });
      return new NextResponse("Media derivative is not ready", { status: 404, headers: NOT_CACHEABLE });
    }
  }

  const stream = await storage.getStream(location.providerRef);
  if (stream) {
    const headers: Record<string, string> = { "Content-Type": contentType, "Accept-Ranges": "bytes", ...cacheHeaders };
    if (location.fileSize) headers["Content-Length"] = String(location.fileSize);
    return new NextResponse(stream, { headers });
  }

  const data = await storage.get(location.providerRef);
  if (!data) return new NextResponse("Media derivative is not ready", { status: 404, headers: NOT_CACHEABLE });
  return new NextResponse(data as BodyInit, { headers: { "Content-Type": contentType, "Content-Length": String(data.byteLength), "Accept-Ranges": "bytes", ...cacheHeaders } });
}
