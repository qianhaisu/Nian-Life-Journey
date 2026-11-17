import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getStorageForProvider } from "@/lib/storage/hot-storage";
import manifest from "@/lib/weekend/media-manifest.json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ManifestAsset = {
  filename: string;
  originalKey: string;
  webKey: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  sourcePage: string;
  alt: string;
};

const ASSETS_BY_FILENAME = new Map<string, ManifestAsset>(
  ((manifest as { assets?: ManifestAsset[] }).assets ?? []).map((item) => [item.filename, item])
);

const NO_STORE = { "Cache-Control": "no-store" };
const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";

function isSafeFilename(filename: string) {
  return (
    filename.length > 0 &&
    !filename.includes("/") &&
    !filename.includes("\\") &&
    !filename.includes("..") &&
    path.basename(filename) === filename
  );
}

function matchesIfNoneMatch(header: string | null, etag: string) {
  if (!header) return false;
  return header
    .split(",")
    .map((part) => part.trim())
    .some((tag) => tag === etag || tag === "*");
}

async function resolveLocalAssetFallback(filename: string) {
  const candidates = [
    path.resolve(process.cwd(), "..", "docs", "weekend-planner", "prototype-v3", "assets"),
    path.resolve(process.cwd(), "docs", "weekend-planner", "prototype-v3", "assets"),
  ];
  for (const baseDir of candidates) {
    const resolved = path.resolve(baseDir, filename);
    if (!resolved.startsWith(`${baseDir}${path.sep}`)) continue;
    try {
      const info = await stat(resolved);
      if (info.isFile()) return { filePath: resolved, fileSize: info.size };
    } catch {
      // Try next candidate root.
    }
  }
  return null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug?: string[] }> }
) {
  const { slug } = await params;
  if (!Array.isArray(slug) || slug.length !== 2 || slug[0] !== "web") {
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  }

  const filename = slug[1];
  if (!isSafeFilename(filename)) {
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  }

  const entry = ASSETS_BY_FILENAME.get(filename);
  if (
    !entry ||
    !entry.webKey.startsWith("media/weekend/assets/web/") ||
    entry.bytes <= 0
  ) {
    return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  }

  const etag = `"${entry.sha256}-web"`;
  const cacheHeaders = {
    "Cache-Control": CACHE_IMMUTABLE,
    ETag: etag,
  };

  if (matchesIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new NextResponse(null, { status: 304, headers: cacheHeaders });
  }

  const ossConfigured = Boolean(process.env.OSS_ENDPOINT?.trim());
  if (ossConfigured) {
    const storage = getStorageForProvider("oss");
    const stream = await storage.getStream(entry.webKey, request.signal);
    if (stream) {
      return new NextResponse(stream, {
        headers: {
          "Content-Type": entry.mimeType || "image/jpeg",
          "Content-Length": String(entry.bytes),
          ...cacheHeaders,
        },
      });
    }
    const bytes = await storage.get(entry.webKey, request.signal);
    if (bytes) {
      return new NextResponse(bytes as BodyInit, {
        headers: {
          "Content-Type": entry.mimeType || "image/jpeg",
          "Content-Length": String(bytes.byteLength),
          ...cacheHeaders,
        },
      });
    }
    return new NextResponse("Not ready", { status: 404, headers: NO_STORE });
  }

  // Fallback is strictly limited to local unit tests when OSS_ENDPOINT is unconfigured.
  const local = await resolveLocalAssetFallback(entry.filename);
  if (!local) {
    return new NextResponse("Not ready", { status: 404, headers: NO_STORE });
  }
  if (request.signal?.aborted) {
    return new NextResponse("Aborted", { status: 499, headers: NO_STORE });
  }
  const nodeStream = createReadStream(local.filePath);
  request.signal?.addEventListener("abort", () => nodeStream.destroy(), { once: true });
  const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;
  return new NextResponse(webStream, {
    headers: {
      "Content-Type": entry.mimeType || "image/jpeg",
      "Content-Length": String(local.fileSize),
      ...cacheHeaders,
    },
  });
}
