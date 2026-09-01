import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(scriptDir, "..", "..");

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

process.env.AI_PROVIDER = "gemini";
process.env.AI_ORGANIZER_PROMPT_VERSION = (process.env.AI_ORGANIZER_PROMPT_VERSION ?? "v2").toLowerCase();

const { createConfiguredAIProvider } = await import("../lib/organizer/provider.ts");
const { validateOrganizerDecision } = await import("../lib/organizer/schema.ts");
const { validateOrganizerDecisionV2 } = await import("../lib/organizer/schema-v2.ts");
const { applyOrganizerPolicy } = await import("../lib/organizer/policy.ts");

if (!process.env.GEMINI_API_KEY || !process.env.AI_MODEL) {
  console.error("GEMINI_API_KEY and AI_MODEL must be set in v2/.env.local before running this script.");
  process.exit(1);
}
if (process.env.AI_MODEL !== "gemini-3.6-flash") {
  console.error("AI_MODEL must be gemini-3.6-flash for this smoke test; refusing to switch models.");
  process.exit(1);
}
if (process.env.AI_ORGANIZER_PROMPT_VERSION !== "v2") {
  console.error("AI_ORGANIZER_PROMPT_VERSION must be v2 for this smoke test; run the V2 evaluation gate first.");
  process.exit(1);
}

// Reuses the V1 "food guide" stock photos (repo assets, unrelated to organizer content) as neutral
// non-family image inputs, so this smoke test never touches real child/family media.
const imageDir = path.join(repoRoot, "assets", "images", "food-guide");
const files = ["bakery.jpg", "noodles.jpg", "restaurant.jpg", "convenience-store.jpg"];

const mediaInputs = files.map((filename, index) => ({
  sourceId: "smoke-source-1",
  mediaId: `smoke-media-${index + 1}`,
  variant: "web",
  mimeType: "image/jpeg",
  bytes: readFileSync(path.join(imageDir, filename)),
}));

const context = {
  profileId: "smoke-profile",
  sourceSummaries: [
    {
      id: "smoke-source-1",
      sourceType: "family_photo",
      contentTypes: ["daily", "family"],
      contributorId: "smoke-parent",
      capturedAt: "2026-08-29T10:00:00.000Z",
      sourceLabel: "Non-sensitive smoke test photos (stock food/store images)",
      mediaCount: mediaInputs.length,
      media: mediaInputs.map((input) => ({ id: input.mediaId, mediaType: "photo", mimeType: input.mimeType, hasPoster: false })),
    },
  ],
  existingMemories: [],
  mediaInputs,
  inputSourceCount: 1,
  representativeMediaCount: mediaInputs.length,
  generatedAt: new Date().toISOString(),
  organizationFingerprint: "smoke-multimodal",
};

const provider = createConfiguredAIProvider(process.env);
console.log(`Multimodal smoke test: provider=${provider.name} model=${provider.model} images=${mediaInputs.length}\n`);

const startedAt = Date.now();
try {
  const response = await provider.organize(context);
  const latencyMs = Date.now() - startedAt;
  const validated = process.env.AI_ORGANIZER_PROMPT_VERSION === "v2" ? validateOrganizerDecisionV2(response.decision, context) : validateOrganizerDecision(response.decision, context);
  const evaluated = applyOrganizerPolicy(validated, context);
  console.log(`action: ${evaluated.decision.action}`);
  console.log(`confidence: ${evaluated.decision.confidence}`);
  console.log(`unsupportedFactCount: ${evaluated.unsupportedFactCount}`);
  console.log(`story: ${evaluated.decision.shortStory ?? "(none)"}`);
  console.log(`reason: ${evaluated.decision.reason}`);
  console.log(`latencyMs: ${latencyMs}`);
  console.log(`usage: ${JSON.stringify(response.usage ?? {})}`);
} catch (error) {
  console.error(`Smoke test failed (this is what would safely degrade to store_only in production, per lib/organizer/ai.ts): ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
