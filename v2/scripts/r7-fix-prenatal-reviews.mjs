import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
const client = new pg.Client({ connectionString: tunnelDatabaseUrl(tunnel.env, tunnel.localPort), ssl: { rejectUnauthorized: false } });
await client.connect();

const PROFILE_ID = "profile-zhangnian";
const events = [
  { id: "93914a2f-c6ec-460e-b086-866a23396dea", label: "NT-Jun" },
  { id: "2ecb20ca-c6dc-4b8e-9c35-dc0b0df0a177", label: "张年-first-named" },
];

for (const ev of events) {
  const existing = await client.query(
    "SELECT id FROM content_quality_reviews WHERE target_kind=$1 AND target_id=$2 AND prompt_version=$3",
    ["life_event", ev.id, "prenatal-story-writer-v1"]
  );
  if (existing.rows.length) { console.log(`${ev.label}: review already exists`); continue; }
  const reviewId = randomUUID();
  const fp = createHash("sha256").update(`prenatal-approved|${ev.id}`).digest("hex").slice(0, 32);
  await client.query(
    `INSERT INTO content_quality_reviews
     (id, profile_id, target_kind, target_id, decision, provider, prompt_version,
      policy_version, reason_codes, review_fingerprint)
     VALUES ($1,$2,'life_event',$3,'approved','claude-review','prenatal-story-writer-v1',
      'prenatal-story-policy-v1',$4,$5)`,
    [reviewId, PROFILE_ID, ev.id,
     JSON.stringify(["authorized-by:teddy-2026-09-22", "prenatal-story:approved"]), fp]
  );
  console.log(`${ev.label}: review inserted`);
}

await client.end();
tunnel.close();
console.log("Done");
