// V2 production adapter: turns a pipeline decision into artifact writes.
//
// The gap this closes. Production runs the legacy RuleBasedMemoryOrganizer, which persists
// LifeEvents, DailyTraces, source links and organizer runs. The V2 pipeline (Evidence Builder →
// Subject Resolution → Claim Grounding → Judgment → Writer → Narrative Validator) persists exactly
// one thing — a MemoryCandidate — and nothing ever converts that into a real artifact. So every
// LifeEvent in production came from the legacy path, and no amount of V2 evaluation could reach the
// timeline.
//
// The one rule this module lives by: **it persists a decision, it never makes one.** Nothing here
// re-reads evidence, re-scores worthiness, or reconsiders a route. `outcome.action` is authoritative
// and the adapter's whole job is to write exactly what it says, refusing anything the Judgment layer
// did not authorise.
//
// Split into a PURE planner and a thin applier on purpose. `planArtifacts` touches no database, so
// every safety rule below — media tiers, provenance subsets, review independence, identity — is
// testable without a repository and inspectable as a dry run before a single row is written.
import { createHash } from "node:crypto";
import type { EvidenceWindow } from "./evidence/types";
import { mayAttachToMemory, type MediaBindingTier } from "./evidence/media-tier";
import type { OrganizerOutcome } from "./contract";
import type { QualityDecision, QualityReview } from "./quality-review";
import type { LifeEvent, DailyTrace, SourceMemoryLink, OrganizerRun, ContentType } from "@/lib/types";

export const PRODUCTION_ADAPTER_VERSION = "organizer-v2-adapter-v1";

/**
 * The only ledger decision the V2 adapter ever writes. AI-authored prose is fail-closed
 * (quality-review.ts): it publishes when, and only when, a human replaces this with "approved".
 * The Memory Editor's own `reviewRequirement` ("auto_accept" | "needs_review") is the model's
 * opinion about its own output and is deliberately NOT trusted as a publication decision.
 */
export const ADAPTER_REVIEW_DECISION: QualityDecision = "needs_human_review";

/** Everything the adapter must be told explicitly. No silent defaults — see `assertPolicy`. */
export type AdapterPolicy = {
  /** Which organizer implementation produced this. Recorded on the run. */
  organizerVersion: string;
  /** The Judgment policy id, e.g. "judgment-v6-frozen". Recorded and asserted. */
  judgmentPolicyId: string;
  /** Writer contract version, recorded so a story can always be traced to the writer that made it. */
  writerVersion: string;
  /** Pipeline/prompt version. */
  promptVersion: string;
  policyVersion: string;
  provider: string;
  model?: string;
  /**
   * Media tiers this deployment permits on a Memory. `confirmed` only, unless a deployment
   * explicitly opts into `strong_contextual`. day_level/month_level/unbound are never permitted and
   * cannot be enabled here — `assertPolicy` rejects them rather than trusting the caller.
   */
  allowedMediaTiers: readonly MediaBindingTier[];
};

export type QualityReviewPlan = {
  targetKind: "life_event" | "daily_trace";
  targetId: string;
  /**
   * A ledger decision from the ONE canonical union (quality-review.ts), never a literal of this
   * module's own. The adapter used to write "needs_review", which reads like the Memory Editor's
   * `reviewRequirement` and is not a QualityDecision at all: it happened to stay unpublished only
   * because everything that is not "approved" is unpublished. That is a coincidence, not a
   * guarantee, so the decision is now typed and `ADAPTER_REVIEW_DECISION` is the single value the
   * V2 path writes.
   */
  decision: QualityDecision;
  gateA?: string;
  subjectRelevance?: string;
  worthinessScore?: number;
  reasonCodes: string[];
  provider: string;
  model?: string;
  promptVersion: string;
  policyVersion: string;
  reviewFingerprint: string;
};

export type PersistencePlan = {
  /** The identity every write is keyed by. Never a timestamp, never prose. */
  organizationFingerprint: string;
  action: OrganizerOutcome["action"];
  profileId: string;
  sourceIds: string[];
  lifeEvent?: { event: LifeEvent; links: SourceMemoryLink[] };
  dailyTrace?: DailyTrace;
  /** A NEW review row for a NEW artifact. Never reuses another artifact's decision. */
  review?: QualityReviewPlan;
  run: OrganizerRun;
  /** Media the Judgment layer's evidence permitted, with why each one was allowed or refused. */
  mediaDecisions: Array<{ mediaId: string; tier: MediaBindingTier; linked: boolean; reason: string }>;
  /** Non-fatal notes worth surfacing in a dry run. */
  notes: string[];
};

export class AdapterContractError extends Error {}

/**
 * Refuses a policy that could write unsafe media. This is checked rather than documented because
 * "only confirmed media may be attached" is a truth guarantee, and a config typo must not be able
 * to quietly turn a same-day Quark photo into a Memory illustration.
 */
export function assertPolicy(policy: AdapterPolicy): void {
  const forbidden = policy.allowedMediaTiers.filter((tier) => !mayAttachToMemory(tier));
  if (forbidden.length) {
    throw new AdapterContractError(`allowedMediaTiers contains tiers that may never be attached to a Memory: ${forbidden.join(", ")}. Only confirmed and strong_contextual are attachable.`);
  }
  for (const [field, value] of Object.entries({ organizerVersion: policy.organizerVersion, judgmentPolicyId: policy.judgmentPolicyId, writerVersion: policy.writerVersion, promptVersion: policy.promptVersion, policyVersion: policy.policyVersion, provider: policy.provider })) {
    if (!value) throw new AdapterContractError(`AdapterPolicy.${field} is required — the production path must never use a silent default.`);
  }
}

export type PlanInput = {
  window: EvidenceWindow;
  outcome: OrganizerOutcome;
  /** Deterministic window identity, already computed by the Evidence Builder. */
  windowFingerprint: string;
  policy: AdapterPolicy;
  /** Writer output, when the route produced one. The adapter never writes prose of its own. */
  story?: { title: string; story: string; usedMediaIds?: string[] };
  /**
   * What the Judgment layer recorded about this decision. Carried separately from `outcome` because
   * the validator returns it alongside, and a review row must record the judgement that produced
   * the artifact rather than anything the adapter re-derived.
   */
  judgment?: { reasonCodes?: string[]; gateA?: string; subjectRelevance?: string };
  now: string;
  newId: (prefix: string) => string;
  latencyMs?: number;
};

/** Media the window's own bindings permit, at the tiers this policy allows. */
function planMedia(window: EvidenceWindow, policy: AdapterPolicy, requested: string[] | undefined): PersistencePlan["mediaDecisions"] {
  const allowed = new Set(policy.allowedMediaTiers);
  const byMediaId = new Map(window.mediaBindings.map((binding) => [binding.mediaId, binding]));
  // A Writer may only ever narrow what the evidence offered. If it asked for media the window does
  // not contain, that is a contract violation, surfaced here rather than written.
  const candidates = requested ?? [...byMediaId.keys()];
  return candidates.map((mediaId) => {
    const binding = byMediaId.get(mediaId);
    if (!binding) return { mediaId, tier: "unbound" as const, linked: false, reason: "not present in this window's evidence" };
    if (!allowed.has(binding.tier)) return { mediaId, tier: binding.tier, linked: false, reason: `tier ${binding.tier} is not attachable under this policy` };
    return { mediaId, tier: binding.tier, linked: true, reason: `tier ${binding.tier} permitted` };
  });
}

/**
 * Artifact ids are DERIVED from the organization fingerprint, never minted fresh.
 *
 * The run guard (`findOrganizerRun`) stops an ordinary replay, but it cannot stop a retry after a
 * PARTIAL failure: if the LifeEvent was written and the ledger row was not, no run exists, so the
 * retry proceeds — and with a random id it would write a SECOND Memory for the same evidence. A
 * derived id makes that write land on the same row instead, so the retry repairs the batch rather
 * than duplicating it. Identity is the evidence, not the attempt.
 */
export function artifactIdFor(kind: "event" | "trace", organizationFingerprint: string): string {
  return `${kind}-v2-${createHash("sha256").update(`${kind}:${organizationFingerprint}`).digest("hex").slice(0, 32)}`;
}

function reviewFingerprintOf(organizationFingerprint: string, targetKind: string): string {
  return `${organizationFingerprint}:${targetKind}`;
}

/**
 * Builds the complete set of writes for one pipeline decision. Pure: no database, no clock, no
 * randomness beyond the injected `newId`.
 */
export function planArtifacts(input: PlanInput): PersistencePlan {
  assertPolicy(input.policy);
  const { window, outcome, policy, now } = input;
  const notes: string[] = [];

  // Provenance is the window's evidence and nothing else. The adapter never widens a source set,
  // and never infers one from a date.
  const windowSourceIds = [...new Set(window.items.map((item) => item.sourceId))];
  const outcomeSourceIds = outcome.sourceIds ?? [];
  const foreign = outcomeSourceIds.filter((id) => !windowSourceIds.includes(id));
  if (foreign.length) throw new AdapterContractError(`Outcome cites ${foreign.length} source id(s) that are not in the evidence window. Provenance must be a subset of the evidence.`);
  const sourceIds = outcomeSourceIds.length ? outcomeSourceIds : windowSourceIds;

  const organizationFingerprint = input.windowFingerprint;
  const profileId = window.profileId;
  const run: OrganizerRun = {
    id: input.newId("organizer-run"),
    profileId,
    action: outcome.action as OrganizerRun["action"],
    sourceIds: sourceIds.slice(),
    organizerType: "ai",
    organizerVersion: policy.organizerVersion,
    provider: policy.provider,
    model: policy.model,
    promptVersion: policy.promptVersion,
    processedAt: now,
    organizationFingerprint,
    sourceCount: sourceIds.length,
    mediaInputCount: window.mediaBindings.length,
    latencyMs: input.latencyMs ?? 0,
  };

  const base: PersistencePlan = { organizationFingerprint, action: outcome.action, profileId, sourceIds, run, mediaDecisions: [], notes };

  if (outcome.action === "life_event_candidate") {
    if (!input.story) throw new AdapterContractError("A Memory route requires Writer output; the adapter never invents a title or story.");
    const mediaDecisions = planMedia(window, policy, input.story.usedMediaIds);
    const refused = mediaDecisions.filter((d) => !d.linked);
    if (refused.length) notes.push(`${refused.length} media reference(s) refused: ${refused.map((d) => `${d.mediaId} (${d.reason})`).join("; ")}`);
    const mediaIds = mediaDecisions.filter((d) => d.linked).map((d) => d.mediaId);

    const eventId = artifactIdFor("event", organizationFingerprint);
    const contentTypes = [...new Set(window.items.flatMap((item) => item.contentTypes))] as ContentType[];
    const event: LifeEvent = {
      id: eventId, profileId,
      title: input.story.title, story: input.story.story,
      occurredAt: outcome.occurredAt ?? window.activityDate,
      people: [], tags: contentTypes, contentTypes,
      mediaIds, sourceIds: sourceIds.slice(), growthRecordIds: [], careRecordIds: [],
      eventType: (outcome.eventType === "milestone" ? "milestone" : "moment") as LifeEvent["eventType"],
      memoryWeight: "memory",
      scopes: ["family"],
      // Only a linked, tier-permitted asset may be the hero. No media means no hero, never a
      // borrowed one — a text-only Memory is a complete Memory.
      heroMediaId: mediaIds[0],
      visibility: "family", keptInYearbook: false,
      createdBy: "ai",
      organizerVersion: policy.organizerVersion,
      organizationFingerprint,
      organizerRun: { organizerType: "ai", organizerVersion: policy.organizerVersion, provider: policy.provider, model: policy.model, promptVersion: policy.promptVersion, processedAt: now, organizationFingerprint, sourceCount: sourceIds.length, mediaInputCount: window.mediaBindings.length, latencyMs: input.latencyMs ?? 0 },
    };
    const links: SourceMemoryLink[] = sourceIds.map((sourceId, index) => ({ rawSourceId: sourceId, lifeEventId: eventId, role: index === 0 ? "primary" : "supporting", createdAt: now }));

    // A brand-new artifact gets a brand-new review row. It never inherits a decision from another
    // artifact on the same day, and AI-authored prose is never auto-published.
    const review: QualityReviewPlan = {
      targetKind: "life_event", targetId: eventId,
      decision: ADAPTER_REVIEW_DECISION,
      gateA: input.judgment?.gateA, subjectRelevance: input.judgment?.subjectRelevance,
      worthinessScore: outcome.worthinessScore ?? 0,
      reasonCodes: input.judgment?.reasonCodes ?? [],
      provider: policy.provider, model: policy.model,
      promptVersion: policy.promptVersion, policyVersion: policy.policyVersion,
      reviewFingerprint: reviewFingerprintOf(organizationFingerprint, "life_event"),
    };
    return { ...base, lifeEvent: { event, links }, review, mediaDecisions, run: { ...run, targetId: eventId } };
  }

  if (outcome.action === "daily_trace") {
    // A trace carries evidence-linked lines, never Writer prose, and never media links: a
    // DailyTrace is provenance, not presentation.
    const entries = (outcome.traceLines ?? []).map((line) => line.text).filter(Boolean);
    if (entries.length === 0) notes.push("trace has no lines; the outcome supplied none");
    const traceId = artifactIdFor("trace", organizationFingerprint);
    const trace: DailyTrace = {
      id: traceId, profileId,
      occurredAt: outcome.occurredAt ?? window.activityDate,
      entries, sourceIds: sourceIds.slice(),
      scopes: ["family"], visibility: "family",
      organizationFingerprint,
      organizerRun: { organizerType: "ai", organizerVersion: policy.organizerVersion, provider: policy.provider, model: policy.model, promptVersion: policy.promptVersion, processedAt: now, organizationFingerprint, sourceCount: sourceIds.length, mediaInputCount: window.mediaBindings.length, latencyMs: input.latencyMs ?? 0 },
    };
    return { ...base, dailyTrace: trace, run: { ...run, targetId: traceId } };
  }

  // store_only, plan_marker, care_observation, failed: the run is the record. No timeline artifact,
  // and specifically no DailyTrace — a route that did not say "trace" must never produce one.
  if (outcome.action !== "store_only") notes.push(`route ${outcome.action} persists a run only`);
  return base;
}

// ---------------------------------------------------------------- applier
//
// The thin half. Everything unsafe was already decided in `planArtifacts`; this only writes what the
// plan says, in an order chosen so that a crash between two writes can never leave a published
// artifact behind.

/** The repository surface the adapter needs. Narrow on purpose, so it is trivial to double. */
export type ArtifactRepository = {
  findOrganizerRun(organizationFingerprint: string): Promise<OrganizerRun | null>;
  persistOrganization(sourceIds: string[], event: LifeEvent, links: SourceMemoryLink[]): Promise<LifeEvent>;
  persistDailyTrace(trace: DailyTrace): Promise<DailyTrace>;
  persistOrganizerRun(run: OrganizerRun): Promise<OrganizerRun>;
  markSourcesOrganized(sourceIds: string[]): Promise<void>;
  /**
   * Idempotent on (targetKind, targetId, promptVersion) — the ledger's own unique key. This is a
   * first-class Repository method (see repository-interface.ts), so the production worker and the
   * canary write a review through exactly the same surface; nothing here needs SQL of its own.
   */
  persistQualityReview(review: QualityReview): Promise<QualityReview>;
};

/** The subset of a Repository the adapter is allowed to touch. Nothing wider is ever passed in. */
export function artifactRepositoryOf(repository: ArtifactRepository): ArtifactRepository {
  return {
    findOrganizerRun: (fingerprint) => repository.findOrganizerRun(fingerprint),
    persistOrganization: (sourceIds, event, links) => repository.persistOrganization(sourceIds, event, links),
    persistDailyTrace: (trace) => repository.persistDailyTrace(trace),
    persistOrganizerRun: (run) => repository.persistOrganizerRun(run),
    markSourcesOrganized: (sourceIds) => repository.markSourcesOrganized(sourceIds),
    persistQualityReview: (review) => repository.persistQualityReview(review),
  };
}

/** Actions that mean "this run produced a LifeEvent". The V2 route keeps the Judgment layer's own
 *  name (`life_event_candidate`); the legacy organizer writes `create_memory`. A replay has to
 *  recognise both, or a re-run of an already-written V2 Memory reports no target id. */
const MEMORY_RUN_ACTIONS = new Set(["create_memory", "life_event_candidate"]);

export type ApplyResult = { applied: boolean; reason: string; run?: OrganizerRun; eventId?: string; traceId?: string };

/**
 * Writes one plan. Replay-safe: an organizer run already recorded under this fingerprint means the
 * batch was organized before, and nothing is written a second time — the same guard the legacy
 * organizer uses, keyed the same way.
 *
 * Write order is deliberate. The review row goes in BEFORE the organizer run is recorded, because
 * the run is what marks the batch as done; a crash after the artifact but before the review would
 * otherwise leave a Memory that no ledger row covers. AI artifacts are fail-closed
 * (quality-review.ts), so even that window cannot publish anything — the ordering is the second
 * belt, not the only one.
 */
export async function applyPlan(plan: PersistencePlan, repository: ArtifactRepository, options: { newId: (prefix: string) => string; now: string }): Promise<ApplyResult> {
  const prior = await repository.findOrganizerRun(plan.organizationFingerprint);
  if (prior) return { applied: false, reason: "already organized under this fingerprint", run: prior, eventId: MEMORY_RUN_ACTIONS.has(prior.action) ? prior.targetId : undefined, traceId: prior.action === "daily_trace" ? prior.targetId : undefined };

  let eventId: string | undefined;
  let traceId: string | undefined;

  if (plan.lifeEvent) {
    const saved = await repository.persistOrganization(plan.sourceIds, plan.lifeEvent.event, plan.lifeEvent.links);
    eventId = saved.id;
    if (plan.review) {
      await repository.persistQualityReview({ ...plan.review, targetId: saved.id, id: options.newId("quality-review"), profileId: plan.profileId, reviewedAt: options.now });
    }
  } else if (plan.dailyTrace) {
    const saved = await repository.persistDailyTrace(plan.dailyTrace);
    traceId = saved.id;
  } else {
    await repository.markSourcesOrganized(plan.sourceIds);
  }

  const run = await repository.persistOrganizerRun({ ...plan.run, targetId: eventId ?? traceId });
  return { applied: true, reason: "written", run, eventId, traceId };
}
