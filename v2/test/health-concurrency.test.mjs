// Real multi-process concurrency against the file-backed ledger (not a mock): lost updates, duplicate
// entities and correction overwrite must not happen. This is NOT evidence about Postgres transactions.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { runImport } from "../lib/health/importer.ts";
import { confirmedFactIds, effectiveContent, membership } from "../lib/health/ledger.ts";
import { baseBatch, NOW, tmpStore } from "./health-fixtures.mjs";

const run = (dir, kind, n) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ["--import", "tsx", "test/health-worker.mjs", dir, kind, String(n)], { stdio: ["ignore", "pipe", "pipe"] });
  let err = ""; p.stderr.on("data", (d) => (err += d));
  p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`worker ${kind}${n} exited ${code}: ${err}`))));
});

test("8 concurrent importers + 3 concurrent corrections: no lost update, no duplicate identity, corrections intact", async () => {
  const { dir, store } = await tmpStore();
  await runImport(store, baseBatch(), { apply: true, now: NOW });
  const before = (await store.read()).revision;
  const jobs = [
    ...Array.from({ length: 8 }, (_, i) => run(dir, "import", i)),
    ...Array.from({ length: 3 }, (_, i) => run(dir, "correct", i)),
  ];
  await Promise.all(jobs);
  const l = await store.read();
  assert.equal(l.revision, before + 11, "every transaction serialised exactly once (no lost update)");
  for (let i = 0; i < 8; i++) assert.ok(l.entities[`observation:own-${i}`], `own-${i} present`);
  assert.equal(l.entities["observation:shared"].versions.length, 1, "shared identity written once, other 7 were duplicates");
  assert.equal(l.corrections.length, 3);
  assert.equal(new Set(l.corrections.map((c) => c.id)).size, 3);
  // the last correction wins as current value, every earlier value is still in the history
  const cur = effectiveContent(l, { kind: "observation", id: "o1" }).content.text;
  assert.match(cur, /^human-\d$/);
  assert.deepEqual(l.corrections.map((c) => c.before).slice(1), l.corrections.slice(0, 2).map((c) => c.after), "each correction's before-value is the previous correction's after (serial history)");
  assert.equal(confirmedFactIds(l, "e1").filter((x) => x.startsWith("own-")).length, 8);
  assert.deepEqual(membership(l, "e1").candidate.filter((x) => x === "shared"), ["shared"], "duplicate link not multiplied");
  assert.equal(l.runs.length, 1 + 8);
});

test("leftovers of a killed writer (orphan temp file + stale lock, emulated, not a real SIGKILL): ledger intact, lock reclaimed, retry succeeds", async () => {
  const { dir, store } = await tmpStore();
  await runImport(store, baseBatch(), { apply: true, now: NOW });
  const before = JSON.stringify(await store.read());
  const { writeFile, mkdir, utimes } = await import("node:fs/promises");
  // emulate the leftovers of a killed writer: orphan temp file + stale lock
  await writeFile(`${dir}/ledger.json.99999.1.tmp`, "{ half written");
  await mkdir(`${dir}/ledger.lock`);
  const old = new Date(Date.now() - 300000);
  await utimes(`${dir}/ledger.lock`, old, old);
  assert.equal(JSON.stringify(await store.read()), before, "ledger.json unaffected by leftovers");
  await run(dir, "import", 0);
  assert.ok((await store.read()).entities["observation:own-0"]);
});
