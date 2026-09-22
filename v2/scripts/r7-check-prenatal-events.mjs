import path from "node:path";
import { config as loadDotenv } from "dotenv";
import pg from "pg";
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
const client = new pg.Client({ connectionString: tunnelDatabaseUrl(tunnel.env, tunnel.localPort), ssl: { rejectUnauthorized: false } });
await client.connect();

const rows = await client.query(`
  SELECT e.id, e.title, e.occurred_at::date as date, e.memory_weight, e.organizer_version,
         r.decision
  FROM life_events e
  LEFT JOIN content_quality_reviews r ON r.target_kind='life_event' AND r.target_id=e.id
  WHERE e.occurred_at < '2025-01-01'
  ORDER BY e.occurred_at
`);
console.log(`\nPrenatal life_events (occurred_at < 2025-01-01): ${rows.rows.length}`);
for (const r of rows.rows) {
  console.log(`  ${r.date}  [${r.decision ?? 'NO REVIEW'}]  ${r.title}  (${r.organizer_version})`);
}

await client.end();
tunnel.close();
