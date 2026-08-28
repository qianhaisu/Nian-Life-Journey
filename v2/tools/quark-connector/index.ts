import type { QuarkClient } from "../../lib/ingest/quark";

export async function syncQuarkScope(client: QuarkClient, scope: { folder?: string; from?: string; to?: string; query?: string; cursor?: string }) {
  if (!scope.folder && !scope.from && !scope.to && !scope.query) throw new Error("Quark sync requires an explicit scope");
  return client.list(scope);
}
