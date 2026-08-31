import { getStore, markSourcesOrganized, newId, persistCareEpisode, persistDailyTrace, persistOrganization, persistOrganizerRun } from "@/lib/db/repository";
import type { ContentType, LifeEvent, OrganizerAction, OrganizerRun, RawSource, SourceMemoryLink, TimelineScope } from "@/lib/types";
import { buildOrganizerContext, isMedicalSource } from "./context";
import { applyOrganizerPolicy } from "./policy";
import { ORGANIZER_PROMPT_VERSION } from "./prompts/v1";
import { validateOrganizerDecision } from "./schema";
import { RuleBasedMemoryOrganizer, type RuleBasedOptions } from "./rule-based";
import type { AIProvider, OrganizerContext, OrganizerDebug, OrganizerOptions, OrganizerResult } from "./types";

const dateOf = (value: string) => value.slice(0, 10);

class UnavailableAIProvider implements AIProvider {
  readonly name = "unavailable";
  constructor(private readonly reason: string) {}
  async organize(_context: OrganizerContext): Promise<import("./types").AIProviderResponse> { throw new Error(this.reason); }
}

function scopesFor(types: ContentType[]): TimelineScope[] {
  const scopes: TimelineScope[] = ["family"];
  if (types.includes("daycare")) scopes.push("daycare");
  if (types.includes("travel")) scopes.push("outing");
  if (types.some((type) => ["growth", "language", "motor", "interest"].includes(type))) scopes.push("growth");
  return [...new Set(scopes)];
}

function eventTypeFor(weight: LifeEvent["memoryWeight"], types: ContentType[]): LifeEvent["eventType"] {
  if (weight === "chapter") return "chapter";
  if (weight === "highlight" || types.includes("milestone")) return "milestone";
  if (types.includes("travel")) return "outing";
  return "moment";
}

function traceEntries(context: OrganizerContext) {
  return context.sourceSummaries.map((source) => source.text?.trim().slice(0, 180) || `${source.sourceLabel}${source.mediaCount ? ` · ${source.mediaCount} media` : ""}`);
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "AI provider failed";
  return message.slice(0, 180).replace(/[\r\n]/g, " ");
}

function organizerVersionFor(provider: AIProvider) {
  return `ai-${provider.promptVersion ?? ORGANIZER_PROMPT_VERSION}`;
}

export class AIMemoryOrganizer {
  private readonly fallback = new RuleBasedMemoryOrganizer();

  constructor(private readonly provider: AIProvider) {}

  async organize(sourceIds: string[], options: OrganizerOptions = {}): Promise<OrganizerResult> {
    let built: Awaited<ReturnType<typeof buildOrganizerContext>> | undefined;
    let decision: Awaited<ReturnType<typeof applyOrganizerPolicy>>["decision"] | undefined;
    let usage: { input?: number; output?: number; total?: number } | undefined;
    let startedAt = Date.now();
    let provider = options.provider ?? this.provider;
    try {
      const current = await buildOrganizerContext(sourceIds, { now: options.now, organizerVersion: organizerVersionFor(provider) });
      built = current;
      const prior = options.force ? null : current.store.organizerRuns.find((run) => run.organizationFingerprint === current.context.organizationFingerprint && run.organizerType === "ai");
      if (prior) return this.resultFromRun(prior);
      startedAt = Date.now();
      provider = options.provider ?? this.provider;
      const providerResponse = await provider.organize(current.context);
      const validated = validateOrganizerDecision(providerResponse.decision, current.context);
      const policyResult = applyOrganizerPolicy(validated, current.context);
      usage = providerResponse.usage;
      decision = policyResult.decision;
      const { unsupportedFactCount } = policyResult;
      if (unsupportedFactCount !== 0) throw new Error("Policy rejected unsupported facts");
    } catch (error) {
      const fallbackReason = safeError(error);
      const fallbackOptions: RuleBasedOptions = { ...options, organizationFingerprint: built?.context.organizationFingerprint, fallbackReason, mediaInputCount: built?.context.representativeMediaCount };
      return this.fallback.organize(sourceIds, fallbackOptions);
    }
    if (!built || !decision) throw new Error("Organizer context was not created");
    return this.persistDecision(built.context, built.sources, decision, { input: usage, startedAt, provider });
  }

  private async persistDecision(context: OrganizerContext, sources: RawSource[], decision: Awaited<ReturnType<typeof applyOrganizerPolicy>>["decision"], input: { input?: { input?: number; output?: number; total?: number }; startedAt: number; provider: AIProvider }) {
    const store = await getStore();
    const now = new Date().toISOString();
    const runBase = { organizerType: "ai" as const, organizerVersion: organizerVersionFor(input.provider), provider: input.provider.name, model: input.provider.model, promptVersion: input.provider.promptVersion ?? ORGANIZER_PROMPT_VERSION, processedAt: now, organizationFingerprint: context.organizationFingerprint, sourceCount: context.inputSourceCount, mediaInputCount: context.representativeMediaCount, latencyMs: Date.now() - input.startedAt, tokenUsage: input.input };
    if (decision.action === "care_episode") {
      const episode = await persistCareEpisode({ id: newId("care-episode"), profileId: context.profileId, title: `Care record · ${dateOf(decision.occurredAt)}`, startedAt: dateOf(decision.occurredAt), recordIds: [], sourceIds: sources.map((source) => source.id), status: "open", visibility: "private", organizerRun: runBase });
      return this.finish({ profileId: context.profileId, action: decision.action, confidence: decision.confidence, careEpisodeId: episode.id, sourceIds: decision.sourceIds, reason: decision.reason, organizationFingerprint: context.organizationFingerprint, runBase, targetId: episode.id, provider: input.provider });
    }
    if (decision.action === "daily_trace" || decision.action === "store_only") {
      const trace = decision.action === "daily_trace" ? await persistDailyTrace({ id: newId("trace"), profileId: context.profileId, occurredAt: dateOf(decision.occurredAt), entries: traceEntries(context), sourceIds: decision.sourceIds, scopes: scopesFor(decision.contentTypes), visibility: sources.some((source) => source.visibility === "private") ? "private" : "family", organizerRun: runBase, organizationFingerprint: context.organizationFingerprint }) : undefined;
      if (!trace) await markSourcesOrganized(decision.sourceIds);
      return this.finish({ profileId: context.profileId, action: decision.action, confidence: decision.confidence, traceId: trace?.id, sourceIds: decision.sourceIds, reason: decision.reason, organizationFingerprint: context.organizationFingerprint, runBase, targetId: trace?.id, provider: input.provider });
    }
    const existing = decision.existingLifeEventId ? store.events.find((event) => event.id === decision.existingLifeEventId) : undefined;
    if (decision.action === "attach_existing" && !existing) throw new Error("Policy target memory is no longer available");
    const mediaIds = [...new Set(sources.flatMap((source) => source.mediaIds))];
    const people = [...new Set(sources.map((source) => store.contributors.find((contributor) => contributor.id === source.contributorId)?.displayName).filter((name): name is string => Boolean(name)))];
    const visibility = sources.every((source) => source.visibility === "public") ? "public" : sources.some((source) => source.visibility === "private") ? "private" : "family";
    const event: LifeEvent = existing ? { ...existing, title: decision.title ?? existing.title, story: decision.shortStory ?? existing.story, occurredAt: existing.occurredAt, contentTypes: [...new Set([...existing.contentTypes, ...decision.contentTypes])], mediaIds: [...new Set([...existing.mediaIds, ...mediaIds])], sourceIds: [...new Set([...existing.sourceIds, ...decision.sourceIds])], tags: [...new Set([...existing.tags, ...decision.contentTypes])], organizerVersion: runBase.organizerVersion, organizerRun: runBase, organizationFingerprint: context.organizationFingerprint } : { id: newId("event"), profileId: context.profileId, title: decision.title ?? sources[0].sourceLabel, story: decision.shortStory, occurredAt: dateOf(decision.occurredAt), people, tags: decision.contentTypes, contentTypes: decision.contentTypes, mediaIds, sourceIds: decision.sourceIds, growthRecordIds: [], careRecordIds: [], eventType: eventTypeFor(decision.memoryWeight, decision.contentTypes), memoryWeight: decision.memoryWeight, scopes: scopesFor(decision.contentTypes), heroMediaId: mediaIds[0], visibility, keptInYearbook: false, createdBy: "ai", organizerVersion: runBase.organizerVersion, organizerRun: runBase, organizationFingerprint: context.organizationFingerprint };
    const links: SourceMemoryLink[] = sources.map((source, index) => ({ rawSourceId: source.id, lifeEventId: event.id, role: index === 0 ? "primary" : "supporting", createdAt: now }));
    const saved = await persistOrganization(decision.sourceIds, event, links);
    return this.finish({ profileId: context.profileId, action: decision.action, confidence: decision.confidence, eventId: saved.id, sourceIds: decision.sourceIds, reason: decision.reason, organizationFingerprint: context.organizationFingerprint, runBase, targetId: saved.id, provider: input.provider });
  }

  private async finish(input: { profileId: string; action: OrganizerAction; confidence: number; eventId?: string; traceId?: string; careEpisodeId?: string; sourceIds: string[]; reason: string; organizationFingerprint: string; runBase: Omit<OrganizerRun, "id" | "profileId" | "action" | "sourceIds" | "targetId">; targetId?: string; provider: AIProvider }): Promise<OrganizerResult> {
    const run = await persistOrganizerRun({ id: newId("organizer-run"), profileId: input.profileId, action: input.action, sourceIds: input.sourceIds.slice(), targetId: input.targetId, ...input.runBase });
    return { action: input.action, confidence: input.confidence, eventId: input.eventId, traceId: input.traceId, careEpisodeId: input.careEpisodeId, sourceIds: input.sourceIds, reason: input.reason, organizationFingerprint: input.organizationFingerprint, debug: this.debug(input, run), run };
  }

  private resultFromRun(run: OrganizerRun): OrganizerResult {
    return { action: run.action, confidence: 1, eventId: ["create_memory", "attach_existing", "merge_existing"].includes(run.action) ? run.targetId : undefined, traceId: run.action === "daily_trace" ? run.targetId : undefined, careEpisodeId: run.action === "care_episode" ? run.targetId : undefined, sourceIds: run.sourceIds, reason: "This source batch was already organized.", organizationFingerprint: run.organizationFingerprint, fallbackReason: run.fallbackReason, run };
  }

  private debug(input: { action: OrganizerAction; confidence: number; sourceIds: string[]; runBase: Omit<OrganizerRun, "id" | "profileId" | "action" | "sourceIds" | "targetId">; provider: AIProvider }, run: OrganizerRun): OrganizerDebug | undefined {
    if (process.env.AI_ORGANIZER_DEBUG !== "true") return undefined;
    return { sourceIds: input.sourceIds, action: input.action, confidence: input.confidence, latencyMs: input.runBase.latencyMs ?? 0, inputSourceCount: input.runBase.sourceCount, representativeMediaCount: input.runBase.mediaInputCount, provider: input.provider.name, model: input.provider.model, promptVersion: input.runBase.promptVersion ?? ORGANIZER_PROMPT_VERSION, tokenUsage: run.tokenUsage, fallbackReason: run.fallbackReason };
  }
}

export function createAIMemoryOrganizer(provider: AIProvider) {
  return new AIMemoryOrganizer(provider);
}

export { UnavailableAIProvider };
