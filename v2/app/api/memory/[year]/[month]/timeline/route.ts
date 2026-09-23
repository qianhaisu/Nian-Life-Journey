import { NextResponse } from "next/server";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildMonthTimeline, weekEntries } from "@/lib/month-timeline";

// One week of an edited month's timeline, for 「更多」 on the month page (components/month-timeline.tsx).
//   GET /api/memory/2026/09/timeline?week=week-2 → { entries }   that week's days, in reading order
//   GET /api/memory/2026/09/timeline             → { order, weeks, stats }   the month's outline and
//                                                  the merge counts (scripts/check-month-merge.mjs)
// A GET, not a server action: the public entry forwards only GET/HEAD (Caddyfile.ecs), which is why
// the album moved to a route too (lib/month-album-request.ts). Same composition as the page, nothing
// wider; the archive read is the shared 300s on-demand memo the album route uses, never getStore().
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request, { params }: { params: Promise<{ year: string; month: string }> }) {
  const { year, month } = await params;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) return NextResponse.json({ error: "year must be YYYY and month MM" }, { status: 400, headers: NO_STORE });
  const week = new URL(request.url).searchParams.get("week");
  if (week !== null && !/^week-\d{1,2}$/.test(week)) return NextResponse.json({ error: "week must be week-N" }, { status: 400, headers: NO_STORE });
  const timeline = await buildMonthTimeline(await loadFamilyArchiveOnDemand(), year, month);
  if (!timeline) return NextResponse.json({ error: "no edited content for this month" }, { status: 404, headers: NO_STORE });
  if (week === null) return NextResponse.json({ order: timeline.order, weeks: timeline.weeks, stats: timeline.stats }, { headers: NO_STORE });
  const entries = weekEntries(timeline, week);
  if (!entries) return NextResponse.json({ error: "no such week" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ entries }, { headers: NO_STORE });
}
