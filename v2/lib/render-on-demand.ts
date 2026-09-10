import { connection } from "next/server";

// Why a page that reads the archive must NOT be prerendered at build time.
//
// The Docker builder stage deliberately gets no DATABASE_URL (v2/Dockerfile: "This image never
// talks to ... at build time"), so `resolveRepositoryBackend()` resolves to "json" during the
// build and every archive read there returns lib/mock-data.ts — the credential-less local-dev
// fixture. For a route with dynamic params that only meant "don't enumerate", and
// `buildTimeArchiveEnumerationAllowed()` (lib/db/config.ts, 2026-09-06) handles it. For a route
// with NO params there is nothing to enumerate: Next prerenders it at build regardless, and the
// mock render is what it freezes into HTML and serves.
//
// That is not theoretical. Verified 2026-09-10 inside the shipped image: `.next/server/app/
// index.html` was 13,141 bytes of seed data — it linked /events/event-car, /events/event-lake and
// /events/event-daycare-ball (all 404 against the real database) — and `memory.html` listed two
// mock months where the archive has twenty-one. Every container start and every deploy served
// that to whoever opened the site first, until each page's own ISR window happened to elapse.
// 原则一's test is what the family sees the first time they open it, so "wrong for the first five
// minutes" is exactly the case that matters.
//
// `connection()` is Next's supported way to say "this render depends on a real request": the page
// is excluded from build-time prerendering and generated on demand instead — the same on-demand
// path the month pages already take. Nothing here shortens a refresh interval or weakens a cache;
// it only stops the build from answering a question it has no data to answer.
export async function renderOnDemand(): Promise<void> {
  await connection();
}

// The routes that call renderOnDemand() and read through loadFamilyArchiveOnDemand(). Named here
// so app/api/internal/revalidate knows which incoming paths mean "the archive changed under the
// on-demand pages" without either file guessing about the other.
export const ON_DEMAND_ARCHIVE_PATHS: readonly string[] = ["/", "/memory", "/about"];
