// One-shot seed: inserts the missing monthly_snapshot row for 2026-08.
// Run after pulling Vercel env vars:
//   vercel env pull .env.local --environment production --yes
//   node --env-file=.env.local scripts/seed-monthly-snapshot.mjs
import pg from "pg";

const { Client } = pg;

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

const result = await client.query(`
  INSERT INTO "monthly_snapshot" ("id", "profile_id", "month", "summary", "highlights", "visibility", "created_at")
  VALUES (
    'snapshot-2026-08',
    'profile-zhangnian',
    '2026-08',
    '这个月，他开始说更多话，也越来越会回应我们了。',
    '["开始说\\"车车\\"", "走路更稳", "主动翻绘本", "会追着球跑"]'::jsonb,
    'family',
    now()
  )
  ON CONFLICT ("profile_id", "month") DO NOTHING
  RETURNING id;
`);

if (result.rowCount > 0) {
  console.log("Inserted monthly_snapshot:", result.rows[0].id);
} else {
  console.log("monthly_snapshot already exists — no change.");
}

await client.end();
