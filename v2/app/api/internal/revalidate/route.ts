import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { invalidateOnDemandArchive } from "@/lib/family-archive";
import { ON_DEMAND_ARCHIVE_PATHS } from "@/lib/render-on-demand";

function authorized(request: Request) {
  const expected = process.env.INGESTION_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Called by the local worker / Organizer after a write that should be visible before the next
// 300s revalidate window elapses on its own. Body: { paths: string[] } — each is revalidated
// individually so one bad path never blocks the rest.
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const paths = Array.isArray(body?.paths) ? body.paths.filter((p: unknown): p is string => typeof p === "string" && p.startsWith("/") && p.length <= 200) : null;
  if (!paths || paths.length === 0 || paths.length > 50) return NextResponse.json({ error: "paths must be a non-empty array of up to 50 absolute paths" }, { status: 400 });
  for (const path of paths) revalidatePath(path);
  // revalidatePath cannot reach the pages that are rendered on demand — they have no route cache,
  // and the 300s archive memo they read through is module state Next knows nothing about. Clearing
  // it here is what makes a worker push visible on the front page immediately rather than whenever
  // the window happens to lapse. One flag for all three: they share one read.
  const clearedArchiveMemo = paths.some((path: string) => ON_DEMAND_ARCHIVE_PATHS.includes(path));
  if (clearedArchiveMemo) invalidateOnDemandArchive();
  return NextResponse.json({ revalidated: paths, clearedArchiveMemo });
}
