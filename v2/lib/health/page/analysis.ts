// HEALTH-M01-A per-episode analysis versions (medical assistance text) and their review lifecycle.
// This is NOT a second ledger of facts: an analysis only records which facts it read (by the HEALTH-02 dependency hash of the
// episode and by the effective hash of the cited records) and is invalidated by the same dependency mechanism the page already uses.
//
//   draft -> pending_review -> adopted            (an adopted version is superseded by the next adopted one)
//        \-> rejected
//   expired is DERIVED, never stored: a draft / pending / adopted version whose facts or medical evidence no longer match.
//   invalid is DERIVED too: the stored body / snapshot no longer hashes to what was reviewed, or the structure is broken.
//
// Versions are append-only: a body is never edited, only new versions and status events are appended. Generating a draft or
// re-hashing never marks anything reviewed: adoption needs an explicit executor, time and review basis, and re-checks at that
// moment (1) the content seal: body and snapshot still hash to what was drafted, structure still valid, (2) every cited medical
// evidence id still resolves to the registered entry it was bound to (and its saved text still hashes to the registered digest),
// (3) the fact dependency snapshot. Any failure refuses adoption and the old version stays for tracing.
import { Graph, effectiveContent } from "../graph";
import { effectiveHash } from "../ledger";
import { entityKey, hashOf, type Content, type Ledger, type Ref } from "../model";

export type AnalysisStored = "draft" | "pending_review" | "adopted" | "rejected" | "superseded";
export type AnalysisShown = AnalysisStored | "expired" | "invalid";
export type LayerLevel = "doctor" | "parent" | "daycare" | "relay" | "inferred";
export const LAYER_LABEL: Record<LayerLevel, string> = { doctor: "医生诊断/病历", parent: "家长报告", daycare: "托班记录", relay: "汇总稿转述", inferred: "辅助推断" };

/** Resolves a medical evidence id to the digest of its registered entry (which itself carries the digest of the saved text that was read),
 *  or to a problem: not registered, withdrawn, revised, saved text missing or changed. Built from the local evidence register. */
export type EvidenceResolver = (id: string) => { hash: string } | { problem: string };

export interface AnalysisMeasure { id: string; group: "care" | "visit"; kind: "conditional" | "care" | "next_visit"; text: string; detail?: string; conditions: string[]; reassessWhen: string[]; evidenceIds: string[] }
export interface AnalysisBody {
  /** latest date of any record this reading used (across all cited records, other episodes included) */
  dataAsOf: string;
  /** last record of THIS episode; may be earlier than dataAsOf */
  episodeLastRecord: string;
  /** short readable paragraphs: development, what medicine can support, what it means for care / visits */
  summary: string[];
  layers: { level: LayerLevel; text: string }[];
  uncertain: string[];
  impact: string;
  /** what is known as of the data date, so a historical state is never read as today's */
  currentStatus: string;
  measures: AnalysisMeasure[];
  /** every record the reading actually rests on (own episode, other episodes, relays, unattached records); each is sealed into the snapshot */
  factRefs: { ledger: "history" | "record"; ref: Ref; note?: string }[];
  /** ids in the local medical-evidence register; every id must resolve, every measure's ids must be among them */
  evidenceIds: string[];
}
export interface AnalysisSnapshot { episodeHash: string; refs: { ledger: "history" | "record"; ref: Ref; hash: string }[]; evidence: { id: string; hash: string }[] }
export interface AnalysisEvent { status: AnalysisStored; by: string; at: string; basis?: string }
export interface AnalysisVersion { id: string; episodeId: string; seq: number; createdAt: string; author: string; bodyHash: string; snapshotHash: string; body: AnalysisBody; snapshot: AnalysisSnapshot; events: AnalysisEvent[] }
export interface AnalysisFile { schema: 1; versions: AnalysisVersion[] }
export interface Ledgers { history: Ledger | null; record: Ledger | null }

export type RefusalCode = "invalid_body" | "dependency_changed" | "evidence_invalid" | "integrity_failed" | "bad_state" | "missing_basis" | "unknown_version" | "unknown_episode";
export class AnalysisRefused extends Error {
  constructor(public code: RefusalCode, public reasons: string[]) { super(`${code}: ${reasons.join("；")}`); }
}
export const emptyAnalyses = (): AnalysisFile => ({ schema: 1, versions: [] });
export const isAnalysisFile = (v: unknown): v is AnalysisFile => !!v && typeof v === "object" && (v as AnalysisFile).schema === 1 && Array.isArray((v as AnalysisFile).versions);

const DOSE = /\d+(\.\d+)?\s*(mg|毫克|ml|毫升|mL|滴|片|粒|袋|g\b|克|μg|ug)/;
const RECOVERED = /已康复|痊愈|已经好了|已好转完毕|完全好了/;
const day10 = /^\d{4}-\d{2}-\d{2}$/;
const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim());

/** Content rules a body must satisfy before it can even be a draft (and that adoption / reading re-check). `endKnown` is the ledger's declared end of the episode. */
export function validateBody(b: AnalysisBody, ctx: { endKnown: boolean }): string[] {
  const e: string[] = [];
  if (!b || typeof b !== "object") return ["body is not an object"];
  if (typeof b.dataAsOf !== "string" || !day10.test(b.dataAsOf)) e.push("dataAsOf 必须是 YYYY-MM-DD");
  if (typeof b.episodeLastRecord !== "string" || !day10.test(b.episodeLastRecord)) e.push("episodeLastRecord（这一病程的末次记录日期）必须是 YYYY-MM-DD");
  else if (day10.test(String(b.dataAsOf)) && b.episodeLastRecord > b.dataAsOf) e.push("病程末次记录日期不能晚于分析读到资料的截止日期");
  if (!strs(b.summary) || !b.summary.length || b.summary.length > 6 || b.summary.some((s) => s.length > 600)) e.push("summary 需要 1–6 段、每段不超过 600 字");
  if (!Array.isArray(b.layers) || !b.layers.length || b.layers.some((l) => !(l?.level in LAYER_LABEL) || typeof l.text !== "string" || !l.text.trim())) e.push("layers 至少一条，且 level 必须是 doctor/parent/daycare/relay/inferred");
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
    if (!strs(m.evidenceIds) || !m.evidenceIds.length) e.push(`${m.id}: 措施需要写明依据的医学证据 evidenceIds`);
    else if (strs(b.evidenceIds) && m.evidenceIds.some((x) => !b.evidenceIds.includes(x))) e.push(`${m.id}: 措施引用的证据必须在本版 evidenceIds 里`);
    if (Object.keys(m).some((k) => !["id", "group", "kind", "text", "detail", "conditions", "reassessWhen", "evidenceIds"].includes(k))) e.push(`${m.id}: 措施不能带日期/提醒等额外字段（建议不会自动成为预约或吃药提醒）`);
    if (DOSE.test(`${m.text} ${m.detail ?? ""}`)) e.push(`${m.id}: 措施里不写剂量，用药和剂量按医生与说明书`);
  }
  const all = [...(b.summary ?? []), ...(b.layers ?? []).map((l) => l.text), b.impact, b.currentStatus].join("\n");
  if (!ctx.endKnown && RECOVERED.test(all)) e.push("这一病程结束未知，不能写「已康复/痊愈」");
  return e;
}

function ledgerOf(inp: Ledgers, which: "history" | "record") { return which === "history" ? inp.history : inp.record; }
const dayOf = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

/** Hash of one cited record. An episode is cited with everything it rests on (closure), the rest by effective content. */
function refHash(L: Ledger, ref: Ref, g: Graph | null): string {
  return ref.kind === "episode" && g ? g.closureHash(ref) : effectiveHash(L, ref);
}
/** Date a cited record speaks about (appointments still ahead do not count as data read). */
function refDate(L: Ledger, ref: Ref): string | null {
  const c = effectiveContent(L, ref)?.content as Content | undefined;
  if (!c) return null;
  if (ref.kind === "encounter") return c.kind === "appointment_only" ? null : dayOf(c.date);
  if (ref.kind === "observation") return dayOf(c.occurredAt) ?? dayOf(c.recordedAt);
  return null;
}

export function snapshotOf(inp: Ledgers, episodeId: string, body: Pick<AnalysisBody, "factRefs" | "evidenceIds">, evidence: EvidenceResolver | undefined, graph?: Graph): AnalysisSnapshot {
  if (!inp.history || !inp.history.entities[entityKey("episode", episodeId)]) throw new AnalysisRefused("unknown_episode", [`病程 ${episodeId} 不在底账里`]);
  const g = graph ?? new Graph(inp.history);
  const refs: AnalysisSnapshot["refs"] = [];
  const seen = new Set<string>();
  for (const r of body.factRefs) {
    const k = `${r.ledger}:${r.ref.kind}:${r.ref.id}`; if (seen.has(k)) continue; seen.add(k);
    const L = ledgerOf(inp, r.ledger);
    if (!L || !effectiveContent(L, r.ref)) throw new AnalysisRefused("invalid_body", [`引用的记录 ${r.ref.id} 不在 ${r.ledger} 底账里`]);
    refs.push({ ledger: r.ledger, ref: r.ref, hash: refHash(L, r.ref, r.ledger === "history" ? g : null) });
  }
  const ev: AnalysisSnapshot["evidence"] = [];
  const problems: string[] = [];
  for (const id of [...new Set(body.evidenceIds)].sort()) {
    const r = evidence ? evidence(id) : { problem: "医学证据登记没有接通" };
    if ("problem" in r) problems.push(`证据 ${id}：${r.problem}`); else ev.push({ id, hash: r.hash });
  }
  if (problems.length) throw new AnalysisRefused("evidence_invalid", problems);
  return { episodeHash: g.closureHash({ kind: "episode", id: episodeId }), refs: refs.sort((a, b) => `${a.ledger}${a.ref.id}`.localeCompare(`${b.ledger}${b.ref.id}`)), evidence: ev };
}

export interface VersionProblems { integrity: string[]; evidence: string[]; dependency: string[] }
/** Everything that makes a stored version not what was reviewed: content seal, structure, medical evidence, fact dependencies. */
export function versionProblems(inp: Ledgers, v: AnalysisVersion, evidence: EvidenceResolver | undefined, graph?: Graph): VersionProblems {
  const p: VersionProblems = { integrity: [], evidence: [], dependency: [] };
  if (!v || typeof v !== "object" || !v.body || !v.snapshot || !Array.isArray(v.events) || !v.events.length) { p.integrity.push("这一版分析的结构不完整"); return p; }
  if (hashOf(v.body) !== v.bodyHash) p.integrity.push("正文与提交审核时的内容哈希不一致（正文在审核之后被改过）");
  if (typeof v.snapshotHash !== "string" || hashOf(v.snapshot) !== v.snapshotHash) p.integrity.push("依赖快照缺失或与提交审核时不一致");
  const last = v.events[v.events.length - 1];
  if (last.status === "adopted" && !(last.by?.trim() && last.at?.trim() && last.basis?.trim())) p.integrity.push("采用记录缺少采用人、时间或审核依据");
  const ended = inp.history ? effectiveContent(inp.history, { kind: "episode", id: v.episodeId })?.content.declaredEnd === "ended" : false;
  for (const m of validateBody(v.body, { endKnown: ended })) p.integrity.push(`结构/内容规则不满足：${m}`);
  const snapIds = new Set((v.snapshot.evidence ?? []).map((e) => e.id));
  if (!Array.isArray(v.snapshot.evidence)) p.integrity.push("没有绑定医学证据（旧版本，无法核验）");
  else if ((v.body.evidenceIds ?? []).some((id) => !snapIds.has(id))) p.integrity.push("正文引用的医学证据没有进入绑定快照");
  if (p.integrity.length) return p;
  if (!inp.history) { p.dependency.push("病程底账没有接通，无法核对这版分析依据的事实"); }
  else if (!inp.history.entities[entityKey("episode", v.episodeId)]) p.dependency.push("这一病程已不在底账里");
  else {
    const g = graph ?? new Graph(inp.history);
    if (g.closureHash({ kind: "episode", id: v.episodeId }) !== v.snapshot.episodeHash) p.dependency.push("这一病程的成员、就诊、医院事实、来源或更正在这版分析生成之后有变化");
    for (const r of v.snapshot.refs) {
      const L = ledgerOf(inp, r.ledger);
      if (!L || !effectiveContent(L, r.ref)) p.dependency.push(`这版分析引用的记录 ${r.ref.id} 已不在底账里`);
      else if (refHash(L, r.ref, r.ledger === "history" ? g : null) !== r.hash) p.dependency.push(`这版分析引用的${r.ref.kind === "episode" ? "病程" : "记录"} ${r.ref.id} 被更正或修改过`);
    }
  }
  for (const b of v.snapshot.evidence) {
    const r = evidence ? evidence(b.id) : { problem: "医学证据登记没有接通，无法核验" };
    if ("problem" in r) p.evidence.push(`医学证据 ${b.id}：${r.problem}`);
    else if (r.hash !== b.hash) p.evidence.push(`医学证据 ${b.id} 的登记内容或已读正文与审核时不同（已被修订）`);
  }
  return p;
}
/** Human-readable reasons a shown/adopted version needs re-review (dependency + evidence); integrity is reported separately. */
export const reviewReasons = (p: VersionProblems) => [...p.dependency, ...p.evidence];

export const storedStatus = (v: AnalysisVersion): AnalysisStored => v.events[v.events.length - 1].status;
export interface AnalysisState { id: string; episodeId: string; seq: number; recorded: AnalysisStored; shown: AnalysisShown; reasons: string[]; last: AnalysisEvent }
export function stateOf(inp: Ledgers, v: AnalysisVersion, evidence: EvidenceResolver | undefined, graph?: Graph): AnalysisState {
  const recorded = storedStatus(v);
  const live = recorded === "draft" || recorded === "pending_review" || recorded === "adopted";
  const p = live ? versionProblems(inp, v, evidence, graph) : { integrity: [], evidence: [], dependency: [] };
  const shown: AnalysisShown = p.integrity.length ? "invalid" : reviewReasons(p).length ? "expired" : recorded;
  return { id: v.id, episodeId: v.episodeId, seq: v.seq, recorded, shown, reasons: [...p.integrity, ...reviewReasons(p)], last: v.events[v.events.length - 1] };
}
export const versionsOf = (f: AnalysisFile, episodeId: string) => f.versions.filter((v) => v.episodeId === episodeId).sort((a, b) => a.seq - b.seq);
/** The adopted version the page reads for an episode: the newest one recorded as adopted (it may be expired or invalid: shown with a re-review note / withheld). */
export const adoptedOf = (f: AnalysisFile, episodeId: string) => versionsOf(f, episodeId).filter((v) => v.events?.length && storedStatus(v) === "adopted").pop() ?? null;
/** The newest version still waiting for review (draft or pending) - independent of the adopted one that is on display. */
export const waitingOf = (f: AnalysisFile, episodeId: string) => versionsOf(f, episodeId).filter((v) => v.events?.length && (storedStatus(v) === "draft" || storedStatus(v) === "pending_review")).pop() ?? null;

const clone = (f: AnalysisFile): AnalysisFile => structuredClone(f);
const need = (s: unknown, what: string) => { if (typeof s !== "string" || s.trim().length < 1) throw new AnalysisRefused("missing_basis", [`${what}不能为空`]); return s.trim(); };

interface Checks { evidence: EvidenceResolver | undefined }

/** Append a new draft. An identical body over an identical snapshot as the episode's newest live version is not added again (replay-safe). */
export function addDraft(file: AnalysisFile, inp: Ledgers, a: { episodeId: string; author: string; at: string; body: AnalysisBody } & Checks): { file: AnalysisFile; version: AnalysisVersion; created: boolean } {
  need(a.author, "作者"); need(a.at, "时间");
  const H = inp.history;
  if (!H || !H.entities[entityKey("episode", a.episodeId)]) throw new AnalysisRefused("unknown_episode", [`病程 ${a.episodeId} 不在底账里`]);
  const ep = effectiveContent(H, { kind: "episode", id: a.episodeId })!.content;
  const errs = validateBody(a.body, { endKnown: ep.declaredEnd === "ended" });
  if (errs.length) throw new AnalysisRefused("invalid_body", errs);
  const snapshot = snapshotOf(inp, a.episodeId, a.body, a.evidence);
  // the data date must cover every dated record the reading cites (other episodes included)
  let latest = "";
  for (const r of a.body.factRefs) { const L = ledgerOf(inp, r.ledger); const d = L ? refDate(L, r.ref) : null; if (d && d > latest) latest = d; }
  if (latest && latest > a.body.dataAsOf) throw new AnalysisRefused("invalid_body", [`dataAsOf ${a.body.dataAsOf} 早于引用的记录日期 ${latest}：分析读到资料的截止日期要覆盖所有引用`]);
  const bodyHash = hashOf(a.body), snapshotHash = hashOf(snapshot);
  const mine = versionsOf(file, a.episodeId);
  const same = mine.filter((v) => v.bodyHash === bodyHash && v.snapshotHash === snapshotHash && storedStatus(v) !== "rejected" && storedStatus(v) !== "superseded").pop();
  if (same) return { file, version: same, created: false };
  const seq = (mine[mine.length - 1]?.seq ?? 0) + 1;
  const v: AnalysisVersion = { id: `AV-${a.episodeId}-${seq}`, episodeId: a.episodeId, seq, createdAt: a.at, author: a.author, bodyHash, snapshotHash, body: a.body, snapshot, events: [{ status: "draft", by: a.author, at: a.at }] };
  const next = clone(file); next.versions.push(v);
  return { file: next, version: v, created: true };
}

function pick(file: AnalysisFile, id: string) {
  const v = file.versions.find((x) => x.id === id);
  if (!v) throw new AnalysisRefused("unknown_version", [`没有这一版分析 ${id}`]);
  return v;
}
function gate(inp: Ledgers, v: AnalysisVersion, evidence: EvidenceResolver | undefined) {
  const p = versionProblems(inp, v, evidence);
  if (p.integrity.length) throw new AnalysisRefused("integrity_failed", p.integrity);
  if (p.evidence.length) throw new AnalysisRefused("evidence_invalid", p.evidence);
  if (p.dependency.length) throw new AnalysisRefused("dependency_changed", p.dependency);
}

export function submit(file: AnalysisFile, inp: Ledgers, a: { id: string; by: string; at: string } & Checks): AnalysisFile {
  const v = pick(file, a.id);
  if (storedStatus(v) !== "draft") throw new AnalysisRefused("bad_state", [`只有草稿能提交审核，当前是 ${storedStatus(v)}`]);
  gate(inp, v, a.evidence);
  const next = clone(file); pick(next, a.id).events.push({ status: "pending_review", by: need(a.by, "提交人"), at: need(a.at, "时间") });
  return next;
}

/** Adoption re-checks content seal, medical evidence and fact dependencies at this very moment: anything changed while it waited refuses it. */
export function adopt(file: AnalysisFile, inp: Ledgers, a: { id: string; by: string; at: string; basis: string } & Checks): AnalysisFile {
  const v = pick(file, a.id);
  if (storedStatus(v) !== "pending_review") throw new AnalysisRefused("bad_state", [`只有待审核的版本能采用，当前是 ${storedStatus(v)}`]);
  const by = need(a.by, "采用人"), at = need(a.at, "时间"), basis = need(a.basis, "审核依据");
  if (basis.length < 2) throw new AnalysisRefused("missing_basis", ["审核依据需要写清楚对照了什么"]);
  gate(inp, v, a.evidence);
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
