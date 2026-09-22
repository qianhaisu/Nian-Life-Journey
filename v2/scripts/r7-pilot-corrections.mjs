/**
 * R7 pilot event corrections:
 * - event-v2-e001ac465066b3df69be2ffea3e46ae1: people→["雪姨"] (妈妈/爸爸 are noise/absent)
 * - event-v2-fe77a21be3bbc242b0b7043fefc5d8ff: people→["妈妈"] (雪姨=noise, 爸爸 absent)
 * - event-v2-47ff9a9a18c7d0fa29f45b75944b0846: porridge semantic fix
 *   Source: "胚芽米，我也可以给他和小米一起熬粥喝"
 *   Story misreads: "胚芽米可以和张年一起熬小米粥喝" (張年 as ingredient)
 *   Correction: "胚芽米可以和小米一起熬粥，给张年喝。"
 *
 * Evidence: R7-pilot.jsonl entries reviewed 2026-09-22 with senderDigest verification.
 */
import { openTunnel, tunnelDatabaseUrl } from "../.data/night-rds.mjs";

const DRY_RUN = !process.argv.includes("--apply");

const PROMPT_VERSION_PILOT = "r7-pilot-people-v1";
const PROMPT_VERSION_PORRIDGE = "r7-semantic-correction-v1";
const POLICY_VERSION = "r7-people-correction-v1";
const CLAUDE_AUTHORIZATION_REASON = "authorized-by:teddy-2026-09-16";

const FIXES = [
  {
    id: "event-v2-e001ac465066b3df69be2ffea3e46ae1",
    promptVersion: PROMPT_VERSION_PILOT,
    // people-only correction: 妈妈 source is hospital SMS noise, 爸爸 absent
    newPeople: ["雪姨"],
    reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "correction:people-inflation"],
  },
  {
    id: "event-v2-fe77a21be3bbc242b0b7043fefc5d8ff",
    promptVersion: PROMPT_VERSION_PILOT,
    // people-only correction: 雪姨 source is off-topic toy question noise, 爸爸 absent
    newPeople: ["妈妈"],
    reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "correction:people-inflation"],
  },
  {
    id: "event-v2-47ff9a9a18c7d0fa29f45b75944b0846",
    promptVersion: PROMPT_VERSION_PORRIDGE,
    // Semantic fix: source "我也可以给他和小米一起熬粥喝" = porridge for 张年, not with 张年
    snippetReplace: {
      old: "胚芽米可以和张年一起熬小米粥喝。",
      new: "胚芽米可以和小米一起熬粥，给张年喝。",
    },
    reasonCodes: [CLAUDE_AUTHORIZATION_REASON, "correction:semantic-misread"],
  },
];

console.log("Opening RDS tunnel…");
const tunnel = await openTunnel();
const tunnelUrl = tunnelDatabaseUrl(tunnel.env, tunnel.localPort);
process.env.DATABASE_URL = tunnelUrl;
process.env.DATABASE_URL_UNPOOLED = tunnelUrl;

const { createPostgresRepository } = await import("../lib/db/postgres-repository.ts");
const repo = createPostgresRepository();

console.log(`Tunnel up on port ${tunnel.localPort}${DRY_RUN ? " [DRY RUN]" : ""}`);

let applied = 0, skipped = 0, failed = 0;

for (const fix of FIXES) {
  console.log(`\n=== ${fix.id} ===`);
  try {
    const version = await repo.getStoryContentVersion(fix.id);
    if (!version) {
      console.log(`  SKIP: event not found in DB`);
      skipped++;
      continue;
    }
    const { contentSha256: currentContentSha256, content } = version;
    console.log(`  title: ${content.title}`);
    console.log(`  story: ${String(content.story ?? "").slice(0, 120)}`);
    console.log(`  current people: ${JSON.stringify(content.people ?? [])}`);

    let newStory = undefined;
    if (fix.snippetReplace) {
      const storyStr = content.story ?? "";
      if (!storyStr.includes(fix.snippetReplace.old)) {
        console.log(`  WARNING: snippet "${fix.snippetReplace.old}" not found — may already be corrected`);
        console.log(`  Current story: ${storyStr}`);
        skipped++;
        continue;
      }
      newStory = storyStr.replace(fix.snippetReplace.old, fix.snippetReplace.new);
      console.log(`  newStory: ${newStory.slice(0, 120)}`);
    }

    if (DRY_RUN) {
      console.log(`  DRY RUN: would apply people=${JSON.stringify(fix.newPeople ?? "(unchanged)")} story=${newStory ? "(changed)" : "(unchanged)"}`);
      applied++;
      continue;
    }

    const result = await repo.applyClaudeStoryCorrection({
      eventId: fix.id,
      currentContentSha256,
      ...(newStory !== undefined ? { newStory } : {}),
      ...(fix.newPeople !== undefined ? { newPeople: fix.newPeople } : {}),
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
