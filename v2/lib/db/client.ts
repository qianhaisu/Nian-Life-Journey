import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { requireDatabaseUrl } from "./config";

let pool: Pool | undefined;

// One pool per process. Never created unless something actually asks for it — resolving
// REPOSITORY_BACKEND=json never touches this module's connection path at all.
export function getPool(env: NodeJS.ProcessEnv = process.env): Pool {
  if (!pool) pool = new Pool({ connectionString: requireDatabaseUrl(env) });
  return pool;
}

export function getDb(env: NodeJS.ProcessEnv = process.env) {
  return drizzle(getPool(env), { schema });
}

export async function closePool() {
  if (pool) { await pool.end(); pool = undefined; }
}
