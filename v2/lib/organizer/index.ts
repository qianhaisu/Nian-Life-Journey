import { getStore, markSourcesProcessing } from "@/lib/db/repository";
import { preGroupSources } from "./pre-group";
import { createConfiguredAIProvider, AIProviderError } from "./provider";
import { AIMemoryOrganizer, UnavailableAIProvider } from "./ai";
import { RuleBasedMemoryOrganizer, type RuleBasedOptions } from "./rule-based";
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
