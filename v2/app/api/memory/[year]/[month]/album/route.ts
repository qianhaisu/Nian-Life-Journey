import { NextResponse } from "next/server";
import { monthArchiveDays, monthDayAlbum } from "@/lib/month-album";
import { parseAlbumRequest } from "@/lib/month-album-request";

// Read-only month album (lib/month-album-request.ts says why this is a GET and not a server action).
//   GET /api/memory/2026/09/album               → { days }   every archive day of the month
//   GET /api/memory/2026/09/album?day=2026-09-07 → { album }  that day's album, or null
// Returns exactly what the month page composes — the same visibility gates, nothing wider.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ year: string; month: string }> }) {
  const { year, month } = await params;
  const parsed = parseAlbumRequest(year, month, new URL(request.url).searchParams.get("day"));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE });
  if (parsed.day) return NextResponse.json({ album: (await monthDayAlbum(year, month, parsed.day)) ?? null }, { headers: NO_STORE });
  return NextResponse.json({ days: await monthArchiveDays(year, month) }, { headers: NO_STORE });
}
