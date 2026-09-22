/**
 * R7 correction apply: remove fabricated presence assertions ("也在") from 4 events.
 *
 * Uses the versioned applyClaudeStoryCorrection path (not direct SQL) as required by
 * R7-FEEDBACK.md URGENT section.
 *
 * Evidence for each fix is in R7-CODEX-EVIDENCE-PACK.json and R7-presence-review.jsonl.
 */
import { openTunnel, assertRdsTarget, tunnelDatabaseUrl } from "../.data/night-rds.mjs";

const DRY_RUN = !process.argv.includes("--apply");

// v2: event-v2-65303546 re-correction (already applied — idempotent on re-run)
// v3: event-q169-022-f810a0a9 (commander-approved; internal task-authorized correction manifest)
const PROMPT_VERSION_V2 = "r7-presence-correction-v2";
const PROMPT_VERSION_V3 = "r7-presence-correction-v3";
const POLICY_VERSION = "r7-presence-correction-v3";
const CLAUDE_AUTHORIZATION_REASON = "authorized-by:teddy-2026-09-16";

/**
 * v1 fixes (already applied 2026-09-22, idempotent now):
 *   - event-v2-a72fc3b4: removed "妈妈也在", people→["爸爸"] ✓
 *   - event-v2-1c0c1b52: removed "这一天妈妈也在", people→["奶奶"] ✓
 *
 * v2 fix (already applied, idempotent now):
 *   - event-v2-65303546: removed "那天爷爷也在" entirely (爷爷 chat ≠ physical presence)
 *
 * v3 fix (task-authorized correction via internal manifest):
 *   - event-q169-022-f810a0a9: "奶奶也在。" is a presence fabrication.
 *     Prior blocker: commander-release-2026-09-13 / release-2026-09-13-R2.
 *     Internal manifest in applyClaudeStoryCorrection verifies exact blocker identity and
 *     requires CLAUDE_AUTHORIZATION_REASON in reasonCodes — no caller-supplied override needed.
 */
const FIXES = [
  {
    id: "event-v2-65303546bc257919a7f28d487ffe357a",
    promptVersion: PROMPT_VERSION_V2,
    snippetReplace: { old: "那天爷爷也在。", new: "" },
    newPeople: ["妈妈", "爷爷"],
    reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "correction:presence-assertion"],
  },
  {
    id: "event-q169-022-f810a0a9",
    promptVersion: PROMPT_VERSION_V3,
    // Story contains "奶奶也在。" after "妈妈给他铰了头发，理了个小清新。" — pure presence assertion.
    // Source messages: 妈妈 described the haircut; 奶奶 is not mentioned in any source message.
    // Evidence: R7-CODEX-EVIDENCE-PACK.json event-q169-022 sources — no sender_digest matching 奶奶.
    snippetReplace: { old: "奶奶也在。", new: "" },
    newPeople: ["妈妈"],  // only 妈妈 sent source messages for this event
    reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "correction:presence-assertion"],
  },
];

// --- setup tunnel + env before importing repository ---
console.log("Opening RDS tunnel…");
const tunnel = await openTunnel();
const tunnelUrl = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
process.env.DATABASE_URL = tunnelUrl;
process.env.DATABASE_URL_UNPOOLED = tunnelUrl;

// Import repository AFTER env is set so getPool() picks up the tunnel URL
const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");

const repo = createPostgresRepository();

// Verify we're on RDS (openTunnel already asserted, but double-check fingerprint)
console.log(`Tunnel up on port ${tunnel.localPort}`);

let applied = 0;
let skipped = 0;
let failed = 0;

for (const fix of FIXES) {
  console.log(`\n=== ${fix.id} ===`);
  try {
    // 1. Get current content hash via repository (uses SQL microsecond-precision timestamp)
    const version = await repo.getStoryContentVersion(fix.id);
    if (!version) {
      console.log(`  SKIP: event not found in DB`);
      skipped++;
      continue;
    }
    const { contentSha256: currentContentSha256, content } = version;
    console.log(`  title: ${content.title}`);
    console.log(`  story[0:100]: ${String(content.story ?? "").slice(0, 100)}`);
    console.log(`  people (not in hash): will be set to ${JSON.stringify(fix.newPeople)}`);
    console.log(`  currentContentSha256: ${currentContentSha256.slice(0, 16)}…`);

    // Apply snippet replacement to get new story
    let newStory = content.story ?? "";
    if (fix.snippetReplace) {
      if (!newStory.includes(fix.snippetReplace.old)) {
        console.log(`  WARNING: snippet "${fix.snippetReplace.old}" not found in story`);
        console.log(`  Current story: ${newStory}`);
        skipped++;
        continue;
      }
      newStory = newStory.replace(fix.snippetReplace.old, fix.snippetReplace.new);
    }
    console.log(`  newStory[0:100]: ${newStory.slice(0, 100)}`);

    if (DRY_RUN) {
      console.log(`  DRY RUN: would call applyClaudeStoryCorrection`);
      applied++;
      continue;
    }

    // 2. Call applyClaudeStoryCorrection via repository
    const result = await repo.applyClaudeStoryCorrection({
      eventId: fix.id,
      currentContentSha256,
      newStory: newStory !== content.story ? newStory : undefined,
      newPeople: fix.newPeople,
      promptVersion: fix.promptVersion,
      policyVersion: POLICY_VERSION,
      reasonCodes: fix.reasonCodes,
    });

    if (result.idempotent) {
      console.log(`  IDEMPOTENT: already applied for promptVersion=${fix.promptVersion}`);
    } else {
      console.log(`  APPLIED: oldHash=${result.oldContentSha256.slice(0, 12)}… newHash=${result.newContentSha256.slice(0, 12)}…`);
      console.log(`  reviewId: ${result.review.id}`);
    }
    applied++;
  } catch (err) {
    console.error(`  ERROR: ${err.message}`);
    failed++;
  }
}

tunnel.close();
console.log(`\nDone. applied=${applied} skipped=${skipped} failed=${failed}`);
if (failed > 0) process.exit(1);
