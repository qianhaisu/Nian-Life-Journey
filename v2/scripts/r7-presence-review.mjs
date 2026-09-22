/**
 * R7 presence-assertion systematic review.
 * Reads R7-CODEX-EVIDENCE-PACK.json and for every story:
 *   1. Identifies presence assertions ("也在/陪着/一起/也来/陪在")
 *   2. Checks whether each asserted person has a substantive source (not noise)
 *   3. Checks people field against verified source speakers
 *   4. Detects people inflation (window speakers vs event participants)
 *   5. Outputs a JSONL findings ledger
 *
 * This is READ-ONLY — no DB writes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const EVIDENCE_PACK_PATH =
  "C:/Users/teddy/Documents/NianlifeOps/artifacts/NIGHT-RELATIONS-20260921/R7-CODEX-EVIDENCE-PACK.json";
const OUTPUT_PATH =
  "C:/Users/teddy/Documents/NianlifeOps/artifacts/NIGHT-RELATIONS-20260921/R7-presence-review.jsonl";

// Patterns that assert physical presence/participation in an event
const PRESENCE_PATTERNS = [
  /(\S{1,6})也在/g,       // 雪姨也在
  /(\S{1,6})陪着/g,       // 妈妈陪着
  /(\S{1,6})也来/g,       // 奶奶也来
  /(\S{1,6})一起/g,       // 和妈妈一起
  /和(\S{1,6})一起/g,     // 和妈妈一起
  /(\S{1,6})陪在/g,       // 爸爸陪在
  /这一天(\S{1,6})也在/g, // 这一天妈妈也在
  /(\S{1,6})当天也在/g,
];

// Known noise source text patterns (administrative messages that arrive via WeChat but aren't family speech)
const NOISE_PATTERNS = [
  /【.{1,20}】/,           // 【浙江医院】、【某某系统】
  /点击https?:/,
  /满意度调查/,
  /感谢您的配合/,
  /验证码/,
];

function isNoise(text) {
  return NOISE_PATTERNS.some((p) => p.test(text));
}

// Extract all person-names mentioned in presence assertions within a story
function extractPresenceAssertions(story) {
  const assertions = [];
  const text = story;
  for (const pat of PRESENCE_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      const name = m[1];
      // Filter out generic pronouns
      if (name && !["他", "她", "它", "我", "你", "小年年", "张年", "宝宝", "年年"].includes(name)) {
        assertions.push({ pattern: pat.source, name, context: text.slice(Math.max(0, m.index - 10), m.index + 15) });
      }
    }
  }
  return assertions;
}

// Compute story content hash (story-content-v1 format)
// NOTE: the hash formula from the DB uses the DB's timestamp format and source_ids order.
// Here we use the evidence pack's values, so the hash may differ from DB.
// This hash is for the LEDGER fingerprint only, not for recordClaudeStoryDecision.
function computeStoryFingerprint(story) {
  const payload = JSON.stringify({
    title: story.title,
    storyText: story.story,
    people: story.people,
    sourceIds: story.source_ids ?? story.sourceIds,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 16);
}

function main() {
  console.log("Reading evidence pack...");
  const pack = JSON.parse(readFileSync(EVIDENCE_PACK_PATH, "utf8"));
  const stories = pack.events ?? pack.stories ?? (Array.isArray(pack) ? pack : null);
  if (!stories) throw new Error("Cannot find events/stories array in evidence pack. Keys: " + Object.keys(pack).join(", "));
  console.log(`  ${stories.length} stories loaded`);

  const findings = [];
  let flaggedCount = 0;

  for (const s of stories) {
    const storyText = s.story ?? "";
    const people = s.people ?? [];
    const sources = s.sources ?? [];

    // Build set of known speakers in this event's sources (excluding noise)
    const substantiveSpeakers = new Map(); // narrativeLabel → {senderDigest, displayName}
    const noiseSources = [];
    for (const src of sources) {
      const txt = src.text ?? "";
      const spk = src.speaker;
      if (isNoise(txt)) {
        noiseSources.push(src.id);
        continue;
      }
      // Use sender_digest (snake_case as in the pack) or senderDigest fallback
      const senderDigest = src.sender_digest ?? src.senderDigest;
      if (spk?.known && spk.narrativeLabel) {
        const key = spk.narrativeLabel;
        if (!substantiveSpeakers.has(key)) {
          substantiveSpeakers.set(key, {
            senderDigest,
            displayName: spk.displayName,
            canonicalPersonId: spk.canonicalPersonId,
          });
        }
      }
    }

    const flags = [];

    // 1. Check for presence assertions
    const assertions = extractPresenceAssertions(storyText);
    for (const a of assertions) {
      const asserted = a.name;
      // Check if this person has a substantive source
      const hasSource = substantiveSpeakers.has(asserted);
      if (!hasSource) {
        flags.push({
          type: "unsupported_presence_assertion",
          assertedPerson: asserted,
          context: a.context,
          note: `Story says '${asserted}也在/陪着/一起' but ${asserted} has no substantive source message in this event's source_ids`,
        });
      }
    }

    // 2. Check people field inflation
    const inflatedPeople = [];
    for (const person of people) {
      if (!substantiveSpeakers.has(person)) {
        // Check if this person at least appears in story text as a reactor/addressee
        const inStory = storyText.includes(person);
        inflatedPeople.push({
          person,
          hasSubstantiveSource: false,
          appearsInStory: inStory,
          note: `${person} is in people[] but has no substantive source message`,
        });
      }
    }
    if (inflatedPeople.length > 0) {
      flags.push({
        type: "people_field_inflation",
        inflatedPeople,
        verifiedPeople: Array.from(substantiveSpeakers.keys()),
        suggestedPeople: Array.from(substantiveSpeakers.keys()),
      });
    }

    // 3. Check for generic subject inference flags
    // (Stories that use "也在" + only non-participant source)
    if (noiseSources.length > 0 && sources.length <= 2 && substantiveSpeakers.size === 0) {
      flags.push({
        type: "story_with_only_noise_sources",
        noiseSources,
        note: "All source messages appear to be noise (system/admin messages). Story content has no speaker backing.",
      });
    }

    const fingerprint = computeStoryFingerprint(s);

    if (flags.length > 0) {
      flaggedCount++;
      findings.push({
        eventId: s.id,
        date: s.date ?? s.occurred_at,
        title: s.title,
        storySnippet: storyText.slice(0, 120),
        people,
        verifiedSpeakers: Array.from(substantiveSpeakers.keys()),
        noiseSources,
        flags,
        fingerprint,
        sourceCount: sources.length,
        substantiveSourceCount: substantiveSpeakers.size,
      });
    }
  }

  console.log(`\nScan complete: ${stories.length} stories, ${flaggedCount} flagged`);

  const lines = findings.map((f) => JSON.stringify(f)).join("\n");
  writeFileSync(OUTPUT_PATH, lines + "\n", "utf8");
  console.log(`Findings written to ${OUTPUT_PATH}`);

  // Summary by flag type
  const typeCounts = {};
  for (const f of findings) {
    for (const flag of f.flags) {
      typeCounts[flag.type] = (typeCounts[flag.type] ?? 0) + 1;
    }
  }
  console.log("\nFlag type summary:");
  for (const [t, n] of Object.entries(typeCounts)) {
    console.log(`  ${t}: ${n}`);
  }

  // Show the specific examples Codex called out
  const CODEX_SAMPLES = [
    "event-q169-022-f810a0a9",
    "event-v2-a72fc3b4a3dcd28d18aac2a36d1c75bd",
    "event-v2-1c0c1b525b1c4bc0f4e2bf7eafc2988e",
    "event-v2-47ff9a9a18c7d0fa29f45b75944b0846",
  ];
  console.log("\nCodex-named sample events:");
  for (const id of CODEX_SAMPLES) {
    const found = findings.find((f) => f.eventId === id);
    if (found) {
      console.log(`  ${id}: FLAGGED — ${found.flags.map((f) => f.type).join(", ")}`);
    } else {
      const inPack = stories.find((s) => s.id === id);
      console.log(`  ${id}: ${inPack ? "IN PACK, NOT FLAGGED (no pattern match)" : "NOT IN PACK"}`);
    }
  }
}

main();
