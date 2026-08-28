import { getConnectorState, upsertConnectorState } from "../../lib/db/repository";
import { ingestQuarkFile, isQuarkAuthError, QuarkAdapterError, type QuarkClient, type QuarkImportOptions, type QuarkScope, toQuarkStructuredError } from "../../lib/ingest/quark";
import type { ConnectorState } from "../../lib/types";

export type QuarkSyncOptions = QuarkImportOptions & { maxRetries?: number; retryDelayMs?: number };

const CONNECTOR_VERSION = "quark-cli/0.1";

function persistedScope(scope: QuarkScope) {
  const value = { folder: scope.folder, from: scope.from, to: scope.to, query: scope.query };
  return Object.values(value).some(Boolean) ? value : undefined;
}

function retryable(error: unknown) {
  return error instanceof QuarkAdapterError ? error.retryable : true;
}

async function withRetry<T>(operation: () => Promise<T>, options: Pick<QuarkSyncOptions, "maxRetries" | "retryDelayMs">, action: string) {
  const maxRetries = Number.isInteger(options.maxRetries) && (options.maxRetries ?? 0) >= 0 ? options.maxRetries ?? 0 : 2;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) && (options.retryDelayMs ?? 0) > 0 ? options.retryDelayMs ?? 0 : 0;
  for (let attempt = 0; ; attempt += 1) {
    try { return await operation(); }
    catch (error) {
      if (!retryable(error) || attempt >= maxRetries) throw error;
      if (retryDelayMs) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * 2 ** attempt));
    }
  }
}

async function persistState(profileId: string, scope: QuarkScope, patch: Partial<ConnectorState>): Promise<ConnectorState> {
  const previous = await getConnectorState("quark", profileId);
  return await upsertConnectorState({
    id: previous?.id ?? `connector-quark-${profileId}`,
    provider: "quark",
    profileId,
    cursor: "cursor" in patch ? patch.cursor : previous?.cursor,
    lastSuccessfulSync: patch.lastSuccessfulSync ?? previous?.lastSuccessfulSync,
    lastError: patch.lastError,
    pendingArchiveCount: patch.pendingArchiveCount ?? previous?.pendingArchiveCount ?? 0,
    scope: persistedScope(scope),
    connectorVersion: CONNECTOR_VERSION,
    status: patch.status ?? previous?.status ?? "idle",
    updatedAt: new Date().toISOString(),
  });
}

async function requireAuth(client: QuarkClient) {
  if (!client.checkAuth) return;
  const status = await client.checkAuth();
  if (status.status === "connected") return;
  const code = status.code ?? (status.status === "unsupported" ? "QUARK_AGENT_UNSUPPORTED" : status.status === "unavailable" ? "QUARK_CLI_UNAVAILABLE" : "QUARK_AUTH_REQUIRED");
  throw new QuarkAdapterError(code, status.officialMessage ?? status.message, { officialCode: status.officialCode, action: "get-user-info", retryable: false });
}

export async function syncQuarkScope(client: QuarkClient, scope: QuarkScope, options?: QuarkSyncOptions) {
  if (!scope.folder && !scope.from && !scope.to && !scope.query) throw new QuarkAdapterError("QUARK_SCOPE_REQUIRED", "Quark sync requires an explicit scope", { action: "search", retryable: false });

  let cursor = scope.cursor;
  const seenCursors = new Set<string>();
  const files = [];
  try {
    await requireAuth(client);
    do {
      if (cursor && seenCursors.has(cursor)) throw new QuarkAdapterError("QUARK_PAGINATION_UNSUPPORTED", "Quark connector returned a repeated cursor", { action: "list", retryable: false });
      if (cursor) seenCursors.add(cursor);
      const page = await withRetry(() => client.list({ ...scope, cursor }), options ?? {}, "list");
      files.push(...page.files);
      cursor = page.cursor;
    } while (cursor);

    if (!options) return { files, cursor };
    await persistState(options.profileId, scope, { cursor, status: "syncing", lastError: undefined });
    const imported = [];
    for (const file of files) imported.push(await withRetry(() => ingestQuarkFile(file, options, client), options, "import"));
    await persistState(options.profileId, scope, { cursor, status: "connected", lastSuccessfulSync: new Date().toISOString(), lastError: undefined });
    return { files, cursor, imported };
  } catch (error) {
    if (options) {
      const structured = toQuarkStructuredError(error, "sync");
      await persistState(options.profileId, scope, { cursor, status: isQuarkAuthError(error) ? "auth_required" : "failed", lastError: structured.officialMessage }).catch(() => undefined);
    }
    throw error;
  }
}
