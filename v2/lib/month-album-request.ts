import type { PhotoDay } from "@/lib/memory-chapters";

// The month album's read door, shared by the GET route (app/api/memory/[year]/[month]/album) and the
// two controls that open it (components/archive-expander.tsx, components/day-album.tsx).
//
// Until 2026-09-15 both controls called server actions. A server action is a POST, and the public
// entry (Caddyfile.ecs) forwards only GET/HEAD — writes stay on the private SSH path — so on
// nianlife.cn 「展开这个月其余的照片」 and 「翻开这一天的相册」 were refused before they reached the app.
// Reading an album is a read; it is a GET now. The validation is exactly what the actions checked.

export type AlbumRequest =
  | { ok: true; year: string; month: string; day?: string }
  | { ok: false; error: string };

export function parseAlbumRequest(year: string, month: string, day: string | null): AlbumRequest {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) return { ok: false, error: "year must be YYYY and month MM" };
  if (day === null) return { ok: true, year, month };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.slice(0, 7) !== `${year}-${month}`) return { ok: false, error: "day must be YYYY-MM-DD inside the requested month" };
  return { ok: true, year, month, day };
}

export function albumUrl(year: string, month: string, day?: string) {
  return `/api/memory/${encodeURIComponent(year)}/${encodeURIComponent(month)}/album${day ? `?day=${encodeURIComponent(day)}` : ""}`;
}

async function readAlbum<T>(url: string): Promise<T> {
  const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error(`album read failed: ${response.status}`);
  return await response.json() as T;
}

// Every archive day of the month (all photos); the expander filters to the days the page left out.
export async function fetchFullArchiveDays(year: string, month: string): Promise<PhotoDay[]> {
  return (await readAlbum<{ days: PhotoDay[] }>(albumUrl(year, month))).days ?? [];
}

// The album's photographs for exactly one day of this month, or undefined.
export async function fetchDayAlbum(year: string, month: string, day: string): Promise<PhotoDay | undefined> {
  return (await readAlbum<{ album: PhotoDay | null }>(albumUrl(year, month, day))).album ?? undefined;
}
