import { getStore, findOrganizerRun, markSourcesOrganized, markSourcesProcessing, newId, persistCareEpisode, persistDailyTrace, persistOrganization, persistOrganizerRun } from "@/lib/db/repository";
import type { ContentType, LifeEvent, OrganizerAction, OrganizerRun, RawSource, SourceMemoryLink } from "@/lib/types";
import { isMedicalSource, sourceBatchFingerprint } from "./context";
import type { OrganizerOptions, OrganizerResult } from "./types";

const dateOf = (value: string) => value.slice(0, 10);
const milestoneSignal = /第一次|首次|开始|学会|主动|生日|旅行|里程碑|first\s*time|milestone|birthday|travel/i;

function contributorsFor(sources: RawSource[], store: Awaited<ReturnType<typeof getStore>>) {
  return sources.map((source) => store.contributors.find((item) => item.id === source.contributorId)?.displayName).filter((name): name is string => Boolean(name));
}

function relatedEvent(sources: RawSource[], store: Awaited<ReturnType<typeof getStore>>) {
  const date = dateOf(sources[0].capturedAt);
  const types = new Set(sources.flatMap((source) => source.contentTypes));
  return store.events.find((event) => event.profileId === sources[0].profileId && dateOf(event.occurredAt) === date && event.visibility !== "private" && event.contentTypes.some((type) => types.has(type)));
}

function mediaCount(sources: RawSource[]) {
  return sources.reduce((count, source) => count + source.mediaIds.length, 0);
}

function traceEntry(sources: RawSource[]) {
  const count = mediaCount(sources);
  const label = sources.find((source) => source.sourceLabel)?.sourceLabel ?? "Archive trace";
  const text = sources.find((source) => source.text)?.text?.trim();
  return text ? text.slice(0, 180) : `${label}${count ? ` · ${count} media` : ""}`;
}

export type RuleBasedOptions = OrganizerOptions & { organizationFingerprint?: string; fallbackReason?: string; mediaInputCount?: number };

export class RuleBasedMemoryOrganizer {
  async organize(sourceIds: string[], options: RuleBasedOptions = {}): Promise<OrganizerResult> {
    const store = await getStore();
    const sources = sourceIds.map((id) => store.rawSources.find((source) => source.id === id)).filter((source): source is RawSource => Boolean(source && !source.deletedAt));
    if (!sources.length || sources.length !== new Set(sourceIds).size) throw new Error("No sources found for organization");
    const checksums = new Map(store.media.map((media) => [media.id, media.mediaAssetId ? store.mediaAssets.find((asset) => asset.id === media.mediaAssetId)?.checksum ?? undefined : undefined]));
    const organizationFingerprint = options.organizationFingerprint ?? sourceBatchFingerprint(sources, checksums, "rule-v2");
    const prior = options.force ? null : await findOrganizerRun(organizationFingerprint);
    if (prior) return this.resultFromRun(prior);
    const startedAt = Date.now();
    const medical = sources.some(isMedicalSource);
    const existing = medical ? undefined : relatedEvent(sources, store);
    const types = [...new Set(sources.flatMap((source) => source.contentTypes))] as ContentType[];
    const text = sources.find((source) => source.text)?.text?.trim();
    const signal = milestoneSignal.test(sources.map((source) => source.text ?? "").join("\n")) || types.includes("travel") || types.includes("milestone");
    const count = mediaCount(sources);
    const action: OrganizerAction = medical ? "care_episode" : existing ? "attach_existing" : signal || (Boolean(text) && sources.length <= 2) ? "create_memory" : count || text ? "daily_trace" : "store_only";
    const confidence = medical ? 0.95 : existing ? 0.86 : signal ? 0.84 : text ? 0.78 : 0.42;
    const now = (options.now ?? new Date()).toISOString();
    const runBase = { organizerType: "rule" as const, organizerVersion: "rule-v2", provider: "rule-based", processedAt: now, organizationFingerprint, sourceCount: sources.length, mediaInputCount: options.mediaInputCount ?? 0, fallbackReason: options.fallbackReason, latencyMs: Date.now() - startedAt };
    if (action === "care_episode") {
      const episode = await persistCareEpisode({ id: newId("care-episode"), profileId: sources[0].profileId, title: `Care record · ${dateOf(sources[0].capturedAt)}`, startedAt: dateOf(sources[0].capturedAt), recordIds: [], sourceIds: sourceIds.slice(), status: "open", visibility: "private", organizerRun: runBase });
      const run = await persistOrganizerRun({ id: newId("organizer-run"), profileId: sources[0].profileId, action, sourceIds: sourceIds.slice(), targetId: episode.id, ...runBase });
      return { action, confidence, careEpisodeId: episode.id, sourceIds: sourceIds.slice(), reason: "Health sources were organized as private facts without diagnosis.", organizationFingerprint, fallbackReason: options.fallbackReason, debug: this.debug({ action, confidence, sourceIds, runBase, latencyMs: Date.now() - startedAt }), run };
    }
    if (action === "daily_trace" || action === "store_only") {
      const trace = action === "daily_trace" ? await persistDailyTrace({ id: newId("trace"), profileId: sources[0].profileId, occurredAt: dateOf(sources[0].capturedAt), entries: [traceEntry(sources)], sourceIds: sourceIds.slice(), scopes: ["family"], visibility: sources.some((source) => source.visibility === "private") ? "private" : "family", organizerRun: runBase, organizationFingerprint }) : undefined;
      if (!trace) await markSourcesOrganized(sourceIds);
      const run = await persistOrganizerRun({ id: newId("organizer-run"), profileId: sources[0].profileId, action, sourceIds: sourceIds.slice(), targetId: trace?.id, ...runBase });
      return { action, confidence, traceId: trace?.id, sourceIds: sourceIds.slice(), reason: action === "daily_trace" ? "Ordinary material was kept as a compact daily trace." : "Material was retained without creating a timeline memory.", organizationFingerprint, fallbackReason: options.fallbackReason, debug: this.debug({ action, confidence, sourceIds, runBase, latencyMs: Date.now() - startedAt }), run };
    }
    const contributorNames = contributorsFor(sources, store);
    const mediaIds = [...new Set(sources.flatMap((source) => source.mediaIds))];
    const title = existing?.title ?? text?.slice(0, 80) ?? `${dateOf(sources[0].capturedAt)} · Archive memory`;
    const story = existing?.story ?? text?.slice(0, 420);
    const event: LifeEvent = existing ? { ...existing, mediaIds: [...new Set([...existing.mediaIds, ...mediaIds])], sourceIds: [...new Set([...existing.sourceIds, ...sourceIds])], contentTypes: [...new Set([...existing.contentTypes, ...types])], title, story, organizerVersion: "rule-v2", organizationFingerprint, organizerRun: runBase } : { id: newId("event"), profileId: sources[0].profileId, title, story, occurredAt: dateOf(sources[0].capturedAt), people: contributorNames, tags: types, contentTypes: types, mediaIds, sourceIds: sourceIds.slice(), growthRecordIds: [], careRecordIds: [], eventType: types.includes("travel") ? "outing" : signal ? "milestone" : "moment", memoryWeight: types.includes("travel") ? "highlight" : signal ? "memory" : "trace", scopes: ["family"], heroMediaId: mediaIds[0], visibility: sources.some((source) => source.visibility === "private") ? "private" : "family", keptInYearbook: false, createdBy: "rule", organizerVersion: "rule-v2", organizationFingerprint, organizerRun: runBase };
    const links: SourceMemoryLink[] = sources.map((source, index) => ({ rawSourceId: source.id, lifeEventId: event.id, role: index === 0 ? "primary" : "supporting", createdAt: now }));
    const saved = await persistOrganization(sourceIds, event, links);
    const run = await persistOrganizerRun({ id: newId("organizer-run"), profileId: sources[0].profileId, action, sourceIds: sourceIds.slice(), targetId: saved.id, ...runBase });
    return { action, confidence, eventId: saved.id, sourceIds: sourceIds.slice(), reason: existing ? "Related material was attached to the nearby existing memory." : "Sources were organized with conservative deterministic rules.", organizationFingerprint, fallbackReason: options.fallbackReason, debug: this.debug({ action, confidence, sourceIds, runBase, latencyMs: Date.now() - startedAt }), run };
  }

  private resultFromRun(run: OrganizerRun): OrganizerResult {
    return { action: run.action, confidence: 1, eventId: run.action === "create_memory" || run.action === "attach_existing" || run.action === "merge_existing" ? run.targetId : undefined, traceId: run.action === "daily_trace" ? run.targetId : undefined, careEpisodeId: run.action === "care_episode" ? run.targetId : undefined, sourceIds: run.sourceIds, reason: "This source batch was already organized.", organizationFingerprint: run.organizationFingerprint, fallbackReason: run.fallbackReason, run };
  }

  private debug(input: { action: OrganizerAction; confidence: number; sourceIds: string[]; runBase: Omit<OrganizerRun, "id" | "profileId" | "action" | "sourceIds" | "targetId">; latencyMs: number }) {
    if (process.env.AI_ORGANIZER_DEBUG !== "true") return undefined;
    return { sourceIds: input.sourceIds, action: input.action, confidence: input.confidence, latencyMs: input.latencyMs, inputSourceCount: input.runBase.sourceCount, representativeMediaCount: input.runBase.mediaInputCount, provider: input.runBase.provider, model: input.runBase.model, promptVersion: input.runBase.promptVersion ?? "rule-v2", fallbackReason: input.runBase.fallbackReason, tokenUsage: input.runBase.tokenUsage };
  }
}

// Kept as the compatibility entry point used by the existing capture and
// Quark ingestion code. The configured organizer is selected lazily so this
// module remains safe to import from server actions and connectors.
export async function organizeSources(sourceIds: string[], options: RuleBasedOptions = {}) {
  await markSourcesProcessing(sourceIds);
  const { getConfiguredOrganizer } = await import("./index");
  return getConfiguredOrganizer().organize(sourceIds, options);
}

export async function organizeSourcesWithRules(sourceIds: string[], options: RuleBasedOptions = {}) {
  return new RuleBasedMemoryOrganizer().organize(sourceIds, options);
}
