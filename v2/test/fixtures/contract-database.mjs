// The only way a test reaches a real PostgreSQL database: an explicit CONTRACT_DATABASE_URL in the
// shell that runs it. Plain `npm test` never loads .env.local and never reads DATABASE_URL, so the
// production database (which .env.local points at) cannot be touched by accident; the PostgreSQL
// suites report themselves as skipped instead.
//
//   CONTRACT_DATABASE_URL="postgres://..." npm test          (bash)
//   $env:CONTRACT_DATABASE_URL="postgres://..."; npm test    (PowerShell)
//
// When set, the same URL is exported as DATABASE_URL for this process so createPostgresRepository()
// (which resolves its connection through lib/db/config.ts) uses the opted-in database.
export const CONTRACT_DATABASE_URL = process.env.CONTRACT_DATABASE_URL?.trim() || null;
if (CONTRACT_DATABASE_URL) process.env.DATABASE_URL = CONTRACT_DATABASE_URL;

export const SKIP_REASON = "PostgreSQL contract suite skipped — set CONTRACT_DATABASE_URL to opt in (plain `npm test` never connects to a database)";
