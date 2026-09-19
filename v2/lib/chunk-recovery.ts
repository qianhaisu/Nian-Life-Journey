// A stale prefetched route can refer to a chunk removed by a later deployment.
// Reload only these asset failures, and at most once per URL per minute.
const RETRY_WINDOW_MS = 60_000;
const KEY = "nianlife:chunk-recovery";

export function isChunkLoadError(error: { name?: string; message?: string }): boolean {
  return error.name === "ChunkLoadError" ||
    /Loading (?:CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message ?? "");
}

export function claimChunkReload(
  error: { name?: string; message?: string },
  storage: Pick<Storage, "getItem" | "setItem">,
  url: string,
  now = Date.now(),
): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const previous = JSON.parse(storage.getItem(KEY) ?? "null") as { url?: string; at?: number } | null;
    if (previous?.url === url && typeof previous.at === "number" && now - previous.at < RETRY_WINDOW_MS) return false;
    // Write before reloading so even persistent network failures cannot loop.
    storage.setItem(KEY, JSON.stringify({ url, at: now }));
    return true;
  } catch {
    // Without durable session state, offer a manual retry instead of risking a loop.
    return false;
  }
}
