import type { CareEpisode, ConnectorState, DailyTrace, LifeEvent, MediaAsset, MediaLocation, OrganizerRun, RawSource, SourceMemoryLink } from "@/lib/types";

// Pages depend on this domain contract, never on PostgreSQL or a storage SDK.
export interface ArchiveRepository {
  getMediaAsset(id: string): Promise<MediaAsset | null>;
  listMediaLocations(mediaAssetId: string): Promise<MediaLocation[]>;
  appendRawSource(input: { source: RawSource; assets: MediaAsset[]; locations: MediaLocation[] }): Promise<RawSource>;
  persistOrganization(sourceIds: string[], event: LifeEvent, links: SourceMemoryLink[]): Promise<LifeEvent>;
  persistDailyTrace(trace: DailyTrace): Promise<DailyTrace>;
  persistCareEpisode(episode: CareEpisode): Promise<CareEpisode>;
  persistOrganizerRun(run: OrganizerRun): Promise<OrganizerRun>;
  findOrganizerRun(organizationFingerprint: string): Promise<OrganizerRun | null>;
  getConnectorState(provider: "quark", profileId: string): Promise<ConnectorState | null>;
  upsertConnectorState(input: ConnectorState): Promise<ConnectorState>;
}
