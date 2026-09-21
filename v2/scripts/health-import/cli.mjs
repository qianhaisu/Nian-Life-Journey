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
// Default is dry-run; nothing is written without --apply.
// Exit codes: 0 ok | 1 error (I/O, usage, unreadable input) | 2 input rejected, nothing written | 3 needs human review (conflict/ambiguity listed).
// Error and report output carries ids, counts, reasons and line numbers — never message or document text.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HealthFileStore } from "../../lib/health/file-store.ts";
import { runCorrection, runImport } from "../../lib/health/importer.ts";
import { Graph, analysisStatus } from "../../lib/health/ledger.ts";
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
