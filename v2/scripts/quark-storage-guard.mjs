// Phase 3B2b: shared preflight for every real (non-dry-run) Quark ingest CLI entry point
// (quark-heic-ingest.mjs, quark-history-init.mjs, quark-photo-init.mjs,
// tools/quark-connector/apply-artifact.ts). One tested place to answer "is
// MEDIA_STORAGE_PROVIDER usable for a real write, and which MediaLocation.provider tag will this
// run's writes carry" — instead of four copies of the same R2_*/OSS_* variable list, each of which
// used to hard-require exactly "r2" and reject "oss" outright.
import { getR2Config } from "../lib/storage/hot-storage.ts";
import { getOssConfig } from "../lib/storage/oss-storage.ts";

// Deliberately stricter than lib/storage/hot-storage.ts's activeMediaProvider(): that function
// drives live app read/write ROUTING, where an unset/unrecognized value safely defaulting to
// "hot" (R2 in production, local disk in dev) is the right call — a page can always re-derive a
// thumbnail. A one-shot CLI ingest's writes are meant to be PERMANENT; silently defaulting an
// unset or misspelled MEDIA_STORAGE_PROVIDER to local disk would quietly write "permanent"
// originals into a directory that disappears with the process. So here, exactly "r2" or "oss" are
// the only accepted values — anything else (including unset) fails before any database read or
// object write, matching every one of these scripts' existing fail-fast-at-the-top style.
//
// Returns the MediaLocation.provider tag this run's writes must carry: "r2" storage tags "hot"
// (matching activeMediaProvider()'s own mapping — the physical R2 backend is tagged "hot" in the
// database, "oss" is a separate tier), "oss" storage tags "oss".
export function requireQuarkStorageProvider(env = process.env) {
  const value = env.MEDIA_STORAGE_PROVIDER;
  if (value !== "r2" && value !== "oss") {
    throw new Error(`MEDIA_STORAGE_PROVIDER must be "r2" or "oss" for a real (non-dry-run) Quark ingest — got ${value === undefined ? "unset" : JSON.stringify(value)}`);
  }
  // Reuses the SAME config validators the storage adapters themselves use — one place names each
  // backend's required variables (lib/storage/hot-storage.ts's getR2Config, lib/storage/
  // oss-storage.ts's getOssConfig), not four hand-rolled copies of the same list. Each throws with
  // the specific missing variable name(s) when incomplete, and never requires the OTHER backend's
  // credentials.
  if (value === "r2") getR2Config(env);
  else getOssConfig(env);
  return value === "oss" ? "oss" : "hot";
}
