import { findOrganizerRun, getOrganizerWindowInput, markSourcesOrganized, markSourcesProcessing, persistDailyTrace, persistOrganization, persistOrganizerRun, persistQualityReview, getStore } from "@/lib/db/repository";
import { preGroupSources } from "./pre-group";
import { createConfiguredAIProvider, AIProviderError } from "./provider";
import { AIMemoryOrganizer, UnavailableAIProvider } from "./ai";
import { RuleBasedMemoryOrganizer, type RuleBasedOptions } from "./rule-based";
import { describeSelection, jobUsesV2, selectProductionOrganizer, type JobRouting, type ProductionSelection } from "./production-selector";
import { createDeepSeekV2Pipeline } from "./v2-pipeline";
import { EvidenceOrganizerV2, type V2OrganizerRepository } from "./v2-organizer";
import type { OrganizerOptions, OrganizerResult } from "./types";

export type MemoryOrganizer = {
  organize(sourceIds: string[], options?: OrganizerOptions): Promise<OrganizerResult>;
};

export function getConfiguredOrganizer(env: NodeJS.ProcessEnv = process.env): MemoryOrganizer {
  const mode = (env.MEMORY_ORGANIZER ?? "rule").toLowerCase();
  if (mode !== "ai" || env.AI_ORGANIZER_ENABLED === "false") return new RuleBasedMemoryOrganizer();
  try { return new AIMemoryOrganizer(createConfiguredAIProvider(env)); }
  catch (error) { return new AIMemoryOrganizer(new UnavailableAIProvider(error instanceof AIProviderError ? error.message : "AI provider is not configured")); }
}

/** The module-level repository, narrowed to what the V2 organizer is allowed to touch. */
export const productionArtifactRepository: V2OrganizerRepository = {
  getOrganizerWindowInput,
  findOrganizerRun,
  persistOrganization,
  persistDailyTrace,
  persistOrganizerRun,
  markSourcesOrganized,
  persistQualityReview,
};

export type OrganizerRouting = {
  organizer: MemoryOrganizer;
  selection: ProductionSelection;
  useV2: boolean;
  /** One line naming the implementation, Judgment policy, Writer, prompt/policy versions and boundary. */
  description: string;
};

/**
 * Which organizer runs THIS job.
 *
 * The decision is per job, not per process, because both V2 scopes are per job: an allowlist canary
 * routes named source ids, and the new-input cutover routes work created after an instant. Anything
 * outside the boundary — every historical job, every forced re-organization — stays on the legacy
 * organizer, which is also what an unset/failed configuration means (selectProductionOrganizer
 * throws on a misconfigured V2 rather than quietly handing back legacy).
 */
export function getOrganizerForJob(job: { sourceIds: string[] } & JobRouting, env: NodeJS.ProcessEnv = process.env): OrganizerRouting {
  const selection = selectProductionOrganizer(env);
  const useV2 = jobUsesV2(selection, job.sourceIds, { createdAt: job.createdAt, force: job.force });
  const description = `${describeSelection(selection)} job=${useV2 ? "v2" : "legacy"}`;
  if (!useV2 || !selection.useV2) return { organizer: getConfiguredOrganizer(env), selection, useV2: false, description };
  const pipeline = createDeepSeekV2Pipeline(env, { judgment: selection.judgment, model: selection.adapterPolicy.model ?? "unspecified" });
  return { organizer: new EvidenceOrganizerV2({ selection, pipeline, repository: productionArtifactRepository }), selection, useV2: true, description };
}

export async function organizeSourceBatches(sourceIds: string[], options: OrganizerOptions = {}) {
  const store = await getStore();
  const sources = sourceIds.map((id) => store.rawSources.find((source) => source.id === id)).filter((source): source is NonNullable<typeof source> => Boolean(source && !source.deletedAt));
  if (sources.length !== new Set(sourceIds).size) throw new Error("Some requested sources are unavailable");
  const organizer = getConfiguredOrganizer();
  const results: OrganizerResult[] = [];
  for (const group of preGroupSources(sources)) { await markSourcesProcessing(group.map((source) => source.id)); results.push(await organizer.organize(group.map((source) => source.id), options)); }
  return results;
}

export async function reorganizeSources(sourceIds: string[], options: OrganizerOptions = {}) {
  return getConfiguredOrganizer().organize(sourceIds, { ...options, force: true });
}

export * from "./types";
export * from "./provider";
export * from "./schema";
export * from "./policy";
export * from "./context";
export * from "./media-input";
export * from "./ai";
export * from "./evaluation";
export { RuleBasedMemoryOrganizer } from "./rule-based";
export type { RuleBasedOptions } from "./rule-based";
