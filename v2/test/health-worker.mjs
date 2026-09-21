// Child process for health-concurrency.test.mjs: one transaction per invocation against a shared ledger dir.
import { HealthFileStore } from "../lib/health/file-store.ts";
import { runCorrection, runImport } from "../lib/health/importer.ts";
import { batch, obs, link } from "./health-fixtures.mjs";

const [dir, kind, n] = process.argv.slice(2);
const store = new HealthFileStore(dir, { lockTimeoutMs: 60000 });
if (kind === "import") {
  const own = obs(`own-${n}`, { sources: ["s1"] });
  const shared = obs("shared", { sources: ["s1"] });
  await runImport(store, batch(`w${n}`, [own, shared], [link("observation", `own-${n}`, "attached", "episode", "e1"), link("observation", "shared", "candidate", "episode", "e1")]), { apply: true, now: () => "2030-01-01T00:00:00Z" });
} else {
  await runCorrection(store, { id: `corr-${n}`, type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: `human-${n}`, author: "reviewer", at: "2030-04-01", reason: "concurrent correction" });
}
