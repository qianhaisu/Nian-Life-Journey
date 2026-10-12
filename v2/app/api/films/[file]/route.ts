import { getStorageForProvider } from "@/lib/storage/hot-storage";
import { NextResponse } from "next/server";

// 给雪姨的短片（2026-10）。只读 OSS 上两个固定对象；不查数据库、不进档案。size 是上传时记下的真实字节数。
const FILMS: Record<string, { key: string; type: string; size: number }> = {
  "xueyi-2026-v4.mp4": { key: "media/films/xueyi-2026/xueyi-2026-v4.mp4", type: "video/mp4", size: 141401707 },
  "xueyi-2026-poster-v4.jpg": { key: "media/films/xueyi-2026/xueyi-2026-poster-v4.jpg", type: "image/jpeg", size: 386172 },
};
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const film = Object.prototype.hasOwnProperty.call(FILMS, file) ? FILMS[file] : undefined;
  if (!film || film.size <= 0) return new NextResponse("Not found", { status: 404, headers: NO_STORE });
  const storage = getStorageForProvider("oss");
  const base = { "Content-Type": film.type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=31536000, immutable" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range")?.trim() ?? "");
  if (m && (m[1] || m[2])) {
    const total = film.size;
    const start = m[1] ? Number(m[1]) : Math.max(0, total - Number(m[2]));
    const end = m[1] ? (m[2] ? Math.min(Number(m[2]), total - 1) : total - 1) : total - 1;
    if (!(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < total)) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${total}`, ...NO_STORE } });
    const body = storage.getRange ? await storage.getRange(film.key, start, end, request.signal) : null;
    if (!body) return new NextResponse("Not ready", { status: 404, headers: NO_STORE });
    return new NextResponse(body, { status: 206, headers: { ...base, "Content-Range": `bytes ${start}-${end}/${total}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = await storage.getStream(film.key, request.signal);
  if (!stream) return new NextResponse("Not ready", { status: 404, headers: NO_STORE });
  return new NextResponse(stream, { headers: { ...base, "Content-Length": String(film.size) } });
}
