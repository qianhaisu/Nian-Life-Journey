// Private, reviewable health timeline built from the ledger. One block per episode so a change only
// recomputes the episodes it touches: a block is reused only when its DEPENDENCY CLOSURE hash (episode,
// members, encounters, hospital facts, sources at their bound versions, effective roles, corrections) is
// unchanged. Cached output must equal a from-scratch build; tests compare them.
// Every item carries the observation version, its source chain (bound versions) and any corrections;
// unknown occurrence time is shown as the message record time and labelled as such — never as the event time.
// Nothing is silently truncated: a shortened text is marked and the full text is in timeline.json.
import { Graph, effectiveContent, type EffLink } from "./graph";
import { entityKey, hashOf, type Content, type Correction, type Ledger } from "./model";

export type Category = "prescription" | "plan" | "handoff" | "summary_relay" | "executed_report" | "not_given_report" | "question" | "reminder" | "recall" | "relay" | "observation";
export interface SourceRef { id: string; role: "from_source" | "supports"; boundVersion: number | null; currentVersion: number; newerVersionAvailable: boolean; sha256?: string; relPath?: string }
export interface TraceInfo { observationId: string; version: number; sources: SourceRef[]; corrections: string[] }
export interface TimelineItem {
  observationId: string; displayTime: string; timeKind: "occurred" | "recorded_only"; precision: string | null;
  recordedAt: string; category: Category; role: string; text: string; textTruncated: boolean; trace: TraceInfo; counted: boolean; linkBasis: string | null;
}
export interface FactView { id: string; type: string; value: unknown; agreement: unknown; valueConflict: unknown; abnormal: unknown; actuallyTaken: unknown; primarySource: unknown; allSourceValues: unknown; documents: SourceRef[]; historicalCorrections: string[] }
export interface EncounterView { id: string; kind: string; kindLabel: string; countsAsVisit: boolean; date: unknown; precision: unknown; hospital: unknown; dept: unknown; diagnoses: unknown; note: unknown; documents: SourceRef[]; facts: FactView[] }
export type DerivedStatus = "ongoing" | "ended" | "end_unknown" | "stale_no_recent_update";
export interface TimelineBlock {
  episodeId: string; inputHash: string; title: string; start: string | null; startBasis: string | null; end: string | null;
  declaredEnd: string; derivedStatus: DerivedStatus; lastUpdate: string | null; treatmentCourse: string; extra: Record<string, unknown>;
  encounters: EncounterView[]; items: TimelineItem[]; candidates: TimelineItem[]; background: TimelineItem[];
}
export interface Timeline {
  asOf: string; blocks: TimelineBlock[];
  unattached: TimelineItem[]; unattachedEncounters: EncounterView[]; unattachedFacts: FactView[];
  ambiguities: { a: string; b: string; reason: string }[];
  stats: { computed: number; reused: number };
}

const ROLE_CATEGORY: [RegExp, Category][] = [
  [/^summary_relay$/, "summary_relay"],
  [/prescri/, "prescription"], [/handoff|handover/, "handoff"], [/not_given|withheld|not_taken/, "not_given_report"],
  [/administered|adherence|actually_taken|executed/, "executed_report"], [/plan|regimen|intent|planned|standby|consider/, "plan"],
  [/remind/, "reminder"], [/question/, "question"], [/recall|history|recollection/, "recall"], [/relay|hearsay/, "relay"],
];
export const categoryOf = (role: string): Category => ROLE_CATEGORY.find(([re]) => re.test(role))?.[1] ?? "observation";
const ENCOUNTER_KIND: Record<string, { label: string; visit: boolean }> = {
  visit: { label: "已就诊", visit: true }, appointment_only: { label: "仅预约（未就诊）", visit: false }, diagnostic_only: { label: "仅检查", visit: false },
};
const TEXT_LIMIT = 160;

class View {
  g: Graph;
  private byFrom = new Map<string, EffLink[]>();
  private byTo = new Map<string, EffLink[]>();
  constructor(public ledger: Ledger) {
    this.g = new Graph(ledger);
    for (const l of this.g.links) {
      if (l.effectiveRole === "removed") continue;
      const fk = entityKey(l.from.kind, l.from.id), tk = entityKey(l.to.kind, l.to.id);
      (this.byFrom.get(fk) ?? this.byFrom.set(fk, []).get(fk)!).push(l);
      (this.byTo.get(tk) ?? this.byTo.set(tk, []).get(tk)!).push(l);
    }
  }
  out(kind: string, id: string) { return this.byFrom.get(`${kind}:${id}`) ?? []; }
  inn(kind: string, id: string) { return this.byTo.get(`${kind}:${id}`) ?? []; }
  eff(kind: string, id: string) { return effectiveContent(this.ledger, { kind: kind as never, id }); }
  sourceRefs(l: EffLink[], roles: string[]): SourceRef[] {
    return l.filter((x) => roles.includes(x.effectiveRole) && x.to.kind === "source").map((x) => {
      const s = this.ledger.entities[entityKey("source", x.to.id)];
      const cur = s?.versions.length ?? 0;
      const bound = x.toVersion ?? cur;
      const c = (s?.versions[bound - 1]?.content ?? {}) as Content;
      return { id: x.to.id, role: (x.effectiveRole === "supports" ? "supports" : "from_source") as SourceRef["role"], boundVersion: x.toVersion ?? null, currentVersion: cur, newerVersionAvailable: cur > bound, sha256: c.sha256 as string | undefined, relPath: c.relPath as string | undefined };
    }).sort((a, b) => (a.role === b.role ? a.id.localeCompare(b.id) : a.role === "from_source" ? -1 : 1));
  }
  item(observationId: string, counted: boolean, basis: string | null): TimelineItem | null {
    const eff = this.eff("observation", observationId);
    if (!eff) return null;
    const c = eff.content;
    const occurred = typeof c.occurredAt === "string" && c.occurredAt ? c.occurredAt : null;
    const recordedAt = String(c.recordedAt ?? "");
    const full = String(c.text ?? c.basis ?? "").replace(/\s+/g, " ").trim();
    return {
      observationId, displayTime: occurred ?? recordedAt, timeKind: occurred ? "occurred" : "recorded_only", precision: occurred ? String(c.occurredPrecision ?? "") : null,
      recordedAt, category: categoryOf(String(c.role)), role: String(c.role), text: full, textTruncated: full.length > TEXT_LIMIT,
      trace: { observationId, version: eff.version, sources: this.sourceRefs(this.out("observation", observationId), ["from_source", "supports"]), corrections: eff.corrections }, counted, linkBasis: basis,
    };
  }
  historicalFor(kind: string, id: string): string[] {
    return this.ledger.corrections.filter((c): c is Extract<Correction, { type: "historical" }> => c.type === "historical" && ((c.ref.kind === kind && c.ref.id === id) || c.targets.some((t) => t.kind === kind && t.id === id))).map((c) => c.id).sort();
  }
  fact(id: string): FactView | null {
    const e = this.eff("canonical_fact", id);
    if (!e) return null;
    const c = e.content;
    return { id, type: String(c.type), value: c.value, agreement: c.agreement ?? null, valueConflict: c.valueConflict ?? null, abnormal: c.abnormal ?? null, actuallyTaken: c.actuallyTaken ?? null, primarySource: c.primarySource ?? null, allSourceValues: c.allSourceValues ?? null, documents: this.sourceRefs(this.out("canonical_fact", id), ["documented_in"]), historicalCorrections: this.historicalFor("canonical_fact", id) };
  }
  encounter(id: string): EncounterView | null {
    const e = this.eff("encounter", id);
    if (!e) return null;
    const c = e.content;
    const k = ENCOUNTER_KIND[String(c.kind)] ?? { label: `其他（${String(c.kind)}）`, visit: false };
    const facts = this.inn("encounter", id).filter((l) => l.effectiveRole === "of_encounter").map((l) => this.fact(l.from.id)).filter((f): f is FactView => !!f).sort((a, b) => a.id.localeCompare(b.id));
    return { id, kind: String(c.kind), kindLabel: k.label, countsAsVisit: k.visit, date: c.date, precision: c.precision ?? null, hospital: c.hospital ?? null, dept: c.dept ?? null, diagnoses: c.diagnoses ?? null, note: c.note ?? null, documents: this.sourceRefs(this.out("encounter", id), ["documented_in"]), facts };
  }
}
const byTime = (a: TimelineItem, b: TimelineItem) => (a.displayTime === b.displayTime ? a.observationId.localeCompare(b.observationId) : a.displayTime < b.displayTime ? -1 : 1);
const EXTRA_KEYS = ["endBasis", "canonical", "groupId", "group", "canonicalBasis", "primaryInGroup", "supersededBy", "keyFindings", "openQuestions", "execution", "encounterRefs", "hospitalSource"];

export function buildTimeline(ledger: Ledger, opts: { asOf: string; staleDays?: number; previous?: Timeline }): Timeline {
  const staleDays = opts.staleDays ?? 14;
  const v = new View(ledger);
  const prev = new Map((opts.previous?.blocks ?? []).map((b) => [b.episodeId, b]));
  const blocks: TimelineBlock[] = [];
  let computed = 0, reused = 0;
  const placedObs = new Set<string>(), placedEnc = new Set<string>();
  const episodeIds = Object.values(ledger.entities).filter((e) => e.kind === "episode").map((e) => e.id).sort();
  for (const id of episodeIds) {
    const closure = v.g.closureHash({ kind: "episode", id });
    const deps = new Set(v.g.dependenciesOf(entityKey("episode", id)));
    const hist = ledger.corrections.filter((c) => c.type === "historical" && (deps.has(entityKey(c.ref.kind, c.ref.id)) || c.targets.some((t) => deps.has(entityKey(t.kind, t.id))))).map((c) => c.reqHash).sort();
    const inputHash = hashOf({ closure, hist, asOf: opts.asOf.slice(0, 10), staleDays });
    const members = v.inn("episode", id).filter((l) => ["attached", "candidate", "background"].includes(l.effectiveRole));
    for (const l of members) placedObs.add(l.from.id);
    for (const l of v.out("episode", id)) if (l.effectiveRole === "encounter") placedEnc.add(l.to.id);
    const old = prev.get(id);
    if (old && old.inputHash === inputHash) { blocks.push(old); reused++; continue; }
    computed++;
    const ep = v.eff("episode", id)!.content as Content;
    const pick = (role: string, counted: boolean) => members.filter((l) => l.effectiveRole === role).map((l) => v.item(l.from.id, counted, l.basis ?? null)).filter((x): x is TimelineItem => !!x).sort(byTime);
    const items = pick("attached", true), candidates = pick("candidate", false), background = pick("background", false);
    const lastUpdate = items.length ? items[items.length - 1].displayTime : (ep.start as string | null) ?? null;
    const declaredEnd = String(ep.declaredEnd);
    let derived: DerivedStatus = declaredEnd === "ended" ? "ended" : declaredEnd === "end_unknown" ? "end_unknown" : "ongoing";
    if (derived === "ongoing" && lastUpdate && daysBetween(lastUpdate, opts.asOf) > staleDays) derived = "stale_no_recent_update";
    const encounters = v.out("episode", id).filter((l) => l.effectiveRole === "encounter").map((l) => v.encounter(l.to.id)).filter((x): x is EncounterView => !!x).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
    const extra: Record<string, unknown> = {};
    for (const k of EXTRA_KEYS) if (ep[k] !== undefined) extra[k] = ep[k];
    blocks.push({ episodeId: id, inputHash, title: String(ep.title), start: (ep.start as string | null) ?? null, startBasis: (ep.startBasis as string | null) ?? null, end: (ep.end as string | null) ?? null, declaredEnd, derivedStatus: derived, lastUpdate, treatmentCourse: String(ep.treatmentCourse ?? "unknown"), extra, encounters, items, candidates, background });
  }
  blocks.sort((a, b) => ((a.start ?? "9999") === (b.start ?? "9999") ? a.episodeId.localeCompare(b.episodeId) : (a.start ?? "9999") < (b.start ?? "9999") ? -1 : 1));
  const unattached = Object.values(ledger.entities).filter((e) => e.kind === "observation" && !placedObs.has(e.id)).map((e) => v.item(e.id, false, null)!).sort(byTime);
  const unattachedEncounters = Object.values(ledger.entities).filter((e) => e.kind === "encounter" && !placedEnc.has(e.id)).map((e) => v.encounter(e.id)!).sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id));
  const unattachedFacts = Object.values(ledger.entities).filter((e) => e.kind === "canonical_fact" && !v.out("canonical_fact", e.id).some((l) => l.effectiveRole === "of_encounter")).map((e) => v.fact(e.id)!).sort((a, b) => a.id.localeCompare(b.id));
  const ambiguities = Object.values(ledger.ambiguities).sort((a, b) => (a.a + a.b).localeCompare(b.a + b.b));
  return { asOf: opts.asOf, blocks, unattached, unattachedEncounters, unattachedFacts, ambiguities, stats: { computed, reused } };
}
function daysBetween(a: string, b: string) { return (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000; }

/** Timeline equality ignoring cache statistics: what a cached build must satisfy against a from-scratch build. */
export const timelineContentHash = (t: Timeline) => hashOf({ ...t, stats: undefined });

// ---------- diff (full content, not just membership) ----------
export interface TimelineDiff {
  addedBlocks: string[]; removedBlocks: string[];
  changedBlocks: { episodeId: string; addedItems: string[]; removedItems: string[]; changedItems: string[]; metaChanged: boolean; statusChange?: [string, string] }[];
  unchangedBlocks: number;
  unattached: { added: string[]; removed: string[]; changed: string[] };
  unattachedEncounters: { added: string[]; removed: string[]; changed: string[] };
  unattachedFacts: { added: string[]; removed: string[]; changed: string[] };
}
const delta = <T>(a: T[], b: T[], id: (x: T) => string) => {
  const am = new Map(a.map((x) => [id(x), hashOf(x)])), bm = new Map(b.map((x) => [id(x), hashOf(x)]));
  return { added: [...bm.keys()].filter((k) => !am.has(k)).sort(), removed: [...am.keys()].filter((k) => !bm.has(k)).sort(), changed: [...bm.keys()].filter((k) => am.has(k) && am.get(k) !== bm.get(k)).sort() };
};
export function diffTimelines(a: Timeline, b: Timeline): TimelineDiff {
  const am = new Map(a.blocks.map((x) => [x.episodeId, x])), bm = new Map(b.blocks.map((x) => [x.episodeId, x]));
  const out: TimelineDiff = { addedBlocks: [], removedBlocks: [], changedBlocks: [], unchangedBlocks: 0, unattached: delta(a.unattached, b.unattached, (x) => x.observationId), unattachedEncounters: delta(a.unattachedEncounters, b.unattachedEncounters, (x) => x.id), unattachedFacts: delta(a.unattachedFacts, b.unattachedFacts, (x) => x.id) };
  for (const [id] of bm) if (!am.has(id)) out.addedBlocks.push(id);
  for (const [id, x] of am) {
    const y = bm.get(id);
    if (!y) { out.removedBlocks.push(id); continue; }
    const key = (blk: TimelineBlock) => new Map([...blk.items.map((i) => [`m:${i.observationId}`, hashOf(i)] as const), ...blk.candidates.map((i) => [`c:${i.observationId}`, hashOf(i)] as const), ...blk.background.map((i) => [`b:${i.observationId}`, hashOf(i)] as const)]);
    const xa = key(x), ya = key(y);
    const added = [...ya.keys()].filter((k) => !xa.has(k)), removed = [...xa.keys()].filter((k) => !ya.has(k)), changed = [...ya.keys()].filter((k) => xa.has(k) && xa.get(k) !== ya.get(k));
    const shell = (t: TimelineBlock) => hashOf({ ...t, items: 0, candidates: 0, background: 0, inputHash: 0, derivedStatus: 0 });
    const metaChanged = shell(x) !== shell(y);
    const statusChange = x.derivedStatus !== y.derivedStatus ? ([x.derivedStatus, y.derivedStatus] as [string, string]) : undefined;
    if (added.length || removed.length || changed.length || statusChange || metaChanged) out.changedBlocks.push({ episodeId: id, addedItems: added, removedItems: removed, changedItems: changed, metaChanged, statusChange });
    else out.unchangedBlocks++;
  }
  return out;
}

// ---------- trace ----------
export function traceObservation(ledger: Ledger, observationId: string) {
  const e = ledger.entities[entityKey("observation", observationId)];
  if (!e) return null;
  const v = new View(ledger);
  return {
    observation: { id: observationId, versions: e.versions.map((x) => ({ version: x.version, hash: x.hash, runId: x.runId, at: x.at })) },
    sources: v.sourceRefs(v.out("observation", observationId), ["from_source", "supports"]).map((s) => ({ role: s.role, source: s.id, boundVersion: s.boundVersion, currentVersion: s.currentVersion, newerVersionAvailable: s.newerVersionAvailable, entity: ledger.entities[entityKey("source", s.id)]?.versions[(s.boundVersion ?? s.currentVersion) - 1]?.content ?? null })),
    removedSources: v.g.links.filter((l) => l.from.kind === "observation" && l.from.id === observationId && l.effectiveRole === "removed" && l.to.kind === "source").map((l) => ({ source: l.to.id, correctionId: l.correctionId ?? null })),
    membership: v.g.links.filter((l) => l.from.kind === "observation" && l.from.id === observationId && l.to.kind === "episode").map((l) => ({ episode: l.to.id, declaredRole: l.role, effectiveRole: l.effectiveRole, correctionId: l.correctionId ?? null })),
    corrections: ledger.corrections.filter((c) => (c.type === "field" && c.ref.kind === "observation" && c.ref.id === observationId) || (c.type === "link" && c.linkId.includes(`observation:${observationId}|`))),
  };
}

// ---------- rendering ----------
const CATEGORY_LABEL: Record<Category, string> = { prescription: "处方", plan: "计划", handoff: "交接", summary_relay: "汇总稿转述", executed_report: "实际执行报告", not_given_report: "未执行报告", question: "提问", reminder: "提醒", recall: "回忆", relay: "转述", observation: "观察" };
const STATUS_LABEL: Record<DerivedStatus, string> = { ongoing: "进行中", ended: "已明确结束", end_unknown: "结束时间未知", stale_no_recent_update: "进行中但近期无更新" };
const COURSE_LABEL: Record<string, string> = { unknown: "疗程未知" };
const S = (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x));

function line(i: TimelineItem) {
  const t = i.timeKind === "occurred" ? `${i.displayTime}（发生，${i.precision}）` : `${i.displayTime}（仅消息记录时间，发生时间未知）`;
  const corr = i.trace.corrections.length ? ` ✎更正 ${i.trace.corrections.join(",")}` : "";
  const text = i.textTruncated ? `${i.text.slice(0, TEXT_LIMIT)}…（节选，全文见 timeline.json）` : i.text;
  const src = i.trace.sources.map((s) => `${s.id}${s.boundVersion ? `@v${s.boundVersion}` : ""}${s.newerVersionAvailable ? "(有更新版本)" : ""}`).join("、") || "无";
  return `- ${t} · ${CATEGORY_LABEL[i.category]} · ${text} ⟨${i.observationId} v${i.trace.version}; 来源 ${src}${i.linkBasis ? `; 关联依据 ${i.linkBasis}` : ""}⟩${corr}`;
}
function encLines(e: EncounterView) {
  const out = [`- ${S(e.date)} · ${e.kindLabel}${e.countsAsVisit ? "" : "（不计入已发生就诊次数）"} · ${S(e.hospital ?? "")} ${S(e.dept ?? "")} ⟨${e.id}; 文件 ${e.documents.map((d) => d.id).join("、") || "无"}⟩${e.diagnoses ? ` 诊断：${S(e.diagnoses)}` : ""}${e.note ? ` 备注：${S(e.note)}` : ""}`];
  for (const f of e.facts) out.push(`  - [${f.type}] ${S(f.value)}${f.abnormal ? `（异常：${S(f.abnormal)}）` : ""}${f.actuallyTaken ? `（服药：${S(f.actuallyTaken)}）` : ""} 一致性 ${S(f.agreement)}${f.valueConflict ? " ⚠取值冲突" : ""} ⟨${f.id}; 来源 ${f.documents.map((d) => d.id).join("、") || "无"}${f.historicalCorrections.length ? `; 历史更正 ${f.historicalCorrections.join(",")}` : ""}⟩`);
  return out;
}
export function renderMarkdown(t: Timeline): string {
  const out: string[] = [`# 健康历史时间轴（私有审阅稿）`, `截至 ${t.asOf}。候选与同期背景不计入该病程的确认事实；预约/仅检查不计入已发生就诊。文本节选处已标注，完整内容见 timeline.json。`, ""];
  for (const b of t.blocks) {
    out.push(`## ${b.title}（${b.episodeId}）`, `- 起：${b.start ?? "未知"}${b.startBasis ? `（${b.startBasis}）` : ""}；状态：${STATUS_LABEL[b.derivedStatus]}${b.end ? `；止：${b.end}` : ""}；${COURSE_LABEL[b.treatmentCourse] ?? b.treatmentCourse}`);
    out.push(`- 确认事实 ${b.items.length}；候选 ${b.candidates.length}；同期背景 ${b.background.length}；就诊/检查记录 ${b.encounters.length}`, "");
    if (b.encounters.length) out.push("**就诊与医院事实**", ...b.encounters.flatMap(encLines), "");
    out.push(...b.items.map(line));
    if (b.candidates.length) out.push("", "**候选（不计入确认事实）**", ...b.candidates.map(line));
    if (b.background.length) out.push("", "**同期背景（不计入确认事实）**", ...b.background.map(line));
    out.push("");
  }
  out.push(`## 未挂靠到任何病程的就诊/检查（${t.unattachedEncounters.length}）`, ...t.unattachedEncounters.flatMap(encLines), "");
  out.push(`## 未挂靠到任何就诊的规范事实（${t.unattachedFacts.length}）`, "源资料没有就诊号；保留为本人事实，不伪造就诊。", ...t.unattachedFacts.map((f) => `- [${f.type}] ${S(f.value)} ⟨${f.id}; 来源 ${f.documents.map((d) => d.id).join("、") || "无"}⟩`), "");
  out.push(`## 未挂靠到任何病程的观察（${t.unattached.length}，全部列出）`, "未挂靠不等于无关，只是不据日期硬挂。", "", ...t.unattached.map(line), "");
  if (t.ambiguities.length) out.push(`## 待人工判断的同槽位歧义（${t.ambiguities.length}）`, ...t.ambiguities.map((a) => `- ${a.a} ↔ ${a.b}：${a.reason}`));
  return out.join("\n");
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function renderHtml(t: Timeline): string {
  const md = renderMarkdown(t).split("\n").map((l) => (l.startsWith("## ") ? `<h2>${esc(l.slice(3))}</h2>` : l.startsWith("# ") ? `<h1>${esc(l.slice(2))}</h1>` : /^\s*- /.test(l) ? `<li style="margin-left:${l.startsWith("  ") ? 2 : 0}em">${esc(l.replace(/^\s*- /, ""))}</li>` : l ? `<p>${esc(l)}</p>` : "")).join("\n");
  return `<!doctype html><meta charset="utf-8"><title>health timeline</title><style>body{font:14px/1.6 system-ui;max-width:900px;margin:2em auto;padding:0 1em}li{margin:.2em 0}</style>\n${md}`;
}
