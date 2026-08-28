import { promises as fs } from "node:fs";
import path from "node:path";
import { getStore } from "@/lib/db/repository";
import { locationForMedia } from "@/lib/db/media";
import { NextResponse } from "next/server";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const store = await getStore(); const media = store.media.find((item) => item.id === id);
  if (!media?.objectKey || media.visibility === "private") return new NextResponse("Not found", { status: 404 });
  const requested = new URL(request.url).searchParams.get("variant"); const location = locationForMedia(store, media, requested === "thumbnail" ? "thumbnail" : requested === "poster" ? "poster" : "web");
  const objectKey = location?.providerRef ?? media.objectKey;
  if (!objectKey.startsWith("media/")) return new NextResponse("Not found", { status: 404 });
  try { const data = await fs.readFile(path.join(process.cwd(), ".data", objectKey)); return new NextResponse(data, { headers: { "Content-Type": location?.mimeType || media.mimeType || "application/octet-stream", "Cache-Control": "private, max-age=60" } }); }
  catch { return new NextResponse("Not found", { status: 404 }); }
}
