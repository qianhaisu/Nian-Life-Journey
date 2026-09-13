// What a change to the archive has to tell the running site, so a family page shows it on the next
// request instead of whenever a cache window happens to lapse.
//
// Why this exists (2026-09-13). Two symptoms from one cause:
//   - "直链能开但月页无入口": a newly published story's /events/<id> rendered fresh on its first
//     request — nothing had cached that id yet — while its month page kept serving HTML rendered
//     before the publish. The month is ISR with a 300s window and stale-while-revalidate, so the
//     first request after the window STILL gets the old page and only triggers the re-render; the
//     story appeared in the month on the request after that. Checking reachability therefore took
//     "several rounds of warming", and a scan that happened to land inside the window measured the
//     past.
//   - The publish wrote the database directly. Nothing called /api/internal/revalidate, and the one
//     caller that does (scripts/nianlife-worker.mjs) only knows the months it imported.
//
// The site's family pages all read one archive (lib/family-archive.ts), so a change to it can alter
// any of them: a story's month, its year, the /memory index card, the neighbouring stories' 上一篇 /
// 下一篇. Guessing the affected subset is the failure above in another form. `scope: "archive"`
// refreshes all of them — three route patterns plus the on-demand pages' shared read — and costs
// only a re-render on each page's next visit, never a database read now.
import { ON_DEMAND_ARCHIVE_PATHS } from "@/lib/render-on-demand";

export type RefreshTarget = { path: string; type?: "page" };

// Every ISR route rendered from the archive. A dynamic route listed with type "page" makes Next
// revalidate every concrete path under it (revalidatePath("/memory/[year]/[month]", "page")).
export const ARCHIVE_ISR_ROUTES: readonly string[] = ["/memory/[year]", "/memory/[year]/[month]", "/events/[id]"];

// Pages rendered on demand that read the archive through the shared memo. /preview is the private
// preview surface; it reads the same memo, so it is cleared by the same notice.
const MEMO_READERS: readonly string[] = [...ON_DEMAND_ARCHIVE_PATHS, "/preview"];

export function archiveRefreshTargets(): RefreshTarget[] {
  return [
    ...ARCHIVE_ISR_ROUTES.map((path) => ({ path, type: "page" as const })),
    ...MEMO_READERS.map((path) => ({ path })),
  ];
}

// A path the archive renders. Any of these arriving in a notice means the archive changed, and the
// memoised read behind /, /memory, /about and /preview is dropped too — a month path alone used to
// leave the /memory index up to 300s behind the month it links to.
export function isArchivePath(path: string): boolean {
  return MEMO_READERS.includes(path) || /^\/(memory|events|preview)(\/|$)/.test(path);
}

export type RefreshRequest =
  | { ok: true; scope: "archive" | "paths"; targets: RefreshTarget[]; clearsArchiveMemo: boolean }
  | { ok: false; error: string };

// Body: `{ scope: "archive" }` for everything the archive renders, or `{ paths: string[] }` (1–50
// absolute paths) for exactly those. Anything else is refused rather than half-applied.
export function parseRefreshRequest(body: unknown): RefreshRequest {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : undefined;
  if (record?.scope === "archive") {
    return { ok: true, scope: "archive", targets: archiveRefreshTargets(), clearsArchiveMemo: true };
  }
  const raw = record?.paths;
  const paths = Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string" && p.startsWith("/") && p.length <= 200) : null;
  if (!paths || paths.length === 0 || paths.length > 50) {
    return { ok: false, error: 'send { "scope": "archive" } or paths as a non-empty array of up to 50 absolute paths' };
  }
  return { ok: true, scope: "paths", targets: paths.map((path) => ({ path })), clearsArchiveMemo: paths.some(isArchivePath) };
}
