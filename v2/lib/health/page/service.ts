// HEALTH-04 read side. Everything is read-only and optional:
//   HEALTH_HISTORY_LEDGER        directory holding the HEALTH-02 ledger.json (read, never written; no lock is taken)
//   HEALTH_HISTORY_ORIGINAL_ROOTS ';'-separated roots from which hospital originals may be served (a source's own `root` must be one of them)
//   HEALTH_HISTORY_ORIGINAL_ROOT_MAP ';'-separated "<root recorded in the ledger>=<absolute server directory>" pairs, for a deployment whose originals live somewhere else than where they were recorded
//                                (the ledger is not rewritten, so hashes and analysis snapshots stay valid; the server directory is served only after the same allow-list, containment and SHA-256 checks)
//   HEALTH_PAGE_INTERVALS        reviewed interval file (JSON)
//   HEALTH_PAGE_MATERIALS        reviewed follow-up materials file (JSON)
//   HEALTH_PAGE_DERIVED          private derived layer (JSON): records found in review but not in the accepted ledger (recovery statements)
//   HEALTH_PAGE_ANALYSES         per-episode medical-assistance analyses (JSON, append-only versions); only an adopted version whose dependency snapshot still matches counts as reviewed
//   HEALTH_PAGE_EVIDENCE         local medical-evidence register (JSON) next to the saved texts that were read; analyses are bound to its entries and are held for re-review when an entry or its text is missing/changed
//   HEALTH_PAGE_MATERIAL_ROOT    directory the materials' `source.file` paths are relative to; each source file's SHA-256 is re-checked on read
// Each path must be absolute and resolve (links followed) outside the repository; a bad one is reported by NAME only and that input
// is treated as not connected. The page model is cached in memory until one of the underlying files changes (mtime/size), so a
// parent's new note or a WeChat increment imported into the history ledger shows up on the next read.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { HealthFileStore } from "../file-store";
import { effectiveContent } from "../graph";
import { entityKey, type Ledger } from "../model";
import { isInside, resolveThroughLinks } from "../record/paths";
import type { HealthRecordService } from "../record/service";
import { wallOf } from "../record/service";
import { isAnalysisFile, type AnalysisFile } from "./analysis";
import { evidenceResolverFromFile } from "./evidence";
import { buildHealthPage, type DerivedFile, type HealthPage, type IntervalFile, type MaterialsFile } from "./model";

export interface PageSourcesConfig { historyLedgerDir: string | null; originalRoots: string[]; originalRootMap?: { from: string; to: string }[]; intervalsFile: string | null; materialsFile: string | null; derivedFile?: string | null; analysesFile?: string | null; evidenceFile?: string | null; materialRoot?: string | null; problems: string[] }

export function loadPageSourcesConfig(repo: string, env: Record<string, string | undefined> = process.env): PageSourcesConfig {
  const problems: string[] = [];
  const one = (name: string): string | null => {
    const v = env[name]?.trim();
    if (!v) return null;
    if (!path.isAbsolute(v)) { problems.push(`${name} must be an absolute path`); return null; }
    let real: string;
    try { real = resolveThroughLinks(v); } catch { problems.push(`${name} could not be resolved`); return null; }
    if (isInside(real, repo)) { problems.push(`${name} resolves inside the repository`); return null; }
    return real;
  };
  const roots: string[] = [];
  for (const r of (env.HEALTH_HISTORY_ORIGINAL_ROOTS ?? "").split(";").map((s) => s.trim()).filter(Boolean)) {
    if (!path.isAbsolute(r)) { problems.push("HEALTH_HISTORY_ORIGINAL_ROOTS entries must be absolute"); continue; }
    try { const real = resolveThroughLinks(r); if (isInside(real, repo)) problems.push("HEALTH_HISTORY_ORIGINAL_ROOTS entry resolves inside the repository"); else roots.push(real); } catch { problems.push("HEALTH_HISTORY_ORIGINAL_ROOTS entry could not be resolved"); }
  }
  const originalRootMap: { from: string; to: string }[] = [];
  for (const pair of (env.HEALTH_HISTORY_ORIGINAL_ROOT_MAP ?? "").split(";").map((x) => x.trim()).filter(Boolean)) {
    const i = pair.lastIndexOf("=");
    const from = i > 0 ? pair.slice(0, i).trim() : "", to = i > 0 ? pair.slice(i + 1).trim() : "";
    if (!from || !path.isAbsolute(to)) { problems.push("HEALTH_HISTORY_ORIGINAL_ROOT_MAP entries must be <recorded root>=<absolute directory>"); continue; }
    try { const real = resolveThroughLinks(to); if (isInside(real, repo)) problems.push("HEALTH_HISTORY_ORIGINAL_ROOT_MAP target resolves inside the repository"); else { originalRootMap.push({ from, to: real }); roots.push(real); } } catch { problems.push("HEALTH_HISTORY_ORIGINAL_ROOT_MAP target could not be resolved"); }
  }
  return { historyLedgerDir: one("HEALTH_HISTORY_LEDGER"), originalRoots: roots, originalRootMap, intervalsFile: one("HEALTH_PAGE_INTERVALS"), materialsFile: one("HEALTH_PAGE_MATERIALS"), derivedFile: one("HEALTH_PAGE_DERIVED"), analysesFile: one("HEALTH_PAGE_ANALYSES"), evidenceFile: one("HEALTH_PAGE_EVIDENCE"), materialRoot: one("HEALTH_PAGE_MATERIAL_ROOT"), problems };
}

async function sigOf(file: string | null) { if (!file) return "-"; try { const s = await stat(file); return `${s.mtimeMs}:${s.size}`; } catch { return "missing"; } }
async function readJson<T>(file: string | null, check: (v: unknown) => v is T): Promise<T | null> {
  if (!file) return null;
  try { const v = JSON.parse(await readFile(file, "utf8")); return check(v) ? v : null; } catch { return null; }
}
const isIntervals = (v: unknown): v is IntervalFile => !!v && typeof v === "object" && (v as IntervalFile).schema === 1 && Array.isArray((v as IntervalFile).intervals);
const isDerived = (v: unknown): v is DerivedFile => !!v && typeof v === "object" && (v as DerivedFile).schema === 1 && Array.isArray((v as DerivedFile).records);
const isMaterials = (v: unknown): v is MaterialsFile => !!v && typeof v === "object" && (v as MaterialsFile).schema === 1 && Array.isArray((v as MaterialsFile).items) && typeof (v as MaterialsFile).dataCutoff === "string";

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf" };
const norm = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

export class HealthPageService {
  private cache: { sig: string; day: string; page: HealthPage; history: Ledger | null } | null = null;
  constructor(private records: HealthRecordService, private cfg: PageSourcesConfig, private now: () => number = Date.now) {}

  private async historyLedger(): Promise<Ledger | null> {
    if (!this.cfg.historyLedgerDir) return null;
    try { return await new HealthFileStore(this.cfg.historyLedgerDir).read(); } catch { return null; }
  }

  async page(): Promise<HealthPage> {
    const nowWall = wallOf(this.now(), false);
    const rec = await this.records.ledgerSignature();
    const sig = [rec, await sigOf(this.cfg.historyLedgerDir && path.join(this.cfg.historyLedgerDir, "ledger.json")), await sigOf(this.cfg.intervalsFile), await sigOf(this.cfg.materialsFile), await sigOf(this.cfg.derivedFile ?? null), await sigOf(this.cfg.analysesFile ?? null), await this.evidenceSig(), await this.materialSourceSig()].join("|");
    if (this.cache && this.cache.sig === sig && this.cache.day === nowWall.slice(0, 10)) return this.cache.page;
    const [history, record, intervals, materials, derived, analyses] = await Promise.all([
      this.historyLedger(), this.records.readLedger(), readJson(this.cfg.intervalsFile, isIntervals), readJson(this.cfg.materialsFile, isMaterials), readJson(this.cfg.derivedFile ?? null, isDerived), readJson<AnalysisFile>(this.cfg.analysesFile ?? null, isAnalysisFile),
    ]);
    const hashes = await this.materialSourceHashes(materials);
    const page = buildHealthPage({ history, record, intervals, materials, derived, analyses, evidence: evidenceResolverFromFile(this.cfg.evidenceFile), now: nowWall, materialSourceHash: materials && this.cfg.materialRoot ? (file) => hashes.get(file) : undefined /* no root configured: the model reports "not verified" */ });
    this.cache = { sig, day: nowWall.slice(0, 10), page, history };
    return page;
  }

  /** Signature of the evidence register and of every saved text it names, so a changed/removed text shows up on the next read. */
  private async evidenceSig(): Promise<string> {
    const f = this.cfg.evidenceFile; if (!f) return "-";
    let names: string[] = [];
    try { const v = JSON.parse(await readFile(f, "utf8")); names = (v.sources ?? []).map((x: { localText?: string }) => x.localText).filter((x: unknown): x is string => typeof x === "string"); } catch { /* unreadable register: the resolver reports every id */ }
    const sigs = await Promise.all(names.map((n) => sigOf(path.resolve(path.dirname(f), n))));
    return `${await sigOf(f)}:${sigs.join(",")}`;
  }
  /** Source files of the follow-up materials, resolved under HEALTH_PAGE_MATERIAL_ROOT only (never outside it). */
  private materialPath(file: string): string | null {
    const root = this.cfg.materialRoot; if (!root) return null;
    const p = path.resolve(root, file);
    try { const real = resolveThroughLinks(p); return isInside(real, root) ? real : null; } catch { return null; }
  }
  private async materialSourceSig(): Promise<string> {
    const m = await readJson(this.cfg.materialsFile, isMaterials); if (!m || !this.cfg.materialRoot) return "-";
    const files = [...new Set(m.items.map((i) => i.source.file))].sort();
    return (await Promise.all(files.map(async (f) => { const p = this.materialPath(f); return p ? sigOf(p) : "none"; }))).join(",");
  }
  private async materialSourceHashes(m: MaterialsFile | null): Promise<Map<string, string | undefined>> {
    const out = new Map<string, string | undefined>();
    if (!m || !this.cfg.materialRoot) return out; // no root configured: nothing can be checked; the model then reports the items as "not verified" (never as current)
    for (const file of new Set(m.items.map((i) => i.source.file))) {
      const p = this.materialPath(file);
      try { out.set(file, p ? createHash("sha256").update(await readFile(p)).digest("hex") : undefined); } catch { out.set(file, undefined); }
    }
    return out;
  }

  /**
   * Hospital original by history source id. Served only when: the id is a hospital_document source in the history ledger, its recorded
   * root is one of the configured roots, the resolved file stays inside that root, and the bytes still hash to the recorded SHA-256.
   */
  async historyOriginal(id: string): Promise<{ data: Buffer; mime: string } | null> {
    if (!/^[\w:.-]{1,120}$/.test(id) || !this.cfg.originalRoots.length) return null;
    await this.page();
    const history = this.cache?.history;
    if (!history || !history.entities[entityKey("source", id)]) return null;
    const c = effectiveContent(history, { kind: "source", id })?.content;
    if (!c || c.layer !== "hospital_document" || typeof c.root !== "string" || typeof c.relPath !== "string" || typeof c.sha256 !== "string") return null;
    let rootReal: string;
    const recorded = c.root;
    const mapped = this.cfg.originalRootMap?.find((m) => norm(m.from) === norm(recorded))?.to ?? recorded;
    try { rootReal = resolveThroughLinks(mapped); } catch { return null; }
    if (!this.cfg.originalRoots.some((r) => norm(r) === norm(rootReal))) return null;
    // the ledger may carry Windows separators (recorded on another machine); containment is still checked on the resolved path
    const file = path.resolve(rootReal, c.relPath.replace(/\\/g, "/"));
    let real: string;
    try { real = resolveThroughLinks(file); } catch { return null; }
    if (!isInside(real, rootReal)) return null;
    const mime = MIME[path.extname(real).toLowerCase()];
    if (!mime) return null;
    let data: Buffer;
    try { data = await readFile(real); } catch { return null; }
    if (createHash("sha256").update(data).digest("hex") !== c.sha256) return null;
    return { data, mime };
  }
}
