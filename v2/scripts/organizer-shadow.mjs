#!/usr/bin/env node
// Shadow runner for the evidence pipeline (§12). SYNTHETIC ONLY in this round: it runs the 24
// fixtures (or a caller-supplied subset) through the pipeline and, with --commit, writes
// MemoryCandidate rows — never a LifeEvent, never a DailyTrace, never touches a RawSource.
//
// Real-data mode is intentionally NOT implemented here. Wiring it up requires a real AI provider
// and explicit authorization this script does not have — see §12/§15 of the Organizer V2 task. Do
// not add real-data support to this file without that explicit authorization.
import { runPipeline } from "../lib/organizer/pipeline.ts";
import { MockMemoryEditorProvider } from "../lib/organizer/mock-editor.ts";
import { ORGANIZER_FIXTURES, NOW, SUBJECT, OTHER_CHILD_NAME } from "../lib/organizer/fixtures.ts";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const idsArg = args.find((arg) => arg.startsWith("--fixtures="));
const fixtureIds = idsArg ? idsArg.slice("--fixtures=".length).split(",") : undefined;

if (args.includes("--real") || process.env.ORGANIZER_SHADOW_REAL_DATA === "true") {
  console.error("Real-data shadow mode is not implemented in this round. See §12/§15 of the Organizer V2 task: it requires a real AI provider and explicit authorization that this script does not have.");
  process.exit(1);
}

const fixtures = fixtureIds ? ORGANIZER_FIXTURES.filter((fixture) => fixtureIds.includes(fixture.id)) : ORGANIZER_FIXTURES;
console.log(`Organizer shadow run (SYNTHETIC ONLY) — ${fixtures.length} fixture(s), mode=${commit ? "commit (writes MemoryCandidate rows, fingerprint prefixed shadow:synthetic:)" : "dry-run (default, nothing written)"}`);

const provider = new MockMemoryEditorProvider({ subjectNames: [SUBJECT.primaryName, ...SUBJECT.aliases], otherChildNames: [OTHER_CHILD_NAME] });
let failures = 0;

for (const fixture of fixtures) {
  const result = await runPipeline(fixture.window, {
    subject: SUBJECT,
    provider,
    context: { ...fixture.context, now: NOW },
    // Namespaced so a shadow run can never collide with (or be mistaken for) a real window's fingerprint.
    windowFingerprint: `shadow:synthetic:${fixture.id}`,
    persist: commit,
  });
  const expected = Array.isArray(fixture.expectedAction) ? fixture.expectedAction : [fixture.expectedAction];
  const ok = expected.includes(result.outcome.action);
  if (!ok) failures += 1;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${fixture.id} — final=${result.outcome.action}${result.degradeReason ? ` degrade=${result.degradeReason}` : ""}${result.candidate ? ` candidateId=${result.candidate.id}` : ""}`);
}

console.log(`\n${fixtures.length - failures}/${fixtures.length} fixtures produced their expected action.`);
console.log("Reminder: this run only ever writes to memory_candidates (when --commit is passed). No LifeEvent, DailyTrace, or RawSource was touched.");
if (failures > 0) {
  console.error("\nShadow run did not meet the safety gate. This must be 100% before any real-data run is even considered (§15).");
  process.exitCode = 1;
}
