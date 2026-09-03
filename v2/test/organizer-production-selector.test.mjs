import test from "node:test";
import assert from "node:assert/strict";
import { selectProductionOrganizer, jobUsesV2, describeSelection, OrganizerSelectionError, LEGACY_IMPLEMENTATION_ID, V2_IMPLEMENTATION_ID } from "../lib/organizer/production-selector.ts";
import { COUPLED_CANDIDATE_JUDGMENT, FROZEN_V6_JUDGMENT } from "../lib/organizer/judgment-policy.ts";

// Which organizer production runs. Three rules: legacy is the default, a misconfigured V2 fails
// closed rather than quietly running legacy, and V2 is bounded to named source ids.

const ON = {
  ORGANIZER_V2_ENABLED: "true",
  ORGANIZER_V2_JUDGMENT_POLICY: FROZEN_V6_JUDGMENT.id,
  ORGANIZER_V2_WRITER_VERSION: "writer-v2",
  ORGANIZER_V2_SOURCE_ALLOWLIST: "src-a,src-b",
};

// ---------------------------------------------------------------- default off

test("an empty environment selects legacy", () => {
  const selection = selectProductionOrganizer({});
  assert.equal(selection.useV2, false);
  assert.equal(selection.implementationId, LEGACY_IMPLEMENTATION_ID);
});

test("anything short of an explicit true means legacy", () => {
  for (const value of [undefined, "", "false", "0", "yes", "TRUE", "on", " true"]) {
    const selection = selectProductionOrganizer({ ...ON, ORGANIZER_V2_ENABLED: value });
    assert.equal(selection.useV2, false, `ORGANIZER_V2_ENABLED=${JSON.stringify(value)} must not enable V2`);
  }
});

test("legacy is chosen without needing any other variable to be present", () => {
  // The whole legacy path must stay reachable with none of the V2 configuration set, so a broken
  // V2 config can never take production down by accident.
  const selection = selectProductionOrganizer({ ORGANIZER_V2_JUDGMENT_POLICY: "nonsense", ORGANIZER_V2_WRITER_VERSION: "" });
  assert.equal(selection.useV2, false);
  assert.match(describeSelection(selection), /v2=off/);
});

// ---------------------------------------------------------------- fail closed, loudly

test("V2 on with no Judgment policy throws rather than falling back", () => {
  assert.throws(() => selectProductionOrganizer({ ...ON, ORGANIZER_V2_JUDGMENT_POLICY: undefined }), OrganizerSelectionError);
});

test("V2 on with no Writer version throws", () => {
  assert.throws(() => selectProductionOrganizer({ ...ON, ORGANIZER_V2_WRITER_VERSION: undefined }), OrganizerSelectionError);
});

test("the REJECTED coupled policy is refused by name, with the reason", () => {
  assert.throws(
    () => selectProductionOrganizer({ ...ON, ORGANIZER_V2_JUDGMENT_POLICY: COUPLED_CANDIDATE_JUDGMENT.id }),
    (error) => error instanceof OrganizerSelectionError && /REJECTED/.test(error.message) && /inner-state|leakage/.test(error.message),
  );
});

test("an unknown Judgment policy throws and lists what is allowed", () => {
  assert.throws(
    () => selectProductionOrganizer({ ...ON, ORGANIZER_V2_JUDGMENT_POLICY: "judgment-something-new" }),
    (error) => error instanceof OrganizerSelectionError && error.message.includes(FROZEN_V6_JUDGMENT.id),
  );
});

test("V2 on with an empty allowlist throws — a canary is a list, not a flag", () => {
  for (const value of [undefined, "", "  ", ","]) {
    assert.throws(() => selectProductionOrganizer({ ...ON, ORGANIZER_V2_SOURCE_ALLOWLIST: value }), OrganizerSelectionError);
  }
});

// ---------------------------------------------------------------- enabled, bounded

test("a valid configuration names every version explicitly", () => {
  const selection = selectProductionOrganizer({ ...ON, ORGANIZER_V2_MODEL: "deepseek-v4-pro" });
  assert.equal(selection.useV2, true);
  assert.equal(selection.implementationId, V2_IMPLEMENTATION_ID);
  assert.equal(selection.adapterPolicy.judgmentPolicyId, FROZEN_V6_JUDGMENT.id);
  assert.equal(selection.adapterPolicy.writerVersion, "writer-v2");
  assert.ok(selection.adapterPolicy.promptVersion, "prompt version must be recorded");
  assert.ok(selection.adapterPolicy.policyVersion, "policy version must be recorded");
  assert.deepEqual([...selection.allowlist].sort(), ["src-a", "src-b"]);
});

test("media tiers default to confirmed only", () => {
  const selection = selectProductionOrganizer(ON);
  assert.deepEqual(selection.adapterPolicy.allowedMediaTiers, ["confirmed"]);
});

test("a job runs on V2 only when EVERY source is allowlisted", () => {
  const selection = selectProductionOrganizer(ON);
  assert.equal(jobUsesV2(selection, ["src-a"]), true);
  assert.equal(jobUsesV2(selection, ["src-a", "src-b"]), true);
  assert.equal(jobUsesV2(selection, ["src-a", "src-elsewhere"]), false, "a straddling batch must not split across two organizers");
  assert.equal(jobUsesV2(selection, ["src-elsewhere"]), false);
  assert.equal(jobUsesV2(selection, []), false);
});

test("with the selector off, no job takes the V2 path", () => {
  const selection = selectProductionOrganizer({});
  assert.equal(jobUsesV2(selection, ["src-a", "src-b"]), false, "legacy must remain untouched when the selector is off");
});

test("the selection describes itself for the run log", () => {
  const line = describeSelection(selectProductionOrganizer(ON));
  assert.match(line, /v2=on/);
  assert.match(line, new RegExp(FROZEN_V6_JUDGMENT.id));
  assert.match(line, /writer=writer-v2/);
  assert.match(line, /allowlist=2/);
});

test("an unsafe media tier is refused when the adapter validates the policy", async () => {
  // The selector passes tiers through; the adapter is what refuses them, so the two must agree.
  const { assertPolicy, AdapterContractError } = await import("../lib/organizer/production-adapter.ts");
  const selection = selectProductionOrganizer({ ...ON, ORGANIZER_V2_MEDIA_TIERS: "confirmed,day_level" });
  assert.throws(() => assertPolicy(selection.adapterPolicy), AdapterContractError);
});
