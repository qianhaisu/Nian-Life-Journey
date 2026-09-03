// The V2 organizer the production worker actually runs.
//
// Everything below it already existed and is unchanged: the Evidence Builder, the frozen V6
// Judgment, Writer v2, the Narrative Validator, the production adapter. What was missing was the
// piece that lets a queued job reach them — `getConfiguredOrganizer()` could only ever return the
// legacy rule organizer or the V1 AI organizer, so the V2 path was reachable from scripts and from
// nowhere else.
//
// Three properties this file is responsible for:
//
//   1. IT WRITES THROUGH THE REPOSITORY. Every row goes through Repository methods — including the
//      quality ledger, which used to need a raw SQL statement the canary carried privately. The
//      worker and the canary now share one persistence surface, so what a canary proves is a
//      property of production rather than of the canary's own plumbing.
//   2. IT NEVER RE-DECIDES. Judgment picks the route; the Writer may decline; the adapter writes
//      what they said. The one transformation this file makes is explicit and narrow: a Memory
//      route whose page could not be written truthfully is recorded as `store_only` with the reason,
//      never as a trace, never as a Memory with weaker prose (see writeStory below).
//   3. IT IS PAID FOR ONCE. The fingerprint guard runs BEFORE the model calls, so a replay costs
//      nothing and a job that has already been organized returns the run it produced.
import { buildEvidenceWindows, windowFingerprint } from "./evidence/window";
import { buildMediaIndex } from "./evidence/media-index";
import type { EvidenceWindow, WindowSource } from "./evidence/types";
import type { OrganizerOutcome } from "./contract";
import type { ProductionSelection } from "./production-selector";
import type { V2Pipeline, V2Judgment } from "./v2-pipeline";
import { applyPlan, artifactRepositoryOf, planArtifacts, type ArtifactRepository, type PersistencePlan } from "./production-adapter";
import { newId as defaultNewId } from "@/lib/db/repository-interface";
import type { OrganizerWindowInput } from "@/lib/db/repository-interface";
import type { OrganizerAction, OrganizerRun, RawSource } from "@/lib/types";
import type { OrganizerOptions, OrganizerResult } from "./types";

export class V2OrganizerError extends Error {}

/** Exactly the repository surface this organizer uses. Nothing wider is passed in. */
export type V2OrganizerRepository = ArtifactRepository & {
  getOrganizerWindowInput(sourceIds: string[]): Promise<OrganizerWindowInput>;
};

export type V2OrganizerDeps = {
  selection: Extract<ProductionSelection, { useV2: true }>;
  pipeline: V2Pipeline;
  repository: V2OrganizerRepository;
  now?: () => Date;
  newId?: (prefix: string) => string;
};

/** What the Judgment layer's route means to the rest of the app, whose vocabulary is OrganizerAction. */
export function organizerActionFor(action: OrganizerOutcome["action"]): OrganizerAction {
  if (action === "life_event_candidate") return "create_memory";
  if (action === "daily_trace") return "daily_trace";
  if (action === "attach_existing") return "attach_existing";
  if (action === "care_observation") return "care_episode";
  return "store_only";
}

function windowSourceOf(source: RawSource): WindowSource {
  return {
    id: source.id,
    profileId: source.profileId,
    sourceType: source.sourceType,
    contentTypes: source.contentTypes,
    // The WeChat importer records one contributor for a whole import and keeps the real speaker in
    // metadata.senderDigest; senderIdentityOf() reads that, so metadata must survive this mapping.
    contributorId: source.contributorId,
    capturedAt: source.capturedAt,
    text: source.text ?? "",
    mediaIds: source.mediaIds,
    visibility: source.visibility,
    metadata: source.metadata,
    sourceLabel: source.sourceLabel,
  } as WindowSource;
}

export class EvidenceOrganizerV2 {
  constructor(private readonly deps: V2OrganizerDeps) {}

  private get policy() { return this.deps.selection.adapterPolicy; }

  /**
   * One job's evidence → one window. The window is built from THIS JOB's sources, which is what
   * makes the new-input cutover honest: a job carries the material that just arrived, and the
   * organizer never reaches sideways into the archive to widen it. (A historical re-cut would want
   * the whole conversation for neighbour context — that is the Full-history Recalibration's problem,
   * and it will build its own windows.)
   */
  async buildWindow(sourceIds: string[]): Promise<{ window: EvidenceWindow; fingerprint: string; input: OrganizerWindowInput }> {
    const input = await this.deps.repository.getOrganizerWindowInput(sourceIds);
    const wanted = new Set(sourceIds);
    if (input.sources.length !== wanted.size) {
      throw new V2OrganizerError(`V2 organizer: ${input.sources.length} of ${wanted.size} sources are available (deleted or missing rows are never organized).`);
    }
    const assets = new Map(input.mediaAssets.map((asset) => [asset.id, asset]));
    const mediaIndex = buildMediaIndex(
      input.media.map((media) => {
        const asset = media.mediaAssetId ? assets.get(media.mediaAssetId) : undefined;
        return { mediaId: media.id, mediaAssetId: media.mediaAssetId, mediaType: asset?.mediaType ?? media.type, mimeType: asset?.mimeType ?? media.mimeType, checksum: asset?.checksum, takenAt: asset?.takenAt ?? media.takenAt };
      }),
      input.mediaLocations.map((location) => ({ mediaAssetId: location.mediaAssetId, provider: location.provider, variant: location.variant, status: location.status })),
    );
    const assetChecksums = new Map(input.media.map((media) => [media.id, (media.mediaAssetId ? assets.get(media.mediaAssetId)?.checksum : undefined) ?? undefined]));
    const labels = [...new Set(input.sources.map((source) => source.sourceLabel).filter(Boolean))].sort();
    const conversationId = labels.length === 1 ? labels[0] : `mixed:${labels.join("|")}`;
    const windows = buildEvidenceWindows(conversationId, input.sources[0].profileId, input.sources.map(windowSourceOf), { dailyTraces: [], lifeEvents: [] }, { mediaIndex });
    // A batch that splits into several windows is several decisions, and this organizer persists one.
    // Refusing loudly is correct: the pre-grouper already batches by conversation and time, so this
    // means the caller handed the worker something it did not build.
    if (windows.length !== 1) throw new V2OrganizerError(`V2 organizer: this batch splits into ${windows.length} evidence windows; one job must be one window.`);
    const window = windows[0];
    const fingerprint = windowFingerprint(window, { policyVersion: this.policy.policyVersion, promptVersion: this.policy.promptVersion, modelVersion: this.policy.model ?? "unspecified" }, assetChecksums);
    return { window, fingerprint, input };
  }

  /**
   * Judgment says Memory; the Writer may still decline, and a declined page is NOT downgraded into a
   * DailyTrace. A trace is a claim that these lines are a true record of the day, which is a
   * different decision from the one that was made, and manufacturing it here would be the adapter
   * inventing a route. The run keeps the evidence's identity and the reason, and the material stays
   * available to a human.
   */
  private async decide(window: EvidenceWindow, fingerprint: string, birthDate?: string): Promise<{ judgment: V2Judgment; outcome: OrganizerOutcome; story?: { title: string; story: string; usedMediaIds: string[] }; fallbackReason?: string; latencyMs: number }> {
    const judgment = await this.deps.pipeline.judge(window);
    if (judgment.outcome.action !== "life_event_candidate") {
      return { judgment, outcome: judgment.outcome, latencyMs: judgment.latencyMs };
    }
    const written = await this.deps.pipeline.write({ window, windowFingerprint: fingerprint, judgment, birthDate });
    const latencyMs = judgment.latencyMs + written.latencyMs;
    if (!written.wrote) {
      const outcome = { ...judgment.outcome, action: "store_only", degradeReason: written.reason } as OrganizerOutcome;
      return { judgment, outcome, fallbackReason: written.reason, latencyMs };
    }
    return { judgment, outcome: judgment.outcome, story: { title: written.title, story: written.story, usedMediaIds: written.usedMediaIds }, latencyMs };
  }

  async organize(sourceIds: string[], options: OrganizerOptions = {}): Promise<OrganizerResult> {
    const nowDate = options.now ?? this.deps.now?.() ?? new Date();
    const now = nowDate.toISOString();
    const newId = this.deps.newId ?? defaultNewId;
    const { window, fingerprint, input } = await this.buildWindow(sourceIds);

    // Before any model call: an already-organized batch costs nothing to replay.
    const prior = options.force ? null : await this.deps.repository.findOrganizerRun(fingerprint);
    if (prior) return resultFromRun(prior, "already organized under this fingerprint");

    const decided = await this.decide(window, fingerprint, input.profile?.birthDate);
    const plan = planArtifacts({
      window,
      outcome: decided.outcome,
      windowFingerprint: fingerprint,
      policy: this.policy,
      story: decided.story,
      judgment: { reasonCodes: decided.judgment.reasonCodes, gateA: decided.judgment.subjectLevel, subjectRelevance: decided.judgment.verdict.subjectRelevance },
      now,
      newId,
      latencyMs: decided.latencyMs,
    });
    if (decided.fallbackReason) plan.run.fallbackReason = decided.fallbackReason;

    if (options.dryRun) return dryRunResult(plan, decided.fallbackReason);

    const applied = await applyPlan(plan, artifactRepositoryOf(this.deps.repository), { newId, now });
    return {
      action: organizerActionFor(plan.action),
      confidence: confidenceOf(decided.outcome),
      eventId: applied.eventId,
      traceId: applied.traceId,
      sourceIds: plan.sourceIds,
      reason: applied.reason,
      organizationFingerprint: fingerprint,
      fallbackReason: decided.fallbackReason,
      run: applied.run ?? plan.run,
    };
  }
}

function confidenceOf(outcome: OrganizerOutcome): number {
  return "confidence" in outcome && typeof outcome.confidence === "number" ? outcome.confidence : 0;
}

function resultFromRun(run: OrganizerRun, reason: string): OrganizerResult {
  const action = organizerActionFor(run.action as OrganizerOutcome["action"]);
  return {
    action,
    confidence: 0,
    eventId: action === "create_memory" ? run.targetId : undefined,
    traceId: action === "daily_trace" ? run.targetId : undefined,
    sourceIds: run.sourceIds,
    reason,
    organizationFingerprint: run.organizationFingerprint,
    run,
  };
}

/** A dry run reports the decision and the exact plan, and writes nothing. */
function dryRunResult(plan: PersistencePlan, fallbackReason?: string): OrganizerResult {
  return {
    action: organizerActionFor(plan.action),
    confidence: 0,
    eventId: plan.lifeEvent?.event.id,
    traceId: plan.dailyTrace?.id,
    sourceIds: plan.sourceIds,
    reason: `dry run — planned ${plan.action}, nothing written`,
    organizationFingerprint: plan.organizationFingerprint,
    fallbackReason,
    run: plan.run,
  };
}
