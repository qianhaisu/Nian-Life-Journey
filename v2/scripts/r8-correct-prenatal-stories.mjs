/**
 * R8: Correct the 3 prenatal life_events written in R7.
 * Uses applyClaudeStoryCorrection (versioned, safe against human decisions).
 * Idempotent: safe to re-run.
 *
 * Usage:
 *   node --import tsx scripts/r8-correct-prenatal-stories.mjs [--dry-run] [--commit]
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

const PROMPT_VERSION = "r8-prenatal-correction-v1";
const POLICY_VERSION = "r8-prenatal-correction-policy-v1";
const AUTH_REASON = "authorized-by:teddy-2026-09-16"; // CLAUDE_AUTHORIZATION_REASON

// ── read current story from DB ───────────────────────────────────────────────
async function getCurrentStory(eventId) {
  const version = await repo.getStoryContentVersion(eventId);
  if (!version) throw new Error(`Event not found: ${eventId}`);
  return version; // { eventId, contentSha256, content: { title, story, ... } }
}

// For people / display queries
async function getRawRow(eventId) {
  const r = await pool.query("SELECT title, story, people FROM life_events WHERE id=$1", [eventId]);
  if (!r.rows[0]) throw new Error(`Event not found: ${eventId}`);
  return r.rows[0];
}

// ── corrections ───────────────────────────────────────────────────────────────
const corrections = [
  {
    eventId: "93914a2f-c6ec-460e-b086-866a23396dea",
    label: "NT scan Jun 28 2024",
    // "泰德陪着她，一起等结果" has no source evidence.
    // "那天她去了医院" — sender of "我去医院了" is 爸爸, not 苏静.
    // Keep: 苏静 eager for NT, NT = announcement time, 爸爸 went to hospital that day.
    newTitle: "NT 那一天",
    newStory: "苏静很期待这次 NT，说检查之后就可以告诉大家了。NT 那天，泰德发消息说自己去了医院。",
    newPeople: ["苏静", "泰德"],
    reasonCodes: [
      AUTH_REASON,
      "correction:removed-unsourced-accompanying-claim",
      "correction:fixed-sender-attribution-hospital-visit",
      "source:actual-model=deepseek-flash",
      "source:original-approval-provider-was-claude-review-inaccurate",
    ],
  },
  {
    eventId: "2ecb20ca-c6dc-4b8e-9c35-dc0b0df0a177",
    label: "张年 first named Nov 6 2024",
    // "证件还没到手""心里悬着""有人说""安静地等一个确定答案" — all inferred.
    // Keep: 苏静 asked about 证件 risk, 泰德 said "可能成为最后一批合法美宝".
    newTitle: "最后一批",
    newStory: "苏静问起证件的事。泰德说，孩子可能是最后一批合法美宝了。",
    newPeople: ["苏静", "泰德"],
    reasonCodes: [
      AUTH_REASON,
      "correction:removed-unsourced-emotional-framing",
      "correction:removed-unverified-status-claim",
      "correction:preserved-uncertainty-marker",
      "source:actual-model=deepseek-flash",
      "source:original-approval-provider-was-claude-review-inaccurate",
    ],
  },
  {
    eventId: "52a28aea-ec18-41a5-a8ec-d84b0ededb18",
    label: "Final prenatal check Nov 28 2024",
    // Both messages are 苏静 reporting what she was told; 泰德 not in sources.
    // "心里踏实了" — no evidence.
    // Make clear these are 苏静's relayed reports, people = only 苏静.
    newTitle: "一切都好",
    newStory: "苏静说，B 超看起来胎儿很健康，胎心监护结果也很健康。",
    newPeople: ["苏静"],
    reasonCodes: [
      AUTH_REASON,
      "correction:removed-unsourced-joint-reaction",
      "correction:fixed-people-removed-泰德-not-in-sources",
      "correction:made-relay-attribution-explicit",
      "source:actual-model=deepseek-flash",
      "source:original-approval-provider-was-claude-review-inaccurate",
    ],
  },
];

console.log(`Correcting ${corrections.length} prenatal stories (${DRY_RUN ? "DRY RUN" : "LIVE"})\n`);

const results = [];

for (const c of corrections) {
  console.log(`── ${c.label} (${c.eventId.slice(0, 8)}) ──`);
  const current = await getCurrentStory(c.eventId);
  const currentSha = current.contentSha256;

  console.log(`  Current title: ${current.content.title}`);
  console.log(`  Current story: ${current.content.story}`);
  console.log(`  Current sha: ${currentSha.slice(0, 12)}`);
  console.log(`  → New title: ${c.newTitle}`);
  console.log(`  → New story: ${c.newStory}`);
  console.log(`  → New people: ${JSON.stringify(c.newPeople)}`);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would apply correction\n`);
    results.push({ eventId: c.eventId, label: c.label, status: "dry-run" });
    continue;
  }

  try {
    const result = await repo.applyClaudeStoryCorrection({
      eventId: c.eventId,
      currentContentSha256: currentSha,
      newTitle: c.newTitle,
      newStory: c.newStory,
      newPeople: c.newPeople,
      promptVersion: PROMPT_VERSION,
      policyVersion: POLICY_VERSION,
      reasonCodes: c.reasonCodes,
    });
    console.log(`  Status: ${result.idempotent ? "idempotent (already applied)" : "applied"}`);
    console.log(`  New sha: ${result.newContentSha256?.slice(0, 12) ?? "(unchanged)"}\n`);
    results.push({ eventId: c.eventId, label: c.label, status: result.idempotent ? "idempotent" : "applied", sha: result.newContentSha256 });
  } catch (err) {
    if (err?.code === "STALE_REVIEW_CONTENT" || err?.message?.includes("STALE_REVIEW_CONTENT")) {
      // Already corrected — verify current content matches our expected correction
      const after = await getRawRow(c.eventId);
      if (String(after.story) === String(c.newStory) && String(after.title) === String(c.newTitle)) {
        console.log(`  Status: idempotent (content already matches correction)\n`);
        results.push({ eventId: c.eventId, label: c.label, status: "idempotent-content-match" });
      } else {
        console.error(`  ERROR: stale sha but story doesn't match correction. Manual check needed.`);
        console.error(`  Stored: ${after.story}`);
        results.push({ eventId: c.eventId, label: c.label, status: "error", error: err.message });
      }
    } else {
      console.error(`  ERROR: ${err.message}\n`);
      results.push({ eventId: c.eventId, label: c.label, status: "error", error: err.message });
    }
  }
}

console.log("Summary:", JSON.stringify(results, null, 2));

await pool.end();
tunnel.close();
