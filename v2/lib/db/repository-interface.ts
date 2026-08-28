import type { ConnectorState, LifeEvent, MediaAsset, MediaLocation, RawSource, SourceMemoryLink } from "@/lib/types";

// Pages depend on this domain contract, never on PostgreSQL or a storage SDK.
export interface ArchiveRepository {
  getMediaAsset(id: string): Promise<MediaAsset | null>;
  listMediaLocations(mediaAssetId: string): Promise<MediaLocation[]>;
  appendRawSource(input: { source: RawSource; assets: MediaAsset[]; locations: MediaLocation[] }): Promise<RawSource>;
  persistOrganization(sourceIds: string[], event: LifeEvent, links: SourceMemoryLink[]): Promise<LifeEvent>;
  getConnectorState(provider: "quark", profileId: string): Promise<ConnectorState | null>;
}
