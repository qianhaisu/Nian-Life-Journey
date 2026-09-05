import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { requireDatabaseUrl } from "./config";

let pool: Pool | undefined;

// One pool per process. Never created unless something actually asks for it — resolving
// REPOSITORY_BACKEND=json never touches this module's connection path at all.
export function getPool(env: NodeJS.ProcessEnv = process.env): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: requireDatabaseUrl(env) });
    // pg emits 'error' on the pool for a client that fails while idle (e.g. the server or a
    // connection recycler drops it) — that event fires outside any query's promise chain, so
    // without a listener here it becomes an uncaught exception that kills the whole process,
    // not just whatever query happens to be in flight. This only logs; a client actually in use
    // for a query still rejects that query's own promise as normal.
    pool.on("error", (error) => {
      console.error(`pg pool: idle client error (${error instanceof Error ? error.name : "unknown"}) — connection recycled, process continues`);
    });
  }
  return pool;
}

export function getDb(env: NodeJS.ProcessEnv = process.env) {
  return drizzle(getPool(env), { schema });
}

// Import jobs must not turn a resume into N high-latency point lookups.  Keep this deliberately
// narrow: it selects only the two identity columns from media_assets, rather than getStore(),
// which loads the whole archive graph.
export async function getMediaAssetChecksumIndex(env: NodeJS.ProcessEnv = process.env) {
  const rows = await getDb(env)
    .select({ checksum: schema.mediaAssets.checksum, rawSourceId: schema.mediaAssets.rawSourceId, id: schema.mediaAssets.id })
    .from(schema.mediaAssets);
  return new Map(rows
    .filter((row) => typeof row.checksum === "string")
    .map((row) => [row.checksum!.replace(/^sha256:/i, "").toLowerCase(), { id: row.id, rawSourceId: row.rawSourceId }]));
}

export async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}
