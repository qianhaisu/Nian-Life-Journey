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

// NOTE: v1 was already applied for 3 events. This run uses v2 for event-v2-65303546 re-correction.
// event-q169-022-f810a0a9 is blocked by a genuine commander release approval; noted in STATUS.md.
const PROMPT_VERSION = "r7-presence-correction-v2";
const POLICY_VERSION = "r7-presence-correction-v2";
const CLAUDE_AUTHORIZATION_REASON = "authorized-by:teddy-2026-09-16";
// The known r7-regression-fix batch inserted reviews with provider="agent" via direct SQL.
// These are programmatic Claude Code decisions, not human editorial approvals.
// Scope the override to exact provenance: prompt_version="agent-review-20260922-v1" only.
const LEGACY_BATCH_OVERRIDE = ["agent-review-20260922-v1"];

/**
 * v1 fixes (already applied 2026-09-22):
 *   - event-v2-a72fc3b4a3dcd28d18aac2a36d1c75bd: removed "妈妈也在", people→["爸爸"] ✓
 *   - event-v2-1c0c1b525b1c4bc0f4e2bf7eafc2988e: removed "这一天妈妈也在", people→["奶奶"] ✓
 *   - event-v2-65303546bc257919a7f28d487ffe357a: replaced "那天奶奶和爷爷也在" → "那天爷爷也在" ← WRONG (chat ≠ presence)
 *
 * Blocked (human commander approval):
 *   - event-q169-022-f810a0a9: needs human override to fix "奶奶也在"; noted in R7-STATUS.md
 *
 * This run (v2):
 *   - Re-correct event-v2-65303546: remove "那天爷爷也在" entirely (爷爷 sent chat msg ≠ physical presence)
 */
const FIXES = [
  {
    id: "event-v2-65303546bc257919a7f28d487ffe357a",
    snippetReplace: { old: "那天爷爷也在。", new: "" },
    newPeople: ["妈妈", "爷爷"],  // both sent substantive messages in this event's thread
    evidence: "Codex 15:29 finding: chat speech is NOT presence evidence. '那天爷爷也在' removed — 爷爷 commented in chat but that doesn't confirm physical co-presence. '爷爷' stays in people[] since he participated in the conversation thread.",
    reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "correction:presence-assertion"],
    legacyBatchOverridePromptVersions: LEGACY_BATCH_OVERRIDE,
  },
];

// --- setup tunnel + env before importing repository ---
console.log("Opening RDS tunnel…");
const tunnel = await openTunnel();
const tunnelUrl = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
process.env.DATABASE_URL = tunnelUrl;
process.env.DATABASE_URL_UNPOOLED = tunnelUrl;

// Import repository AFTER env is set so getPool() picks up the tunnel URL
const { createPostgresRepository } = await import("../lib/db/postgres-repository.js");

const repo = createPostgresRepository(process.env);

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
      promptVersion: PROMPT_VERSION,
      policyVersion: POLICY_VERSION,
      reasonCodes: fix.reasonCodes,
      legacyBatchOverridePromptVersions: fix.legacyBatchOverridePromptVersions ?? [],
    });

    if (result.idempotent) {
      console.log(`  IDEMPOTENT: already applied for promptVersion=${PROMPT_VERSION}`);
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
