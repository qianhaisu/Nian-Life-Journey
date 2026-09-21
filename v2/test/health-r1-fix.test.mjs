// HEALTH-02-R1 focused fixes: the three groups of counter-examples from the second Codex review, on synthetic data.
// Assertions are on behaviour (state, digests, reasons, exit paths), not on the probes' literal values.
import test from "node:test";
import assert from "node:assert/strict";
import { runCorrection, runImport } from "../lib/health/importer.ts";
import { Graph, analysisStatus, effectiveContent, isValidTimeString, parseTimeString, putAnalysis, resolveRef } from "../lib/health/ledger.ts";
import { businessDigest } from "../lib/health/model.ts";
import { buildTimeline, diffTimelines, renderMarkdown, timelineContentHash, traceObservation } from "../lib/health/timeline.ts";
import { adaptMessagesJson, adaptMessagesMarkdown } from "../scripts/health-import/message-adapters.mjs";
import { batch, episode, link, NOW, obs, src, tmpStore } from "./health-fixtures.mjs";

const apply = (store, b, extra = {}) => runImport(store, b, { apply: true, now: NOW, ...extra });
const corr = (store, input) => runCorrection(store, input, { apply: true });
const C = (id, ref, field, after) => ({ id, type: "field", ref, field, after, author: "r", at: "2030-05-01", reason: "why" });
const tl = async (store, previous) => buildTimeline(await store.read(), { asOf: "2030-04-01", previous });
const analyse = (store, id, refs, episodeIds) => store.transaction((l) => ({ ledger: putAnalysis(l, { id, at: "2030-05-01", author: "assistant", body: {}, refs, episodeIds }), result: null }));
const status = async (store, id) => analysisStatus(await store.read(), id).status;

// ============ Group 1: source versions, corrections and dependency propagation ============
const withSource = () => batch("b", [src("s1", { note: "v1" }), obs("o1", { sources: ["s1"] }), episode("e1")], [link("observation", "o1", "attached", "episode", "e1")]);

test("G1.1 source v1->v2->v3: v2 and v3 are distinguishable, evidence stays bound to v1, cached timeline equals fresh at every step", async () => {
  const { store } = await tmpStore();
  await apply(store, withSource());
  let prev = await tl(store);
  const hashes = [prev.blocks[0].inputHash];
  for (const [i, note] of ["v2", "v3"].entries()) {
    await apply(store, batch(`rev${i}`, [src("s1", { note })]));
    const cached = await tl(store, prev), fresh = await tl(store);
    assert.equal(timelineContentHash(cached), timelineContentHash(fresh), `step ${i}: cached == fresh`);
    const ref = cached.blocks[0].items[0].trace.sources[0];
    assert.equal(ref.boundVersion, 1); assert.equal(ref.currentVersion, i + 2); assert.equal(ref.newerVersionAvailable, true);
    hashes.push(cached.blocks[0].inputHash);
    prev = cached;
  }
  assert.equal(new Set(hashes).size, 3, "v1, v2, v3 all give different block hashes");
  assert.equal(traceObservation(await store.read(), "o1").sources[0].entity.note, "v1", "bound evidence is still v1");
});

test("G1.2 a human correction on a source counts: it reaches direct and indirect analyses, the timeline and the trace", async () => {
  const { store } = await tmpStore();
  await apply(store, withSource());
  await analyse(store, "direct", [{ kind: "source", id: "s1" }], []);
  await analyse(store, "viaEpisode", [], ["e1"]);
  await analyse(store, "viaFact", [{ kind: "observation", id: "o1" }], []);
  const before = await tl(store);
  const c = await corr(store, C("cs", { kind: "source", id: "s1" }, "note", "corrected note"));
  assert.deepEqual(c.impact.episodes, ["e1"]);
  assert.deepEqual(c.impact.analyses.sort(), ["direct", "viaEpisode", "viaFact"]);
  for (const id of ["direct", "viaEpisode", "viaFact"]) assert.equal(await status(store, id), "stale", id);
  const l = await store.read();
  assert.equal(traceObservation(l, "o1").sources[0].entity.note, "corrected note", "trace shows the corrected content of the bound version");
  assert.equal(timelineContentHash(await tl(store, before)), timelineContentHash(await tl(store)));
  assert.notEqual(diffTimelines(before, await tl(store)).changedBlocks.length + (before.blocks[0].inputHash === (await tl(store)).blocks[0].inputHash ? 0 : 1), 0);
});

test("G1.3 fact and source revised together: the new fact version gets its own binding, the old fact version keeps the old one", async () => {
  const { store } = await tmpStore();
  await apply(store, withSource());
  const r = await apply(store, batch("both", [src("s1", { note: "v2" }), obs("o1", { sources: ["s1"], text: "derived from v2" })]));
  assert.equal(r.counts.links_rebind, 1);
  const l = await store.read();
  const lk = Object.values(l.links).find((x) => x.role === "from_source" && x.from.id === "o1");
  assert.deepEqual(lk.bindings.map((b) => [b.from, b.to]), [[1, 1], [2, 2]], "append-only bindings, history not overwritten");
  const t = traceObservation(l, "o1");
  assert.deepEqual(t.observation.versions.map((v) => v.sources[0].boundVersion), [1, 2]);
  assert.deepEqual(t.observation.versions.map((v) => v.sources[0].entity.note), ["v1", "v2"]);
  const item = (await tl(store)).blocks[0].items[0];
  assert.equal(item.trace.sources[0].boundVersion, 2); assert.equal(item.trace.sources[0].newerVersionAvailable, false);
});

test("G1.4 evidence version not stated: reported, never guessed; explicit toVersion is honoured; out-of-range refused", async () => {
  const { store } = await tmpStore();
  await apply(store, withSource());
  await apply(store, batch("srcOnly", [src("s1", { note: "v2" })]));
  const unstated = await apply(store, batch("obs2", [obs("o1", { sources: ["s1"], text: "new fact version" })]));
  assert.equal(unstated.counts.links_unconfirmed, 1); assert.equal(unstated.needsReview, true);
  let l = await store.read();
  const lk = () => Object.values(l.links).find((x) => x.role === "from_source" && x.from.id === "o1");
  assert.deepEqual(lk().bindings.map((b) => b.to), [1], "no binding was invented");
  const bad = await runImport(store, batch("bad", [obs("o1", { sources: ["s1"], text: "third" })], []));
  assert.equal(bad.needsReview, true);
  const explicitBatch = batch("exp", [{ ...obs("o1", { sources: ["s1"], text: "explicitly on v2" }), links: [{ role: "from_source", to: { kind: "source", id: "s1" }, toVersion: 2 }] }]);
  const ok = await apply(store, explicitBatch);
  assert.equal(ok.counts.links_rebind, 1);
  l = await store.read();
  assert.equal(lk().bindings.at(-1).to, 2);
  const range = await runImport(store, batch("range", [{ ...obs("o1", { sources: ["s1"], text: "x" }), links: [{ role: "from_source", to: { kind: "source", id: "s1" }, toVersion: 9 }] }]));
  assert.equal(range.rejected, true);
  assert.ok(range.links.some((x) => x.reason === "binding_version_out_of_range"));
});

// ============ Group 2: weak identity upgrades ============
const MD = (conv, lines) => `# n\n\n- 会话ID: \`${conv}\`\n- 消息数量: ${lines.length}\n\n---\n\n${lines.map(([t, who, body]) => `## ${t.replace(/-/g, "\\-")} ${who}\n\n${body}\n`).join("\n")}`;
const jsonMsgs = (conv, msgs) => JSON.stringify({ session: { wxid: conv }, messages: msgs });
const T = "2030-05-01 08:00:00";
const weakMd = (conv = "cv") => adaptMessagesMarkdown(MD(conv, [[T, "甲", "same words"]]), { batchId: "w" }).batch;
const strongTwo = (conv = "cv") => adaptMessagesJson(jsonMsgs(conv, [{ platformMessageId: "p1", createTime: T, senderDisplayName: "甲", content: "same words" }, { platformMessageId: "p2", createTime: T, senderDisplayName: "甲", content: "same words" }]), { batchId: "s2" }).batch;
const strongOne = (id, conv = "cv") => adaptMessagesJson(jsonMsgs(conv, [{ platformMessageId: id, createTime: T, senderDisplayName: "甲", content: "same words" }]), { batchId: `s-${id}` }).batch;
const srcs = (l) => Object.values(l.entities).filter((e) => e.kind === "source");

test("G2.1 several strong messages match one weak record: no crash, no first-pick; all kept with a pending mapping; order-independent", async () => {
  const a = await tmpStore(), b = await tmpStore(), c = await tmpStore();
  await apply(a.store, weakMd()); const ra = await apply(a.store, strongTwo());
  await apply(b.store, strongTwo()); const rb = await apply(b.store, weakMd());
  const la = await a.store.read(), lb = await b.store.read();
  assert.equal(ra.needsReview, true); assert.equal(rb.needsReview, true);
  assert.equal(srcs(la).length, 3); assert.equal(Object.keys(la.ambiguities).length, 2);
  assert.equal(srcs(la).filter((e) => e.identity === "weak").length, 1, "the weak record was not moved onto either strong message");
  assert.equal(businessDigest(la), businessDigest(lb), "weak-then-strong and strong-then-weak agree");
  // same batch: weak + both strong together
  const together = { batchId: "all", items: [...weakMd().items, ...strongTwo().items] };
  await apply(c.store, together);
  assert.equal(businessDigest(await c.store.read()), businessDigest(la));
});

test("G2.2 strong messages arriving in separate batches: the second one sees the alias is already taken, keeps both, resolves nothing silently", async () => {
  const { store } = await tmpStore();
  await apply(store, weakMd());
  const first = await apply(store, strongOne("p1"));
  assert.equal(first.counts.needsReview ?? 0, 0);
  const weakId = Object.values((await store.read()).entities).find((e) => (e.aliases ?? []).length)?.aliases[0];
  assert.ok(weakId, "first strong message adopted the weak identity");
  const second = await apply(store, strongOne("p2"));
  assert.equal(second.needsReview, true);
  const l = await store.read();
  assert.equal(srcs(l).length, 2);
  assert.throws(() => resolveRef(l, { kind: "source", id: weakId }), /identity_ambiguous/);
});

test("G2.3 a retired weak id still resolves: lookup, trace, correction, idempotent retry, analysis; audit identity is preserved", async () => {
  const { store } = await tmpStore();
  const weak = weakMd();
  await apply(store, weak);
  const weakEntity = srcs(await store.read())[0];
  const weakRef = { kind: "source", id: weakEntity.id };
  // an observation cites the weak source; a correction and an analysis are recorded against the weak id BEFORE the upgrade
  await apply(store, batch("o", [src("zz"), obs("o1", { sources: ["zz"] }), episode("e1")], []));
  await apply(store, { batchId: "lk", items: [], links: [link("observation", "o1", "supports", "source", weakEntity.id)] });
  const pre = C("pre", weakRef, "text", "corrected before upgrade");
  await corr(store, pre);
  await analyse(store, "A", [weakRef], []);
  const upgrade = await apply(store, strongOne("p1"));
  assert.ok(upgrade.impact.entities.length > 0);
  assert.ok(upgrade.impact.analyses.includes("A"), "impact includes dependents that existed before the upgrade");
  const l = await store.read();
  const strong = srcs(l).find((e) => (e.aliases ?? []).length);
  assert.equal(strong.identity, "strong"); assert.ok(strong.aliases.includes(weakEntity.id));
  assert.deepEqual(resolveRef(l, weakRef), { ref: { kind: "source", id: strong.id }, redirectedFrom: weakEntity.id });
  const rec = l.corrections.find((c) => c.id === "pre");
  assert.equal(rec.ref.id, strong.id, "live pointer moved so the correction keeps applying");
  assert.equal(rec.refAtRecording.id, weakEntity.id, "audit identity kept");
  assert.equal(effectiveContent(l, { kind: "source", id: strong.id }).content.text, "corrected before upgrade");
  assert.equal(analysisStatus(l, "A").status, "stale");
  assert.equal(l.analyses.A.versions[0].snapshot.refs[0].originalRef.id, weakEntity.id);
  // retry using the old id, then the new id: idempotent
  assert.equal((await corr(store, pre)).action, "duplicate");
  assert.equal((await corr(store, { ...pre, ref: { kind: "source", id: strong.id } })).action, "duplicate");
  await assert.rejects(corr(store, { ...pre, after: "another value" }), /different request/);
  // a NEW correction addressed by the retired id lands on the adopting entity
  await corr(store, C("post", weakRef, "speaker", "乙"));
  assert.equal(effectiveContent(await store.read(), { kind: "source", id: strong.id }).content.speaker, "乙");
  // trace by retired id (observation) works too
  const t = traceObservation(await store.read(), "o1");
  assert.equal(t.sources.some((s) => s.source === strong.id), true, "links were re-pointed to the adopting entity");
});

// ============ Group 3: structured medical fields, validation, dates ============
const RX = { type: "medication_prescribed", value: JSON.stringify({ dose: "每次5.00ml" }), agreement: "agree", structured: { name: "drug", spec: "100ml", dose: "每次5.00ml", freq: "BID", route: "口服", qty: "x1", note: null } };
const LAB = { type: "lab_result", value: "8.5 IU/mL", agreement: "agree", structured: { name: "IgE", value: "8.5", unit: "IU/mL", ref_range: "0.0-60.0", flag: null } };
const withFacts = () => batch("f", [src("s1"), obs("o1", { sources: ["s1"] }), episode("e1"), { kind: "encounter", id: "E1", content: { kind: "visit", date: "2030-03-01" } }, { kind: "canonical_fact", id: "rx", content: RX }, { kind: "canonical_fact", id: "lab", content: LAB }, { kind: "canonical_fact", id: "free", content: { type: "lab_result", value: "x", structured: { name: "n", value: "y", unit: null } } }],
  [link("observation", "o1", "attached", "episode", "e1"), link("episode", "e1", "encounter", "encounter", "E1"), link("canonical_fact", "rx", "of_encounter", "encounter", "E1"), link("canonical_fact", "lab", "of_encounter", "encounter", "E1")]);

test("G3.1 structured fields are shown, and a correction to them becomes the displayed current value (original text kept, marked superseded), with a real diff", async () => {
  const { store } = await tmpStore();
  await apply(store, withFacts());
  const before = await tl(store);
  const facts = before.blocks[0].encounters[0].facts;
  const rx0 = facts.find((f) => f.id === "rx");
  assert.equal(rx0.structured.dose, "每次5.00ml"); assert.match(rx0.structuredText, /剂量=每次5\.00ml/); assert.match(rx0.structuredText, /频次=BID/); assert.match(rx0.structuredText, /途径=口服/); assert.match(rx0.structuredText, /规格=100ml/);
  assert.equal(rx0.valueTextSuperseded, false);
  assert.equal(facts.find((f) => f.id === "lab").structured.ref_range, "0.0-60.0");
  await corr(store, C("d1", { kind: "canonical_fact", id: "rx" }, "structured.dose", "每次3.00ml"));
  await corr(store, C("l1", { kind: "canonical_fact", id: "lab" }, "structured.value", "9.9"));
  const l = await store.read();
  const after = await tl(store, before);
  assert.equal(timelineContentHash(after), timelineContentHash(await tl(store)), "cached == fresh");
  const rx = after.blocks[0].encounters[0].facts.find((f) => f.id === "rx"), lab = after.blocks[0].encounters[0].facts.find((f) => f.id === "lab");
  assert.equal(rx.structured.dose, "每次3.00ml"); assert.equal(rx.valueTextSuperseded, true); assert.match(rx.displayValue, /每次3\.00ml/); assert.ok(!/5\.00ml/.test(rx.displayValue), "old reading is not the displayed value");
  assert.equal(rx.value, RX.value, "original text is preserved"); assert.deepEqual(rx.correctionIds, ["d1"]);
  assert.match(lab.displayValue, /值=9\.9/);
  const d = diffTimelines(before, after);
  assert.equal(d.changedBlocks.length, 1); assert.equal(d.changedBlocks[0].metaChanged, true);
  const md = renderMarkdown(after);
  assert.match(md, /当前（结构化，已更正 d1）：.*每次3\.00ml/); assert.match(md, /原文（已被更正取代，不作当前值）/);
  assert.equal(effectiveContent(l, { kind: "canonical_fact", id: "rx" }).content.structured.dose, "每次3.00ml");
  // an unattached fact shows its correction in the diff as well
  const b2 = await tl(store);
  await corr(store, C("u1", { kind: "canonical_fact", id: "free" }, "structured.value", "z"));
  assert.deepEqual(diffTimelines(b2, await tl(store)).unattachedFacts.changed, ["free"]);
});

test("G3.2 dose/structured validation: objects need real units, missing unit refused at import and correction, unit changes conflict, unknown stays unknown", async () => {
  const { store } = await tmpStore();
  const bad = (id, content) => ({ kind: "canonical_fact", id, content });
  const noUnitDose = await runImport(store, batch("a", [bad("d1", { type: "medication_prescribed", value: "v", structured: { name: "n", dose: { value: 3 } } })]));
  assert.equal(noUnitDose.items[0].reason, "dose_unit_missing");
  const noUnitObs = await runImport(store, batch("b", [src("s1"), obs("o1", { sources: ["s1"], extra: { dose: { value: 3 } } })]));
  assert.equal(noUnitObs.items.find((i) => i.ref.kind === "observation").reason, "dose_unit_missing");
  const labNoKey = await runImport(store, batch("c", [bad("l1", { type: "lab_result", value: "x", structured: { name: "n", value: "5" } })]));
  assert.equal(labNoKey.items[0].reason, "structured_unit_missing");
  const okCases = await runImport(store, batch("d", [bad("ok1", { type: "medication_prescribed", value: "v", structured: { name: "n", dose: { value: 3, unit: "ml" } } }), bad("ok2", { type: "lab_result", value: "x", structured: { name: "n", value: "5", unit: null } }), bad("ok3", { type: "lab_result", value: "x", structured: { name: "n", value: "negative" } }), bad("ok4", { type: "medication_prescribed", value: "v", structured: { name: "n", dose: "text dose kept as text" } })]));
  assert.equal(okCases.rejected, false, JSON.stringify(okCases.items));
  await apply(store, batch("d2", okCases.items.length ? [bad("ok1", { type: "medication_prescribed", value: "v", structured: { name: "n", dose: { value: 3, unit: "ml" } } })] : []));
  await apply(store, batch("e", [bad("rx", RX), bad("lab", LAB)]));
  const unitObj = await runImport(store, batch("u1", [bad("lab", { ...LAB, structured: { ...LAB.structured, unit: "mg/dL" } })]));
  assert.equal(unitObj.items[0].action, "conflict"); assert.equal(unitObj.items[0].reason, "unit_changed");
  const unitText = await runImport(store, batch("u2", [bad("rx", { ...RX, structured: { ...RX.structured, dose: "每次5.00mg" } })]));
  assert.equal(unitText.items[0].action, "conflict"); assert.equal(unitText.items[0].detail.kind, "unit_token_in_text");
  const sameUnit = await runImport(store, batch("u3", [bad("rx", { ...RX, structured: { ...RX.structured, dose: "每次6.00ml" } })]));
  assert.equal(sameUnit.items[0].action, "version_change");
  // corrections go through the same validation
  await assert.rejects(runCorrection(store, C("x1", { kind: "canonical_fact", id: "ok1" }, "structured.dose", { value: 3 })), /dose_unit_missing/);
  await assert.rejects(runCorrection(store, C("x2", { kind: "canonical_fact", id: "lab" }, "structured", { name: "n", value: "5" })), /structured_unit_missing/);
  assert.equal((await corr(store, C("x3", { kind: "canonical_fact", id: "ok1" }, "structured.dose", { value: 4, unit: "ml" }))).action, "new");
});

test("G3.3 time strings are parsed whole: trailing junk, impossible offsets and precision finer than the value are refused; legal forms pass", async () => {
  for (const bad of ["2030-05-01NOT_A_TIME", "2030-05-01 10:00:00junk", "2030-05-01T10:00:00+25:00", "2030-05-01T24:00", "2030-13-01", "2030-02-30", "2030-05-01Z", "2030-5-1", " 2030-05-01", "2030-05-01T10:00:00+08:99"]) assert.equal(isValidTimeString(bad), false, bad);
  for (const good of ["2030", "2030-05", "2030-05-01", "2030-05-01 10:00", "2030-05-01T10:00:00", "2030-05-01T10:00:00Z", "2030-05-01T10:00:00.123+08:00", "2030-05-01 10:00:00-0500"]) assert.ok(parseTimeString(good), good);
  assert.equal(parseTimeString("2030-05").shape, "month");
  const { store } = await tmpStore();
  const mk = (id, occurredAt, precision) => ({ ...obs(id, { sources: ["s1"], occurredAt, precision }), content: { ...obs(id).content, occurredAt, occurredPrecision: precision, timeBasis: "explicit_in_text" } });
  const r = await runImport(store, batch("t", [src("s1"), mk("a", "2030-05", "month"), mk("b", "2030-05", "day"), mk("c", "2030-05-01", "minute"), mk("d", "2030-05-01", "approx"), mk("e", "2030", "year"), mk("f", "2030-05-01T10:00:00+08:00", "minute"), mk("g", "2030-05-01x", "day")]));
  const reasons = Object.fromEntries(r.items.filter((i) => i.action === "rejected").map((i) => [i.ref.id, i.reason]));
  assert.deepEqual(reasons, { b: "occurred_precision_finer_than_value", c: "occurred_precision_finer_than_value", g: "occurred_at_not_a_valid_time" });
  await assert.rejects(runCorrection(store, { ...C("t1", { kind: "source", id: "s1" }, "x", 1), at: "2030-05-01NOT" }), /valid date/);
});
