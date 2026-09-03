// Which organizer runs in production, decided explicitly and audibly.
//
// Today `getConfiguredOrganizer()` reads MEMORY_ORGANIZER, defaults to "rule", and that is the whole
// decision — there is no record of which Judgment policy, Writer or pipeline version produced an
// artifact, because the legacy organizer has only one of each. The V2 path has several, two of them
// rejected experiments, so "which organizer" is no longer a single answer and a default is no longer
// a safe thing to have.
//
// Three rules shape this module:
//
//   1. LEGACY IS THE DEFAULT. V2 runs only when something explicitly turns it on. An unset variable,
//      an empty one, a typo — all of these mean legacy.
//   2. A MISCONFIGURED V2 FAILS CLOSED, LOUDLY. If V2 is switched on but any required identity is
//      missing, unknown, or names a rejected experiment, this THROWS rather than quietly running
//      legacy. Silently falling back is how you discover months later that the cutover never
//      happened — and it is the exact shape of the bug the validator's routing-policy assertion
//      already exists to prevent.
//   3. V2 IS BOUNDED BY AN ALLOWLIST. Enabling it does not switch production over; it switches over
//      the source ids you named. A canary is a list, not a flag.
import { COUPLED_CANDIDATE_JUDGMENT, FROZEN_V6_JUDGMENT, JUDGMENT_POLICIES, type JudgmentPolicy } from "./judgment-policy";
import { PRODUCTION_ADAPTER_VERSION, type AdapterPolicy } from "./production-adapter";
import { WINDOW_POLICY_VERSION } from "./evidence/window";
import { CONTRACT_POLICY_VERSION } from "./contract";

export const LEGACY_IMPLEMENTATION_ID = "legacy-rule-v2";
export const V2_IMPLEMENTATION_ID = PRODUCTION_ADAPTER_VERSION;

/**
 * Judgment policies a production deployment may name. Deliberately NOT every policy that exists:
 * the coupled candidate was rejected on 2026-09-03 for flattening an inner state into a
 * developmental fact and for attributing a father's action to the child, and naming it here must be
 * an error rather than a configuration choice.
 */
const PRODUCTION_JUDGMENT_POLICIES: readonly string[] = [FROZEN_V6_JUDGMENT.id];

export class OrganizerSelectionError extends Error {}

export type ProductionSelection =
  | { implementationId: typeof LEGACY_IMPLEMENTATION_ID; useV2: false; reason: string }
  | {
      implementationId: string;
      useV2: true;
      reason: string;
      judgment: JudgmentPolicy;
      adapterPolicy: AdapterPolicy;
      /** V2 runs ONLY for jobs whose sources are all in here. Never empty when useV2 is true. */
      allowlist: ReadonlySet<string>;
    };

const flag = (value: string | undefined) => value === "true" || value === "1";

/**
 * Decides the organizer for this deployment. Pure over `env` so a test can state a configuration
 * exactly rather than mutate the process.
 */
export function selectProductionOrganizer(env: NodeJS.ProcessEnv = process.env): ProductionSelection {
  if (!flag(env.ORGANIZER_V2_ENABLED)) {
    return { implementationId: LEGACY_IMPLEMENTATION_ID, useV2: false, reason: "ORGANIZER_V2_ENABLED is not set — legacy organizer (default)" };
  }

  // From here on every problem throws. V2 was explicitly requested; quietly giving back legacy would
  // hide that the request did not take effect.
  const policyId = env.ORGANIZER_V2_JUDGMENT_POLICY;
  if (!policyId) throw new OrganizerSelectionError("ORGANIZER_V2_ENABLED is on but ORGANIZER_V2_JUDGMENT_POLICY is unset. Name the Judgment policy explicitly.");
  if (policyId === COUPLED_CANDIDATE_JUDGMENT.id) {
    throw new OrganizerSelectionError(`${policyId} was REJECTED on 2026-09-03 (inner-state flattening; adult subject leakage) and may not run in production.`);
  }
  if (!PRODUCTION_JUDGMENT_POLICIES.includes(policyId)) {
    throw new OrganizerSelectionError(`Unknown production Judgment policy "${policyId}". Allowed: ${PRODUCTION_JUDGMENT_POLICIES.join(", ")}.`);
  }
  const judgment = JUDGMENT_POLICIES[policyId];
  if (!judgment) throw new OrganizerSelectionError(`Judgment policy "${policyId}" is named but not registered.`);

  const writerVersion = env.ORGANIZER_V2_WRITER_VERSION;
  if (!writerVersion) throw new OrganizerSelectionError("ORGANIZER_V2_ENABLED is on but ORGANIZER_V2_WRITER_VERSION is unset. An artifact must record which Writer wrote it.");

  const allowlist = new Set((env.ORGANIZER_V2_SOURCE_ALLOWLIST ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  if (allowlist.size === 0) {
    // The bounded-canary rule. Turning V2 on without naming inputs would put every incoming job on
    // an unproven path, which is not a canary and is not what this switch is for.
    throw new OrganizerSelectionError("ORGANIZER_V2_ENABLED is on but ORGANIZER_V2_SOURCE_ALLOWLIST is empty. V2 is bounded to named source ids; a global cutover is a separate, deliberate change.");
  }

  const tiers = (env.ORGANIZER_V2_MEDIA_TIERS ?? "confirmed").split(",").map((t) => t.trim()).filter(Boolean);
  const adapterPolicy: AdapterPolicy = {
    organizerVersion: V2_IMPLEMENTATION_ID,
    judgmentPolicyId: judgment.id,
    writerVersion,
    promptVersion: env.ORGANIZER_V2_PROMPT_VERSION ?? WINDOW_POLICY_VERSION,
    policyVersion: CONTRACT_POLICY_VERSION,
    provider: env.ORGANIZER_V2_PROVIDER ?? "deepseek",
    model: env.ORGANIZER_V2_MODEL,
    allowedMediaTiers: tiers as AdapterPolicy["allowedMediaTiers"],
  };

  return {
    implementationId: V2_IMPLEMENTATION_ID,
    useV2: true,
    reason: `V2 enabled for ${allowlist.size} allowlisted source id(s) under ${judgment.id}`,
    judgment,
    adapterPolicy,
    allowlist,
  };
}

/**
 * Whether THIS job may take the V2 path. Every one of its sources must be allowlisted: a job that
 * straddles the boundary runs on legacy, because splitting a source batch across two organizers
 * would produce two artifacts for one piece of evidence.
 */
export function jobUsesV2(selection: ProductionSelection, sourceIds: readonly string[]): boolean {
  if (!selection.useV2) return false;
  if (sourceIds.length === 0) return false;
  return sourceIds.every((id) => selection.allowlist.has(id));
}

/** One line for the run log, so a deployment can always be asked what it is running. */
export function describeSelection(selection: ProductionSelection): string {
  if (!selection.useV2) return `organizer=${selection.implementationId} v2=off (${selection.reason})`;
  return `organizer=${selection.implementationId} v2=on judgment=${selection.adapterPolicy.judgmentPolicyId} writer=${selection.adapterPolicy.writerVersion} prompt=${selection.adapterPolicy.promptVersion} media=[${selection.adapterPolicy.allowedMediaTiers.join(",")}] allowlist=${selection.allowlist.size}`;
}
