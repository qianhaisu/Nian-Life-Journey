import { createHash } from "node:crypto";
import { getStore } from "@/lib/db/repository";
import type { RawSource } from "@/lib/types";
import { HotStorageMediaInputResolver, type MediaInputResolver } from "./media-input";
import type { OrganizerContext, OrganizerMemorySummary, OrganizerSourceSummary } from "./types";

const dateOf = (value: string) => value.slice(0, 10);
const dayMs = 24 * 60 * 60 * 1000;

function safeMetadata(metadata: RawSource["metadata"]) {
  if (!metadata) return undefined;
  const allowed = ["location", "filename", "type", "durationSeconds", "posterAvailable", "recordedAt"];
  const result = Object.fromEntries(allowed.filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]));
  return Object.keys(result).length ? result : undefined;
}

function sourceDate(source: RawSource) {
  const timestamp = Date.parse(source.capturedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sourceBatchFingerprint(sources: RawSource[], assetChecksums: Map<string, string | undefined>, organizerVersion = "ai-v1") {
  const material = sources.toSorted((a, b) => a.id.localeCompare(b.id)).map((source) => [source.id, source.capturedAt, ...source.mediaIds.toSorted().map((mediaId) => `${mediaId}:${assetChecksums.get(mediaId) ?? "unavailable"}`)].join("|")).join("\n");
  return createHash("sha256").update(`${organizerVersion}\n${material}`).digest("hex");
}

function memoryNearSources(event: { occurredAt: string }, sources: RawSource[]) {
  const eventTime = Date.parse(event.occurredAt);
  return sources.some((source) => {
    const sourceTime = sourceDate(source);
    return dateOf(event.occurredAt) === dateOf(source.capturedAt) || (eventTime > 0 && sourceTime > 0 && Math.abs(eventTime - sourceTime) <= dayMs);
  });
}

export async function buildOrganizerContext(sourceIds: string[], options: { now?: Date; resolver?: MediaInputResolver; organizerVersion?: string } = {}) {
  const store = await getStore();
  const sources = sourceIds.map((id) => store.rawSources.find((source) => source.id === id)).filter((source): source is RawSource => Boolean(source && !source.deletedAt));
  if (!sources.length) throw new Error("No sources found for organization");
  if (sources.length !== new Set(sourceIds).size) throw new Error("Some requested sources are unavailable");
  const assetChecksums = new Map(store.media.map((media) => [media.id, media.mediaAssetId ? store.mediaAssets.find((asset) => asset.id === media.mediaAssetId)?.checksum : undefined]));
  const fingerprint = sourceBatchFingerprint(sources, assetChecksums, options.organizerVersion ?? "ai-v1");
  const sourceSummaries: OrganizerSourceSummary[] = sources.map((source) => ({ id: source.id, sourceType: source.sourceType, contentTypes: source.contentTypes, contributorId: source.contributorId, contributorName: store.contributors.find((item) => item.id === source.contributorId)?.displayName, capturedAt: source.capturedAt, sourceLabel: source.sourceLabel, text: source.text, mediaCount: source.mediaIds.length, media: source.mediaIds.map((mediaId) => { const media = store.media.find((item) => item.id === mediaId); const asset = media?.mediaAssetId ? store.mediaAssets.find((item) => item.id === media.mediaAssetId) : undefined; const hasPoster = Boolean(asset && store.mediaLocations.some((location) => location.mediaAssetId === asset.id && location.provider === "hot" && location.variant === "poster" && location.status === "ready")); return { id: mediaId, mediaType: asset?.mediaType ?? media?.type ?? "photo", mimeType: asset?.mimeType ?? media?.mimeType ?? "application/octet-stream", takenAt: asset?.takenAt ?? media?.takenAt, durationSeconds: asset?.durationSeconds ?? media?.durationSeconds, filename: asset?.originalFilename ?? media?.originalFilename, width: asset?.width ?? media?.width, height: asset?.height ?? media?.height, hasPoster }; }), metadata: { ...safeMetadata(source.metadata), ...(source.originalFilename ? { filename: source.originalFilename } : {}) } }));
  const existingMemories: OrganizerMemorySummary[] = store.events.filter((event) => event.profileId === sources[0].profileId && memoryNearSources(event, sources)).map((event) => ({ id: event.id, occurredAt: event.occurredAt, title: event.title, story: event.visibility === "private" ? undefined : event.story?.slice(0, 180), contentTypes: event.contentTypes, memoryWeight: event.memoryWeight, sourceCount: event.sourceIds.length, visibility: event.visibility }));
  const resolver = options.resolver ?? new HotStorageMediaInputResolver();
  const mediaInputs = await resolver.resolve(sources);
  const context: OrganizerContext = { profileId: sources[0].profileId, sourceSummaries, existingMemories, mediaInputs, inputSourceCount: sources.length, representativeMediaCount: mediaInputs.length, generatedAt: (options.now ?? new Date()).toISOString(), organizationFingerprint: fingerprint };
  return { context, sources, store };
}

export function isMedicalSource(source: RawSource) {
  return source.sourceType === "medical_document" || source.sourceType === "checkup_document" || source.contentTypes.includes("health");
}
