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
