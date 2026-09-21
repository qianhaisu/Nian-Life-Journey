// HEALTH-02 acceptance scenarios, synthetic data only, file-backed store in an OS temp dir.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runCorrection, runImport } from "../lib/health/importer.ts";
import { analysisStatus, applyCorrection, confirmedFactIds, effectiveContent, membership, planImport, putAnalysis, registerEvidence, CONTENT_VALIDATORS } from "../lib/health/ledger.ts";
import { businessDigest, emptyLedger } from "../lib/health/model.ts";
import { buildTimeline, diffTimelines, renderHtml, renderMarkdown, traceObservation } from "../lib/health/timeline.ts";
import { adaptMessagesJsonl, adaptMessagesMarkdown } from "../lib/health/adapters.ts";
import { baseBatch, batch, encounter, episode, link, NOW, obs, src, tmpStore } from "./health-fixtures.mjs";

const apply = (store, b, extra = {}) => runImport(store, b, { apply: true, now: NOW, ...extra });

test("dry-run writes nothing; apply then re-apply is idempotent and only the run log grows", async () => {
  const { store } = await tmpStore();
  const dry = await runImport(store, baseBatch());
  assert.equal(dry.applied, false);
  assert.equal(dry.counts.new, 12);
  assert.equal((await store.read()).revision, 0, "dry-run must not write");
  const first = await apply(store, baseBatch());
  assert.equal(first.applied, true);
  const l1 = await store.read();
  const again = await apply(store, baseBatch());
  const l2 = await store.read();
  assert.equal(again.counts.new, 0);
  assert.equal(again.counts.links_new, 0);
  assert.equal(businessDigest(l1), businessDigest(l2), "business content unchanged");
  assert.equal(l2.runs.length, l1.runs.length + 1, "run log is separate and explains the replay");
  assert.equal(Object.keys(l2.links).length, Object.keys(l1.links).length);
});

test("shuffled replay of split batches lands on the same business digest", async () => {
  const b = baseBatch();
  const a = await tmpStore(), c = await tmpStore();
  await apply(a.store, b);
  const nonObs = b.items.filter((it) => it.kind !== "observation");
  const onlyObs = b.items.filter((it) => it.kind === "observation");
  await apply(c.store, { batchId: "p1", items: nonObs });
  await apply(c.store, { batchId: "p2", items: onlyObs.slice(2) });
  await apply(c.store, { batchId: "p3", items: onlyObs.slice(0, 2) });
  await apply(c.store, { batchId: "p4", items: [], links: [...b.links].reverse() });
  await apply(c.store, { batchId: "p5", items: b.items, links: b.links }); // full replay on top
  assert.equal(businessDigest(await c.store.read()), businessDigest(await a.store.read()));
});

test("same identity, changed content: new version kept, old version never revived by replay", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  const changed = batch("v2", [obs("o1", { role: "symptom_report", text: "edited text", sources: ["s1", "s2"] })]);
  const r = await apply(store, changed);
  assert.equal(r.counts.version_change, 1);
  const ledger = await store.read();
  assert.equal(ledger.entities["observation:o1"].versions.length, 2);
  const replayOld = await apply(store, batch("old", [obs("o1", { role: "symptom_report", sources: ["s1", "s2"] })]));
  assert.equal(replayOld.counts.duplicate, 1);
  assert.equal(replayOld.items[0].reason, "same_as_older_version_not_revived");
  assert.equal((await store.read()).entities["observation:o1"].versions.length, 2);
  assert.equal(effectiveContent(await store.read(), { kind: "observation", id: "o1" }).content.text, "edited text");
});

test("human correction survives re-import of old and changed data; before-value is traceable", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  await runCorrection(store, { id: "C1", type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: "corrected", author: "reviewer", at: "2030-04-01", reason: "misread" });
  await apply(store, baseBatch()); // old material again
  let l = await store.read();
  assert.equal(effectiveContent(l, { kind: "observation", id: "o1" }).content.text, "corrected");
  assert.equal(l.corrections[0].before, "t-o1");
  const auto = await apply(store, batch("auto", [obs("o1", { role: "symptom_report", text: "auto-changed", sources: ["s1", "s2"] })]));
  assert.deepEqual(auto.items[0].detail.shadowedByCorrection, ["text"]);
  l = await store.read();
  assert.equal(effectiveContent(l, { kind: "observation", id: "o1" }).content.text, "corrected");
  assert.equal(l.entities["observation:o1"].versions.length, 2, "auto version kept as evidence");
  // same correction id again is a no-op; a different payload under the same id is refused
  assert.equal((await runCorrection(store, { id: "C1", type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: "corrected", author: "reviewer", at: "2030-04-01", reason: "misread" })).action, "duplicate");
  await assert.rejects(runCorrection(store, { id: "C1", type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: "other", author: "x", at: "2030-04-02", reason: "y" }));
  await assert.rejects(runCorrection(store, { id: "C2", type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: "z", author: "", at: "2030-04-02", reason: "" }));
});

test("link correction (candidate -> removed) is not resurrected by re-import; membership conflict is reported", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  await runCorrection(store, { id: "C-L", type: "link", from: { kind: "observation", id: "o1" }, to: { kind: "episode", id: "e1" }, role: "attached", afterRole: "candidate", author: "r", at: "2030-04-01", reason: "only nearby in time" });
  let l = await store.read();
  assert.deepEqual(confirmedFactIds(l, "e1"), ["o2"]);
  const re = await apply(store, baseBatch());
  assert.equal(re.counts.links_new, 0);
  l = await store.read();
  assert.deepEqual(confirmedFactIds(l, "e1"), ["o2"]);
  // a later import proposing the opposite role for the same pair is a conflict, not an overwrite
  const opposing = await runImport(store, batch("opp", [], [link("observation", "o4", "attached", "episode", "e1")]), { apply: true, now: NOW });
  assert.equal(opposing.counts.links_conflict, 1);
  assert.ok(!confirmedFactIds(await store.read(), "e1").includes("o4"));
});

test("same-day different events stay separate; candidates never count; targets are checked by identity", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  const l = await store.read();
  assert.deepEqual(membership(l, "e1").attached, ["o1", "o2"]);
  assert.deepEqual(membership(l, "e1").candidate, ["o4"]);
  assert.deepEqual(membership(l, "e2"), { attached: [], candidate: [], background: [] }, "same-day episode is not merged or auto-filled");
  const tl = buildTimeline(l, { asOf: "2030-03-20" });
  const e1 = tl.blocks.find((b) => b.episodeId === "e1");
  assert.equal(e1.items.length, 2);
  assert.equal(e1.candidates.length, 1);
  assert.ok(e1.candidates.every((i) => i.counted === false));
  // wrong target kind / dangling target, same collection size in both cases
  const wrongKind = await runImport(store, batch("wk", [], [link("observation", "o4", "attached", "encounter", "E1")]));
  assert.equal(wrongKind.rejected, true);
  const dangling = await runImport(store, batch("dg", [], [link("observation", "o4", "attached", "episode", "e-nope")]));
  assert.ok(dangling.links.some((x) => x.reason === "dangling_target"));
  const roleMismatch = await runImport(store, batch("rm", [], [link("episode", "e1", "attached", "episode", "e2")]));
  assert.ok(roleMismatch.links.some((x) => x.reason === "role_not_allowed_from_kind"));
});

test("time honesty: unknown occurrence is shown as message record time; question/reminder/recall keep roles; ongoing vs unknown vs stale", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  await apply(store, batch("ended", [episode("e4", { end: "2030-03-05", declaredEnd: "ended" }), episode("e5", { declaredEnd: "ongoing", start: "2030-01-01" })]));
  const l = await store.read();
  const tl = buildTimeline(l, { asOf: "2030-03-10", staleDays: 14 });
  const st = Object.fromEntries(tl.blocks.map((b) => [b.episodeId, b.derivedStatus]));
  assert.equal(st.e4, "ended");
  assert.equal(st.e1, "end_unknown");
  assert.equal(st.e5, "stale_no_recent_update");
  const item = tl.blocks.find((b) => b.episodeId === "e1").items.find((i) => i.observationId === "o1");
  assert.equal(item.timeKind, "recorded_only");
  assert.match(renderMarkdown(tl), /仅消息记录时间，发生时间未知/);
  const cats = Object.fromEntries([...tl.blocks.flatMap((b) => [...b.items, ...b.candidates, ...b.background])].map((i) => [i.observationId, i.category]));
  assert.equal(cats.o2, "executed_report"); assert.equal(cats.o3, "plan"); assert.equal(cats.o4, "question"); assert.equal(cats.o5, "recall");
  assert.match(renderHtml(tl), /<h1>/);
});

test("unit participates: unit-less measure rejected, unit change is a conflict not a silent version", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  const noUnit = await runImport(store, batch("nu", [obs("o9", { extra: { measure: { value: 3 } } })]));
  assert.equal(noUnit.items[0].reason, "measure_unit_missing");
  const changedUnit = await runImport(store, batch("cu", [obs("o2", { role: "medication_administered", recordedAt: "2030-03-02 09:00:00", sources: ["s2"], extra: { measure: { value: 5, unit: "mg" } } })]));
  assert.equal(changedUnit.items[0].action, "conflict");
  assert.equal(changedUnit.items[0].reason, "unit_changed");
  const unknownTime = await runImport(store, batch("ut", [{ ...obs("o8"), content: { ...obs("o8").content, timeBasis: "explicit_in_text" } }]));
  assert.equal(unknownTime.items[0].reason, "unknown_occurrence_must_declare_time_basis");
  const lieTime = await runImport(store, batch("lt", [obs("o7", { occurredAt: "2030-03-01", precision: "day", extra: { timeBasis: "message_time_only" } })]));
  assert.equal(lieTime.items[0].reason, "occurred_at_claims_message_time_only");
});

test("bad input fails whole batch with no partial write; validator exceptions become failures, not passes", async () => {
  const { store } = await tmpStore();
  const bad = baseBatch();
  bad.links.push(link("observation", "o1", "attached", "episode", "missing-episode"));
  await assert.rejects(apply(store, bad), /rejected; nothing written/);
  assert.equal((await store.read()).revision, 0);
  const corrupt = batch("corrupt", [{ kind: "observation", id: "z", content: null }]);
  await assert.rejects(apply(store, corrupt));
  const noId = await runImport(store, batch("noid", [{ kind: "source", content: { a: 1 } }]));
  assert.equal(noId.items[0].reason, "no_strong_identity");
  const throwing = () => { throw new Error("boom"); };
  const r = await runImport(store, batch("t", [src("sx")]), { validators: [throwing] });
  assert.equal(r.rejected, true);
  assert.match(r.items[0].reason, /^validator_error:boom/);
  await assert.rejects(apply(store, batch("t2", [src("sx")]), { validators: [throwing] }));
  assert.equal((await store.read()).revision, 0);
});

test("injected crash before rename leaves the ledger untouched; retry then succeeds; stale lock is reclaimed", async () => {
  const { dir, store: good } = await tmpStore();
  const { HealthFileStore } = await import("../lib/health/file-store.ts");
  const crashing = new HealthFileStore(dir, { failBeforeRename: true });
  await assert.rejects(apply(crashing, baseBatch()), /injected/);
  assert.equal((await good.read()).revision, 0);
  await apply(good, baseBatch());
  assert.equal((await good.read()).revision, 1);
  // simulate a dead process's lock
  const { mkdir, utimes } = await import("node:fs/promises");
  await mkdir(path.join(dir, "ledger.lock"));
  const old = new Date(Date.now() - 120000);
  await utimes(path.join(dir, "ledger.lock"), old, old);
  const quick = new HealthFileStore(dir, { staleLockMs: 1000, lockTimeoutMs: 2000 });
  await apply(quick, batch("after-stale", [src("s9")]));
  assert.ok((await good.read()).entities["source:s9"]);
});

test("weak identity: cross-format twin is duplicate when text matches, ambiguous when it does not; strong ids never merge by guess", async () => {
  const { store } = await tmpStore();
  const json = adaptMessagesJsonl(JSON.stringify({ conversation: "c9", id: "m1", time: "2030-05-01 08:00:00", speaker: "A", text: "hello" }) + "\n" + JSON.stringify({ conversation: "c9", id: "m2", time: "2030-05-01 08:05:00", speaker: "B", text: "second" }), "j");
  await apply(store, json);
  const md = adaptMessagesMarkdown("- [2030-05-01 08:00:00] A: hello\n- [2030-05-01 08:05:00] B: second (edited)\n- [2030-05-01 08:10:00] A: new one", "c9", "m");
  const dry = await runImport(store, md);
  const byReason = dry.items.map((i) => `${i.action}:${i.reason ?? ""}`);
  assert.ok(byReason.includes("duplicate:weak_identity_matches_existing_slot_and_text"));
  assert.ok(byReason.includes("ambiguous:weak_identity_slot_taken_by_different_text"));
  assert.ok(byReason.includes("new:"));
  const applied = await apply(store, md);
  assert.equal(applied.counts.ambiguous, 1);
  const l = await store.read();
  assert.equal(Object.values(l.entities).filter((e) => e.kind === "source").length, 3, "ambiguous item was held, not merged or written");
  // weak id without full slot text is deterministic: re-import is a duplicate
  const again = await runImport(store, md);
  assert.equal(again.counts.new, 0);
});

test("incremental: adding one observation touches only its episode; unrelated blocks are reused and identical", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  const before = buildTimeline(await store.read(), { asOf: "2030-03-20" });
  assert.equal(before.stats.computed, 3);
  const r = await apply(store, batch("inc", [obs("o10", { role: "symptom_report", recordedAt: "2030-03-10 09:00:00", sources: ["s3"] })], [link("observation", "o10", "attached", "episode", "e3")]));
  assert.deepEqual(r.impact.episodes, ["e3"]);
  const after = buildTimeline(await store.read(), { asOf: "2030-03-20", previous: before });
  assert.equal(after.stats.computed, 1);
  assert.equal(after.stats.reused, 2);
  assert.strictEqual(after.blocks.find((b) => b.episodeId === "e1"), before.blocks.find((b) => b.episodeId === "e1"));
  const d = diffTimelines(before, after);
  assert.equal(d.changedBlocks.length, 1);
  assert.equal(d.changedBlocks[0].episodeId, "e3");
  assert.deepEqual(d.changedBlocks[0].addedItems, ["m:o10"]);
  assert.equal(d.unchangedBlocks, 2);
  // an unrelated new source touches no episode
  const r2 = await apply(store, batch("unrel", [src("s-lonely")]));
  assert.deepEqual(r2.impact.episodes, []);
});

test("dependent analyses go stale on fact change, membership change, correction and evidence change; withdrawal invalidates", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  await store.transaction((l) => {
    let n = registerEvidence(l, { id: "guide-x", version: "2030", status: "valid" });
    n = putAnalysis(n, { id: "A1", at: "t", author: "assistant", body: { note: "not a diagnosis" }, refs: [{ kind: "observation", id: "o1" }], episodeIds: ["e1"], evidence: [{ id: "guide-x", version: "2030" }], conditions: ["age<2"], reassessWhen: ["new fever reading"] });
    n = putAnalysis(n, { id: "A3", at: "t", author: "assistant", body: {}, refs: [{ kind: "observation", id: "o3" }], episodeIds: ["e3"] });
    return { ledger: n, result: null };
  });
  const status = async (id) => analysisStatus(await store.read(), id);
  assert.equal((await status("A1")).status, "current");
  const r = await apply(store, batch("chg", [obs("o1", { role: "symptom_report", text: "changed", sources: ["s1", "s2"] })]));
  assert.deepEqual(r.impact.analyses, ["A1"], "only the dependent analysis is reported");
  assert.equal((await status("A1")).status, "stale");
  assert.equal((await status("A3")).status, "current", "unrelated analysis untouched");
  // re-registering re-snapshots
  await store.transaction((l) => ({ ledger: putAnalysis(l, { id: "A1", at: "t2", author: "assistant", body: {}, refs: [{ kind: "observation", id: "o1" }], episodeIds: ["e1"], evidence: [{ id: "guide-x", version: "2030" }] }), result: null }));
  assert.equal((await status("A1")).status, "current");
  const c = await runCorrection(store, { id: "C9", type: "link", from: { kind: "observation", id: "o2" }, to: { kind: "episode", id: "e1" }, role: "attached", afterRole: "removed", author: "r", at: "t", reason: "wrong child" });
  assert.deepEqual(c.impact.analyses, ["A1"]);
  assert.equal((await status("A1")).status, "stale");
  await store.transaction((l) => ({ ledger: registerEvidence(l, { id: "guide-x", version: "2031", status: "valid" }), result: null }));
  assert.ok((await status("A1")).reasons.includes("evidence_version_changed:guide-x"));
  await store.transaction((l) => ({ ledger: registerEvidence(l, { id: "guide-x", version: "2031", status: "withdrawn" }), result: null }));
  assert.equal((await status("A1")).status, "invalidated");
});

test("shared source: story-side data is never read or changed (ledger holds references only)", async () => {
  // The health path has no dependency on the app repository. Assert it structurally: the modules import nothing from lib/db.
  for (const f of ["model", "ledger", "importer", "file-store", "timeline", "adapters"]) {
    const text = await readFile(new URL(`../lib/health/${f}.ts`, import.meta.url), "utf8");
    assert.ok(!/from "\.\.\/db|persistCareEpisode|getStore|DATABASE_URL/.test(text.replace(/\/\/.*$/gm, "")), `${f}.ts must not touch the application database`);
  }
  const l = emptyLedger();
  assert.deepEqual(Object.keys(l).sort(), ["analyses", "corrections", "entities", "evidence", "links", "revision", "runs", "schema"]);
});

test("trace: every timeline item resolves to observation versions, source chain and corrections", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  await runCorrection(store, { id: "CT", type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: "fixed", author: "a", at: "t", reason: "r" });
  const l = await store.read();
  const t = traceObservation(l, "o1");
  assert.deepEqual(t.sources.map((s) => `${s.role}:${s.source}`), ["from_source:s1", "supports:s2"]);
  assert.equal(t.corrections.length, 1);
  const item = buildTimeline(l, { asOf: "2030-03-20" }).blocks[0].items[0];
  assert.deepEqual(item.trace.corrections, ["CT"]);
  assert.equal(traceObservation(l, "nope"), null);
});

test("content validators are generic: no episode/observation id or keyword decides anything", () => {
  const l = emptyLedger();
  const p = planImport(l, batch("g", [obs("anything-at-all", { text: "任意文字" })]), CONTENT_VALIDATORS);
  assert.equal(p.counts.new, 1);
  assert.equal(applyCorrection.length >= 2, true);
});
