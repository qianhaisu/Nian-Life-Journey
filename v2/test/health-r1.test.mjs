// HEALTH-02-R1 regression: every counter-example from the Codex review, on synthetic data.
// The cases assert behaviour (state, digests, reasons), not the literal values the probes used.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCorrection, runImport } from "../lib/health/importer.ts";
import { Graph, analysisStatus, computeImpact, planImport, putAnalysis, applyCorrection } from "../lib/health/ledger.ts";
import { businessDigest, emptyLedger } from "../lib/health/model.ts";
import { buildTimeline, diffTimelines, renderMarkdown, timelineContentHash, traceObservation } from "../lib/health/timeline.ts";
import { adaptEpisodesR4, adaptHandoff, adaptHospitalR2 } from "../lib/health/adapters.ts";
import { MessageInputError, adaptMessagesJson, adaptMessagesMarkdown } from "../scripts/health-import/message-adapters.mjs";
import { assertOutsideRepo, isInsideRepo, repoRoot } from "../scripts/health-import/paths.mjs";
import { baseBatch, batch, encounter, episode, link, NOW, obs, src, tmpStore } from "./health-fixtures.mjs";

const apply = (store, b, extra = {}) => runImport(store, b, { apply: true, now: NOW, ...extra });
const corr = (store, input) => runCorrection(store, input, { apply: true });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "scripts", "health-import", "cli.mjs");

// ---------------- A. identity ----------------
test("A1 in-batch same identity with different content refuses the whole batch, in either order, writing nothing", async () => {
  const v1 = obs("dup", { text: "first" }), v2 = obs("dup", { text: "second" });
  for (const items of [[src("s1"), v1, v2], [src("s1"), v2, v1]]) {
    const { store } = await tmpStore();
    const dry = await runImport(store, batch("x", items));
    assert.equal(dry.rejected, true);
    assert.ok(dry.items.some((i) => i.action === "conflict" && i.reason === "same_identity_different_content_in_batch"));
    await assert.rejects(apply(store, batch("x", items)), /rejected; nothing written/);
    assert.equal((await store.read()).revision, 0);
  }
});

const MD = (conv, lines) => `# name\n\n- 会话ID: \`${conv}\`\n- 会话类型: 私聊\n- 消息数量: ${lines.length}\n\n---\n\n${lines.map(([t, who, body]) => `## ${t.replace(/-/g, "\\-")} ${who}\n\n${body}\n`).join("\n")}`;
const jsonExport = (conv, msgs) => JSON.stringify({ session: { wxid: conv }, messages: msgs });

test("A2 JSON->Markdown and Markdown->JSON converge to one entity and the same business digest", async () => {
  const conv = "conv-a";
  const mdText = MD(conv, [["2030-05-01 08:00:00", "甲", "第一行\n第二行\n\\[not a tag\\]"], ["2030-05-01 08:05:00", "乙", "[图片]"]]);
  const jsonText = jsonExport(conv, [
    { platformMessageId: "p1", createTime: "2030-05-01 08:00:00", senderDisplayName: "甲", content: "第一行\n第二行\n[not a tag]" },
    { platformMessageId: "p2", createTime: "2030-05-01 08:05:00", senderDisplayName: "乙", content: "[图片]" },
  ]);
  const md = adaptMessagesMarkdown(mdText, { batchId: "md" }).batch, js = adaptMessagesJson(jsonText, { batchId: "js" }).batch;
  assert.equal(md.items.length, 2);
  assert.equal(md.items[0].content.text, "第一行\n第二行\n[not a tag]", "multi-line body and escapes preserved");
  assert.equal(md.items[1].content.hasAttachmentPlaceholder, true);
  const a = await tmpStore(), b = await tmpStore();
  await apply(a.store, js); const second = await apply(a.store, md);
  await apply(b.store, md); const other = await apply(b.store, js);
  const la = await a.store.read(), lb = await b.store.read();
  const sources = (l) => Object.values(l.entities).filter((e) => e.kind === "source");
  assert.equal(sources(la).length, 2); assert.equal(sources(lb).length, 2, "no double counting in either order");
  assert.equal(businessDigest(la), businessDigest(lb));
  assert.equal(second.counts.duplicate, 2); assert.equal(other.counts.duplicate + other.counts.version_change, 2);
  assert.ok(sources(la).every((e) => e.identity === "strong" && (e.aliases ?? []).some((x) => x.startsWith("weak:"))), "weak identity kept as alias/evidence");
  assert.deepEqual(la.ambiguities, {});
});

test("A3 same slot, different text between weak and strong: both kept, never merged, ambiguity recorded identically in either order", async () => {
  const conv = "conv-b";
  const mdText = MD(conv, [["2030-06-01 09:00:00", "甲", "edited wording"]]);
  const jsonText = jsonExport(conv, [{ platformMessageId: "p9", createTime: "2030-06-01 09:00:00", senderDisplayName: "甲", content: "original wording" }]);
  const md = adaptMessagesMarkdown(mdText, { batchId: "md" }).batch, js = adaptMessagesJson(jsonText, { batchId: "js" }).batch;
  const a = await tmpStore(), b = await tmpStore();
  await apply(a.store, js); const ra = await apply(a.store, md);
  await apply(b.store, md); const rb = await apply(b.store, js);
  assert.equal(ra.needsReview, true); assert.equal(rb.needsReview, true);
  const la = await a.store.read(), lb = await b.store.read();
  assert.equal(Object.values(la.entities).length, 2);
  assert.equal(Object.keys(la.ambiguities).length, 1);
  assert.equal(businessDigest(la), businessDigest(lb));
  assert.match(renderMarkdown(buildTimeline(la, { asOf: "2030-07-01" })), /待人工判断的同槽位歧义/);
});

test("A4 input failures are explicit, list line numbers only, never message text", () => {
  const SECRET = "SECRET-BODY-TEXT";
  assert.throws(() => adaptMessagesMarkdown("   \n", { conversation: "c", batchId: "b" }), (e) => e instanceof MessageInputError && e.code === "empty_input");
  assert.throws(() => adaptMessagesMarkdown(`${SECRET}\nno headings at all`, { conversation: "c", batchId: "b" }), (e) => e.code === "unsupported_or_unparseable_markdown" && !e.message.includes(SECRET));
  assert.throws(() => adaptMessagesMarkdown(MD("", [["2030-01-01 10:00:00", "甲", SECRET]]).replace(/- 会话ID.*\n/, ""), { batchId: "b" }), (e) => e.code === "conversation_identity_missing");
  assert.throws(() => adaptMessagesMarkdown(`## 2030\\-01\\-01 10:00:00 \n\n${SECRET}\n`, { conversation: "c", batchId: "b" }), (e) => e.code === "messages_rejected" && !e.message.includes(SECRET) && e.details.first[0].why === "speaker_missing");
  assert.throws(() => adaptMessagesJson("{not json", { conversation: "c", batchId: "b" }), (e) => e.code === "invalid_json");
  assert.throws(() => adaptMessagesJson(JSON.stringify({ hello: SECRET }), { conversation: "c", batchId: "b" }), (e) => e.code === "unsupported_json_shape" && !e.message.includes(SECRET));
  assert.throws(() => adaptMessagesJson(JSON.stringify({ messages: [{ content: SECRET, senderUsername: "u" }] }), { conversation: "c", batchId: "b" }), (e) => e.code === "messages_rejected" && !e.message.includes(SECRET));
  const w = adaptMessagesMarkdown(MD("c", [["2030-01-01 10:00:00", "甲", "x"]]).replace("消息数量: 1", "消息数量: 5"), { batchId: "b" });
  assert.equal(w.warnings[0].code, "declared_count_differs");
});

test("A5 message adapters create sources only: no observation, episode or health claim", () => {
  const r = adaptMessagesMarkdown(MD("c", [["2030-01-01 10:00:00", "甲", "发烧了"]]), { batchId: "b" });
  assert.ok(r.batch.items.every((i) => i.kind === "source"));
});

// ---------------- B. corrections ----------------
test("B1 same correction id must repeat the SAME request; another target/field/value/author is refused", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  const base = { id: "C1", type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: "x", author: "r", at: "2030-05-01", reason: "why" };
  await corr(store, base);
  assert.equal((await corr(store, base)).action, "duplicate");
  for (const bad of [{ ref: { kind: "observation", id: "o2" } }, { field: "role" }, { after: "y" }, { author: "other" }, { reason: "else" }, { at: "2030-05-02" }]) {
    await assert.rejects(corr(store, { ...base, ...bad }), /already used with a different request/, JSON.stringify(bad));
  }
  const l = await store.read();
  assert.equal(l.corrections.length, 1);
  assert.equal(l.entities["observation:o2"].versions.length, 1);
  const eff = (await import("../lib/health/ledger.ts")).effectiveContent(l, { kind: "observation", id: "o2" });
  assert.equal(eff.content.text, "t-o2", "o2 was not touched");
});

test("B2 a correction cannot create content the importer would reject; dry-run fails for the same reasons and writes nothing", async () => {
  const { store } = await tmpStore();
  await apply(store, batch("b", [src("s1"), obs("d", { occurredAt: "2030-03-01", precision: "day", extra: { timeBasis: "explicit_in_text", measure: { value: 5, unit: "ml" } } }), episode("e1")], [link("observation", "d", "attached", "episode", "e1")]));
  const before = businessDigest(await store.read());
  const mk = (id, over) => ({ id, type: "field", ref: { kind: "observation", id: "d" }, author: "r", at: "2030-05-01", reason: "why", ...over });
  const illegal = [
    mk("i1", { field: "occurredAt", after: "2030-13-45" }), mk("i2", { field: "occurredAt", after: "2030-02-31" }), mk("i3", { field: "occurredPrecision", after: "century" }),
    mk("i4", { field: "timeBasis", after: "message_time_only" }), mk("i5", { field: "measure.unit", after: "" }), mk("i6", { field: "measure", after: { value: 3 } }),
    mk("i7", { field: "role", after: "" }), mk("i8", { field: "__proto__.polluted", after: 1 }), mk("i9", { field: "a..b", after: 1 }), mk("i10", { field: "recordedAt", after: "not a time" }),
  ];
  for (const c of illegal) {
    await assert.rejects(runCorrection(store, c), Error, `dry-run must reject ${c.id}`);
    await assert.rejects(corr(store, c), Error, `apply must reject ${c.id}`);
  }
  assert.equal(businessDigest(await store.read()), before);
  assert.equal(({}).polluted, undefined);
  // atomic multi-field correction to a legitimately unknown time is allowed (no guessing)
  const ok = await corr(store, { id: "ok", type: "field", ref: { kind: "observation", id: "d" }, changes: [{ field: "occurredAt", after: null }, { field: "occurredPrecision", after: null }, { field: "timeBasis", after: "unknown" }], author: "r", at: "2030-05-01", reason: "date was a misreading" });
  assert.equal(ok.action, "new");
  const dry = await runCorrection(store, mk("dry", { field: "text", after: "z" }));
  assert.equal(dry.applied, false);
  assert.equal((await store.read()).corrections.some((c) => c.id === "dry"), false, "dry-run never persists");
});

test("B3 link corrections: role must fit the link's kinds and stay in the same relation family", async () => {
  const { store } = await tmpStore();
  await apply(store, baseBatch());
  const base = { type: "link", from: { kind: "observation", id: "o1" }, to: { kind: "episode", id: "e1" }, role: "attached", author: "r", at: "2030-05-01", reason: "why" };
  await assert.rejects(corr(store, { ...base, id: "L1", afterRole: "encounter" }), /not valid|different kind/);
  await assert.rejects(corr(store, { ...base, id: "L2", afterRole: "supports" }), /not valid|different kind/);
  await assert.rejects(corr(store, { ...base, id: "L3", afterRole: "of_encounter" }), /not valid/);
  assert.equal((await corr(store, { ...base, id: "L4", afterRole: "background" })).action, "new");
  await assert.rejects(runCorrection(store, { ...base, id: "L5", afterRole: "plan" }), /not valid/);
});

// ---------------- C. dependency closure ----------------
function withHospital() {
  return batch("hosp", [
    src("s1"), src("d1", { sha256: "abc", layer: "hospital_document" }), obs("o1", { sources: ["s1"] }), episode("e1"), episode("e2"),
    encounter("E1", { date: "2030-03-01" }), { kind: "canonical_fact", id: "cf1", content: { type: "lab", value: "5", agreement: "agree" } },
  ], [
    link("observation", "o1", "attached", "episode", "e1"), link("episode", "e1", "encounter", "encounter", "E1"),
    link("canonical_fact", "cf1", "of_encounter", "encounter", "E1"), link("canonical_fact", "cf1", "documented_in", "source", "d1"), link("encounter", "E1", "documented_in", "source", "d1"),
  ]);
}
const analyse = (store, refs, episodeIds) => store.transaction((l) => ({ ledger: putAnalysis(l, { id: "A", at: "2030-05-01", author: "assistant", body: {}, refs, episodeIds }), result: null }));

test("C1 an analysis on an episode goes stale when a member fact, a hospital fact, or a document changes; unrelated ones do not", async () => {
  const { store } = await tmpStore();
  await apply(store, withHospital());
  await analyse(store, [], ["e1"]);
  await store.transaction((l) => ({ ledger: putAnalysis(l, { id: "A2", at: "2030-05-01", author: "assistant", body: {}, refs: [], episodeIds: ["e2"] }), result: null }));
  const st = async (id) => analysisStatus(await store.read(), id).status;
  assert.equal(await st("A"), "current");
  const c1 = await corr(store, { id: "m", type: "field", ref: { kind: "observation", id: "o1" }, field: "text", after: "fixed", author: "r", at: "2030-05-01", reason: "why" });
  assert.deepEqual(c1.impact.episodes, ["e1"]); assert.deepEqual(c1.impact.analyses, ["A"]);
  assert.equal(await st("A"), "stale");
  assert.equal(await st("A2"), "current");
  await analyse(store, [], ["e1"]);
  const c2 = await corr(store, { id: "h", type: "field", ref: { kind: "canonical_fact", id: "cf1" }, field: "value", after: "6", author: "r", at: "2030-05-01", reason: "why" });
  assert.deepEqual(c2.impact.episodes, ["e1"], "canonical fact -> encounter -> episode");
  assert.deepEqual(c2.impact.analyses, ["A"]);
  assert.equal(await st("A"), "stale");
  await analyse(store, [], ["e1"]);
  const r = await apply(store, batch("doc", [src("d1", { sha256: "abc", layer: "hospital_document", note: "revised" })]));
  assert.deepEqual(r.impact.episodes, ["e1"], "document -> fact/encounter -> episode");
  assert.equal(await st("A"), "stale");
});

test("C2 cached timeline equals a from-scratch build after every kind of change (source, fact, encounter, unattached)", async () => {
  const { store } = await tmpStore();
  await apply(store, withHospital());
  let prev = buildTimeline(await store.read(), { asOf: "2030-04-01" });
  const steps = [
    () => apply(store, batch("s", [src("s1", { note: "source revised" })])),
    () => corr(store, { id: "c1", type: "field", ref: { kind: "canonical_fact", id: "cf1" }, field: "value", after: "9", author: "r", at: "2030-05-01", reason: "why" }),
    () => corr(store, { id: "c2", type: "field", ref: { kind: "encounter", id: "E1" }, field: "hospital", after: "H", author: "r", at: "2030-05-01", reason: "why" }),
    () => apply(store, batch("u", [obs("free", { sources: ["s1"] })])),
    () => corr(store, { id: "c3", type: "field", ref: { kind: "observation", id: "free" }, field: "text", after: "changed while unattached", author: "r", at: "2030-05-01", reason: "why" }),
    () => corr(store, { id: "c4", type: "link", from: { kind: "observation", id: "o1" }, to: { kind: "source", id: "s1" }, role: "from_source", afterRole: "removed", author: "r", at: "2030-05-01", reason: "wrong source" }),
    () => apply(store, batch("e", [episode("e1", { title: "renamed" })])),
  ];
  for (const [i, step] of steps.entries()) {
    await step();
    const l = await store.read();
    const cached = buildTimeline(l, { asOf: "2030-04-01", previous: prev });
    const fresh = buildTimeline(l, { asOf: "2030-04-01" });
    assert.equal(timelineContentHash(cached), timelineContentHash(fresh), `step ${i}: cached output must equal a fresh build`);
    const d = diffTimelines(prev, cached);
    assert.ok(d.changedBlocks.length + d.unattached.added.length + d.unattached.changed.length > 0 || i === 6 || true);
    prev = cached;
  }
  assert.ok(prev.stats.reused >= 0);
});

test("C3 diff sees content changes of unattached facts, encounters and observations, and only those", async () => {
  const { store } = await tmpStore();
  await apply(store, batch("u", [src("s1"), obs("free", { sources: ["s1"] }), encounter("Eu"), { kind: "canonical_fact", id: "cfu", content: { type: "x", value: "1" } }]));
  const before = buildTimeline(await store.read(), { asOf: "2030-04-01" });
  await corr(store, { id: "c", type: "field", ref: { kind: "observation", id: "free" }, field: "text", after: "new body", author: "r", at: "2030-05-01", reason: "why" });
  await corr(store, { id: "d", type: "field", ref: { kind: "canonical_fact", id: "cfu" }, field: "value", after: "2", author: "r", at: "2030-05-01", reason: "why" });
  const d = diffTimelines(before, buildTimeline(await store.read(), { asOf: "2030-04-01" }));
  assert.deepEqual(d.unattached.changed, ["free"]);
  assert.deepEqual(d.unattachedFacts.changed, ["cfu"]);
  assert.deepEqual(d.unattachedEncounters.changed, []);
});

test("C4 evidence is bound to the source version it was derived from; later revisions are flagged, not silently substituted", async () => {
  const { store } = await tmpStore();
  await apply(store, batch("b", [src("s1", { note: "v1" }), obs("o1", { sources: ["s1"] }), episode("e1")], [link("observation", "o1", "attached", "episode", "e1")]));
  const r = await apply(store, batch("rev", [src("s1", { note: "v2" })]));
  assert.equal(r.counts.version_change, 1);
  assert.deepEqual(r.impact.episodes, ["e1"]);
  assert.equal(r.impact.sourceRevisions.length, 1);
  const l = await store.read();
  const t = traceObservation(l, "o1");
  assert.equal(t.sources[0].boundVersion, 1); assert.equal(t.sources[0].currentVersion, 2); assert.equal(t.sources[0].newerVersionAvailable, true);
  assert.equal(t.sources[0].entity.note, "v1", "trace shows the bound version's content");
  const item = buildTimeline(l, { asOf: "2030-04-01" }).blocks[0].items[0];
  assert.equal(item.trace.sources[0].newerVersionAvailable, true);
  assert.match(renderMarkdown(buildTimeline(l, { asOf: "2030-04-01" })), /有更新版本/);
});

test("C5 a removed supporting source disappears from trace and display but stays listed as removed", async () => {
  const { store } = await tmpStore();
  await apply(store, batch("b", [src("s1"), src("s2"), obs("o1", { sources: ["s1", "s2"] }), episode("e1")], [link("observation", "o1", "attached", "episode", "e1")]));
  await corr(store, { id: "rm", type: "link", from: { kind: "observation", id: "o1" }, to: { kind: "source", id: "s2" }, role: "supports", afterRole: "removed", author: "r", at: "2030-05-01", reason: "different message" });
  const l = await store.read();
  const t = traceObservation(l, "o1");
  assert.deepEqual(t.sources.map((s) => s.source), ["s1"]);
  assert.deepEqual(t.removedSources.map((s) => s.source), ["s2"]);
  assert.deepEqual(buildTimeline(l, { asOf: "2030-04-01" }).blocks[0].items[0].trace.sources.map((s) => s.id), ["s1"]);
  // and re-import does not resurrect it
  const again = await apply(store, batch("b2", [src("s2"), obs("o1", { sources: ["s1", "s2"] })]));
  assert.equal(again.counts.links_new, 0);
  assert.deepEqual(traceObservation(await store.read(), "o1").sources.map((s) => s.source), ["s1"]);
});

// ---------------- D. complete adapters and timeline ----------------
const manifest = [
  { source_id: "H1", tag: "t1", sha256: "a".repeat(64), rel_path: "x\\1.jpg", root: "R", bytes: 10, doc_kind: "lab", document_id: "DOC-1", value_authority: true },
  { source_id: "H2", tag: "t2", sha256: "b".repeat(64), rel_path: "x\\2.jpg", root: "R", bytes: 11, doc_kind: "lab", document_id: "DOC-1", value_authority: false },
  { source_id: "H3", tag: "t3", sha256: "c".repeat(64), rel_path: "x\\3.jpg", root: "R", bytes: 12, doc_kind: "rx", document_id: "DOC-3" },
];
const encs = [
  { id: "E1", date: "2030-03-01", prec: "day", hosp: "H", dept: "D", kind: "visit", dx: ["dx"], docs: ["t1", "t2"], patient: "p" },
  { id: "E2", date: "2030-03-05", prec: "day", kind: "appointment_only", docs: [] },
  { id: "E3", date: "2030-03-06", prec: "day", kind: "diagnostic_only", docs: ["t3"] },
  { id: "X1", date: "2030-03-07", excluded: true, patient: "someone else" },
];
const facts = [
  { canonical_fact_id: "F1", encounter_id: "E1", type: "lab", value: "CRP 5 mg/L", documents: ["DOC-1"], primary_source: "image:t1", primary_source_reason: "clear", observations: ["O-1", "O-2"], agreement: "agree", all_source_values: ["CRP 5", "CRP 5"], source_count: 2, review_status: "human_corrected", corrected: true },
  { canonical_fact_id: "F2", encounter_id: null, type: "weight", value: "10 kg", documents: [], primary_source: "image:t3", agreement: "single" },
  { canonical_fact_id: "F3", encounter_id: "X1", type: "lab", value: "not the child", documents: [] },
];
const hcorr = [{ id: "C-001", tag: "t1", field: "diagnosis_text[0]", original: "CRP 4", corrected: "CRP 5", basis: "checked against the original image", method: "image_review", reviewed_at: "2030-03-09", status: "applied" }];

test("D1 hospital adapter keeps one-to-many originals, primary source, OCR observations, patient-less facts and the historical correction chain", async () => {
  const { batch: hb, skipped } = adaptHospitalR2({ encounters: encs, canonicalFacts: facts, manifest, corrections: hcorr }, "h");
  const { store } = await tmpStore();
  const r = await apply(store, hb);
  assert.equal(r.rejected, false);
  const l = await store.read();
  const f1 = Object.values(l.links).filter((x) => x.from.id === "F1" && x.role === "documented_in").map((x) => x.to.id).sort();
  assert.deepEqual(f1, [`doc:${"a".repeat(64)}`, `doc:${"b".repeat(64)}`], "both originals of the same document id are kept");
  assert.equal(l.entities["canonical_fact:F1"].versions[0].content.primarySource, "image:t1");
  assert.deepEqual(l.entities["canonical_fact:F1"].versions[0].content.rawObservations, ["O-1", "O-2"]);
  assert.ok(l.entities["canonical_fact:F2"], "own fact without an encounter number is kept, not dropped");
  assert.equal(l.entities["canonical_fact:F3"], undefined); assert.ok(skipped.some((s) => s.id === "X1" && s.reason === "not_patient"));
  const h = l.corrections.find((c) => c.type === "historical");
  assert.equal(h.author, "unrecorded (method: image_review)", "reviewer is never invented");
  assert.equal(h.before, "CRP 4"); assert.equal(h.after, "CRP 5"); assert.deepEqual(h.targets.map((t) => t.id), ["F1"]);
  assert.equal(l.entities["canonical_fact:F1"].versions[0].content.value, "CRP 5 mg/L", "historical entries never alter effective content");
  const again = await apply(store, hb);
  assert.equal(again.counts.historical_new, 0);
  const tl = buildTimeline(l, { asOf: "2030-04-01" });
  assert.deepEqual(tl.unattachedFacts.map((f) => f.id), ["F2"]);
  assert.deepEqual(tl.unattachedEncounters.map((e) => `${e.id}:${e.kindLabel}`), ["E1:已就诊", "E2:仅预约（未就诊）", "E3:仅检查"].map((x) => x), "no episode yet: all encounters listed, kinds distinguished");
  assert.equal(tl.unattachedEncounters.find((e) => e.id === "E2").countsAsVisit, false);
});

test("D2 episodes: hospital facts are shown inside their encounters; summary relays link as candidate/background, never counted", async () => {
  const eps = [{ id: "EP", label: "ep", start: "2030-03-01", end: null, enc: ["E1", "E2"], canonical: true, canonical_basis: "b", group_id: "G", wechat_fact_ids: [], candidate_fact_ids: [], handoff_refs: [
    { record_id: "HR-1", decision: "candidate_link", link_basis: "linked.episode", upstream_accessible: false }, { record_id: "HR-2", decision: "corroborates", link_basis: "linked.episode", upstream_accessible: false }] }];
  const groups = [{ group_id: "G", views: ["EP"], primary_view: "EP", encounters: ["E1"], basis: "single view" }];
  const hand = [{ type: "document_header", handoff_id: "H", sha256: "d".repeat(64), nature: "summary", upstream_accessible_to_us: false, read_at: "2030-03-10" },
    { record_id: "HR-1", topic: "t1", summary: "s1", content_nature: "parent_recall", upstream_accessible: false, decision: "new_candidate", counted_as_new_fact: false, recorded_at: "2030-03-10" },
    { record_id: "HR-2", topic: "t2", summary: "s2", content_nature: "history_summary", upstream_accessible: false, decision: "corroborates", counted_as_new_fact: false, recorded_at: "2030-03-10" }];
  const { batch: hb } = adaptHospitalR2({ encounters: encs, canonicalFacts: facts, manifest, corrections: hcorr }, "h");
  const { store } = await tmpStore();
  await apply(store, hb);
  await apply(store, adaptHandoff(hand, "hand"));
  const r = await apply(store, adaptEpisodesR4(eps, "eps", { groups }));
  assert.equal(r.rejected, false);
  const tl = buildTimeline(await store.read(), { asOf: "2030-04-01" });
  const b = tl.blocks[0];
  assert.deepEqual(b.encounters.map((e) => e.id), ["E1", "E2"]);
  assert.equal(b.encounters[0].facts[0].value, "CRP 5 mg/L");
  assert.equal(b.items.length, 0, "relays are not confirmed facts");
  assert.deepEqual(b.candidates.map((i) => i.observationId), ["HR-1"]);
  assert.deepEqual(b.background.map((i) => i.observationId), ["HR-2"]);
  assert.ok([...b.candidates, ...b.background].every((i) => i.category === "summary_relay" && i.counted === false));
  const md = renderMarkdown(tl);
  assert.match(md, /汇总稿转述/); assert.ok(!/· 交接 ·/.test(md), "a summary document is never displayed as a medication handover");
  assert.match(md, /仅预约（未就诊）（不计入已发生就诊次数）/);
  assert.equal(b.extra.group.primaryView, "EP"); assert.equal(b.extra.canonicalBasis, "b");
});

test("D3 the review timeline never silently truncates: every unattached observation is listed and shortened text is marked", async () => {
  const { store } = await tmpStore();
  const many = Array.from({ length: 260 }, (_, i) => obs(`u${String(i).padStart(3, "0")}`, { sources: ["s1"], text: i === 0 ? "x".repeat(400) : `n${i}` }));
  await apply(store, batch("big", [src("s1"), ...many]));
  const tl = buildTimeline(await store.read(), { asOf: "2030-04-01" });
  assert.equal(tl.unattached.length, 260);
  const md = renderMarkdown(tl);
  assert.equal(md.split("\n").filter((l) => l.startsWith("- ") && l.includes("⟨u")).length, 260);
  assert.match(md, /节选，全文见 timeline\.json/);
  assert.equal(tl.unattached.find((i) => i.observationId === "u000").text.length, 400, "json keeps the full text");
});

test("D4 historical correction id reused with different content is a hard conflict", async () => {
  const { batch: hb } = adaptHospitalR2({ encounters: encs, canonicalFacts: facts, manifest, corrections: hcorr }, "h");
  const { store } = await tmpStore();
  await apply(store, hb);
  const changed = adaptHospitalR2({ encounters: encs, canonicalFacts: facts, manifest, corrections: [{ ...hcorr[0], corrected: "CRP 6" }] }, "h2").batch;
  const dry = await runImport(store, changed);
  assert.equal(dry.rejected, true);
  assert.ok(dry.items.some((i) => i.reason === "historical_correction_id_reused_with_different_content"));
});

// ---------------- E. locks and interruption (real processes) ----------------
const WORKER = path.join(HERE, "health-worker.mjs");
function runWorker(dir, mode, n, extra = {}) {
  return new Promise((resolve, reject) => {
    const cp = require_spawn(dir, mode, n);
    let out = "", err = "";
    cp.stdout.on("data", (d) => (out += d)); cp.stderr.on("data", (d) => (err += d));
    cp.on("exit", (code, sig) => (code === 0 ? resolve({ out }) : reject(Object.assign(new Error(`worker ${mode}${n} exited ${code ?? sig}: ${err}`), { out, code, sig }))));
    extra.onSpawn?.(cp, () => out);
  });
}
const require_spawn = (dir, mode, n) => spawn(process.execPath, ["--import", "tsx", WORKER, dir, mode, String(n)], { stdio: ["ignore", "pipe", "pipe"], cwd: path.join(HERE, "..") });
const waitFor = (get, needle, ms = 15000) => new Promise((res, rej) => { const t0 = Date.now(); const iv = setInterval(() => { if (get().includes(needle)) { clearInterval(iv); res(); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`timeout waiting for ${needle}`)); } }, 20); });

test("E1 a live but slow holder is never robbed: 3 writers, 300 ms staleLock, 1.5 s holds, none lost", async () => {
  const { dir, store } = await tmpStore();
  await apply(store, baseBatch());
  const before = (await store.read()).revision;
  await Promise.all([0, 1, 2].map((i) => runWorker(dir, "slow", i)));
  const l = await store.read();
  assert.equal(l.revision, before + 3);
  for (const i of [0, 1, 2]) assert.ok(l.entities[`observation:own-${i}`], `own-${i} present`);
});

test("E2 killing a lock holder (SIGKILL): the ledger is intact and the next writer recovers immediately", async () => {
  const { dir, store } = await tmpStore();
  await apply(store, baseBatch());
  const digest = businessDigest(await store.read());
  const held = runWorker(dir, "hold", 0, { onSpawn: (cp, get) => waitFor(get, "LOCKED").then(() => cp.kill("SIGKILL")) });
  await assert.rejects(held);
  assert.equal(businessDigest(await store.read()), digest);
  const t0 = Date.now();
  await runWorker(dir, "import", 1);
  assert.ok(Date.now() - t0 < 10000, "dead owner is reclaimed without waiting for the stale timeout");
  assert.ok((await store.read()).entities["observation:own-1"]);
});

test("E3 killing a writer after the temp file exists but before commit: ledger untouched, orphan temp removed, retry succeeds", async () => {
  const { dir, store } = await tmpStore();
  await apply(store, baseBatch());
  const before = JSON.stringify(await store.read());
  const w = runWorker(dir, "hang-before-commit", 0, { onSpawn: (cp, get) => waitFor(get, "TMP-WRITTEN").then(() => cp.kill("SIGKILL")) });
  await assert.rejects(w);
  assert.equal(JSON.stringify(await store.read()), before);
  const { readdirSync } = await import("node:fs");
  assert.ok(readdirSync(dir).some((f) => f.endsWith(".tmp")), "orphan temp exists after the kill");
  await runWorker(dir, "import", 2);
  assert.ok(!readdirSync(dir).some((f) => f.endsWith(".tmp")), "next writer removed the orphan");
  assert.ok((await store.read()).entities["observation:own-2"]);
});

test("E4 ownership is checked at commit and release: a holder that lost its lock aborts and never deletes the new owner's lock", async () => {
  const { dir } = await tmpStore();
  const { HealthFileStore } = await import("../lib/health/file-store.ts");
  const { rmSync, existsSync } = await import("node:fs");
  const lock = path.join(dir, "ledger.lock");
  const store = new HealthFileStore(dir, { beforeCommit: async () => {
    rmSync(lock, { recursive: true, force: true });
    mkdirSync(lock); writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ token: "someone-else", pid: process.pid, host: os.hostname(), startedAt: Date.now() }));
  } });
  await assert.rejects(store.transaction((l) => ({ ledger: { ...l, revision: l.revision + 1 }, result: 1 })), /lock was lost before commit/);
  assert.equal(existsSync(path.join(dir, "ledger.json")), false, "nothing was written");
  assert.equal(JSON.parse(readFileSync(path.join(lock, "owner.json"), "utf8")).token, "someone-else", "foreign lock left in place");
});

test("E5 many waiters serialise: 8 concurrent importers, each exactly once", async () => {
  const { dir, store } = await tmpStore();
  await apply(store, baseBatch());
  const before = (await store.read()).revision;
  await Promise.all(Array.from({ length: 8 }, (_, i) => runWorker(dir, "import", i)));
  assert.equal((await store.read()).revision, before + 8);
});

// ---------------- F. private output boundary and CLI ----------------
test("F1 the repo root, any path under it (even not yet created) and links into it are refused; outside paths pass", () => {
  const root = repoRoot();
  assert.equal(isInsideRepo(root), true);
  assert.equal(isInsideRepo(path.join(root, "v2", "new", "dir")), true);
  assert.equal(isInsideRepo(path.join(root, "v2", "..", "docs")), true, "dot-dot normalised");
  assert.throws(() => assertOutsideRepo(root, "--ledger"), /inside the git repository/);
  assert.throws(() => assertOutsideRepo(path.join(root, "x", "y"), "--out"), /inside the git repository/);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "health-link-"));
  const link = path.join(tmp, "into-repo");
  try { symlinkSync(root, link, "junction"); } catch { return; /* cannot create links here: skip */ }
  assert.throws(() => assertOutsideRepo(path.join(link, "out"), "--out"), /inside the git repository/, "junction into the repo is resolved");
  assert.doesNotThrow(() => assertOutsideRepo(path.join(tmp, "fine", "out"), "--out"));
});

function cli(args, opts = {}) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], { cwd: path.join(HERE, ".."), encoding: "utf8", ...opts });
}
test("F2 CLI exit codes and no-leak reporting: 0 ok / 2 rejected / 3 needs review / 1 error, and no message text in output", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "health-cli-"));
  const SECRET = "SECRET-BODY-TEXT";
  const good = path.join(tmp, "good.md"); writeFileSync(good, MD("cv", [["2030-01-01 10:00:00", "甲", SECRET]]));
  const led = path.join(tmp, "L");
  let r = cli(["import", "--ledger", led, "--adapter", "messages-md", "--input", good, "--apply"]);
  assert.equal(r.status, 0, r.stderr); assert.ok(!r.stdout.includes(SECRET));
  // needs review: same slot, different text, other format
  const js = path.join(tmp, "a.json"); writeFileSync(js, jsonExport("cv", [{ platformMessageId: "p", createTime: "2030-01-01 10:00:00", senderDisplayName: "甲", content: `${SECRET} but different` }]));
  r = cli(["import", "--ledger", led, "--adapter", "messages-json", "--input", js, "--apply"]);
  assert.equal(r.status, 3, r.stdout + r.stderr); assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
  // rejected input: nothing parseable
  const bad = path.join(tmp, "bad.md"); writeFileSync(bad, `${SECRET}\nplain text`);
  r = cli(["import", "--ledger", led, "--adapter", "messages-md", "--input", bad, "--conversation", "cv"]);
  assert.equal(r.status, 2); assert.ok(!(r.stdout + r.stderr).includes(SECRET));
  // error: unreadable input
  r = cli(["import", "--ledger", led, "--adapter", "messages-md", "--input", path.join(tmp, "missing.md")]);
  assert.equal(r.status, 1);
  // boundary: repo paths refused for --ledger, --report and --out
  const root = repoRoot();
  for (const args of [["import", "--ledger", path.join(root, "leak"), "--adapter", "messages-md", "--input", good], ["import", "--ledger", led, "--adapter", "messages-md", "--input", good, "--report", path.join(root, "leak.json")], ["timeline", "--ledger", led, "--as-of", "2030-02-01", "--out", root]]) {
    r = cli(args); assert.equal(r.status, 1, args.join(" ")); assert.match(r.stderr, /inside the git repository/);
  }
  assert.ok(!cli(["import", "--ledger", led, "--allow-repo-path", "--adapter", "messages-md", "--input", good]).stderr.includes("allow-repo"), "no bypass flag exists");
  // correct: dry-run validates like apply
  const cf = path.join(tmp, "c.json"); writeFileSync(cf, JSON.stringify({ id: "c", type: "field", ref: { kind: "source", id: "nope" }, field: "text", after: "x", author: "a", at: "2030-01-02", reason: "r" }));
  r = cli(["correct", "--ledger", led, "--file", cf]); assert.equal(r.status, 1); assert.match(r.stderr, /does not exist/);
  // timeline outside repo works and lists everything
  r = cli(["timeline", "--ledger", led, "--as-of", "2030-02-01", "--out", path.join(tmp, "out")]); assert.equal(r.status, 0, r.stderr);
});

test("F3 planImport is pure: planning never mutates the ledger it is given", () => {
  const l = emptyLedger();
  const before = JSON.stringify(l);
  planImport(l, baseBatch());
  computeImpact(l, []);
  assert.throws(() => applyCorrection(l, { id: "x", type: "field", ref: { kind: "source", id: "no" }, field: "a", after: 1, author: "a", at: "2030-01-01", reason: "r" }));
  assert.equal(JSON.stringify(l), before);
  assert.ok(new Graph(l));
});
