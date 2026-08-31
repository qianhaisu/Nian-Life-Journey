import { existsSync } from "node:fs";
import { config } from "dotenv";

for (const file of [".env", ".env.local"]) if (existsSync(file)) config({ path: file, override: true });

const REQUIRED_MODEL = "gemini-3.6-flash";
process.env.AI_PROVIDER = "gemini";

const { createConfiguredAIProvider } = await import("../lib/organizer/provider.ts");
const { evaluateAIOrganizer, AI_ORGANIZER_EVALUATION_FIXTURES } = await import("../lib/organizer/evaluation.ts");

if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set. Add it to v2/.env.local before running this script.");
  process.exit(1);
}
if (process.env.AI_MODEL !== REQUIRED_MODEL) {
  console.error(`AI_MODEL must be ${REQUIRED_MODEL} for this comparison; refusing to switch models.`);
  process.exit(1);
}

const providerEnvironment = (promptVersion) => ({ ...process.env, AI_PROVIDER: "gemini", AI_MODEL: REQUIRED_MODEL, AI_ORGANIZER_PROMPT_VERSION: promptVersion });
const v1Provider = createConfiguredAIProvider(providerEnvironment("v1"));
const v2Provider = createConfiguredAIProvider(providerEnvironment("v2"));

console.log(`Comparing ${AI_ORGANIZER_EVALUATION_FIXTURES.length} synthetic fixtures against Gemini model=${REQUIRED_MODEL}`);
console.log("V1 and V2 use separate provider instances and prompt/schema contracts.\n");

const v1 = await evaluateAIOrganizer(v1Provider);
const v2 = await evaluateAIOrganizer(v2Provider);

function label(result) {
  const parts = [result.passed ? "PASS" : "FAIL", result.action];
  if (result.fallback) parts.push("fallback");
  if (result.proposedAction && result.proposedAction !== result.action) parts.push(`proposal=${result.proposedAction}`);
  return parts.join("/");
}

console.log("fixture                       expected                 v1                         v2");
console.log("----------------------------  -----------------------  ------------------------  ------------------------");
for (let index = 0; index < AI_ORGANIZER_EVALUATION_FIXTURES.length; index += 1) {
  const fixture = AI_ORGANIZER_EVALUATION_FIXTURES[index];
  console.log(`${fixture.id.padEnd(28)}  ${fixture.expectedActions.join("|").padEnd(23)}  ${label(v1.results[index]).padEnd(24)}  ${label(v2.results[index])}`);
}

function printDetails(name, evaluation) {
  console.log(`\n${name} details:`);
  for (const result of evaluation.results) {
    console.log(`- ${result.id}: ${label(result)} confidence=${result.confidence ?? result.proposedConfidence ?? "n/a"} latencyMs=${result.latencyMs}`);
    if (result.proposedAction && result.proposedAction !== result.action) console.log(`  proposedAction: ${result.proposedAction}`);
    if (result.proposedStory) console.log(`  proposedStory: ${result.proposedStory}`);
    if (result.reason) console.log(`  reason: ${result.reason}`);
    if (result.usage) console.log(`  usage: ${JSON.stringify(result.usage)}`);
    if (result.error) console.log(`  error: ${result.error}`);
  }
  console.log(`${name} metrics:`);
  console.log(JSON.stringify(evaluation.metrics, null, 2));
}

printDetails("V1", v1);
printDetails("V2", v2);

// 7/8 is a research-stage comparison gate against the synthetic fixture set, not a production
// release bar. A larger real-data evaluation set and gate belong to the P0 work that makes this
// system safe for real family data.
const v2GatePassed = v2.results.filter((result) => result.passed).length >= 7
  && v2.metrics.unsupportedFactCount === 0
  && v2.metrics.firstTimeHallucinationCount === 0
  && v2.metrics.medicalDiagnosisInferenceCount === 0;
console.log(`\nV2 quality gate: ${v2GatePassed ? "PASS" : "FAIL"} (minimum 7/8 accepted; three safety metrics must be zero)`);
if (!v2GatePassed) process.exitCode = 1;
