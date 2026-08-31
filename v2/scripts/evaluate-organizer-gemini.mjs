import { existsSync } from "node:fs";
import { config } from "dotenv";

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

process.env.AI_PROVIDER = "gemini";
process.env.AI_ORGANIZER_PROMPT_VERSION = (process.env.AI_ORGANIZER_PROMPT_VERSION ?? "v2").toLowerCase();

const { createConfiguredAIProvider } = await import("../lib/organizer/provider.ts");
const { evaluateAIOrganizer, AI_ORGANIZER_EVALUATION_FIXTURES } = await import("../lib/organizer/evaluation.ts");

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Add it to v2/.env.local before running this script.");
  process.exit(1);
}
if (!process.env.AI_MODEL) {
  console.error("AI_MODEL is not set (use gemini-3.6-flash). Add it to v2/.env.local before running this script.");
  process.exit(1);
}
if (process.env.AI_MODEL !== "gemini-3.6-flash") {
  console.error("AI_MODEL must be gemini-3.6-flash for this evaluation; refusing to switch models.");
  process.exit(1);
}
if (process.env.AI_ORGANIZER_PROMPT_VERSION !== "v2") {
  console.error("AI_ORGANIZER_PROMPT_VERSION must be v2 for this evaluation; use organizer:compare:gemini for the V1 baseline.");
  process.exit(1);
}

const provider = createConfiguredAIProvider(process.env);
console.log(`Running ${AI_ORGANIZER_EVALUATION_FIXTURES.length} synthetic fixtures against provider=${provider.name} model=${provider.model}\n`);

const evaluation = await evaluateAIOrganizer(provider);

for (const result of evaluation.results) {
  console.log(`- [${result.passed ? "PASS" : "FAIL"}] ${result.id}`);
  console.log(`    expected: ${result.expectedActions.join(" | ")}   actual: ${result.action}`);
  if (result.proposedAction && result.proposedAction !== result.action) console.log(`    proposed action: ${result.proposedAction}`);
  console.log(`    confidence: ${result.confidence ?? result.proposedConfidence ?? "n/a"}   unsupportedFactCount: ${result.unsupportedFactCount}   latencyMs: ${result.latencyMs}`);
  if (result.story ?? result.proposedStory) console.log(`    story: ${result.story ?? result.proposedStory}`);
  if (result.reason) console.log(`    reason: ${result.reason}`);
  if (result.usage) console.log(`    usage: ${JSON.stringify(result.usage)}`);
  if (result.error) console.log(`    error: ${result.error}`);
  console.log("");
}

console.log("Aggregate metrics:");
console.log(JSON.stringify(evaluation.metrics, null, 2));

if (evaluation.metrics.unsupportedFactCount > 0 || evaluation.metrics.firstTimeHallucinationCount > 0 || evaluation.metrics.medicalDiagnosisInferenceCount > 0 || !evaluation.results.every((result) => result.passed)) process.exitCode = 1;
