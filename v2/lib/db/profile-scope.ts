import type { Store } from "./repository-interface";

// Read-side guard shared by both backends: a Store handed to a page only ever contains rows of
// the profile it names. Rows written under another profile id (contract-test fixtures, a
// synthetic import) stay in the file or the database — nothing here deletes — but the book
// about 张年 does not show them. media_locations and links carry no profile_id of their own and
// follow their asset / source / event instead.
export function scopeStoreToProfile(store: Store, profileId: string): Store {
  const own = <T extends { profileId: string }>(rows: T[]) => rows.filter((row) => row.profileId === profileId);
  const mediaAssets = own(store.mediaAssets);
  const rawSources = own(store.rawSources);
  const events = own(store.events);
  const assetIds = new Set(mediaAssets.map((asset) => asset.id));
  const sourceIds = new Set(rawSources.map((source) => source.id));
  const eventIds = new Set(events.map((event) => event.id));
  return {
    ...store,
    contributors: own(store.contributors),
    media: own(store.media),
    mediaAssets,
    mediaLocations: store.mediaLocations.filter((location) => assetIds.has(location.mediaAssetId)),
    connectorStates: own(store.connectorStates),
    rawSources,
    events,
    dailyTraces: own(store.dailyTraces),
    growthRecords: own(store.growthRecords),
    careRecords: own(store.careRecords),
    careEpisodes: own(store.careEpisodes),
    monthlyFocusGoals: own(store.monthlyFocusGoals),
    organizerRuns: own(store.organizerRuns),
    organizerJobs: own(store.organizerJobs),
    chatImportTasks: own(store.chatImportTasks),
    links: store.links.filter((link) => sourceIds.has(link.rawSourceId) && eventIds.has(link.lifeEventId)),
  };
}
