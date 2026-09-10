export type RepositoryBackend = "postgres" | "json";

// The one profile this site is about. Every read path pins to this id instead of "whichever
// profiles row comes first": a synthetic profile left behind by a contract test must never be
// served as 张年 (that is how the site once showed a 2020 birth date). Writes from scripts and
// tests may target other profile ids; the read layer simply never sees them.
export const CANONICAL_PROFILE_ID = "profile-zhangnian";

// Central, fail-fast resolution — the only place REPOSITORY_BACKEND and DATABASE_URL are read.
// No backend ever falls back to another on error: a bad config throws here, at module load,
// before any request is served, instead of silently degrading a read or write later.
export function resolveRepositoryBackend(env: NodeJS.ProcessEnv = process.env): RepositoryBackend {
  const raw = (env.REPOSITORY_BACKEND ?? "json").trim().toLowerCase();
  if (raw !== "postgres" && raw !== "json") {
    throw new Error(`Unsupported REPOSITORY_BACKEND: "${raw}". Set it to "postgres" or "json", or leave it unset (defaults to "json").`);
  }
  if (raw === "postgres" && !env.DATABASE_URL) {
    throw new Error('REPOSITORY_BACKEND=postgres requires DATABASE_URL to be set. Nothing falls back to the JSON store automatically — set DATABASE_URL or switch REPOSITORY_BACKEND to "json".');
  }
  return raw;
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  return url;
}

// A generateStaticParams that enumerates the archive (which months/years exist) must never bake
// that list in from the local JSON fallback store (lib/mock-data.ts) — that store exists only for
// credential-less local dev, and the Docker builder stage deliberately gets no DATABASE_URL (see
// v2/Dockerfile's comment: "This image never talks to ... at build time"). Left unguarded,
// resolveRepositoryBackend() silently resolves to "json" during that build, so whichever months
// happen to exist in the mock fixture get frozen into static HTML and served — in place of the
// real archive — until each page's own ISR window happens to elapse on a live request. Any
// generateStaticParams that would otherwise call listArchiveMonths() must check this guard first
// and return an empty list when it is false, exactly like app/events/[id]/page.tsx already does
// unconditionally (2026-09-06 incident) — every path still renders correctly at runtime via
// on-demand ISR, where REPOSITORY_BACKEND/DATABASE_URL are the real ones.
export function buildTimeArchiveEnumerationAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.REPOSITORY_BACKEND ?? "").trim().toLowerCase() === "postgres";
}
