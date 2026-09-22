/**
 * Retry HUMAN_DECISION_PRESENT-blocked semantic review writes from cached verdicts.
 * Reads RESULTS.jsonl for error records that have a retained verdict,
 * and retries only the DB write (no model re-call).
 *
 * Usage:
 *   node --import tsx scripts/r7-retry-blocked-writes.mjs \
 *     --results=<path>/R7-SEMANTIC-REVIEW-RESULTS.jsonl \
 *     [--dry-run]
 */
import { readFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), "../.env.local"), quiet: true });
process.env.REPOSITORY_BACKEND = "postgres";

const args = process.argv.slice(2);
const argOf = (n, fb) => { const h = args.find(a => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : fb; };
const hasFlag = (n) => args.includes(`--${n}`);

const RESULTS_PATH = argOf("results", null);
const DRY_RUN = hasFlag("dry-run");
if (!RESULTS_PATH) { console.error("--results=<path> required"); process.exit(1); }

const CLAUDE_AUTHORIZATION_REASON = "authorized-by:teddy-2026-09-16";
const PROMPT_VERSION = "r7-semantic-review-v1";
const POLICY_VERSION = "r7-semantic-review-policy-v1";

// ── Load error records that have a retained verdict ────────────────────────
const lines = readFileSync(RESULTS_PATH, "utf8").split("\n").filter(Boolean);
const retryable = [];
for (const line of lines) {
  try {
    const rec = JSON.parse(line);
    if (rec.status === "error" && rec.verdict && rec.id && rec.contentSha256) {
      retryable.push(rec);
    }
  } catch {}
}
console.log(`Found ${retryable.length} blocked write records to retry`);
if (DRY_RUN) console.log("[DRY RUN — no DB writes]");

// ── DB setup ───────────────────────────────────────────────────────────────
const { openTunnel, tunnelDatabaseUrl } = await import("../.data/night-rds.mjs");
const tunnel = await openTunnel();
process.env.DATABASE_URL = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;

const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
const { getPool } = await import("../lib/db/client.ts");
const repo = createPostgresRepository();
const pool = getPool();

let approved = 0, flagged = 0, corrected = 0, stillBlocked = 0, stale = 0, failed = 0;

for (const rec of retryable) {
  if (DRY_RUN) { console.log(`  dry-run: ${rec.id?.slice(-12)} verdict=${rec.verdict}`); continue; }

  try {
    if (rec.verdict === "approve") {
      await repo.recordClaudeStoryDecision({
        eventId: rec.id,
        decision: "approved",
        reviewedContentSha256: rec.contentSha256,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:approved", "retry-after-guard-fix"],
      });
      approved++;
    } else if (rec.verdict === "flag") {
      await repo.recordClaudeStoryDecision({
        eventId: rec.id,
        decision: "needs_human_review",
        reviewedContentSha256: rec.contentSha256,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:flagged", "retry-after-guard-fix"],
      });
      flagged++;
    } else if (rec.verdict === "correct_needed") {
      // Corrections that failed due to HUMAN_DECISION_PRESENT were originally flagged as
      // pending_correction_unapplied; just mark needs_human_review here.
      await repo.recordClaudeStoryDecision({
        eventId: rec.id,
        decision: "needs_human_review",
        reviewedContentSha256: rec.contentSha256,
        promptVersion: PROMPT_VERSION,
        policyVersion: POLICY_VERSION,
        reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "semantic-review:correction-blocked", "retry-after-guard-fix"],
      });
      flagged++;
    }
  } catch (e) {
    if (e.message?.includes("STALE_REVIEW_CONTENT")) { stale++; console.log(`  stale: ${rec.id?.slice(-12)}`); }
    else if (e.message?.includes("HUMAN_DECISION_PRESENT")) { stillBlocked++; console.log(`  still-blocked: ${rec.id?.slice(-12)} — ${e.message?.slice(0, 80)}`); }
    else { failed++; console.error(`  error: ${rec.id?.slice(-12)} — ${e.message?.slice(0, 100)}`); }
  }

  const done = approved + flagged + corrected + stillBlocked + stale + failed;
  if (done % 50 === 0 && done > 0) {
    console.log(`  Progress: approved=${approved} flagged=${flagged} still-blocked=${stillBlocked} stale=${stale} failed=${failed}`);
  }
}

await pool.end();
tunnel.close();

console.log(`\nDone.`);
console.log(`  approved=${approved} flagged=${flagged} still-blocked=${stillBlocked} stale=${stale} failed=${failed}`);
