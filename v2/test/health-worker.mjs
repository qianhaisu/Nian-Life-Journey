// Child process for the health concurrency/interruption tests: one transaction per invocation against a shared ledger dir.
// modes: import | correct | slow (holds the lock 1.5 s with a 300 ms staleLockMs) | hold (takes the lock and never finishes)
//        | hang-before-commit (temp file written, then hangs before the rename)
import { HealthFileStore } from "../lib/health/file-store.ts";
import { runCorrection, runImport } from "../lib/health/importer.ts";
import { batch, obs, link } from "./health-fixtures.mjs";

const [dir, mode, n] = process.argv.slice(2);
const forever = () => new Promise(() => setInterval(() => {}, 1000));
const opts = { lockTimeoutMs: 60000 };
if (mode === "slow") { opts.staleLockMs = 300; opts.beforeCommit = () => new Promise((r) => setTimeout(r, 1500)); }
if (mode === "hold") opts.afterAcquire = async () => { console.log("LOCKED"); await forever(); };
if (mode === "hang-before-commit") opts.beforeCommit = async () => { console.log("TMP-WRITTEN"); await forever(); };
const store = new HealthFileStore(dir, opts);
const now = () => "2030-01-01T00:00:00Z";
if (mode === "correct") {
  await runCorrection(store, { id: `corr-${n}`, type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: `human-${n}`, author: "reviewer", at: "2030-04-01", reason: "concurrent correction" }, { apply: true });
} else {
  const own = obs(`own-${n}`, { sources: ["s1"] });
  const shared = obs("shared", { sources: ["s1"] });
  await runImport(store, batch(`w${n}`, [own, shared], [link("observation", `own-${n}`, "attached", "episode", "e1"), link("observation", "shared", "candidate", "episode", "e1")]), { apply: true, now });
}
