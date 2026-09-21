// HEALTH-02 import CLI. Never reads app env / DATABASE_URL and never touches the application database:
// the only state is a ledger directory you name with --ledger (must be outside the git repo).
//   node --import tsx scripts/health-import/cli.mjs import   --ledger DIR --adapter wechat-r4|episodes-r4|hospital-r2|handoff|messages-jsonl|messages-md --input FILE [...] [--apply] [--report FILE]
//   node --import tsx scripts/health-import/cli.mjs correct  --ledger DIR --file correction.json [--apply]
//   node --import tsx scripts/health-import/cli.mjs timeline --ledger DIR --as-of YYYY-MM-DD --out DIR [--stale-days 14]
//   node --import tsx scripts/health-import/cli.mjs analyses --ledger DIR
// Default is dry-run; nothing is written without --apply.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HealthFileStore } from "../../lib/health/file-store.ts";
import { runCorrection, runImport } from "../../lib/health/importer.ts";
import { analysisStatus } from "../../lib/health/ledger.ts";
import { adaptEpisodesR4, adaptHandoff, adaptHospitalR2, adaptMessagesJsonl, adaptMessagesMarkdown, adaptWechatFactsR4 } from "../../lib/health/adapters.ts";
import { buildTimeline, renderHtml, renderMarkdown } from "../../lib/health/timeline.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const jsonl = (f) => readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));

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
export function assertLedgerOutsideRepo(dir, allowInRepo = false) {
  const rel = path.relative(REPO_ROOT, path.resolve(dir));
  if (!allowInRepo && rel && !rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error(`ledger dir ${dir} is inside the git repo; private health data must live outside it`);
}
export function buildBatch(args) {
  const inputs = [].concat(args.input ?? []);
  const id = args["batch-id"] ?? `${args.adapter}-${path.basename(String(inputs[0] ?? "input"))}`;
  switch (args.adapter) {
    case "wechat-r4": return { batch: adaptWechatFactsR4(jsonl(inputs[0]), id) };
    case "episodes-r4": return { batch: adaptEpisodesR4(jsonl(inputs[0]), id) };
    case "hospital-r2": { const [encounters, canonicalFacts, manifest] = inputs.map(jsonl); return adaptHospitalR2({ encounters, canonicalFacts, manifest }, id); }
    case "handoff": return { batch: adaptHandoff(jsonl(inputs[0]), id) };
    case "messages-jsonl": return { batch: adaptMessagesJsonl(readFileSync(inputs[0], "utf8"), id) };
    case "messages-md": return { batch: adaptMessagesMarkdown(readFileSync(inputs[0], "utf8"), String(args.conversation ?? ""), id) };
    default: throw new Error(`unknown --adapter ${args.adapter}`);
  }
}

export async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!args.ledger) throw new Error("--ledger DIR is required");
  assertLedgerOutsideRepo(args.ledger, !!args["allow-repo-path"]);
  const store = new HealthFileStore(String(args.ledger));
  if (cmd === "import") {
    const { batch, skipped } = buildBatch(args);
    let report;
    try { report = await runImport(store, batch, { apply: !!args.apply }); }
    catch (e) { if (e.report) { report = e.report; report.error = e.message; } else throw e; }
    const summary = { ...report, items: undefined, links: undefined, skippedByAdapter: skipped?.length ?? 0, rejections: report.items.filter((i) => i.action === "rejected").slice(0, 50), conflicts: report.items.filter((i) => i.action === "conflict" || i.action === "ambiguous").slice(0, 50) };
    if (args.report) { mkdirSync(path.dirname(String(args.report)), { recursive: true }); writeFileSync(String(args.report), JSON.stringify({ ...report, skipped }, null, 1)); }
    console.log(JSON.stringify(summary, null, 1));
    return report.rejected ? 2 : 0;
  }
  if (cmd === "correct") {
    const input = JSON.parse(readFileSync(String(args.file), "utf8"));
    if (!args.apply) { console.log(JSON.stringify({ mode: "dry-run", wouldApply: input }, null, 1)); return 0; }
    console.log(JSON.stringify(await runCorrection(store, input), null, 1));
    return 0;
  }
  if (cmd === "timeline") {
    const ledger = await store.read();
    const tl = buildTimeline(ledger, { asOf: String(args["as-of"]), staleDays: args["stale-days"] ? Number(args["stale-days"]) : undefined });
    const out = String(args.out);
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, "timeline.json"), JSON.stringify(tl, null, 1));
    writeFileSync(path.join(out, "timeline.md"), renderMarkdown(tl));
    writeFileSync(path.join(out, "timeline.html"), renderHtml(tl));
    console.log(JSON.stringify({ blocks: tl.blocks.length, unattached: tl.unattached.length, out }, null, 1));
    return 0;
  }
  if (cmd === "analyses") {
    const ledger = await store.read();
    console.log(JSON.stringify(Object.keys(ledger.analyses).map((id) => ({ id, ...analysisStatus(ledger, id) })), null, 1));
    return 0;
  }
  throw new Error(`unknown command ${cmd}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
