// HEALTH-02 import CLI. Never reads app env / DATABASE_URL and never touches the application database:
// the only state is a ledger directory you name with --ledger. Every path that receives real data
// (--ledger, --out, --report) must resolve outside the git repo (symlinks/junctions resolved, repo root refused).
//
//   import   --ledger DIR --adapter ADAPTER --input FILE [--input FILE ...] [--apply] [--report FILE]
//      ADAPTER (accepted-fact files):  wechat-r4 | episodes-r4 [--groups F --association F] | hospital-r2 (--input enc --input facts --input manifest [--corrections F]) | handoff
//      ADAPTER (raw messages -> sources only, NOT health events): messages-md | messages-json   [--conversation ID]
//   correct  --ledger DIR --file correction.json [--apply]      (dry-run runs the same validation as apply)
//   confirm-binding --ledger DIR --file confirm.json [--apply]  ({from:{kind,id}, role, source, toVersion, by, reason}: states which source version a PENDING fact version rests on, without re-sending the fact)
//   timeline --ledger DIR --as-of YYYY-MM-DD --out DIR [--stale-days 14]
//   analyses --ledger DIR
//   stamp-intervals --ledger HISTORY_DIR [--record-ledger DIR] [--derived derived.json] --file review.json --out stamped.json
//      (HEALTH-04) records the current effective hash of every support/counter record in a reviewed interval file; a later change to
//      any of them makes the page show that interval as "needs review" instead of keeping the old verdict.
//   page --ledger HISTORY_DIR [--record-ledger DIR] [--intervals F] [--materials F] [--derived F] [--analyses F] [--material-root DIR] --as-of YYYY-MM-DDTHH:mm --out DIR
//      (HEALTH-04) builds the same page model the /health page shows and writes page-model.json + impact.json. This is the one update
//      entry after a WeChat increment: `import --apply` into the history ledger, then `page` to see which intervals / follow-up items
//      became "needs review". The site itself recomputes on the next read (its cache is keyed on the files).
//   baseline --ledger HISTORY_DIR [--record-ledger DIR] --out FILE [--apply]     (HEALTH-M01-A) stores the current effective hashes as the point later changes are measured from
//   impact   --ledger HISTORY_DIR [--record-ledger DIR] --baseline FILE [--analyses FILE] [--as-of ISO] [--out DIR]
//      (HEALTH-M01-A) read-only preview of what changed since the baseline: affected episodes, new records that belong to no episode
//      (leads for a person, never auto-attached), excluded records with reasons, new raw sources awaiting fact extraction.
//   analysis list|draft|submit|adopt|reject --ledger HISTORY_DIR [--record-ledger DIR] --analyses FILE --evidence REGISTER.json   (HEALTH-M01-A; writes only with --apply)
//      --evidence: the local medical-evidence register (also for impact and page): an id that does not resolve, or an entry / saved text that changed, blocks adoption and holds a shown analysis for re-review
//      draft   --episode ID --body FILE --author NAME [--at ISO]     append a version bound to the episode's dependency snapshot
//      submit  --id AV-… --by NAME [--at ISO]                        draft -> pending review
//      adopt   --id AV-… --by NAME --basis TEXT [--at ISO]           re-compares the snapshot now; refused (exit 3) if the facts changed
//      reject  --id AV-… --by NAME --basis TEXT [--at ISO]
//      Generating or restamping never marks anything reviewed; adoption is an explicit act with executor, time and review basis.
// Default is dry-run; nothing is written without --apply.
// Exit codes: 0 ok | 1 error (I/O, usage, unreadable input) | 2 input rejected, nothing written | 3 needs human review (conflict/ambiguity listed).
// Error and report output carries ids, counts, reasons and line numbers — never message or document text.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HealthFileStore } from "../../lib/health/file-store.ts";
import { runCorrection, runImport } from "../../lib/health/importer.ts";
import { Graph, analysisStatus, effectiveContent, effectiveHash } from "../../lib/health/ledger.ts";
import { buildHealthPage } from "../../lib/health/page/model.ts";
import { AnalysisRefused, addDraft, adopt, emptyAnalyses, isAnalysisFile, reject, stateOf, submit } from "../../lib/health/page/analysis.ts";
import { evidenceResolverFromFile } from "../../lib/health/page/evidence.ts";
import { computeImpact, makeBaseline } from "../../lib/health/page/impact.ts";
import { hashOf } from "../../lib/health/model.ts";
import { Graph as DepGraph } from "../../lib/health/graph.ts";
import { adaptEpisodesR4, adaptHandoff, adaptHospitalR2, adaptWechatFactsR4 } from "../../lib/health/adapters.ts";
import { buildTimeline, renderHtml, renderMarkdown } from "../../lib/health/timeline.ts";
import { MessageInputError, adaptMessagesJson, adaptMessagesMarkdown } from "./message-adapters.mjs";
import { assertOutsideRepo } from "./paths.mjs";

const jsonl = (f, label) => {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { throw new Error(`cannot read ${label} input`); }
  return text.split(/\r?\n/).map((l, i) => [l, i + 1]).filter(([l]) => l.trim()).map(([l, n]) => { try { return JSON.parse(l); } catch { throw new Error(`${label} input is not valid JSONL at line ${n}`); } });
};

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[k] = true;
      else { out[k] = out[k] === undefined ? next : [].concat(out[k], next); i++; }
    } else out._.push(a);
  }
  return out;
}

export function buildBatch(args) {
  const inputs = [].concat(args.input ?? []).map(String);
  if (!inputs.length) throw new Error("--input is required");
  const id = String(args["batch-id"] ?? `${args.adapter}-${path.basename(inputs[0])}`);
  switch (args.adapter) {
    case "wechat-r4": return { batch: adaptWechatFactsR4(jsonl(inputs[0], "wechat-r4"), id) };
    case "episodes-r4": return { batch: adaptEpisodesR4(jsonl(inputs[0], "episodes-r4"), id, { groups: args.groups ? jsonl(String(args.groups), "groups") : undefined, association: args.association ? jsonl(String(args.association), "association") : undefined }) };
    case "hospital-r2": {
      if (inputs.length < 3) throw new Error("hospital-r2 needs --input encounters --input canonical-facts --input source-manifest");
      const [encounters, canonicalFacts, manifest] = inputs.map((f) => jsonl(f, "hospital-r2"));
      return adaptHospitalR2({ encounters, canonicalFacts, manifest, corrections: args.corrections ? jsonl(String(args.corrections), "corrections") : undefined }, id);
    }
    case "handoff": return { batch: adaptHandoff(jsonl(inputs[0], "handoff"), id) };
    case "messages-md": case "messages-json": {
      let text;
      try { text = readFileSync(inputs[0], "utf8"); } catch { throw new Error("cannot read messages input"); }
      const r = (args.adapter === "messages-md" ? adaptMessagesMarkdown : adaptMessagesJson)(text, { conversation: args.conversation ? String(args.conversation) : undefined, batchId: id });
      return { batch: r.batch, warnings: r.warnings };
    }
    default: throw new Error(`unknown --adapter ${args.adapter}`);
  }
}

function writeOut(file, text, label) {
  const target = assertOutsideRepo(file, label);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}

export async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!args.ledger) throw new Error("--ledger DIR is required");
  const ledgerDir = assertOutsideRepo(String(args.ledger), "--ledger");
  if (args.report) assertOutsideRepo(String(args.report), "--report");
  if (args.out) assertOutsideRepo(String(args.out), "--out");
  const store = new HealthFileStore(ledgerDir);
  if (cmd === "import") {
    let built;
    try { built = buildBatch(args); }
    catch (e) { if (e instanceof MessageInputError) { console.error(`input rejected: ${e.message}`); return 2; } throw e; }
    let report;
    try { report = await runImport(store, built.batch, { apply: !!args.apply }); }
    catch (e) { if (e.report) { report = e.report; report.error = e.message; } else throw e; }
    const sel = (f) => report.items.filter(f).slice(0, 50).map((i) => ({ ref: i.ref, action: i.action, reason: i.reason }));
    const summary = { ...report, items: undefined, links: undefined, warnings: built.warnings ?? [], skippedByAdapter: built.skipped?.length ?? 0, rejections: sel((i) => i.action === "rejected"), conflicts: sel((i) => i.action === "conflict" || i.action === "ambiguous"), linkRejections: report.links.filter((l) => l.action === "rejected").slice(0, 50) };
    if (args.report) writeOut(String(args.report), JSON.stringify({ ...report, skipped: built.skipped, warnings: built.warnings ?? [] }, null, 1), "--report");
    console.log(JSON.stringify(summary, null, 1));
    return report.rejected ? 2 : report.needsReview ? 3 : 0;
  }
  if (cmd === "correct") {
    let input;
    try { input = JSON.parse(readFileSync(String(args.file), "utf8")); } catch { throw new Error("cannot read correction file as JSON"); }
    const r = await runCorrection(store, input, { apply: !!args.apply });
    console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", ...r }, null, 1));
    return 0;
  }
  if (cmd === "confirm-binding") {
    let c;
    try { c = JSON.parse(readFileSync(String(args.file), "utf8")); } catch { throw new Error("cannot read confirmation file as JSON"); }
    const b = { batchId: `confirm-binding-${c?.from?.id}-${c?.source}-${c?.toVersion}`, items: [], links: [{ from: c.from, role: c.role ?? "from_source", to: { kind: "source", id: c.source }, toVersion: c.toVersion, confirmation: { by: c.by, reason: c.reason } }] };
    let report;
    try { report = await runImport(store, b, { apply: !!args.apply }); } catch (e) { if (e.report) { report = e.report; report.error = e.message; } else throw e; }
    console.log(JSON.stringify({ mode: report.mode, applied: report.applied, counts: report.counts, links: report.links, rejected: report.rejected, needsReview: report.needsReview, impact: { episodes: report.impact.episodes, analyses: report.impact.analyses } }, null, 1));
    return report.rejected ? 2 : report.needsReview ? 3 : 0;
  }
  if (cmd === "timeline") {
    const ledger = await store.read();
    const tl = buildTimeline(ledger, { asOf: String(args["as-of"]), staleDays: args["stale-days"] ? Number(args["stale-days"]) : undefined });
    const out = String(args.out);
    writeOut(path.join(out, "timeline.json"), JSON.stringify(tl, null, 1), "--out");
    writeOut(path.join(out, "timeline.md"), renderMarkdown(tl), "--out");
    writeOut(path.join(out, "timeline.html"), renderHtml(tl), "--out");
    console.log(JSON.stringify({ blocks: tl.blocks.length, unattachedObservations: tl.unattached.length, unattachedEncounters: tl.unattachedEncounters.length, unattachedFacts: tl.unattachedFacts.length, ambiguities: tl.ambiguities.length, out: path.resolve(out) }, null, 1));
    return 0;
  }
  if (cmd === "stamp-intervals" || cmd === "page") {
    const history = await store.read();
    const record = args["record-ledger"] ? await new HealthFileStore(assertOutsideRepo(String(args["record-ledger"]), "--record-ledger")).read() : null;
    const readJson = (f, label) => { try { return JSON.parse(readFileSync(assertOutsideRepo(String(f), label), "utf8")); } catch { throw new Error(`cannot read ${label} as JSON`); } };
    if (cmd === "stamp-intervals") {
      const file = readJson(args.file, "--file");
      const bad = [];
      for (const iv of [...(file.intervals ?? []), { id: "nodes", supports: file.nodes ?? [] }]) for (const r of [...(iv.supports ?? []), ...(iv.counter ?? [])]) {
        const L = r.ledger === "record" ? record : history;
        if (!L || !effectiveContent(L, r.ref)) { bad.push(`${iv.id}:${r.ref?.kind}:${r.ref?.id}`); continue; }
        r.hash = effectiveHash(L, r.ref);
      }
      const derived = args.derived ? readJson(args.derived, "--derived") : null;
      for (const src of file.enrolment?.sources ?? []) {
        if (src.ledger === "derived") { const d = (derived?.records ?? []).find((x) => x.id === src.ref?.id); if (!d) { bad.push(`enrolment:derived:${src.ref?.id}`); continue; } src.hash = hashOf(d); }
        else { const L = src.ledger === "record" ? record : history; if (!L || !effectiveContent(L, src.ref)) { bad.push(`enrolment:${src.ref?.id}`); continue; } src.hash = effectiveHash(L, src.ref); }
      }
      if (bad.length) { console.error(JSON.stringify({ unknownRefs: bad })); return 2; }
      file.episodeStamps = Object.fromEntries(Object.values(history.entities).filter((e) => e.kind === "episode").map((e) => [e.id, new DepGraph(history).closureHash({ kind: "episode", id: e.id })]));
      file.reviewedAt = new Date().toISOString(); // records imported after this instant and falling inside a span re-open it for review
      writeOut(String(args.out), JSON.stringify(file, null, 1), "--out");
      console.log(JSON.stringify({ intervals: (file.intervals ?? []).length, refs: (file.intervals ?? []).reduce((n, iv) => n + (iv.supports?.length ?? 0) + (iv.counter?.length ?? 0), 0) }));
      return 0;
    }
    const asOf = String(args["as-of"] ?? "");
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(asOf)) throw new Error("--as-of must be YYYY-MM-DDTHH:mm (Shanghai wall clock)");
    const materials = args.materials ? readJson(args.materials, "--materials") : null;
    const rootDir = args["material-root"] ? assertOutsideRepo(String(args["material-root"]), "--material-root") : null;
    const materialSourceHash = materials && rootDir ? (file) => { try { return createHash("sha256").update(readFileSync(path.resolve(rootDir, file))).digest("hex"); } catch { return undefined; } } : undefined;
    const page = buildHealthPage({ history, record, intervals: args.intervals ? readJson(args.intervals, "--intervals") : null, materials, derived: args.derived ? readJson(args.derived, "--derived") : null, analyses: args.analyses ? readJson(args.analyses, "--analyses") : null, evidence: evidenceResolverFromFile(args.evidence ? assertOutsideRepo(String(args.evidence), "--evidence") : null), materialSourceHash, now: asOf });
    const impact = { asOf: page.asOf, nodes: page.nodes.length, bands: page.bands.map((b) => ({ id: b.id, kind: b.kind, start: b.start, end: b.end, status: b.status, reasons: b.statusReasons })), pendingIntervals: page.pendingIntervals, followUp: { status: page.followUp.status, reason: page.followUp.staleReason }, reminders: page.reminders.length };
    writeOut(path.join(String(args.out), "page-model.json"), JSON.stringify(page, null, 1), "--out");
    writeOut(path.join(String(args.out), "impact.json"), JSON.stringify(impact, null, 1), "--out");
    console.log(JSON.stringify({ nodes: impact.nodes, bands: impact.bands.length, pendingIntervals: impact.pendingIntervals, followUp: impact.followUp.status }, null, 1));
    return 0;
  }
  if (cmd === "baseline" || cmd === "impact" || cmd === "analysis") {
    const history = await store.read();
    const record = args["record-ledger"] ? await new HealthFileStore(assertOutsideRepo(String(args["record-ledger"]), "--record-ledger")).read() : null;
    const readJ = (f, label) => { try { return JSON.parse(readFileSync(assertOutsideRepo(String(f), label), "utf8")); } catch { throw new Error(`cannot read ${label} as JSON`); } };
    const nowIso = args.at ? String(args.at) : new Date().toISOString();
    // medical evidence is resolved from the local register (--evidence FILE); without it nothing can be drafted, submitted or adopted and shown analyses read as unverifiable
    const evidence = evidenceResolverFromFile(args.evidence ? assertOutsideRepo(String(args.evidence), "--evidence") : null);
    const sides = { history, record };
    if (cmd === "baseline") {
      const b = makeBaseline(sides, nowIso);
      if (args.apply) writeOut(String(args.out), JSON.stringify(b, null, 1), "--out");
      console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", history: Object.keys(b.history).length, record: Object.keys(b.record).length, episodes: Object.keys(b.episodes).length }));
      return 0;
    }
    if (cmd === "impact") {
      const base = args.baseline ? readJ(args.baseline, "--baseline") : null;
      const analyses = args.analyses ? readJ(args.analyses, "--analyses") : null;
      const imp = computeImpact(sides, analyses && isAnalysisFile(analyses) ? analyses : null, base, String(args["as-of"] ?? nowIso.slice(0, 16)), evidence);
      if (args.out) writeOut(path.join(String(args.out), `impact-${imp.digest}.json`), JSON.stringify(imp, null, 1), "--out");
      console.log(JSON.stringify({ digest: imp.digest, changed: imp.changed.length, affectedEpisodes: imp.affectedEpisodes.map((a) => ({ id: a.episodeId, reasons: a.reasons })), attachedNew: imp.attachedNew.length, leads: imp.leads.length, excluded: Object.fromEntries(Object.entries(imp.excluded).map(([k, v]) => [k, v.length])), newSources: imp.newSources }, null, 1));
      return imp.affectedEpisodes.length || imp.leads.length ? 3 : 0;
    }
    const sub = args._[1];
    const file = assertOutsideRepo(String(args.analyses ?? ""), "--analyses");
    let cur = emptyAnalyses();
    try { cur = readJ(file, "--analyses"); } catch (e) { if (existsSync(file)) throw e; }
    if (!isAnalysisFile(cur)) throw new Error("--analyses is not an analyses file");
    if (sub === "list") {
      console.log(JSON.stringify(cur.versions.map((v) => { const st = stateOf(sides, v, evidence); return { id: v.id, episode: v.episodeId, seq: v.seq, shown: st.shown, recorded: st.recorded, reasons: st.reasons, by: st.last.by, at: st.last.at }; }), null, 1));
      return 0;
    }
    try {
      let next, note = {};
      if (sub === "draft") {
        const body = readJ(args.body, "--body");
        const r = addDraft(cur, sides, { episodeId: String(args.episode), author: String(args.author ?? ""), at: nowIso, body, evidence });
        next = r.file; note = { id: r.version.id, created: r.created };
      } else if (sub === "submit") { next = submit(cur, sides, { id: String(args.id), by: String(args.by ?? ""), at: nowIso, evidence }); note = { id: args.id }; }
      else if (sub === "adopt") { next = adopt(cur, sides, { id: String(args.id), by: String(args.by ?? ""), at: nowIso, basis: String(args.basis ?? ""), evidence }); note = { id: args.id }; }
      else if (sub === "reject") { next = reject(cur, { id: String(args.id), by: String(args.by ?? ""), at: nowIso, basis: String(args.basis ?? "") }); note = { id: args.id }; }
      else throw new Error(`unknown analysis subcommand ${sub}`);
      if (args.apply) writeOut(file, JSON.stringify(next, null, 1), "--analyses");
      console.log(JSON.stringify({ mode: args.apply ? "apply" : "dry-run", sub, ...note, versions: next.versions.length }));
      return 0;
    } catch (e) {
      if (!(e instanceof AnalysisRefused)) throw e;
      console.error(JSON.stringify({ refused: e.code, reasons: e.reasons }));
      return e.code === "dependency_changed" || e.code === "evidence_invalid" ? 3 : 2;
    }
  }
  if (cmd === "analyses") {
    const ledger = await store.read();
    const g = new Graph(ledger);
    console.log(JSON.stringify(Object.keys(ledger.analyses).map((id) => ({ id, ...analysisStatus(ledger, id, g) })), null, 1));
    return 0;
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`error: ${e.message}`); process.exit(1); });
}
