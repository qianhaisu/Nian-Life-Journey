import { QuarkCliAdapter } from "./cli-adapter";
import { syncQuarkScope } from "./index";
import { toQuarkStructuredError } from "../../lib/ingest/quark";

function option(name: string) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requiredOption(name: string) {
  const value = option(name)?.trim();
  if (!value) throw new Error(`Missing required option ${name}`);
  return value;
}

try {
  const query = requiredOption("--query");
  const profileId = option("--profile-id")?.trim() || "profile-zhangnian";
  const contributorId = option("--contributor-id")?.trim() || "contributor-system-import";
  const visibility = option("--visibility")?.trim() || "family";
  if (visibility !== "private" && visibility !== "family" && visibility !== "public") throw new Error("--visibility must be private, family, or public");
  const sessionInput = option("--session-input")?.trim() || query;
  const maxRetriesValue = option("--max-retries");
  const maxRetries = maxRetriesValue === undefined ? undefined : Number(maxRetriesValue);
  if (maxRetries !== undefined && (!Number.isInteger(maxRetries) || maxRetries < 0)) throw new Error("--max-retries must be a non-negative integer");
  const result = await syncQuarkScope(new QuarkCliAdapter({ sessionInput }), { query }, { profileId, contributorId, visibility, maxRetries });
  process.stdout.write(JSON.stringify({ ok: true, imported: result.imported?.length ?? 0, files: result.files.length, cursor: result.cursor }) + "\n");
} catch (error) {
  process.stderr.write(JSON.stringify({ ok: false, error: toQuarkStructuredError(error, "sync") }) + "\n");
  process.exitCode = 1;
}