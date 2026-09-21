// HEALTH-M01-A per-episode analysis versions (medical assistance text) and their review lifecycle.
// This is NOT a second ledger of facts: an analysis only records which facts it read (by the HEALTH-02 dependency hash of the
// episode and by the effective hash of the cited records) and is invalidated by the same dependency mechanism the page already uses.
//
//   draft -> pending_review -> adopted            (an adopted version is superseded by the next adopted one)
//        \-> rejected
//   expired is DERIVED, never stored: a draft / pending / adopted version whose snapshot no longer matches the ledger.
//
// Versions are append-only: a body is never edited, only new versions and status events are appended. Generating a draft or
// re-hashing never marks anything reviewed: adoption needs an explicit executor, time and review basis, and re-compares the
// dependency snapshot at that moment; if the facts changed meanwhile it is refused and the old version stays for tracing.
import { Graph, effectiveContent } from "../graph";
import { effectiveHash } from "../ledger";
import { entityKey, hashOf, type Ledger, type Ref } from "../model";

export type AnalysisStored = "draft" | "pending_review" | "adopted" | "rejected" | "superseded";
export type AnalysisShown = AnalysisStored | "expired";
export type LayerLevel = "doctor" | "parent" | "relay" | "inferred";
export const LAYER_LABEL: Record<LayerLevel, string> = { doctor: "医生诊断/病历", parent: "家长报告", relay: "汇总稿转述", inferred: "辅助推断" };

export interface AnalysisMeasure { id: string; group: "care" | "visit"; kind: "conditional" | "care" | "next_visit"; text: string; detail?: string; conditions: string[]; reassessWhen: string[] }
export interface AnalysisBody {
  /** last date of the records this reading rests on; nothing later is claimed */
  dataAsOf: string;
  /** short readable paragraphs: development, what medicine can support, what it means for care / visits */
  summary: string[];
  layers: { level: LayerLevel; text: string }[];
  uncertain: string[];
  impact: string;
  /** what is known as of the data date, so a historical state is never read as today's */
  currentStatus: string;
  measures: AnalysisMeasure[];
  /** facts the reading rests on (private analysis pack keeps the quotes; the page shows no evidence button) */
  factRefs: { ledger: "history" | "record"; ref: Ref; note?: string }[];
  /** ids in the private medical-evidence register (clause, population, version, date, link) */
  evidenceIds: string[];
}
export interface AnalysisSnapshot { episodeHash: string; refs: { ledger: "history" | "record"; ref: Ref; hash: string }[] }
export interface AnalysisEvent { status: AnalysisStored; by: string; at: string; basis?: string }
export interface AnalysisVersion { id: string; episodeId: string; seq: number; createdAt: string; author: string; bodyHash: string; body: AnalysisBody; snapshot: AnalysisSnapshot; events: AnalysisEvent[] }
export interface AnalysisFile { schema: 1; versions: AnalysisVersion[] }
export interface Ledgers { history: Ledger | null; record: Ledger | null }

export class AnalysisRefused extends Error {
  constructor(public code: "invalid_body" | "dependency_changed" | "bad_state" | "missing_basis" | "unknown_version" | "unknown_episode", public reasons: string[]) { super(`${code}: ${reasons.join("；")}`); }
}
export const emptyAnalyses = (): AnalysisFile => ({ schema: 1, versions: [] });
export const isAnalysisFile = (v: unknown): v is AnalysisFile => !!v && typeof v === "object" && (v as AnalysisFile).schema === 1 && Array.isArray((v as AnalysisFile).versions);

const DOSE = /\d+(\.\d+)?\s*(mg|毫克|ml|毫升|mL|滴|片|粒|袋|g\b|克|μg|ug)/;
const RECOVERED = /已康复|痊愈|已经好了|已好转完毕|完全好了/;
const day10 = /^\d{4}-\d{2}-\d{2}$/;
const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim());

/** Content rules a body must satisfy before it can even be a draft. `endKnown` is the ledger's declared end of the episode. */
export function validateBody(b: AnalysisBody, ctx: { endKnown: boolean }): string[] {
  const e: string[] = [];
  if (!b || typeof b !== "object") return ["body is not an object"];
  if (typeof b.dataAsOf !== "string" || !day10.test(b.dataAsOf)) e.push("dataAsOf 必须是 YYYY-MM-DD");
  if (!strs(b.summary) || !b.summary.length || b.summary.length > 6 || b.summary.some((s) => s.length > 500)) e.push("summary 需要 1–6 段、每段不超过 500 字");
  if (!Array.isArray(b.layers) || !b.layers.length || b.layers.some((l) => !(l?.level in LAYER_LABEL) || typeof l.text !== "string" || !l.text.trim())) e.push("layers 至少一条，且 level 必须是 doctor/parent/relay/inferred");
  if (!strs(b.uncertain)) e.push("uncertain 必须是字符串列表");
  if (typeof b.impact !== "string" || !b.impact.trim()) e.push("impact（对观察护理/就医安排的实际影响）不能为空");
  if (typeof b.currentStatus !== "string" || !b.currentStatus.trim()) e.push("currentStatus（截至资料日期的状态说明）不能为空");
  if (!strs(b.evidenceIds) || b.evidenceIds.length > 40) e.push("evidenceIds 必须是字符串列表");
  if (!Array.isArray(b.factRefs) || b.factRefs.some((r) => !r || (r.ledger !== "history" && r.ledger !== "record") || !r.ref?.kind || !r.ref?.id)) e.push("factRefs 格式不对");
  const ids = new Set<string>();
  for (const m of Array.isArray(b.measures) ? b.measures : []) {
    if (!m || typeof m.id !== "string" || !m.id || ids.has(m.id)) { e.push("measure id 缺失或重复"); continue; }
    ids.add(m.id);
    if (m.group !== "care" && m.group !== "visit") e.push(`${m.id}: group 必须是 care/visit`);
    if (!["conditional", "care", "next_visit"].includes(m.kind)) e.push(`${m.id}: kind 不合法`);
    if (typeof m.text !== "string" || !m.text.trim()) e.push(`${m.id}: text 为空`);
    if (!strs(m.conditions) || !m.conditions.length) e.push(`${m.id}: 需要写明适用前提/触发条件 conditions`);
    if (!strs(m.reassessWhen)) e.push(`${m.id}: reassessWhen 必须是列表`);
    if (Object.keys(m).some((k) => !["id", "group", "kind", "text", "detail", "conditions", "reassessWhen"].includes(k))) e.push(`${m.id}: 措施不能带日期/提醒等额外字段（建议不会自动成为预约或吃药提醒）`);
    if (DOSE.test(`${m.text} ${m.detail ?? ""}`)) e.push(`${m.id}: 措施里不写剂量，用药和剂量按医生与说明书`);
  }
  const all = [...(b.summary ?? []), ...(b.layers ?? []).map((l) => l.text), b.impact, b.currentStatus].join("\n");
  if (!ctx.endKnown && RECOVERED.test(all)) e.push("这一病程结束未知，不能写「已康复/痊愈」");
  return e;
}

function ledgerOf(inp: Ledgers, which: "history" | "record") { return which === "history" ? inp.history : inp.record; }

export function snapshotOf(inp: Ledgers, episodeId: string, refs: AnalysisBody["factRefs"], graph?: Graph): AnalysisSnapshot {
  if (!inp.history || !inp.history.entities[entityKey("episode", episodeId)]) throw new AnalysisRefused("unknown_episode", [`病程 ${episodeId} 不在底账里`]);
  const g = graph ?? new Graph(inp.history);
  const out: AnalysisSnapshot["refs"] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    const k = `${r.ledger}:${r.ref.kind}:${r.ref.id}`; if (seen.has(k)) continue; seen.add(k);
    const L = ledgerOf(inp, r.ledger);
    if (!L || !effectiveContent(L, r.ref)) throw new AnalysisRefused("invalid_body", [`引用的记录 ${r.ref.id} 不在 ${r.ledger} 底账里`]);
    out.push({ ledger: r.ledger, ref: r.ref, hash: effectiveHash(L, r.ref) });
  }
  return { episodeHash: g.closureHash({ kind: "episode", id: episodeId }), refs: out.sort((a, b) => `${a.ledger}${a.ref.id}`.localeCompare(`${b.ledger}${b.ref.id}`)) };
}

/** Why the snapshot no longer matches (empty = the facts are still exactly what the analysis read). */
export function snapshotProblems(inp: Ledgers, v: AnalysisVersion, graph?: Graph): string[] {
  if (!inp.history) return ["病程底账没有接通，无法核对这版分析依据的事实"];
  if (!inp.history.entities[entityKey("episode", v.episodeId)]) return ["这一病程已不在底账里"];
  const why: string[] = [];
  const g = graph ?? new Graph(inp.history);
  if (g.closureHash({ kind: "episode", id: v.episodeId }) !== v.snapshot.episodeHash) why.push("这一病程的成员、就诊、医院事实、来源或更正在这版分析生成之后有变化");
  for (const r of v.snapshot.refs) {
    const L = ledgerOf(inp, r.ledger);
    if (!L || !effectiveContent(L, r.ref)) why.push(`这版分析引用的记录 ${r.ref.id} 已不在底账里`);
    else if (effectiveHash(L, r.ref) !== r.hash) why.push(`这版分析引用的记录 ${r.ref.id} 被更正或修改过`);
  }
  return why;
}

export const storedStatus = (v: AnalysisVersion): AnalysisStored => v.events[v.events.length - 1].status;
export interface AnalysisState { id: string; episodeId: string; seq: number; recorded: AnalysisStored; shown: AnalysisShown; reasons: string[]; last: AnalysisEvent }
export function stateOf(inp: Ledgers, v: AnalysisVersion, graph?: Graph): AnalysisState {
  const recorded = storedStatus(v);
  const live = recorded === "draft" || recorded === "pending_review" || recorded === "adopted";
  const reasons = live ? snapshotProblems(inp, v, graph) : [];
  return { id: v.id, episodeId: v.episodeId, seq: v.seq, recorded, shown: reasons.length ? "expired" : recorded, reasons, last: v.events[v.events.length - 1] };
}
export const versionsOf = (f: AnalysisFile, episodeId: string) => f.versions.filter((v) => v.episodeId === episodeId).sort((a, b) => a.seq - b.seq);
/** The adopted version the page reads for an episode: the newest one recorded as adopted (it may be expired: shown with a re-review note). */
export const adoptedOf = (f: AnalysisFile, episodeId: string) => versionsOf(f, episodeId).filter((v) => storedStatus(v) === "adopted").pop() ?? null;

const clone = (f: AnalysisFile): AnalysisFile => structuredClone(f);
const need = (s: unknown, what: string) => { if (typeof s !== "string" || s.trim().length < 1) throw new AnalysisRefused("missing_basis", [`${what}不能为空`]); return s.trim(); };

/** Append a new draft. An identical body over an identical snapshot as the episode's newest live version is not added again (replay-safe). */
export function addDraft(file: AnalysisFile, inp: Ledgers, a: { episodeId: string; author: string; at: string; body: AnalysisBody }): { file: AnalysisFile; version: AnalysisVersion; created: boolean } {
  need(a.author, "作者"); need(a.at, "时间");
  const H = inp.history;
  if (!H || !H.entities[entityKey("episode", a.episodeId)]) throw new AnalysisRefused("unknown_episode", [`病程 ${a.episodeId} 不在底账里`]);
  const ep = effectiveContent(H, { kind: "episode", id: a.episodeId })!.content;
  const errs = validateBody(a.body, { endKnown: ep.declaredEnd === "ended" });
  if (errs.length) throw new AnalysisRefused("invalid_body", errs);
  const snapshot = snapshotOf(inp, a.episodeId, a.body.factRefs);
  const bodyHash = hashOf(a.body);
  const mine = versionsOf(file, a.episodeId);
  const same = mine.filter((v) => v.bodyHash === bodyHash && hashOf(v.snapshot) === hashOf(snapshot) && storedStatus(v) !== "rejected" && storedStatus(v) !== "superseded").pop();
  if (same) return { file, version: same, created: false };
  const seq = (mine[mine.length - 1]?.seq ?? 0) + 1;
  const v: AnalysisVersion = { id: `AV-${a.episodeId}-${seq}`, episodeId: a.episodeId, seq, createdAt: a.at, author: a.author, bodyHash, body: a.body, snapshot, events: [{ status: "draft", by: a.author, at: a.at }] };
  const next = clone(file); next.versions.push(v);
  return { file: next, version: v, created: true };
}

function pick(file: AnalysisFile, id: string) {
  const v = file.versions.find((x) => x.id === id);
  if (!v) throw new AnalysisRefused("unknown_version", [`没有这一版分析 ${id}`]);
  return v;
}

export function submit(file: AnalysisFile, inp: Ledgers, a: { id: string; by: string; at: string }): AnalysisFile {
  const v = pick(file, a.id);
  if (storedStatus(v) !== "draft") throw new AnalysisRefused("bad_state", [`只有草稿能提交审核，当前是 ${storedStatus(v)}`]);
  const why = snapshotProblems(inp, v);
  if (why.length) throw new AnalysisRefused("dependency_changed", why);
  const next = clone(file); pick(next, a.id).events.push({ status: "pending_review", by: need(a.by, "提交人"), at: need(a.at, "时间") });
  return next;
}

/** Adoption compares the dependency snapshot again at this very moment: facts that changed while it waited for review refuse it. */
export function adopt(file: AnalysisFile, inp: Ledgers, a: { id: string; by: string; at: string; basis: string }): AnalysisFile {
  const v = pick(file, a.id);
  if (storedStatus(v) !== "pending_review") throw new AnalysisRefused("bad_state", [`只有待审核的版本能采用，当前是 ${storedStatus(v)}`]);
  const by = need(a.by, "采用人"), at = need(a.at, "时间"), basis = need(a.basis, "审核依据");
  if (basis.length < 2) throw new AnalysisRefused("missing_basis", ["审核依据需要写清楚对照了什么"]);
  const why = snapshotProblems(inp, v);
  if (why.length) throw new AnalysisRefused("dependency_changed", why);
  const next = clone(file);
  for (const o of next.versions) if (o.episodeId === v.episodeId && o.id !== v.id && storedStatus(o) === "adopted") o.events.push({ status: "superseded", by, at, basis: `被 ${v.id} 取代` });
  pick(next, a.id).events.push({ status: "adopted", by, at, basis });
  return next;
}

export function reject(file: AnalysisFile, a: { id: string; by: string; at: string; basis: string }): AnalysisFile {
  const v = pick(file, a.id);
  const s = storedStatus(v);
  if (s !== "draft" && s !== "pending_review") throw new AnalysisRefused("bad_state", [`只有草稿或待审核的版本能退回，当前是 ${s}`]);
  const next = clone(file); pick(next, a.id).events.push({ status: "rejected", by: need(a.by, "退回人"), at: need(a.at, "时间"), basis: need(a.basis, "退回理由") });
  return next;
}
