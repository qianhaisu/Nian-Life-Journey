import { getMediaForDelivery } from "@/lib/db/repository";
import { hotStorage, selectLocation } from "@/lib/storage/hot-storage";
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
  // This route is deliberately Hot Storage only. Original retrieval is an
  // authenticated connector/admin workflow and is never a page image URL.
  if (!location || location.provider !== "hot" || location.variant === "original" || !location.providerRef.startsWith("media/")) return new NextResponse("Media derivative is not ready", { status: 404, headers: NOT_CACHEABLE });

  // id + variant fully determine the bytes at this URL — content never changes for a given
  // (id, variant), so this is safe to cache for a year at both the browser and the CDN.
  const etag = `"${(asset.checksum ?? asset.id).replace(/^sha256:/i, "")}-${location.variant}"`;
  const cacheHeaders = { "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: cacheHeaders });

  const data = await hotStorage.get(location.providerRef);
  if (!data) return new NextResponse("Media derivative is not ready", { status: 404, headers: NOT_CACHEABLE });
  return new NextResponse(data as BodyInit, { headers: { "Content-Type": location.mimeType || media.mimeType || "application/octet-stream", "Content-Length": String(data.byteLength), ...cacheHeaders } });
}
