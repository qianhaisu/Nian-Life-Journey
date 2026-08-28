import { ingestQuarkFile, type QuarkClient } from "../../lib/ingest/quark";
import { getOrCreateQuarkState } from "../../lib/archive/quark-archive";
import { getStore, upsertConnectorState } from "../../lib/db/repository";

export async function syncQuarkScope(client: QuarkClient, scope: { folder?: string; from?: string; to?: string; query?: string; cursor?: string }, options?: { profileId: string; contributorId: string; visibility: "private" | "family" | "public" }) {
  if (!scope.folder && !scope.from && !scope.to && !scope.query) throw new Error("Quark sync requires an explicit scope");
  if (!options) return client.list(scope);
  const state = await getOrCreateQuarkState(options.profileId);
  await upsertConnectorState({ ...state, status: "syncing", scope, updatedAt: new Date().toISOString() });
  try {
    const result = await client.list(scope);
    const imported = [];
    for (const file of result.files) imported.push(await ingestQuarkFile(file, options, client));
    const store = await getStore();
    const pendingArchiveCount = store.mediaAssets.filter((asset) => asset.profileId === options.profileId && asset.archiveStatus !== "archived").length;
    await upsertConnectorState({ ...state, cursor: result.cursor, scope, status: "idle", pendingArchiveCount, lastSuccessfulSync: new Date().toISOString(), lastError: undefined, updatedAt: new Date().toISOString() });
    return { ...result, imported };
  } catch (error) {
    await upsertConnectorState({ ...state, scope, status: "failed", lastError: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() });
    throw error;
  }
}
