/**
 * R8 name-correction: replace "泰德" → "Ted" in prenatal stories and people fields.
 * Uses applyClaudeStoryCorrection (versioned, idempotent).
 *
 * Usage:
 *   node --import tsx scripts/r8-name-correction.mjs [--dry-run] [--commit]
 */
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run") || !args.includes("--commit");

const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
process.env.DATABASE_URL = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
process.env.REPOSITORY_BACKEND = "postgres";

const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
const { getPool } = await import("../lib/db/client.ts");
const repo = createPostgresRepository();
const pool = getPool();

const PROMPT_VERSION = "r8-name-correction-v1";
const POLICY_VERSION = "r8-name-correction-policy-v1";
const AUTH_REASON = "authorized-by:teddy-2026-09-16";

async function getCurrentStory(eventId) {
  const v = await repo.getStoryContentVersion(eventId);
  if (!v) throw new Error(`Event not found: ${eventId}`);
  return v;
}

async function getRawRow(eventId) {
  const r = await pool.query("SELECT title, story, people FROM life_events WHERE id=$1", [eventId]);
  if (!r.rows[0]) throw new Error(`Not found: ${eventId}`);
  return r.rows[0];
}

// Only events where the story or people contain "泰德"
const corrections = [
  {
    eventId: "93914a2f-c6ec-460e-b086-866a23396dea",
    label: "NT scan Jun 28 2024",
    // After R8: "苏静很期待这次 NT，说检查之后就可以告诉大家了。NT 那天，泰德发消息说自己去了医院。"
    newStory: "苏静很期待这次 NT，说检查之后就可以告诉大家了。NT 那天，Ted 发消息说自己去了医院。",
    newPeople: ["苏静", "Ted"],
    reasonCodes: [AUTH_REASON, "correction:name-泰德→Ted", "correction:user-identity-canonical-name"],
  },
  {
    eventId: "2ecb20ca-c6dc-4b8e-9c35-dc0b0df0a177",
    label: "张年 first named Nov 6 2024",
    // After R8: "苏静问起证件的事。泰德说，孩子可能是最后一批合法美宝了。"
    newStory: "苏静问起证件的事。Ted 说，孩子可能是最后一批合法美宝了。",
    newPeople: ["苏静", "Ted"],
    reasonCodes: [AUTH_REASON, "correction:name-泰德→Ted", "correction:user-identity-canonical-name"],
  },
  // Story 3 (52a28aea) has no 泰德 in text and people=["苏静"] — no change needed
];

console.log(`Name correction: 泰德→Ted (${DRY_RUN ? "DRY RUN" : "LIVE"})\n`);

const results = [];
for (const c of corrections) {
  console.log(`── ${c.label} (${c.eventId.slice(0, 8)}) ──`);
  const v = await getCurrentStory(c.eventId);
  console.log(`  Current story: ${v.content.story}`);
  console.log(`  New story:     ${c.newStory}`);
  if (DRY_RUN) {
    console.log(`  [DRY RUN]\n`);
    results.push({ eventId: c.eventId, status: "dry-run" });
    continue;
  }
  try {
    const r = await repo.applyClaudeStoryCorrection({
      eventId: c.eventId,
      currentContentSha256: v.contentSha256,
      newStory: c.newStory,
      newPeople: c.newPeople,
      promptVersion: PROMPT_VERSION,
      policyVersion: POLICY_VERSION,
      reasonCodes: c.reasonCodes,
    });
    console.log(`  Status: ${r.idempotent ? "idempotent" : "applied"}  newSha: ${r.newContentSha256.slice(0, 12)}\n`);
    results.push({ eventId: c.eventId, status: r.idempotent ? "idempotent" : "applied" });
  } catch (err) {
    if (err?.message?.includes("STALE_REVIEW_CONTENT")) {
      const row = await getRawRow(c.eventId);
      if (row.story === c.newStory) {
        console.log(`  Status: idempotent-content-match\n`);
        results.push({ eventId: c.eventId, status: "idempotent-content-match" });
      } else {
        console.error(`  ERROR stale sha, story mismatch: ${row.story}\n`);
        results.push({ eventId: c.eventId, status: "error", error: err.message });
      }
    } else {
      console.error(`  ERROR: ${err.message}\n`);
      results.push({ eventId: c.eventId, status: "error", error: err.message });
    }
  }
}

console.log("Summary:", JSON.stringify(results));
await pool.end();
tunnel.close();
