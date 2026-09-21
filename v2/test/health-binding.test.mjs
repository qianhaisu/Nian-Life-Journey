// HEALTH-02 source-binding closeout: (1) historical fact versions show only the evidence that existed then,
// (2) pending bindings persist and can be confirmed explicitly without re-sending different fact text.
// Synthetic data only; file-backed ledger in an OS temp dir.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCorrection, runImport } from "../lib/health/importer.ts";
import { analysisStatus, putAnalysis } from "../lib/health/ledger.ts";
import { businessDigest } from "../lib/health/model.ts";
import { buildTimeline, renderMarkdown, timelineContentHash, traceObservation } from "../lib/health/timeline.ts";
import { batch, episode, link, NOW, obs, src, tmpStore } from "./health-fixtures.mjs";

const apply = (store, b) => runImport(store, b, { apply: true, now: NOW });
const corr = (store, input) => runCorrection(store, input, { apply: true });
const tl = async (store, previous) => buildTimeline(await store.read(), { asOf: "2030-04-01", previous });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "scripts", "health-import", "cli.mjs");

// ---------- 1. historical versions and later evidence ----------
test("H1 a fact version never shows a source added later; current and historical views stay separate", async () => {
  const { store } = await tmpStore();
  await apply(store, batch("base", [src("s1", { text: "evidence1" }), obs("o1", { sources: ["s1"] })]));
  await apply(store, batch("later", [src("s2", { text: "later-evidence" }), obs("o1", { text: "new-fact", sources: ["s1", "s2"] })]));
  const t = traceObservation(await store.read(), "o1");
  assert.deepEqual(t.observation.versions[0].sources.map((s) => s.source), ["s1"], "v1 was documented by s1 only");
  assert.deepEqual(t.observation.versions[1].sources.map((s) => s.source), ["s1", "s2"]);
  assert.ok(!JSON.stringify(t.observation.versions[0]).includes("later-evidence"), "later evidence text does not leak into the old version");
  // the later source is revised twice, and a third fact version is written without s2: old versions do not change
  await apply(store, batch("s2v2", [src("s2", { text: "later-evidence-2" })]));
  await apply(store, batch("s2v3", [src("s2", { text: "later-evidence-3" })]));
  const before = JSON.stringify(t.observation.versions[0]);
  const t2 = traceObservation(await store.read(), "o1");
  assert.equal(JSON.stringify(t2.observation.versions[0]), before);
  assert.equal(t2.observation.versions[1].sources.find((s) => s.source === "s2").boundVersion, 1);
  assert.equal(t2.observation.versions[1].sources.find((s) => s.source === "s2").entity.text, "later-evidence", "bound to what it rested on, not the newest");
  // the timeline (current version) shows both sources
  const item = (await tl(store)).unattached.find((i) => i.observationId === "o1");
  assert.deepEqual(item.trace.sources.map((s) => s.id), ["s1", "s2"]);
});

test("H2 a later withdrawal of a relation is annotated, not applied backwards: old versions keep their basis, the current view drops it", async () => {
  const { store } = await tmpStore();
  await apply(store, batch("base", [src("s1"), src("s2"), obs("o1", { sources: ["s1", "s2"] })]));
  await apply(store, batch("v2", [obs("o1", { text: "second", sources: ["s1", "s2"] })]));
  await corr(store, { id: "rm", type: "link", from: { kind: "observation", id: "o1" }, to: { kind: "source", id: "s2" }, role: "supports", afterRole: "removed", author: "r", at: "2030-05-01", reason: "different message" });
  await apply(store, batch("v3", [obs("o1", { text: "third", sources: ["s1"] })]));
  const t = traceObservation(await store.read(), "o1");
  const ids = (i) => t.observation.versions[i].sources.map((s) => s.source);
  assert.deepEqual(ids(0), ["s1", "s2"], "v1 basis intact");
  assert.deepEqual(ids(1), ["s1", "s2"], "v2 basis intact although the relation was withdrawn afterwards");
  assert.deepEqual(ids(2), ["s1"], "the latest version no longer shows it");
  assert.equal(t.observation.versions[0].sources.find((s) => s.source === "s2").withdrawnSince, "rm", "withdrawal is annotated on the history");
  assert.deepEqual(t.sources.map((s) => s.source), ["s1"]);
  assert.deepEqual(t.removedSources.map((s) => s.source), ["s2"]);
  const l = await store.read();
  assert.equal(Object.values(l.links).filter((x) => x.from.id === "o1").length, 2, "audit rows are never deleted");
});

// ---------- 2. pending bindings and explicit confirmation ----------
async function pendingLedger() {
  const ctx = await tmpStore();
  await apply(ctx.store, batch("base", [src("s1", { text: "v1" }), obs("o1", { sources: ["s1"] }), episode("e1")], [link("observation", "o1", "attached", "episode", "e1")]));
  await apply(ctx.store, batch("source-only", [src("s1", { text: "v2" })]));
  const incoming = batch("unknown", [obs("o1", { text: "revised-fact", sources: ["s1"] })]);
  const first = await apply(ctx.store, incoming);
  return { ...ctx, incoming, first };
}
const sameFactPlusConfirmation = (toVersion, by = "reviewer", reason = "checked which source text the revision was written from") =>
  batch("confirm", [{ ...obs("o1", { text: "revised-fact", sources: ["s1"] }), links: [{ role: "from_source", to: { kind: "source", id: "s1" }, toVersion, confirmation: { by, reason } }] }]);

test("H3 a pending binding is recorded, survives replay, and is visible in queries and the timeline", async () => {
  const { store, incoming, first } = await pendingLedger();
  assert.equal(first.needsReview, true); assert.equal(first.counts.links_unconfirmed, 1);
  const l1 = await store.read();
  assert.equal(l1.bindingEvents.length, 1); assert.equal(l1.bindingEvents[0].type, "pending");
  assert.equal(l1.bindingEvents[0].before, 1); assert.equal(l1.bindingEvents[0].sourceCurrentVersion, 2);
  const replay = await apply(store, incoming);
  assert.equal(replay.needsReview, true, "the open question is still reported on replay");
  assert.equal(replay.counts.links_unconfirmed, 1);
  assert.equal(replay.links[0].reason, "source_binding_pending_confirmation");
  const l2 = await store.read();
  assert.equal(l2.bindingEvents.length, 1, "replay does not duplicate the pending event");
  assert.equal(businessDigest(l1), businessDigest(l2));
  const t = await tl(store);
  assert.equal(t.pendingBindings.length, 1);
  assert.match(renderMarkdown(t), /待确认的来源绑定/); assert.match(renderMarkdown(t), /依据版本待确认/);
  assert.equal(t.blocks[0].items[0].trace.sources[0].bindingPending, true);
  assert.deepEqual(Object.values(l2.links).find((x) => x.role === "from_source").bindings.map((b) => [b.from, b.to]), [[1, 1]], "no binding was invented");
});

test("H4 the same fact text can be re-sent with an explicit source version to confirm: audited, idempotent, history intact", async () => {
  const { store } = await pendingLedger();
  await store.transaction((l) => ({ ledger: putAnalysis(l, { id: "A", at: "2030-05-01", author: "assistant", body: {}, refs: [], episodeIds: ["e1"] }), result: null }));
  const before = await tl(store);
  const r = await apply(store, sameFactPlusConfirmation(2));
  assert.equal(r.counts.links_confirm, 1); assert.equal(r.needsReview, false); assert.equal(r.counts.version_change, 0, "the fact text was not changed");
  const l = await store.read();
  assert.equal(l.entities["observation:o1"].versions.length, 2, "no third fact version was created to trigger the update");
  const lk = Object.values(l.links).find((x) => x.role === "from_source");
  assert.deepEqual(lk.bindings.map((b) => [b.from, b.to]), [[1, 1], [2, 2]], "old binding kept, new one appended");
  const ev = l.bindingEvents.map((e) => ({ type: e.type, before: e.before, after: e.after, by: e.by ?? null, reason: e.reason ?? null, from: e.fromVersion }));
  assert.deepEqual(ev, [{ type: "pending", before: 1, after: null, by: null, reason: null, from: 2 }, { type: "confirmed", before: 1, after: 2, by: "reviewer", reason: "checked which source text the revision was written from", from: 2 }]);
  assert.equal(l.bindingEvents[1].at, "2030-01-01T00:00:00Z");
  const t = traceObservation(l, "o1");
  assert.deepEqual(t.observation.versions.map((v) => v.sources[0].boundVersion), [1, 2]);
  assert.equal(t.observation.versions[1].sources[0].confirmedBy, "reviewer");
  assert.equal(t.observation.versions[1].sources[0].bindingPending, false);
  const after = await tl(store, before);
  assert.equal(after.pendingBindings.length, 0);
  assert.equal(timelineContentHash(after), timelineContentHash(await tl(store)), "cached == fresh");
  assert.notEqual(before.blocks[0].inputHash, after.blocks[0].inputHash);
  assert.equal(analysisStatus(l, "A").status, "stale", "confirmation changes what the fact rests on, so dependent analyses are flagged");
  // idempotent retry
  const digest = businessDigest(l);
  const retry = await apply(store, sameFactPlusConfirmation(2));
  assert.equal(retry.counts.links_confirm, 0); assert.equal(retry.needsReview, false);
  assert.equal(businessDigest(await store.read()), digest, "retrying the same confirmation changes nothing");
});

test("H5 conflicting or incomplete confirmations never overwrite; a bound version is not silently re-bound", async () => {
  const { store } = await pendingLedger();
  const incomplete = await runImport(store, sameFactPlusConfirmation(2, "", ""));
  assert.equal(incomplete.rejected, true); assert.ok(incomplete.links.some((x) => x.reason === "confirmation_requires_by_and_reason"));
  const noMeta = batch("nometa", [{ ...obs("o1", { text: "revised-fact", sources: ["s1"] }), links: [{ role: "from_source", to: { kind: "source", id: "s1" }, toVersion: 2 }] }]);
  assert.equal((await runImport(store, noMeta)).rejected, true);
  await assert.rejects(apply(store, sameFactPlusConfirmation(9)), /rejected; nothing written/);
  await apply(store, sameFactPlusConfirmation(1));
  const l = await store.read();
  assert.deepEqual(Object.values(l.links).find((x) => x.role === "from_source").bindings.map((b) => [b.from, b.to]), [[1, 1], [2, 1]], "operator explicitly said v2 rests on source v1");
  const digest = businessDigest(l);
  const conflict = await apply(store, sameFactPlusConfirmation(2, "someone-else", "different opinion"));
  assert.equal(conflict.needsReview, true); assert.equal(conflict.counts.links_conflict, 1);
  assert.equal(conflict.links[0].reason, "binding_for_this_version_already_established");
  assert.equal(businessDigest(await store.read()), digest, "the earlier confirmation stands");
  // without any pending state, a differing explicit version for an already bound fact version is a conflict too
  const other = await tmpStore();
  await apply(other.store, batch("b", [src("s1"), obs("o1", { sources: ["s1"] })]));
  await apply(other.store, batch("s", [src("s1", { note: "v2" })]));
  const rebind = await apply(other.store, sameFactPlusConfirmation(2).items.length ? batch("r", [{ ...obs("o1", { sources: ["s1"] }), links: [{ role: "from_source", to: { kind: "source", id: "s1" }, toVersion: 2 }] }]) : null);
  assert.equal(rebind.counts.links_conflict, 1);
  assert.equal(Object.values((await other.store.read()).links).find((x) => x.role === "from_source").bindings.length, 1);
});

test("H6 CLI confirm-binding: dry-run then apply, idempotent, rejects without who/why", async () => {
  const { dir, store } = await pendingLedger();
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "health-confirm-")), "c.json");
  const run = (args) => spawnSync(process.execPath, ["--import", "tsx", CLI, "confirm-binding", "--ledger", dir, "--file", file, ...args], { cwd: path.join(HERE, ".."), encoding: "utf8" });
  const body = { from: { kind: "observation", id: "o1" }, role: "from_source", source: "s1", toVersion: 2, by: "reviewer", reason: "checked" };
  writeFileSync(file, JSON.stringify({ ...body, by: "", reason: "" }));
  assert.equal(run([]).status, 2);
  writeFileSync(file, JSON.stringify(body));
  const dry = run([]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal((await store.read()).bindingEvents.length, 1, "dry-run writes nothing");
  const applied = run(["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal((await store.read()).bindingEvents.length, 2);
  assert.equal(run(["--apply"]).status, 0);
  assert.equal((await store.read()).bindingEvents.length, 2, "idempotent");
});
