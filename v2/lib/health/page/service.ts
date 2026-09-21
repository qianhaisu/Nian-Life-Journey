// HEALTH-04 read side. Everything is read-only and optional:
//   HEALTH_HISTORY_LEDGER        directory holding the HEALTH-02 ledger.json (read, never written; no lock is taken)
//   HEALTH_HISTORY_ORIGINAL_ROOTS ';'-separated roots from which hospital originals may be served (a source's own `root` must be one of them)
//   HEALTH_PAGE_INTERVALS        reviewed interval file (JSON)
//   HEALTH_PAGE_MATERIALS        reviewed follow-up materials file (JSON)
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
import { buildHealthPage, type HealthPage, type IntervalFile, type MaterialsFile } from "./model";

export interface PageSourcesConfig { historyLedgerDir: string | null; originalRoots: string[]; intervalsFile: string | null; materialsFile: string | null; problems: string[] }

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
  return { historyLedgerDir: one("HEALTH_HISTORY_LEDGER"), originalRoots: roots, intervalsFile: one("HEALTH_PAGE_INTERVALS"), materialsFile: one("HEALTH_PAGE_MATERIALS"), problems };
}

async function sigOf(file: string | null) { if (!file) return "-"; try { const s = await stat(file); return `${s.mtimeMs}:${s.size}`; } catch { return "missing"; } }
async function readJson<T>(file: string | null, check: (v: unknown) => v is T): Promise<T | null> {
  if (!file) return null;
  try { const v = JSON.parse(await readFile(file, "utf8")); return check(v) ? v : null; } catch { return null; }
}
const isIntervals = (v: unknown): v is IntervalFile => !!v && typeof v === "object" && (v as IntervalFile).schema === 1 && Array.isArray((v as IntervalFile).intervals);
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
    const sig = [rec, await sigOf(this.cfg.historyLedgerDir && path.join(this.cfg.historyLedgerDir, "ledger.json")), await sigOf(this.cfg.intervalsFile), await sigOf(this.cfg.materialsFile)].join("|");
    if (this.cache && this.cache.sig === sig && this.cache.day === nowWall.slice(0, 10)) return this.cache.page;
    const [history, record, intervals, materials] = await Promise.all([
      this.historyLedger(), this.records.readLedger(), readJson(this.cfg.intervalsFile, isIntervals), readJson(this.cfg.materialsFile, isMaterials),
    ]);
    const page = buildHealthPage({ history, record, intervals, materials, now: nowWall });
    this.cache = { sig, day: nowWall.slice(0, 10), page, history };
    return page;
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
    try { rootReal = resolveThroughLinks(c.root); } catch { return null; }
    if (!this.cfg.originalRoots.some((r) => norm(r) === norm(rootReal))) return null;
    const file = path.resolve(rootReal, c.relPath);
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
