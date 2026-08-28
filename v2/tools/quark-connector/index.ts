import { ingestQuarkFile, type QuarkClient } from "../../lib/ingest/quark";

export async function syncQuarkScope(client: QuarkClient, scope: { folder?: string; from?: string; to?: string; query?: string; cursor?: string }, options?: { profileId: string; contributorId: string; visibility: "private" | "family" | "public" }) {
  if (!scope.folder && !scope.from && !scope.to && !scope.query) throw new Error("Quark sync requires an explicit scope");
  const result = await client.list(scope);
  if (!options) return result;
  const imported = [];
  for (const file of result.files) imported.push(await ingestQuarkFile(file, options, client));
  return { ...result, imported };
}
