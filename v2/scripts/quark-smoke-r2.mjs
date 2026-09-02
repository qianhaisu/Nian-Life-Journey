#!/usr/bin/env node
// Quick smoke: verify 3 Quark web derivatives are readable from R2.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(__dirname, "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";
process.env.MEDIA_STORAGE_PROVIDER = "r2";

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows } = await client.query(`
  SELECT m.id, m.taken_at, m.width, m.height, ml.provider_ref
  FROM media m
  JOIN media_locations ml ON ml.media_asset_id = m.media_asset_id
  WHERE m.raw_source_id LIKE 'source-quark-sha-%'
    AND ml.variant = 'web' AND ml.status = 'ready'
  ORDER BY m.taken_at DESC
  LIMIT 6
`);
await client.end();

const { hotStorage } = await import("../lib/storage/hot-storage.ts");

let ok = 0, miss = 0;
for (const row of rows) {
  const bytes = await hotStorage.get(row.provider_ref);
  if (bytes) {
    const takenAt = row.taken_at instanceof Date ? row.taken_at.toISOString() : String(row.taken_at);
    console.log(`OK ${takenAt.slice(0,10)} ${row.width}x${row.height} ${row.provider_ref} (${bytes.byteLength}B)`);
    ok++;
  } else {
    console.log(`MISSING ${row.provider_ref}`);
    miss++;
  }
}
console.log(`\n${ok} readable, ${miss} missing from R2`);
process.exit(miss > 0 ? 1 : 0);
