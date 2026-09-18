import { timingSafeEqual } from "node:crypto";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { parseRefreshRequest } from "@/lib/archive-refresh";
import { invalidateOnDemandArchive } from "@/lib/family-archive";
import { invalidateMonthContent } from "@/lib/month-content";

function authorized(request: Request) {
  const expected = process.env.INGESTION_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected); const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Called after a write that should be visible on the next request rather than after the 300s ISR
// window (plus one more request, because of stale-while-revalidate) elapses on its own.
// Body: { scope: "archive" } — every page the archive renders (lib/archive-refresh.ts says why that
// is the default for any publish) — or { paths: string[] } for exactly those paths. Each target is
// revalidated individually so one bad path never blocks the rest.
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = parseRefreshRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  for (const target of parsed.targets) {
    if (target.type) revalidatePath(target.path, target.type);
    else revalidatePath(target.path);
  }
  // revalidatePath cannot reach the pages that are rendered on demand — they have no route cache,
  // and the 300s archive memo they read through is module state Next knows nothing about. Any path
  // the archive renders clears it: a month path alone used to leave the /memory index behind.
  if (parsed.clearsArchiveMemo) {
    invalidateOnDemandArchive();
    // The edited-month files are read through a memo of the same shape and for the same reason, so
    // they go stale the same way. Cleared on the same signal: a correction to a month's words, or a
    // withdrawn edit, has to be visible on the next request rather than up to 300s later — and an
    // absent file that was remembered as "no content" must be re-checked once one appears.
    invalidateMonthContent();
  }
  return NextResponse.json({
    scope: parsed.scope,
    revalidated: parsed.targets.map((target) => target.type ? `${target.path} (${target.type})` : target.path),
    clearedArchiveMemo: parsed.clearsArchiveMemo,
    clearedMonthContent: parsed.clearsArchiveMemo,
    at: new Date().toISOString(),
  });
}
