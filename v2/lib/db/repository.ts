import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { careEpisodes, careRecords, contributors, dailyTraces, events as seedEvents, growthRecords, media as seedMedia, monthlySnapshot, profile, rawSources as seedSources } from "@/lib/mock-data";
import type { CareEpisode, CareRecord, ConnectorState, Contributor, DailyTrace, GrowthRecord, LifeEvent, Media, MediaAsset, MediaLocation, MonthlySnapshot, Profile, RawSource, SourceMemoryLink } from "@/lib/types";
import { selectLocation } from "@/lib/storage/hot-storage";

export type Store = { profile: Profile; contributors: Contributor[]; media: Media[]; mediaAssets: MediaAsset[]; mediaLocations: MediaLocation[]; connectorStates: ConnectorState[]; rawSources: RawSource[]; events: LifeEvent[]; dailyTraces: DailyTrace[]; growthRecords: GrowthRecord[]; careRecords: CareRecord[]; careEpisodes: CareEpisode[]; links: SourceMemoryLink[]; monthlySnapshot: MonthlySnapshot };
const dataDir = path.join(process.cwd(), ".data");
const storeFile = path.join(dataDir, "nian-life.json");

const initialStore = (): Store => ({ profile, contributors, media: seedMedia, mediaAssets: [], mediaLocations: [], connectorStates: [], rawSources: seedSources.map((source) => ({ ...source, status: source.status === "inbox" ? "organized" : source.status })), events: seedEvents, dailyTraces, growthRecords, careRecords, careEpisodes, links: seedSources.flatMap((source) => source.relatedLifeEventId ? [{ rawSourceId: source.id, lifeEventId: source.relatedLifeEventId, role: "supporting" as const, createdAt: source.importedAt }] : []), monthlySnapshot });

function normalizeStore(store: Partial<Store>): Store {
  return { ...initialStore(), ...store, media: store.media ?? [], mediaAssets: store.mediaAssets ?? [], mediaLocations: store.mediaLocations ?? [], connectorStates: store.connectorStates ?? [], rawSources: store.rawSources ?? [], events: store.events ?? [], contributors: store.contributors ?? [], links: store.links ?? [], dailyTraces: store.dailyTraces ?? [], growthRecords: store.growthRecords ?? [], careRecords: store.careRecords ?? [], careEpisodes: store.careEpisodes ?? [] };
}
function hydrateMedia(store: Store): Store {
  store.media = store.media.map((media) => {
    const asset = store.mediaAssets.find((item) => item.id === media.mediaAssetId);
    if (!asset) return media;
    const location = selectLocation(store.mediaLocations.filter((item) => item.mediaAssetId === asset.id), asset);
    return location ? { ...media, src: "/api/media/" + media.id + "?variant=" + location.variant } : media;
  });
  return store;
}

async function readStore(): Promise<Store> {
  try { return hydrateMedia(normalizeStore(JSON.parse(await fs.readFile(storeFile, "utf8")) as Partial<Store>)); }
  catch { await fs.mkdir(dataDir, { recursive: true }); const store = initialStore(); await writeStore(store); return store; }
}
async function writeStore(store: Store) { await fs.mkdir(dataDir, { recursive: true }); await fs.writeFile(storeFile, JSON.stringify(store, null, 2), "utf8"); }

export async function getHomeEvents() { const store = await readStore(); return store.events.filter((event) => event.visibility !== "private").toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt)); }
export async function getAllEvents() { const store = await readStore(); return store.events.toSorted((a, b) => b.occurredAt.localeCompare(a.occurredAt)); }
export async function getStore() { return readStore(); }
export async function getEventDetail(id: string) { const store = await readStore(); const event = store.events.find((item) => item.id === id); if (!event) return null; return { event, media: store.media.filter((item) => event.mediaIds.includes(item.id)), sources: store.rawSources.filter((item) => event.sourceIds.includes(item.id) && !item.deletedAt), contributors: store.contributors, growth: store.growthRecords.filter((item) => event.growthRecordIds.includes(item.id)), care: store.careRecords.filter((item) => event.careRecordIds.includes(item.id) && item.visibility !== "private") }; }
export async function appendUpload(input: { source: RawSource; media: Media[]; assets?: MediaAsset[]; locations?: MediaLocation[] }) { const store = await readStore(); store.rawSources.push(input.source); store.media.push(...input.media); store.mediaAssets.push(...(input.assets ?? [])); store.mediaLocations.push(...(input.locations ?? [])); await writeStore(store); return input.source; }
export async function persistOrganization(sourceIds: string[], eventInput: LifeEvent, links: SourceMemoryLink[]) { const store = await readStore(); const existing = store.events.find((event) => event.id === eventInput.id); if (existing) { existing.sourceIds = [...new Set([...existing.sourceIds, ...sourceIds])]; existing.mediaIds = [...new Set([...existing.mediaIds, ...eventInput.mediaIds])]; existing.contentTypes = [...new Set([...existing.contentTypes, ...eventInput.contentTypes])]; existing.story = eventInput.story || existing.story; } else store.events.push(eventInput); for (const source of store.rawSources) if (sourceIds.includes(source.id)) { source.status = "organized"; source.relatedLifeEventId = eventInput.id; } store.links.push(...links.filter((link) => !store.links.some((old) => old.rawSourceId === link.rawSourceId && old.lifeEventId === link.lifeEventId))); for (const media of store.media) if (eventInput.mediaIds.includes(media.id)) media.lifeEventId = eventInput.id; await writeStore(store); return existing ?? eventInput; }
export async function undoOrganization(sourceIds: string[], eventId: string) { const store = await readStore(); const event = store.events.find((item) => item.id === eventId); if (!event) return; event.sourceIds = event.sourceIds.filter((id) => !sourceIds.includes(id)); event.mediaIds = event.mediaIds.filter((id) => !store.rawSources.find((source) => source.id === id)?.mediaIds.includes(id)); store.links = store.links.filter((link) => !(link.lifeEventId === eventId && sourceIds.includes(link.rawSourceId))); for (const source of store.rawSources) if (sourceIds.includes(source.id)) { source.status = "uploaded"; source.relatedLifeEventId = undefined; } for (const media of store.media) if (sourceIds.some((sourceId) => store.rawSources.find((source) => source.id === sourceId)?.mediaIds.includes(media.id))) media.lifeEventId = undefined; if (!event.sourceIds.length && event.id.startsWith("event-")) store.events = store.events.filter((item) => item.id !== eventId); await writeStore(store); }
export const newId = (prefix: string) => `${prefix}-${randomUUID()}`;
