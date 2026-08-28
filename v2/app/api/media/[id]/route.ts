import { getStore } from "@/lib/db/repository";
import { locationForMedia } from "@/lib/db/media";
import { hotStorage } from "@/lib/storage/hot-storage";
import type { MediaVariant } from "@/lib/types";
import { NextResponse } from "next/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const media = store.media.find((item) => item.id === id);
  if (!media?.mediaAssetId || media.visibility === "private") return new NextResponse("Not found", { status: 404 });
  const value = new URL(request.url).searchParams.get("variant");
  if (value === "original") return new NextResponse("Original media is not available through page delivery", { status: 404 });
  const requested: MediaVariant = value === "thumbnail" || value === "poster" || value === "preview" || value === "document_preview" ? value : "web";
  const location = locationForMedia(store, media, requested);
  // This route is deliberately Hot Storage only. Original retrieval is an
  // authenticated connector/admin workflow and is never a page image URL.
  if (!location || location.provider !== "hot" || location.variant === "original" || !location.providerRef.startsWith("media/")) return new NextResponse("Media derivative is not ready", { status: 404 });
  const data = await hotStorage.get(location.providerRef);
  if (!data) return new NextResponse("Media derivative is not ready", { status: 404 });
  return new NextResponse(data as BodyInit, { headers: { "Content-Type": location.mimeType || media.mimeType || "application/octet-stream", "Content-Length": String(data.byteLength), "Cache-Control": "private, max-age=60" } });
}
