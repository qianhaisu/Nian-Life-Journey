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
//   3. V2 IS BOUNDED. Enabling it does not switch the archive over; it switches over exactly one
//      named boundary — a list of source ids (a canary), or work that arrives after an activation
//      instant (the new-input cutover). Never "everything that exists".
//
// THE TWO SCOPES, and why the second one exists:
//
//   allowlist  — V2 runs for jobs whose every source id is named. A canary is a list, not a flag.
//   new_input  — V2 runs for jobs CREATED after `ORGANIZER_V2_NEW_INPUT_AFTER`. This is the
//                production cutover: new capture and new ingest are organized by V2, while every
//                historical row (8,796 RawSources, 83 LifeEvents, 155 DailyTraces, the WeChat and
//                Quark corpora) is left exactly as it is. Nothing here reprocesses anything: a job
//                is the only way work reaches an organizer, jobs are created only by capture
//                (app/actions.ts) and Quark ingest (lib/ingest/quark.ts), and a job created before
//                the boundary — or any `force` re-organization of existing evidence — stays on
//                legacy. Retiring the legacy containers and re-cutting their evidence is a separate,
//                explicitly scheduled Full-history Recalibration, and is NOT a prerequisite for this.
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

export type V2Scope = "allowlist" | "new_input";

/** What the worker knows about a job when it asks whether the job may take the V2 path. */
export type JobRouting = { createdAt?: string; force?: boolean };

export type ProductionSelection =
  | { implementationId: typeof LEGACY_IMPLEMENTATION_ID; useV2: false; reason: string }
  | {
      implementationId: string;
      useV2: true;
      reason: string;
      judgment: JudgmentPolicy;
      adapterPolicy: AdapterPolicy;
      scope: V2Scope;
      /** allowlist scope: V2 runs ONLY for jobs whose sources are all in here. Empty in new_input scope. */
      allowlist: ReadonlySet<string>;
      /** new_input scope: the activation instant. Only jobs created after it take V2. */
      newInputAfter?: string;
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
  const newInputAfterRaw = env.ORGANIZER_V2_NEW_INPUT_AFTER?.trim();
  if (allowlist.size && newInputAfterRaw) {
    throw new OrganizerSelectionError("ORGANIZER_V2_SOURCE_ALLOWLIST and ORGANIZER_V2_NEW_INPUT_AFTER are both set. Name ONE boundary: a canary list, or a new-input activation instant.");
  }
  let scope: V2Scope = "allowlist";
  let newInputAfter: string | undefined;
  if (newInputAfterRaw) {
    // The new-input cutover instant. Parsed here rather than at routing time so a malformed value
    // is a loud startup error instead of a boundary that silently never (or always) matches.
    const parsed = Date.parse(newInputAfterRaw);
    if (Number.isNaN(parsed)) throw new OrganizerSelectionError(`ORGANIZER_V2_NEW_INPUT_AFTER "${newInputAfterRaw}" is not a parseable timestamp. Use an ISO instant, e.g. 2026-09-04T00:00:00.000Z.`);
    scope = "new_input";
    newInputAfter = new Date(parsed).toISOString();
  } else if (allowlist.size === 0) {
    // The bounded-canary rule. Turning V2 on without naming inputs would put every incoming job on
    // an unproven path, which is not a canary and is not what this switch is for.
    throw new OrganizerSelectionError("ORGANIZER_V2_ENABLED is on but neither ORGANIZER_V2_SOURCE_ALLOWLIST nor ORGANIZER_V2_NEW_INPUT_AFTER is set. V2 is bounded to named source ids or to work created after an activation instant; organizing the whole archive is a separate, explicitly scheduled change.");
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
    reason: scope === "new_input"
      ? `V2 enabled for Organizer jobs created after ${newInputAfter} under ${judgment.id}; existing rows are never requeued`
      : `V2 enabled for ${allowlist.size} allowlisted source id(s) under ${judgment.id}`,
    judgment,
    adapterPolicy,
    scope,
    allowlist,
    newInputAfter,
  };
}

/**
 * Whether THIS job may take the V2 path.
 *
 * allowlist scope: every one of the job's sources must be allowlisted. A job that straddles the
 * boundary runs on legacy, because splitting a source batch across two organizers would produce two
 * artifacts for one piece of evidence.
 *
 * new_input scope: the job must have been CREATED after the activation instant, and must not be a
 * `force` re-organization. Both are refusals to reprocess history: `createdAt` is the only property
 * that distinguishes work that arrived after the cutover from work that was already here, and a
 * forced re-run is by definition aimed at evidence that has already been organized. A job with no
 * creation time is refused rather than assumed new.
 */
export function jobUsesV2(selection: ProductionSelection, sourceIds: readonly string[], job: JobRouting = {}): boolean {
  if (!selection.useV2) return false;
  if (sourceIds.length === 0) return false;
  if (selection.scope === "new_input") {
    if (job.force) return false;
    if (!job.createdAt || !selection.newInputAfter) return false;
    const created = Date.parse(job.createdAt);
    return Number.isFinite(created) && created > Date.parse(selection.newInputAfter);
  }
  return sourceIds.every((id) => selection.allowlist.has(id));
}

/** One line for the run log, so a deployment can always be asked what it is running. */
export function describeSelection(selection: ProductionSelection): string {
  if (!selection.useV2) return `organizer=${selection.implementationId} v2=off (${selection.reason})`;
  const bound = selection.scope === "new_input" ? `scope=new_input after=${selection.newInputAfter}` : `scope=allowlist allowlist=${selection.allowlist.size}`;
  return `organizer=${selection.implementationId} v2=on judgment=${selection.adapterPolicy.judgmentPolicyId} writer=${selection.adapterPolicy.writerVersion} prompt=${selection.adapterPolicy.promptVersion} policy=${selection.adapterPolicy.policyVersion} media=[${selection.adapterPolicy.allowedMediaTiers.join(",")}] ${bound}`;
}
